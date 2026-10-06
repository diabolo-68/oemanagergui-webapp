/**
 * OE Manager GUI - Logfiles Analyzer View Mixin
 * Ported from oemanagergui VS Code extension (logfilesAnalyzerPanel.ts).
 *
 * Provides:
 * - Agent log + Access log file upload and parsing
 * - Virtual scrolling log table (PAGE_SIZE=200, ROW_HEIGHT=24)
 * - 9-column grid with source icon, timestamp, PID/IP, agent#, session, requestId, type, duration, message
 * - Filter bar with 10 criteria + 300ms debounce for text inputs
 * - Sort by timestamp or duration
 * - Correlation panel (click request ID to see all related entries)
 * - Pre-filtered open from other views (openLogfilesWith)
 */
const LOG_CHUNK_BYTES = 256 * 1024;
const LOG_MAX_CHUNKS_PER_SOURCE = 3;

const LogfilesViewMixin = {

    // ==================== INITIALIZATION ====================

    /**
     * Initialize logfiles view state. Called from constructor or switchView.
     */
    initLogfilesState() {
        if (this._logfilesInitialized) { return; }
        this._logfilesInitialized = true;

        this.logFileService = new LogFileService();

        // Data state
        this.logAllEntries = [];
        this.logFilteredEntries = [];
        this.logCorrelationIndex = new Map();
        this.logCurrentFilters = {};
        this.logSortField = 'timestamp';
        this.logSortDirection = 'asc';

        // Filter metadata
        this.logKnownAgentNumbers = [];
        this.logKnownProcessIds = [];
        this.logKnownLogTypes = [];
        this.logKnownClientIps = [];
        this.logKnownStatusCodes = [];

        // Virtual scroll state
        this.logPageEntries = [];
        this.logTotalFilteredCount = 0;
        this.logCurrentStartIndex = 0;
        this.logSelectedRequestId = null;
        this.logHighlightedRequestId = null;
        this.logFollowTail = false;
        this.logPendingNewEntries = 0;
        this.logWindowLoading = false;
        this.logSourceWindows = {
            agent: this.createLogSourceWindow('agent'),
            access: this.createLogSourceWindow('access')
        };

        // Auto-load state
        this.logAutoRefreshTimer = null;
        this.logAgentLogOffset = 0;
        this.logAccessLogOffset = 0;
        this.logAutoLoadConfig = null; // { agentLogRelPath, accessLogRelPath, pasoePath }
    },

    /**
     * Called when the logfiles view becomes active.
     */
    loadLogfilesView() {
        this.initLogfilesState();
        this.setupLogfilesEventHandlers();

        // Auto-trigger load on view open if an application is selected and no data loaded yet
        // (matches VS Code extension behavior)
        if (this.selectedApplication && this.logAllEntries.length === 0 && !this._logfilesAutoLoadAttempted) {
            this._logfilesAutoLoadAttempted = true;
            // Defer slightly so the view is rendered first
            setTimeout(() => this.autoLoadLogs(), 100);
        }
    },

    // ==================== EVENT HANDLERS ====================

    setupLogfilesEventHandlers() {
        if (this._logfilesHandlersAttached) { return; }
        this._logfilesHandlersAttached = true;

        const self = this;

        // File inputs
        document.getElementById('logAgentLogFile')?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) { self.handleAgentLogFile(e.target.files[0]); }
        });
        document.getElementById('logAccessLogFile')?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) { self.handleAccessLogFile(e.target.files[0]); }
        });

        // Clear buttons
        document.getElementById('logClearBtn')?.addEventListener('click', () => self.clearLogData());

        // Auto-load controls
        document.getElementById('logBtnAutoLoad')?.addEventListener('click', () => self.autoLoadLogs());
        document.getElementById('logAutoRefreshToggle')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                self.startLogAutoRefresh();
            } else {
                self.stopLogAutoRefresh();
            }
        });

        // Set default date to today
        const dateInput = document.getElementById('logAutoDate');
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }

        // Filter handlers
        const filterIds = ['logFilterSource', 'logFilterAgent', 'logFilterPid', 'logFilterLogType', 'logFilterClientIp', 'logFilterStatusCode'];
        filterIds.forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => self.sendLogFilters());
        });

        // Debounced text filters
        let filterTimeout = null;
        const debouncedFilter = () => {
            clearTimeout(filterTimeout);
            filterTimeout = setTimeout(() => self.sendLogFilters(), 300);
        };
        document.getElementById('logFilterMinResponseTime')?.addEventListener('input', debouncedFilter);
        document.getElementById('logFilterRequestId')?.addEventListener('input', debouncedFilter);
        document.getElementById('logFilterSession')?.addEventListener('input', debouncedFilter);
        document.getElementById('logFilterSearch')?.addEventListener('input', debouncedFilter);

        // Source filter toggles access-only filter visibility
        document.getElementById('logFilterSource')?.addEventListener('change', () => {
            self.updateLogAccessOnlyFilters();
        });

        // Clear filters
        document.getElementById('logBtnClearFilters')?.addEventListener('click', () => self.clearLogFilters());

        // Sort by duration
        document.getElementById('logSortDuration')?.addEventListener('click', () => self.toggleLogSort());

        // Close correlation panel
        document.getElementById('logBtnCloseCorrelation')?.addEventListener('click', () => {
            document.getElementById('logCorrelationPanel')?.classList.remove('open');
            self.logHighlightedRequestId = null;
            self.renderLogRows();
        });

        // Follow Tail toggle
        document.getElementById('logBtnFollowTail')?.addEventListener('click', () => {
            self.logFollowTail = !self.logFollowTail;
            self.updateLogFollowTailButton();
            if (self.logFollowTail) { self.scrollLogToBottom(); }
        });
        document.getElementById('logNewEntriesBadge')?.addEventListener('click', () => {
            self.logFollowTail = true;
            self.updateLogFollowTailButton();
            self.scrollLogToBottom();
        });
        document.getElementById('logBtnOlder')?.addEventListener('click', () => self.loadAdjacentLogWindow('older'));
        document.getElementById('logBtnNewer')?.addEventListener('click', () => self.loadAdjacentLogWindow('newer'));

        // Virtual scroll
        const scrollContainer = document.getElementById('logScrollContainer');
        let scrollTimeout = null;
        scrollContainer?.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => self.handleLogScroll(), 100);
        });

        // Row click delegation
        document.getElementById('logRows')?.addEventListener('click', (e) => self.handleLogRowClick(e));

        // Initialize access-only filter visibility
        this.updateLogAccessOnlyFilters();
    },

    // ==================== FILE HANDLING ====================

    async handleAgentLogFile(file) {
        await this.loadLocalLogFile('agent', file);
    },

    async handleAccessLogFile(file) {
        await this.loadLocalLogFile('access', file);
    },

    createLogSourceWindow(source) {
        return {
            source,
            chunks: [],
            relativePath: '',
            fileName: '',
            pasoePath: undefined,
            localFile: null,
            totalSize: 0,
            hasOlder: false,
            hasNewer: false,
            atTail: true
        };
    },

    async loadLocalLogFile(sourceName, file) {
        const statusEl = document.getElementById(
            sourceName === 'agent' ? 'logAgentLogStatus' : 'logAccessLogStatus'
        );
        if (statusEl) { statusEl.textContent = `Loading ${file.name}...`; }

        const source = this.createLogSourceWindow(sourceName);
        source.fileName = file.name;
        source.localFile = file;
        source.totalSize = file.size;
        this.logSourceWindows[sourceName] = source;

        try {
            await this.loadLogSourceChunk(source, 'initial');
            this.logFollowTail = true;
            this.updateLogFollowTailButton();
            this.rebuildLogWindow(null, true);
        } catch (error) {
            console.error(`[Logfiles] Failed to read ${file.name}:`, error);
            if (statusEl) { statusEl.textContent = `Error reading ${file.name}`; }
            Utils.showToast(`Error reading file: ${file.name}`, 'error');
        }
    },

    async readLocalLogChunk(source, direction, anchorOffset) {
        const file = source.localFile;
        const anchor = anchorOffset ?? (direction === 'backward' ? file.size : 0);
        const rawStart = direction === 'backward'
            ? Math.max(0, anchor - LOG_CHUNK_BYTES)
            : Math.min(anchor, file.size);
        const rawEnd = direction === 'backward'
            ? Math.min(anchor, file.size)
            : Math.min(file.size, rawStart + LOG_CHUNK_BYTES);
        let content = await file.slice(rawStart, rawEnd).text();
        let startOffset = rawStart;

        if (direction === 'backward' && rawStart > 0) {
            const firstNewline = content.indexOf('\n');
            if (firstNewline < 0) {
                content = '';
                startOffset = rawEnd;
            } else {
                const dropped = content.substring(0, firstNewline + 1);
                startOffset += this._utf8ByteLength(dropped);
                content = content.substring(firstNewline + 1);
            }
        }

        if (rawEnd < file.size) {
            const lastNewline = content.lastIndexOf('\n');
            content = lastNewline >= 0 ? content.substring(0, lastNewline + 1) : '';
        }

        const newOffset = startOffset + this._utf8ByteLength(content);
        return {
            content,
            startOffset,
            newOffset,
            totalSize: file.size,
            hasOlder: startOffset > 0,
            hasNewer: newOffset < file.size,
            fileTruncated: false
        };
    },

    async loadLogSourceChunk(source, direction) {
        if (!source.localFile && !source.relativePath) { return false; }

        const firstChunk = source.chunks[0];
        const lastChunk = source.chunks[source.chunks.length - 1];
        const readDirection = direction === 'older' || direction === 'initial' ? 'backward' : 'forward';
        let offset;
        if (direction === 'older') {
            offset = firstChunk?.startOffset;
        } else if (direction === 'newer') {
            offset = lastChunk?.endOffset ?? 0;
        }

        const result = source.localFile
            ? await this.readLocalLogChunk(source, readDirection, offset)
            : await this.agentService.readServerFile(source.relativePath, {
                direction: readDirection,
                offset,
                maxBytes: LOG_CHUNK_BYTES,
                pasoePathOverride: source.pasoePath
            });

        if (result.fileTruncated) {
            source.chunks = [];
            source.totalSize = result.totalSize;
            source.hasOlder = false;
            source.hasNewer = false;
            source.atTail = true;
            if (direction !== 'initial') {
                return this.loadLogSourceChunk(source, 'initial');
            }
        }

        source.totalSize = result.totalSize;
        if (!result.content || result.newOffset <= result.startOffset) {
            source.hasOlder = source.chunks[0]?.startOffset > 0;
            source.hasNewer = false;
            source.atTail = direction !== 'older';
            return false;
        }

        source.chunks = this.logFileService.mergeLogChunk(source.chunks, {
            startOffset: result.startOffset,
            endOffset: result.newOffset,
            content: result.content
        });
        source.chunks = this.logFileService.retainLogChunks(
            source.chunks,
            LOG_MAX_CHUNKS_PER_SOURCE,
            direction === 'older' ? 'older' : 'newer'
        );

        source.hasOlder = source.chunks[0]?.startOffset > 0;
        const windowEnd = source.chunks[source.chunks.length - 1]?.endOffset ?? 0;
        const remainingBytes = Math.max(0, source.totalSize - windowEnd);
        if (direction === 'initial') {
            source.hasNewer = false;
            source.atTail = true;
        } else if (direction === 'newer') {
            source.hasNewer = remainingBytes > 0;
            source.atTail = !source.hasNewer;
        } else {
            source.hasNewer = remainingBytes > 0;
            source.atTail = false;
        }
        return true;
    },

    captureLogViewportAnchor() {
        const scrollContainer = document.getElementById('logScrollContainer');
        if (!scrollContainer || this.logFilteredEntries.length === 0) { return null; }
        const rowIndex = Math.min(
            this.logFilteredEntries.length - 1,
            Math.floor(scrollContainer.scrollTop / 24)
        );
        return {
            key: this.getLogEntryKey(this.logFilteredEntries[rowIndex]),
            remainder: scrollContainer.scrollTop % 24
        };
    },

    getLogEntryKey(entry) {
        if (!entry) { return ''; }
        return [
            entry.source,
            entry.timestamp,
            entry.appRequestId,
            entry.processId ?? entry.clientIp,
            entry.message ?? entry.url
        ].join('|');
    },

    rebuildLogWindow(anchor = null, scrollToTail = false, fallbackDirection = 'older') {
        const agentContent = this.logFileService.joinLogChunks(this.logSourceWindows.agent.chunks);
        const accessContent = this.logFileService.joinLogChunks(this.logSourceWindows.access.chunks);
        const agentEntries = this.logFileService.parseAgentLog(agentContent);
        const accessEntries = this.logFileService.parseAccessLog(accessContent);

        this.logAllEntries = this.logFileService.mergeEntries(agentEntries, accessEntries);
        this.logCorrelationIndex = this.logFileService.buildShortIdCorrelationIndex(this.logAllEntries);
        this.updateLogFilterMetadata();
        this.logFilteredEntries = this.logFileService.filterEntries(this.logAllEntries, this.logCurrentFilters);
        this.sortLogFilteredEntries();
        this.logTotalFilteredCount = this.logFilteredEntries.length;
        this.updateLogEntryCount();
        this.updateLogVirtualSpacer();
        this.hideLogPlaceholder();
        this.updateLogWindowStatus();
        this.updateLogSourceStatuses();

        if (scrollToTail) {
            this.scrollLogToBottom();
            return;
        }

        let anchorIndex = -1;
        if (anchor?.key) {
            anchorIndex = this.logFilteredEntries.findIndex(entry =>
                this.getLogEntryKey(entry) === anchor.key
            );
        }
        const visibleIndex = anchorIndex >= 0
            ? anchorIndex
            : (fallbackDirection === 'newer'
                ? Math.min(100, Math.max(0, this.logFilteredEntries.length - 1))
                : 0);
        this.sendLogPage(Math.max(0, visibleIndex - 50));
        requestAnimationFrame(() => {
            const scrollContainer = document.getElementById('logScrollContainer');
            if (scrollContainer) {
                scrollContainer.scrollTop = visibleIndex * 24 + (anchor?.remainder ?? 0);
            }
        });
    },

    async loadAdjacentLogWindow(direction) {
        if (this.logWindowLoading) { return; }
        const sources = Object.values(this.logSourceWindows).filter(source =>
            direction === 'older' ? source.hasOlder : source.hasNewer
        );
        if (sources.length === 0) {
            this.updateLogWindowStatus();
            return;
        }

        this.logWindowLoading = true;
        this.updateLogWindowStatus(`Loading ${direction} entries...`);
        const anchor = this.captureLogViewportAnchor();

        try {
            const results = await Promise.all(sources.map(source =>
                this.loadLogSourceChunk(source, direction)
            ));
            if (results.some(Boolean)) {
                this.logFollowTail = direction === 'newer' &&
                    Object.values(this.logSourceWindows).every(source => !source.hasNewer);
                this.updateLogFollowTailButton();
                this.rebuildLogWindow(anchor, false, direction);
            }
        } catch (error) {
            console.error(`[Logfiles] Failed to load ${direction} entries:`, error);
            Utils.showToast(`Failed to load ${direction} log entries: ${error.message}`, 'error');
        } finally {
            this.logWindowLoading = false;
            this.updateLogWindowStatus();
        }
    },

    updateLogWindowStatus(message = '') {
        const status = document.getElementById('logWindowStatus');
        const olderButton = document.getElementById('logBtnOlder');
        const newerButton = document.getElementById('logBtnNewer');
        const sources = Object.values(this.logSourceWindows ?? {});
        const hasOlder = sources.some(source => source.hasOlder);
        const hasNewer = sources.some(source => source.hasNewer);
        const loadedBytes = sources.reduce((total, source) =>
            total + source.chunks.reduce((sum, chunk) => sum + (chunk.endOffset - chunk.startOffset), 0), 0
        );

        if (status) {
            status.textContent = message ||
                `${this.logAllEntries.length.toLocaleString()} loaded-window entries ` +
                `(${(loadedBytes / 1024).toFixed(0)} KiB)`;
        }
        if (olderButton) {
            olderButton.disabled = this.logWindowLoading || !hasOlder;
        }
        if (newerButton) {
            newerButton.disabled = this.logWindowLoading || !hasNewer;
        }
    },

    updateLogSourceStatuses() {
        for (const source of Object.values(this.logSourceWindows)) {
            if (!source.fileName || source.chunks.length === 0) { continue; }
            const status = document.getElementById(
                source.source === 'agent' ? 'logAgentLogStatus' : 'logAccessLogStatus'
            );
            if (!status) { continue; }

            const entryCount = this.logAllEntries.filter(entry => entry.source === source.source).length;
            const loadedBytes = source.chunks.reduce((sum, chunk) =>
                sum + (chunk.endOffset - chunk.startOffset), 0
            );
            const rangeStart = source.chunks[0].startOffset / (1024 * 1024);
            const rangeEnd = source.chunks[source.chunks.length - 1].endOffset / (1024 * 1024);
            status.textContent = `${source.fileName} — ${entryCount.toLocaleString()} loaded ` +
                `(${(loadedBytes / 1024).toFixed(0)} KiB, ${rangeStart.toFixed(2)}–${rangeEnd.toFixed(2)} ` +
                `of ${(source.totalSize / (1024 * 1024)).toFixed(2)} MiB)`;
        }
    },

    clearLogData() {
        this.logAllEntries = [];
        this.logFilteredEntries = [];
        this.logCorrelationIndex = new Map();
        this.logPageEntries = [];
        this.logTotalFilteredCount = 0;
        this.logCurrentStartIndex = 0;
        this.logSelectedRequestId = null;
        this.logHighlightedRequestId = null;
        this.logKnownAgentNumbers = [];
        this.logKnownProcessIds = [];
        this.logKnownLogTypes = [];
        this.logKnownClientIps = [];
        this.logKnownStatusCodes = [];
        this.logSourceWindows = {
            agent: this.createLogSourceWindow('agent'),
            access: this.createLogSourceWindow('access')
        };
        this.logWindowLoading = false;

        // Reset auto-load state
        this.stopLogAutoRefresh();
        this.logAgentLogOffset = 0;
        this.logAccessLogOffset = 0;
        this.logAutoLoadConfig = null;
        const autoRefreshToggle = document.getElementById('logAutoRefreshToggle');
        if (autoRefreshToggle) { autoRefreshToggle.checked = false; }
        const autoStatus = document.getElementById('logAutoStatus');
        if (autoStatus) { autoStatus.textContent = ''; }

        // Reset UI
        document.getElementById('logAgentLogFile').value = '';
        document.getElementById('logAccessLogFile').value = '';
        document.getElementById('logAgentLogStatus').textContent = 'No file loaded';
        document.getElementById('logAccessLogStatus').textContent = 'No file loaded';
        document.getElementById('logEntryCount').textContent = '';
        document.getElementById('logRows').innerHTML = '';
        document.getElementById('logPlaceholder').style.display = '';
        document.getElementById('logCorrelationPanel')?.classList.remove('open');

        // Reset filter dropdowns
        this.updateLogFilterDropdowns();
        this.clearLogFilters();

        this.updateLogWindowStatus();

        Utils.showToast('Log data cleared', 'success');
    },

    // ==================== FILTERING ====================

    sendLogFilters() {
        const minRt = document.getElementById('logFilterMinResponseTime')?.value;
        const statusVal = document.getElementById('logFilterStatusCode')?.value;

        this.logCurrentFilters = {
            source: document.getElementById('logFilterSource')?.value === 'all' ? undefined : document.getElementById('logFilterSource')?.value,
            agentNumber: document.getElementById('logFilterAgent')?.value || undefined,
            processId: document.getElementById('logFilterPid')?.value || undefined,
            agentSessionId: document.getElementById('logFilterSession')?.value.trim() || undefined,
            logEntryType: document.getElementById('logFilterLogType')?.value || undefined,
            clientIp: document.getElementById('logFilterClientIp')?.value || undefined,
            statusCode: statusVal ? parseInt(statusVal, 10) : undefined,
            minResponseTime: (minRt && !isNaN(parseInt(minRt, 10))) ? parseInt(minRt, 10) : undefined,
            requestId: document.getElementById('logFilterRequestId')?.value || undefined,
            searchText: document.getElementById('logFilterSearch')?.value || undefined,
        };

        this.applyLogFiltersAndRender();
    },

    clearLogFilters() {
        document.getElementById('logFilterSource').value = 'all';
        document.getElementById('logFilterAgent').value = '';
        document.getElementById('logFilterPid').value = '';
        document.getElementById('logFilterSession').value = '';
        document.getElementById('logFilterLogType').value = '';
        document.getElementById('logFilterClientIp').value = '';
        document.getElementById('logFilterStatusCode').value = '';
        document.getElementById('logFilterMinResponseTime').value = '';
        document.getElementById('logFilterRequestId').value = '';
        document.getElementById('logFilterSearch').value = '';
        this.updateLogAccessOnlyFilters();

        this.logSortField = 'timestamp';
        this.logSortDirection = 'asc';
        this.updateLogSortIndicator();
        this.logCurrentFilters = {};
        this.applyLogFiltersAndRender();
    },

    updateLogAccessOnlyFilters() {
        const showAccess = document.getElementById('logFilterSource')?.value !== 'agent';
        document.querySelectorAll('.log-access-only-filter').forEach(el => {
            el.style.display = showAccess ? 'flex' : 'none';
        });
    },

    updateLogFilterMetadata() {
        const agentNums = new Set();
        const processIds = new Set();
        const logTypes = new Set();
        const clientIps = new Set();
        const statusCodes = new Set();

        for (const entry of this.logAllEntries) {
            if (entry.source === 'agent') {
                agentNums.add(entry.agentNumber);
                processIds.add(entry.processId);
                logTypes.add(entry.logEntryType);
            } else {
                clientIps.add(entry.clientIp);
                statusCodes.add(entry.statusCode);
            }
        }

        this.logKnownAgentNumbers = [...agentNums].sort((a, b) => parseInt(a) - parseInt(b));
        this.logKnownProcessIds = [...processIds].sort((a, b) => parseInt(a) - parseInt(b));
        this.logKnownLogTypes = [...logTypes].sort();
        this.logKnownClientIps = [...clientIps].sort();
        this.logKnownStatusCodes = [...statusCodes].sort((a, b) => a - b);

        this.updateLogFilterDropdowns();
    },

    updateLogFilterDropdowns() {
        this.updateLogFilterDropdown('logFilterAgent', this.logKnownAgentNumbers);
        this.updateLogFilterDropdown('logFilterPid', this.logKnownProcessIds);
        this.updateLogFilterDropdown('logFilterLogType', this.logKnownLogTypes);
        this.updateLogFilterDropdown('logFilterClientIp', this.logKnownClientIps);
        this.updateLogFilterDropdown('logFilterStatusCode', this.logKnownStatusCodes);
    },

    updateLogFilterDropdown(selectId, values) {
        const selectEl = document.getElementById(selectId);
        if (!selectEl) { return; }
        const currentValue = selectEl.value;
        while (selectEl.options.length > 1) { selectEl.remove(1); }
        (values ?? []).forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            selectEl.appendChild(opt);
        });
        selectEl.value = currentValue;
    },

    // ==================== SORTING ====================

    toggleLogSort() {
        if (this.logSortField === 'responseTime') {
            this.logSortDirection = this.logSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.logSortField = 'responseTime';
            this.logSortDirection = 'desc';
        }
        this.updateLogSortIndicator();
        this.sortLogFilteredEntries();
        this.sendLogPage(0);
    },

    updateLogSortIndicator() {
        const indicator = document.getElementById('logSortDurationIndicator');
        if (!indicator) { return; }
        indicator.textContent = this.logSortField === 'responseTime'
            ? (this.logSortDirection === 'asc' ? ' ▲' : ' ▼')
            : '';
    },

    sortLogFilteredEntries() {
        if (this.logSortField === 'responseTime') {
            const dir = this.logSortDirection === 'asc' ? 1 : -1;
            this.logFilteredEntries.sort((a, b) => {
                const aTime = a.source === 'access' ? a.responseTime : -1;
                const bTime = b.source === 'access' ? b.responseTime : -1;
                return (aTime - bTime) * dir;
            });
        }
        // 'timestamp' keeps the original chronological order from mergeEntries()
    },

    // ==================== APPLY & RENDER ====================

    applyLogFiltersAndRender() {
        this.logFilteredEntries = this.logFileService.filterEntries(this.logAllEntries, this.logCurrentFilters);
        this.sortLogFilteredEntries();
        this.logTotalFilteredCount = this.logFilteredEntries.length;

        this.updateLogEntryCount();
        this.sendLogPage(0);
    },

    sendLogPage(startIndex) {
        const PAGE_SIZE = 200;
        const endIndex = Math.min(startIndex + PAGE_SIZE, this.logFilteredEntries.length);
        this.logPageEntries = this.logFilteredEntries.slice(startIndex, endIndex);
        this.logCurrentStartIndex = startIndex;
        this.logTotalFilteredCount = this.logFilteredEntries.length;

        this.updateLogVirtualSpacer();
        this.renderLogRows();
    },

    updateLogEntryCount() {
        const el = document.getElementById('logEntryCount');
        if (!el) { return; }
        const total = this.logAllEntries.length;
        const filtered = this.logFilteredEntries.length;
        el.textContent = total === filtered
            ? `${total.toLocaleString()} loaded entries`
            : `${filtered.toLocaleString()} of ${total.toLocaleString()} loaded entries`;
    },

    updateLogVirtualSpacer() {
        const ROW_HEIGHT = 24;
        const spacer = document.getElementById('logVirtualSpacer');
        if (spacer) {
            spacer.style.height = (this.logTotalFilteredCount * ROW_HEIGHT) + 'px';
            spacer.style.position = 'relative';
        }
    },

    hideLogPlaceholder() {
        const placeholder = document.getElementById('logPlaceholder');
        if (placeholder) { placeholder.style.display = 'none'; }
    },

    // ==================== VIRTUAL SCROLL ====================

    handleLogScroll() {
        const ROW_HEIGHT = 24;
        const BUFFER_ROWS = 50;
        const PAGE_SIZE = 200;
        const scrollContainer = document.getElementById('logScrollContainer');
        if (!scrollContainer) { return; }

        const scrollTop = scrollContainer.scrollTop;
        const visibleStart = Math.floor(scrollTop / ROW_HEIGHT);
        const neededStart = Math.max(0, visibleStart - BUFFER_ROWS);

        const hasScrollableRows = this.logFilteredEntries.length > 0 &&
            scrollContainer.scrollHeight > scrollContainer.clientHeight;
        if (hasScrollableRows) {
            if (scrollTop <= ROW_HEIGHT * 3) {
                this.loadAdjacentLogWindow('older');
            } else if (scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - (ROW_HEIGHT * 3)) {
                this.loadAdjacentLogWindow('newer');
            }
        }

        // Auto-disable follow tail
        if (this.logFollowTail && !this.isLogScrolledNearBottom()) {
            this.logFollowTail = false;
            this.updateLogFollowTailButton();
        }

        // Request new page if outside current range
        if (neededStart < this.logCurrentStartIndex || neededStart + PAGE_SIZE > this.logCurrentStartIndex + this.logPageEntries.length) {
            this.sendLogPage(Math.max(0, neededStart));
        }
    },

    isLogScrolledNearBottom() {
        const ROW_HEIGHT = 24;
        const sc = document.getElementById('logScrollContainer');
        if (!sc) { return false; }
        return sc.scrollTop + sc.clientHeight >= sc.scrollHeight - (ROW_HEIGHT * 5);
    },

    scrollLogToBottom() {
        this.logPendingNewEntries = 0;
        const badge = document.getElementById('logNewEntriesBadge');
        if (badge) { badge.classList.add('hidden'); }

        const lastPageStart = Math.max(0, this.logTotalFilteredCount - 200);
        this.sendLogPage(lastPageStart);

        setTimeout(() => {
            const sc = document.getElementById('logScrollContainer');
            if (sc) { sc.scrollTop = sc.scrollHeight; }
        }, 50);
    },

    updateLogFollowTailButton() {
        const btn = document.getElementById('logBtnFollowTail');
        if (!btn) { return; }
        if (this.logFollowTail) {
            btn.classList.add('active');
            btn.classList.remove('secondary');
            this.logPendingNewEntries = 0;
            const badge = document.getElementById('logNewEntriesBadge');
            if (badge) { badge.classList.add('hidden'); }
        } else {
            btn.classList.remove('active');
            btn.classList.add('secondary');
        }
    },

    // ==================== ROW RENDERING ====================

    renderLogRows() {
        const ROW_HEIGHT = 24;
        const rows = document.getElementById('logRows');
        if (!rows) { return; }

        let html = '';
        for (let i = 0; i < this.logPageEntries.length; i++) {
            const entry = this.logPageEntries[i];
            const globalIdx = this.logCurrentStartIndex + i;
            html += this.renderLogRow(entry, globalIdx);
        }
        rows.innerHTML = html;
        rows.style.position = 'absolute';
        rows.style.top = (this.logCurrentStartIndex * ROW_HEIGHT) + 'px';
        rows.style.left = '0';
        rows.style.right = '0';
    },

    renderLogRow(entry, index) {
        const isAgent = entry.source === 'agent';
        let rowClass = 'log-row';

        if (isAgent) {
            const lt = (entry.logEntryType || '').toUpperCase();
            if (lt === 'ERROR' || lt === 'FATAL') { rowClass += ' type-error'; }
            else if (lt === 'WARNING' || lt === 'WARN') { rowClass += ' type-warning'; }
        } else {
            if (entry.statusCode >= 500) { rowClass += ' status-5xx'; }
            else if (entry.statusCode >= 400) { rowClass += ' status-4xx'; }
        }

        // Highlight correlated entries
        if (this.logHighlightedRequestId && entry.appRequestId) {
            const entryShort = this.logFileService.extractShortRequestId(entry.appRequestId);
            const highlightShort = this.logFileService.extractShortRequestId(this.logHighlightedRequestId);
            if (entryShort === highlightShort && entryShort !== '?') {
                rowClass += ' highlighted';
            }
        }

        const esc = this.escapeLogHtml;
        const sourceIcon = isAgent
            ? '<span class="source-icon source-agent">●</span>'
            : '<span class="source-icon source-access">●</span>';

        const timestamp = esc(entry.timestamp || '');
        const pidIp = isAgent ? esc(entry.processId || '') : esc(entry.clientIp || '');
        const agentNum = isAgent ? esc(entry.agentNumber || '') : '';
        const sessionId = isAgent ? esc(entry.agentSessionId || '') : '';
        const requestId = esc(entry.appRequestId || '');
        const shortReqId = this.logFileService.extractShortRequestId(entry.appRequestId || '');
        const typeOrStatus = isAgent ? esc(entry.logEntryType || '') : String(entry.statusCode || '');
        const duration = isAgent ? '' : (entry.responseTime !== undefined ? String(entry.responseTime) : '');
        const message = isAgent
            ? esc(entry.message || '')
            : esc(this.decodeLogUrlSafe(entry.url || ''));

        const reqIdClass = (requestId && requestId !== '?:?:?' && requestId !== '-')
            ? 'request-id-cell'
            : '';

        return `<div class="${rowClass}" data-index="${index}">` +
            `<div>${sourceIcon}</div>` +
            `<div>${timestamp}</div>` +
            `<div>${pidIp}</div>` +
            `<div>${agentNum}</div>` +
            `<div>${sessionId}</div>` +
            `<div class="${reqIdClass}" data-request-id="${requestId}">${esc(shortReqId)}</div>` +
            `<div>${typeOrStatus}</div>` +
            `<div>${duration}</div>` +
            `<div class="message-cell" title="${message}">${message}</div>` +
            `</div>`;
    },

    handleLogRowClick(e) {
        const requestIdCell = e.target.closest('.request-id-cell');
        if (requestIdCell) {
            const reqId = requestIdCell.dataset.requestId;
            if (reqId && reqId !== '?:?:?' && reqId !== '-') {
                this.logHighlightedRequestId = reqId;
                this.showLogCorrelation(reqId);
                this.renderLogRows();
            }
            return;
        }

        const row = e.target.closest('.log-row');
        if (row) {
            const idx = parseInt(row.dataset.index, 10);
            const entry = this.logPageEntries[idx - this.logCurrentStartIndex];
            if (entry) {
                this.logSelectedRequestId = entry.appRequestId;
                this.renderLogRows();
            }
        }
    },

    // ==================== CORRELATION ====================

    showLogCorrelation(requestId) {
        const shortId = this.logFileService.extractShortRequestId(requestId);
        const correlated = this.logCorrelationIndex.get(shortId) ?? [];

        const titleEl = document.getElementById('logCorrelationTitle');
        if (titleEl) {
            titleEl.textContent = `Correlated Entries for ${shortId} (${correlated.length} entries)`;
        }

        const esc = this.escapeLogHtml;
        let html = '';
        for (const e of correlated) {
            const isAgent = e.source === 'agent';
            const cls = isAgent ? 'correlation-entry source-agent' : 'correlation-entry source-access';
            const src = isAgent ? 'AGENT' : 'HTTP';
            const detail = isAgent
                ? `Agent#${e.agentNumber} ${e.agentSessionId} [${e.logEntryType}] ${esc(e.message || '')}`
                : `${e.method} ${esc(this.decodeLogUrlSafe(e.url || ''))} → ${e.statusCode} (${e.responseTime}µs)`;

            html += `<div class="${cls}">` +
                `<span class="entry-source">${src}</span>` +
                `<span class="entry-time">${esc(e.timestamp)}</span>` +
                `<span class="entry-detail">${detail}</span>` +
                `</div>`;
        }

        const entriesEl = document.getElementById('logCorrelationEntries');
        if (entriesEl) { entriesEl.innerHTML = html; }

        document.getElementById('logCorrelationPanel')?.classList.add('open');
    },

    // ==================== UTILITY FUNCTIONS ====================

    escapeLogHtml(text) {
        if (!text) { return ''; }
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    decodeLogUrlSafe(url) {
        try { return decodeURIComponent(url); }
        catch { return url; }
    },

    /**
     * Align an incremental file read to the last complete line.
     *
     * The Java FileReaderServlet returns raw bytes (up to 2 MB) without
     * newline alignment, so reads can split a log entry mid-line. This helper
     * trims the trailing partial line from the returned content and rewinds
     * the byte offset by that many UTF-8 bytes so the next refresh re-reads
     * the incomplete tail.
     *
     * @param {string} content - UTF-8 decoded content returned by the servlet
     * @param {number} newOffset - Byte offset returned in X-New-Offset
     * @returns {{content: string, newOffset: number}}
     */
    trimPartialTrailingLine(content, newOffset) {
        if (!content) { return { content, newOffset }; }
        // Already ends on a line boundary — nothing to trim.
        if (content.endsWith('\n')) { return { content, newOffset }; }

        const lastNl = content.lastIndexOf('\n');
        if (lastNl < 0) {
            // Whole chunk is a single incomplete line. Drop it and rewind
            // fully so we retry on the next tick.
            const droppedBytes = this._utf8ByteLength(content);
            return { content: '', newOffset: Math.max(0, newOffset - droppedBytes) };
        }

        const kept = content.substring(0, lastNl + 1);
        const dropped = content.substring(lastNl + 1);
        const droppedBytes = this._utf8ByteLength(dropped);
        return { content: kept, newOffset: Math.max(0, newOffset - droppedBytes) };
    },

    /** UTF-8 byte length of a string (used to rewind server byte offsets). */
    _utf8ByteLength(s) {
        if (!s) { return 0; }
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(s).length;
        }
        // Fallback for environments without TextEncoder.
        let bytes = 0;
        for (let i = 0; i < s.length; i++) {
            const code = s.charCodeAt(i);
            if (code < 0x80) { bytes += 1; }
            else if (code < 0x800) { bytes += 2; }
            else if (code >= 0xD800 && code <= 0xDBFF) { bytes += 4; i++; }
            else { bytes += 3; }
        }
        return bytes;
    },

    // ==================== AUTO-LOAD FROM PASOE SERVER ====================

    /**
     * Resolve the agent and access log locations for the selected application and date.
     * Reads openedge.properties and resolves date tokens. Shared with the Lifecycles view.
     * @param {string} date - YYYY-MM-DD
     * @returns {Promise<Object>} Relative paths, display names, PASOE path option and date-token flag
     * @throws {Error} With a user-presentable message when paths cannot be resolved
     */
    async resolveLogSources(date) {
        const pasoePath = this.getEffectivePasoePath();
        if (!pasoePath) {
            throw new Error('PASOE path not available. Check Settings → PASOE Instance.');
        }
        if (!this.selectedApplication) {
            throw new Error('Please select an application first (login and connect).');
        }

        const pasoePathOption = this.getPasoePathOption();
        const propsResult = await this.agentService.readServerFile('conf/openedge.properties', {
            pasoePathOverride: pasoePathOption
        });
        const logPaths = this.logFileService.parsePropertiesContent(propsResult.content, pasoePath);
        const agentLogTemplate = logPaths.get(this.selectedApplication);
        if (!agentLogTemplate) {
            throw new Error(`No agentLogFile found for application "${this.selectedApplication}" in openedge.properties`);
        }

        const agentLogPath = this.logFileService.resolveAgentLogPath(agentLogTemplate, date);
        const logDir = this.logFileService.getLogDirectory(agentLogPath);
        const accessLogPath = `${logDir}/localhost-access.${date}.log`;

        return {
            agentLogRelPath: this.logFileService.toRelativePath(agentLogPath, pasoePath),
            accessLogRelPath: this.logFileService.toRelativePath(accessLogPath, pasoePath),
            agentLogFileName: agentLogPath.split(/[\\/]/).pop(),
            accessLogFileName: accessLogPath.split(/[\\/]/).pop(),
            pasoePath: pasoePathOption,
            hasDateToken: this.logFileService.hasDateToken(agentLogTemplate)
        };
    },

    /**
     * Open the Logfiles view for an application/date and apply filters from another view.
     * Filters only cover the bounded loaded window; older entries need "Older".
     * @param {{applicationName?: string, date?: string, processId?: string, agentSessionId?: string, requestId?: string}} preset
     */
    async openLogfilesWith(preset = {}) {
        this.initLogfilesState();
        const { applicationName, date, processId, agentSessionId, requestId } = preset;

        if (applicationName && applicationName !== this.selectedApplication) {
            const select = document.getElementById('applicationSelect');
            if (select) { select.value = applicationName; }
            this.selectApplication(applicationName);
        }

        // Prevents loadLogfilesView from starting a second, unfiltered load
        this._logfilesAutoLoadAttempted = true;
        this.switchView('logfiles');

        const dateInput = document.getElementById('logAutoDate');
        if (dateInput && date) { dateInput.value = date; }

        await this.autoLoadLogs();

        this.clearLogFilters();
        this.setLogFilterValue('logFilterPid', processId);
        this.setLogFilterValue('logFilterSession', agentSessionId);
        this.setLogFilterValue('logFilterRequestId', requestId);
        this.sendLogFilters();

        const statusEl = document.getElementById('logAutoStatus');
        if (statusEl && (processId || agentSessionId || requestId)) {
            statusEl.textContent = 'Filters cover the loaded window only — use ◀ Older to load earlier entries';
        }
    },

    /** Set a filter control; a select gets the option added when the loaded window lacks that value. */
    setLogFilterValue(controlId, value) {
        const control = document.getElementById(controlId);
        if (!control || !value) { return; }
        if (control.tagName === 'SELECT' && !Array.from(control.options).some(o => o.value === value)) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            control.appendChild(option);
        }
        control.value = value;
    },

    /**
     * Auto-load logs from the PASOE server.
     * Reads openedge.properties → resolves log paths → reads log files → parses → displays.
     */
    async autoLoadLogs() {
        this.initLogfilesState();
        const statusEl = document.getElementById('logAutoStatus');
        const dateInput = document.getElementById('logAutoDate');
        const date = dateInput?.value;

        if (!date) {
            Utils.showToast('Please select a date', 'error');
            return;
        }

        if (statusEl) { statusEl.textContent = 'Reading properties...'; }

        try {
            const sources = await this.resolveLogSources(date);
            const {
                agentLogRelPath, accessLogRelPath, agentLogFileName, accessLogFileName, pasoePath: pasoePathOption
            } = sources;

            // Store config for incremental refresh
            this.logAutoLoadConfig = {
                agentLogRelPath,
                accessLogRelPath,
                agentLogFileName,
                accessLogFileName,
                pasoePath: pasoePathOption
            };

            // Clear existing data for a fresh bounded tail window
            this.logAllEntries = [];
            this.logFilteredEntries = [];
            this.logSourceWindows = {
                agent: {
                    ...this.createLogSourceWindow('agent'),
                    relativePath: agentLogRelPath,
                    fileName: agentLogFileName,
                    pasoePath: pasoePathOption
                },
                access: {
                    ...this.createLogSourceWindow('access'),
                    relativePath: accessLogRelPath,
                    fileName: accessLogFileName,
                    pasoePath: pasoePathOption
                }
            };

            // Show resolved filenames immediately
            const agentStatusEl = document.getElementById('logAgentLogStatus');
            const accessStatusEl = document.getElementById('logAccessLogStatus');
            if (agentStatusEl) { agentStatusEl.textContent = `${agentLogFileName} (loading...)`; }
            if (accessStatusEl) { accessStatusEl.textContent = `${accessLogFileName} (loading...)`; }

            if (statusEl) { statusEl.textContent = 'Loading logs...'; }

            // Load only the newest chunk from both logs
            await this.autoLoadIncremental();

            if (statusEl) { statusEl.textContent = `Tail loaded (${this.logAllEntries.length} entries in window)`; }

        } catch (e) {
            console.error('Auto-load failed:', e);
            Utils.showToast(`Auto-load failed: ${e.message}`, 'error');
            if (statusEl) { statusEl.textContent = 'Load failed'; }
        }
    },

    /**
     * Incrementally load new log data from the server using stored offsets.
     */
    async autoLoadIncremental() {
        if (!this.logAutoLoadConfig || this.logWindowLoading) { return; }

        this.logWindowLoading = true;
        const sources = Object.values(this.logSourceWindows).filter(source =>
            source.relativePath && (source.chunks.length === 0 || source.atTail)
        );
        const initialLoad = sources.some(source => source.chunks.length === 0);
        let changed = false;

        try {
            const results = await Promise.all(sources.map(async source => {
                try {
                    return await this.loadLogSourceChunk(
                        source,
                        source.chunks.length === 0 ? 'initial' : 'newer'
                    );
                } catch (error) {
                    const status = document.getElementById(
                        source.source === 'agent' ? 'logAgentLogStatus' : 'logAccessLogStatus'
                    );
                    if (status) {
                        status.textContent = error.message.includes('404')
                            ? `${source.fileName} (not found)`
                            : `${source.fileName} (error)`;
                    }
                    if (!error.message.includes('404')) {
                        console.warn(`[Logfiles] ${source.source} log read error:`, error);
                    }
                    return false;
                }
            }));
            changed = results.some(Boolean);

            if (changed || initialLoad) {
                this.logFollowTail = true;
                this.updateLogFollowTailButton();
                this.rebuildLogWindow(null, true);
            }
            this.updateLogSourceStatuses();
        } finally {
            this.logWindowLoading = false;
            this.updateLogWindowStatus();
        }
    },

    /**
     * Append newly fetched log entries without resetting the current virtual page.
     * Preserves scroll position; either auto-scrolls (Follow Tail) or shows the
     * "+N new" badge so the user can opt in.
     * @param {Array<Object>} newEntries - Entries to append (any source)
     */
    appendLogEntries(newEntries) {
        if (!Array.isArray(newEntries) || newEntries.length === 0) { return; }

        const wasEmpty = this.logFilteredEntries.length === 0;
        // Capture scroll state BEFORE we mutate the spacer so we can decide
        // whether the user was already pinned at the bottom of the log.
        const wasNearBottom = !wasEmpty && this.isLogScrolledNearBottom();

        // Append to master list (no re-sort).
        this.logAllEntries.push(...newEntries);

        // Rebuild correlation index and filter metadata so dropdowns and the
        // correlation panel pick up new request IDs / agents / PIDs.
        this.logCorrelationIndex = this.logFileService.buildShortIdCorrelationIndex(this.logAllEntries);
        this.updateLogFilterMetadata();

        // Filter only the new entries and append matches to the filtered list.
        const newFiltered = this.logFileService.filterEntries(newEntries, this.logCurrentFilters);
        if (newFiltered.length > 0) {
            this.logFilteredEntries.push(...newFiltered);
        }

        this.logTotalFilteredCount = this.logFilteredEntries.length;
        this.updateLogEntryCount();
        this.updateLogVirtualSpacer();

        if (newFiltered.length === 0) {
            // Total grew but nothing matches the active filter — nothing to render.
            return;
        }

        // Decide whether to auto-scroll to the bottom: explicit Follow Tail mode,
        // a fresh load with no prior content, or the user was already pinned at
        // the bottom of the previous render (typical "tail -f" behavior).
        const shouldFollow = this.logFollowTail || wasEmpty || wasNearBottom;

        if (shouldFollow) {
            this.scrollLogToBottom();
        } else {
            // Re-render the current page so any new rows that fall inside the
            // rendered window become visible. Keep logCurrentStartIndex unchanged
            // so the user's scroll position is preserved.
            this.sendLogPage(this.logCurrentStartIndex);

            this.logPendingNewEntries += newFiltered.length;
            const badge = document.getElementById('logNewEntriesBadge');
            if (badge) {
                badge.textContent = `+${this.logPendingNewEntries} new`;
                badge.classList.remove('hidden');
            }
        }
    },

    /**
     * Start auto-refresh timer for incremental log loading.
     */
    startLogAutoRefresh() {
        this.stopLogAutoRefresh();
        if (!this.logAutoLoadConfig) {
            // Trigger initial auto-load first
            this.autoLoadLogs().then(() => {
                if (this.logAutoLoadConfig) {
                    const intervalSec = this.refreshIntervals?.logs || 5;
                    this.logAutoRefreshTimer = setInterval(() => this.autoLoadIncremental(), intervalSec * 1000);
                }
            });
            return;
        }
        const intervalSec = this.refreshIntervals?.logs || 5;
        this.logAutoRefreshTimer = setInterval(() => this.autoLoadIncremental(), intervalSec * 1000);
    },

    /**
     * Stop auto-refresh timer.
     */
    stopLogAutoRefresh() {
        if (this.logAutoRefreshTimer) {
            clearInterval(this.logAutoRefreshTimer);
            this.logAutoRefreshTimer = null;
        }
    },
};

// Allow CommonJS require() in test environments without affecting browser usage.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LogfilesViewMixin };
}
