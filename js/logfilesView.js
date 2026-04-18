/**
 * OE Manager GUI - Logfiles Analyzer View Mixin
 * Ported from oemanagergui VS Code extension (logfilesAnalyzerPanel.ts).
 *
 * Provides:
 * - Agent log + Access log file upload and parsing
 * - Virtual scrolling log table (PAGE_SIZE=200, ROW_HEIGHT=24)
 * - 9-column grid with source icon, timestamp, PID/IP, agent#, session, requestId, type, duration, message
 * - Filter bar with 9 criteria + 300ms debounce for text inputs
 * - Sort by timestamp or duration
 * - Correlation panel (click request ID to see all related entries)
 * - Gantt chart (PID timeline with colored bars)
 * - Flame chart (Canvas 2D with lane assignment, zoom, drag-to-zoom, click-to-correlate)
 * - Resizable bottom panel
 */
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

        // Gantt data
        this.logGanttData = [];

        // Flame chart state
        this.logWaterfallEntries = [];
        this.logWaterfallCurrentPage = 0;
        this.logWaterfallTotalCount = 0;
        this.logFlameState = null;
        this.logFlameHoverIdx = -1;
        this.logFlameDragStartX = null;
        this.logFlameDragCurrentX = null;
        this.logFlameDragging = false;

        // Bottom panel
        this.logActiveBottomTab = 'gantt';
        this.logBottomPanelHeight = 300;
        this.logIsResizing = false;
        this.logResizeStartY = 0;
        this.logResizeStartHeight = 0;

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

        // Virtual scroll
        const scrollContainer = document.getElementById('logScrollContainer');
        let scrollTimeout = null;
        scrollContainer?.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => self.handleLogScroll(), 100);
        });

        // Row click delegation
        document.getElementById('logRows')?.addEventListener('click', (e) => self.handleLogRowClick(e));

        // Bottom panel tabs
        document.getElementById('logTabGantt')?.addEventListener('click', () => self.switchLogBottomTab('gantt'));
        document.getElementById('logTabWaterfall')?.addEventListener('click', () => self.switchLogBottomTab('waterfall'));

        // Bottom panel resizer
        const resizer = document.getElementById('logGanttResizer');
        resizer?.addEventListener('mousedown', (e) => {
            e.preventDefault();
            self.logIsResizing = true;
            self.logResizeStartY = e.clientY;
            self.logResizeStartHeight = document.getElementById('logBottomPanel').offsetHeight;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!self.logIsResizing) { return; }
            const delta = self.logResizeStartY - e.clientY;
            const newHeight = Math.max(80, Math.min(self.logResizeStartHeight + delta, window.innerHeight - 150));
            document.getElementById('logBottomPanel').style.height = newHeight + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (self.logIsResizing) {
                self.logIsResizing = false;
                document.getElementById('logGanttResizer')?.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                self.logBottomPanelHeight = document.getElementById('logBottomPanel')?.offsetHeight ?? 300;
                if (self.logActiveBottomTab === 'waterfall' && self.logFlameState) {
                    self.drawLogFlameChart();
                }
            }
        });

        // Flame chart mouse interactions
        const canvas = document.getElementById('logWaterfallCanvas');
        canvas?.addEventListener('mousemove', (e) => {
            if (self.logFlameDragging || !self.logFlameState) { return; }
            const idx = self.logFlameHitTest(e.offsetX, e.offsetY);
            if (idx !== self.logFlameHoverIdx) {
                self.logFlameHoverIdx = idx;
                self.drawLogFlameChart();
            }
            self.showLogFlameTooltip(idx, e.clientX, e.clientY);
            canvas.style.cursor = idx >= 0 ? 'pointer' : 'crosshair';
        });

        canvas?.addEventListener('mouseleave', () => {
            if (self.logFlameHoverIdx >= 0) {
                self.logFlameHoverIdx = -1;
                self.drawLogFlameChart();
            }
            document.getElementById('logFlameTooltip').style.display = 'none';
        });

        canvas?.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || !self.logFlameState) { return; }
            self.logFlameDragStartX = e.offsetX;
            self.logFlameDragCurrentX = e.offsetX;
            self.logFlameDragging = true;
            document.getElementById('logFlameTooltip').style.display = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!self.logFlameDragging || !self.logFlameState) { return; }
            const rect = canvas.getBoundingClientRect();
            self.logFlameDragCurrentX = e.clientX - rect.left;
            self.drawLogFlameChart();
        });

        document.addEventListener('mouseup', (e) => {
            if (!self.logFlameDragging) { return; }
            self.logFlameDragging = false;
            if (!self.logFlameState) { self.logFlameDragStartX = null; self.logFlameDragCurrentX = null; return; }

            const dx = Math.abs(self.logFlameDragCurrentX - self.logFlameDragStartX);
            if (dx < 5) {
                // Click — correlate
                const rect = canvas.getBoundingClientRect();
                const py = e.clientY - rect.top;
                const idx = self.logFlameHitTest(self.logFlameDragStartX, py);
                if (idx >= 0) {
                    const entry = self.logFlameState.entries[idx];
                    if (entry.requestId && entry.requestId !== '-') {
                        self.logHighlightedRequestId = entry.requestId;
                        self.showLogCorrelation(entry.requestId);
                        self.renderLogRows();
                    }
                }
            } else {
                // Drag-to-zoom
                const x1 = Math.min(self.logFlameDragStartX, self.logFlameDragCurrentX);
                const x2 = Math.max(self.logFlameDragStartX, self.logFlameDragCurrentX);
                const L = self.logFlameState.layout;
                if (L) {
                    const xRange = self.logFlameState.xMax - self.logFlameState.xMin;
                    const newMin = self.logFlameState.xMin + (x1 / L.W) * xRange;
                    const newMax = self.logFlameState.xMin + (x2 / L.W) * xRange;
                    if (newMax - newMin >= 1) {
                        self.logFlameState.xMin = newMin;
                        self.logFlameState.xMax = newMax;
                        document.getElementById('logBtnWaterfallResetZoom').style.display = '';
                    }
                }
            }
            self.logFlameDragStartX = null;
            self.logFlameDragCurrentX = null;
            self.drawLogFlameChart();
        });

        // Wheel zoom on flame chart
        canvas?.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (!self.logFlameState?.layout) { return; }

            const mouseX = e.offsetX;
            const L = self.logFlameState.layout;
            const xRange = self.logFlameState.xMax - self.logFlameState.xMin;
            const mouseTime = self.logFlameState.xMin + (mouseX / L.W) * xRange;
            const zoomFactor = e.deltaY > 0 ? 1.3 : 1 / 1.3;
            let newRange = xRange * zoomFactor;
            newRange = Math.max(5, Math.min(86400, newRange));
            const ratio = mouseX / L.W;
            let newMin = mouseTime - newRange * ratio;
            let newMax = newMin + newRange;
            if (newMin < 0) { newMin = 0; newMax = Math.min(86400, newRange); }
            if (newMax > 86400) { newMax = 86400; newMin = Math.max(0, 86400 - newRange); }
            self.logFlameState.xMin = newMin;
            self.logFlameState.xMax = newMax;
            self.drawLogFlameChart();
            if (Math.abs(self.logFlameState.xMin - self.logFlameState.xMinOrig) > 0.5 ||
                Math.abs(self.logFlameState.xMax - self.logFlameState.xMaxOrig) > 0.5) {
                document.getElementById('logBtnWaterfallResetZoom').style.display = '';
            }
        }, { passive: false });

        // Waterfall paging
        document.getElementById('logBtnWaterfallPrev')?.addEventListener('click', () => {
            const newStart = Math.max(0, self.logWaterfallCurrentPage - 200);
            self.renderLogWaterfall(self.logWaterfallEntries.slice(newStart, newStart + 200), newStart, self.logWaterfallTotalCount);
        });
        document.getElementById('logBtnWaterfallNext')?.addEventListener('click', () => {
            const newStart = self.logWaterfallCurrentPage + 200;
            if (newStart < self.logWaterfallTotalCount) {
                self.renderLogWaterfall(self.logWaterfallEntries.slice(newStart, newStart + 200), newStart, self.logWaterfallTotalCount);
            }
        });

        // Reset zoom
        document.getElementById('logBtnWaterfallResetZoom')?.addEventListener('click', () => {
            if (self.logFlameState) {
                self.logFlameState.xMin = self.logFlameState.xMinOrig;
                self.logFlameState.xMax = self.logFlameState.xMaxOrig;
                document.getElementById('logBtnWaterfallResetZoom').style.display = 'none';
                self.drawLogFlameChart();
            }
        });

        // Gantt tooltip
        document.addEventListener('mouseover', (e) => {
            const bar = e.target.closest?.('.log-gantt-bar');
            if (bar) {
                const tip = document.getElementById('logGanttTooltip');
                tip.innerHTML = `<strong>PID ${self.escapeLogHtml(bar.dataset.pid)}${self.escapeLogHtml(bar.dataset.agents || '')}</strong><br>` +
                    `Start: ${self.escapeLogHtml(bar.dataset.start)}<br>End: ${self.escapeLogHtml(bar.dataset.end)}`;
                tip.style.display = 'block';
            }
        });
        document.addEventListener('mousemove', (e) => {
            const tip = document.getElementById('logGanttTooltip');
            if (tip?.style.display === 'block') {
                tip.style.left = (e.clientX + 12) + 'px';
                tip.style.top = (e.clientY - 10) + 'px';
            }
        });
        document.addEventListener('mouseout', (e) => {
            if (e.target.closest?.('.log-gantt-bar')) {
                document.getElementById('logGanttTooltip').style.display = 'none';
            }
        });
        // Click Gantt bar → filter by PID
        document.addEventListener('click', (e) => {
            const bar = e.target.closest?.('.log-gantt-bar');
            if (bar?.dataset.pid) {
                document.getElementById('logFilterPid').value = bar.dataset.pid;
                self.sendLogFilters();
            }
        });

        // Flame chart resize observer
        const waterfallContainer = document.getElementById('logWaterfallContainer');
        if (waterfallContainer) {
            const resizeObserver = new ResizeObserver(() => {
                if (self.logFlameState && self.logActiveBottomTab === 'waterfall') {
                    self.drawLogFlameChart();
                }
            });
            resizeObserver.observe(waterfallContainer);
        }

        // Set initial bottom panel height
        const bottomPanel = document.getElementById('logBottomPanel');
        if (bottomPanel) {
            bottomPanel.style.height = this.logBottomPanelHeight + 'px';
        }

        // Initialize access-only filter visibility
        this.updateLogAccessOnlyFilters();
    },

    // ==================== FILE HANDLING ====================

    handleAgentLogFile(file) {
        const statusEl = document.getElementById('logAgentLogStatus');
        statusEl.textContent = `Loading ${file.name}...`;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const agentEntries = this.logFileService.parseAgentLog(content);
            statusEl.textContent = `${file.name} — ${agentEntries.length.toLocaleString()} entries`;

            // Merge with existing access entries
            const existingAccess = this.logAllEntries.filter(e => e.source === 'access');
            this.logAllEntries = this.logFileService.mergeEntries(agentEntries, existingAccess);
            this.logCorrelationIndex = this.logFileService.buildShortIdCorrelationIndex(this.logAllEntries);

            this.updateLogFilterMetadata();
            this.applyLogFiltersAndRender();
            this.computeLogGanttData();

            if (this.logActiveBottomTab === 'waterfall') {
                this.computeLogWaterfallData();
            }

            this.hideLogPlaceholder();
        };
        reader.onerror = () => {
            statusEl.textContent = `Error reading ${file.name}`;
            Utils.showToast(`Error reading file: ${file.name}`, 'error');
        };
        reader.readAsText(file);
    },

    handleAccessLogFile(file) {
        const statusEl = document.getElementById('logAccessLogStatus');
        statusEl.textContent = `Loading ${file.name}...`;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const accessEntries = this.logFileService.parseAccessLog(content);
            statusEl.textContent = `${file.name} — ${accessEntries.length.toLocaleString()} entries`;

            // Merge with existing agent entries
            const existingAgent = this.logAllEntries.filter(e => e.source === 'agent');
            this.logAllEntries = this.logFileService.mergeEntries(existingAgent, accessEntries);
            this.logCorrelationIndex = this.logFileService.buildShortIdCorrelationIndex(this.logAllEntries);

            this.updateLogFilterMetadata();
            this.applyLogFiltersAndRender();
            this.computeLogGanttData();

            if (this.logActiveBottomTab === 'waterfall') {
                this.computeLogWaterfallData();
            }

            this.hideLogPlaceholder();
        };
        reader.onerror = () => {
            statusEl.textContent = `Error reading ${file.name}`;
            Utils.showToast(`Error reading file: ${file.name}`, 'error');
        };
        reader.readAsText(file);
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
        this.logGanttData = [];
        this.logWaterfallEntries = [];
        this.logFlameState = null;
        this.logKnownAgentNumbers = [];
        this.logKnownProcessIds = [];
        this.logKnownLogTypes = [];
        this.logKnownClientIps = [];
        this.logKnownStatusCodes = [];

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

        // Reset bottom panel
        this.renderLogGantt([]);
        this.renderLogWaterfall([], 0, 0);

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
            logEntryType: document.getElementById('logFilterLogType')?.value || undefined,
            clientIp: document.getElementById('logFilterClientIp')?.value || undefined,
            statusCode: statusVal ? parseInt(statusVal, 10) : undefined,
            minResponseTime: (minRt && !isNaN(parseInt(minRt, 10))) ? parseInt(minRt, 10) : undefined,
            requestId: document.getElementById('logFilterRequestId')?.value || undefined,
            searchText: document.getElementById('logFilterSearch')?.value || undefined,
        };

        this.applyLogFiltersAndRender();

        if (this.logActiveBottomTab === 'waterfall') {
            this.computeLogWaterfallData();
        }
    },

    clearLogFilters() {
        document.getElementById('logFilterSource').value = 'all';
        document.getElementById('logFilterAgent').value = '';
        document.getElementById('logFilterPid').value = '';
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

        if (this.logActiveBottomTab === 'waterfall') {
            this.computeLogWaterfallData();
        }
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
            ? `${total.toLocaleString()} entries`
            : `${filtered.toLocaleString()} of ${total.toLocaleString()} entries`;
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

    // ==================== GANTT CHART ====================

    computeLogGanttData() {
        const pidRanges = new Map();

        for (const entry of this.logAllEntries) {
            if (entry.source !== 'agent') { continue; }
            const pid = entry.processId;
            if (!pid) { continue; }
            const sec = this.logFileService.timestampToSeconds(entry.timestamp);
            if (sec === null) { continue; }

            const existing = pidRanges.get(pid);
            if (!existing) {
                pidRanges.set(pid, { firstSeen: sec, lastSeen: sec, agentNumbers: new Set([entry.agentNumber]) });
            } else {
                existing.agentNumbers.add(entry.agentNumber);
                if (sec < existing.firstSeen) { existing.firstSeen = sec; }
                if (sec > existing.lastSeen) { existing.lastSeen = sec; }
            }
        }

        this.logGanttData = Array.from(pidRanges.entries())
            .map(([pid, range]) => ({
                pid,
                startSec: range.firstSeen,
                endSec: range.lastSeen,
                agentNumbers: [...range.agentNumbers].sort((a, b) => parseInt(a) - parseInt(b)),
            }))
            .sort((a, b) => parseInt(a.pid) - parseInt(b.pid));

        this.renderLogGantt(this.logGanttData);
    },

    renderLogGantt(data) {
        const ganttEmpty = document.getElementById('logGanttEmpty');
        const ganttChart = document.getElementById('logGanttChart');
        if (!ganttEmpty || !ganttChart) { return; }

        if (!data || data.length === 0) {
            ganttEmpty.style.display = 'block';
            ganttChart.style.display = 'none';
            return;
        }
        ganttEmpty.style.display = 'none';
        ganttChart.style.display = 'block';

        const TOTAL_SECONDS = 24 * 3600;
        const GANTT_COLORS = [
            '#3794ff', '#89d185', '#f14c4c', '#cca700', '#b180d7',
            '#d18616', '#2aa198', '#6c71c4', '#cb4b16', '#268bd2',
        ];
        const esc = this.escapeLogHtml;

        // Time axis
        let axisHtml = '<div class="log-gantt-time-axis"><div class="log-gantt-time-axis-labels">';
        for (let h = 0; h <= 24; h += 2) {
            const pct = (h * 3600 / TOTAL_SECONDS * 100).toFixed(2);
            axisHtml += `<span class="log-gantt-hour-label" style="left:${pct}%">${String(h).padStart(2, '0')}:00</span>`;
        }
        axisHtml += '</div></div>';

        // Rows
        let rowsHtml = '<div class="log-gantt-rows">';
        data.forEach((item, idx) => {
            const startSec = typeof item.startSec === 'number' ? item.startSec : 0;
            const endSec = typeof item.endSec === 'number' ? item.endSec : startSec;
            const leftPct = (startSec / TOTAL_SECONDS * 100).toFixed(3);
            const widthPct = (Math.max(endSec - startSec, 1) / TOTAL_SECONDS * 100).toFixed(3);
            const color = GANTT_COLORS[idx % GANTT_COLORS.length];
            const agentLabel = item.agentNumbers?.length > 0
                ? ` (Agt#${item.agentNumbers.join(',')})`
                : '';

            let gridLines = '';
            for (let h = 0; h <= 24; h += 2) {
                const gPct = (h * 3600 / TOTAL_SECONDS * 100).toFixed(2);
                gridLines += `<div class="log-gantt-grid-line" style="left:${gPct}%"></div>`;
            }

            rowsHtml += `<div class="log-gantt-row">` +
                `<div class="log-gantt-pid-label">PID ${esc(item.pid)}${esc(agentLabel)}</div>` +
                `<div class="log-gantt-bar-area">` +
                gridLines +
                `<div class="log-gantt-bar" style="left:${leftPct}%;width:${widthPct}%;background:${color};"` +
                ` data-pid="${esc(item.pid)}"` +
                ` data-agents="${esc(agentLabel)}"` +
                ` data-start="${this.formatLogTime(startSec)}"` +
                ` data-end="${this.formatLogTime(endSec)}"` +
                `></div></div></div>`;
        });
        rowsHtml += '</div>';

        ganttChart.innerHTML = axisHtml + rowsHtml;
    },

    // ==================== FLAME CHART (CANVAS) ====================

    computeLogWaterfallData() {
        const entries = (this.logCurrentFilters && Object.keys(this.logCurrentFilters).length > 0)
            ? this.logFilteredEntries
            : this.logAllEntries;

        this.logWaterfallEntries = [];

        for (const entry of entries) {
            if (entry.source !== 'access') { continue; }
            const endSec = this.logFileService.timestampToSeconds(entry.timestamp);
            if (endSec === null) { continue; }
            // responseTime is in microseconds (Tomcat %D directive)
            const durationSec = entry.responseTime / 1_000_000;
            const startSec = Math.max(0, endSec - durationSec);

            this.logWaterfallEntries.push({
                startSec,
                endSec,
                method: entry.method,
                url: entry.url,
                statusCode: entry.statusCode,
                responseTime: entry.responseTime,
                clientIp: entry.clientIp,
                requestId: entry.appRequestId,
            });
        }

        this.logWaterfallEntries.sort((a, b) => a.startSec - b.startSec);
        this.logWaterfallTotalCount = this.logWaterfallEntries.length;

        const PAGE_SIZE = 200;
        const page = this.logWaterfallEntries.slice(0, PAGE_SIZE);
        this.renderLogWaterfall(page, 0, this.logWaterfallTotalCount);
    },

    renderLogWaterfall(entries, startIndex, totalCount) {
        this.logWaterfallCurrentPage = startIndex;
        this.logWaterfallTotalCount = totalCount;
        this.logFlameHoverIdx = -1;
        document.getElementById('logFlameTooltip').style.display = 'none';

        const waterfallEmpty = document.getElementById('logWaterfallEmpty');
        const waterfallContainer = document.getElementById('logWaterfallContainer');
        const waterfallScrollControls = document.getElementById('logWaterfallScrollControls');
        const waterfallInfo = document.getElementById('logWaterfallInfo');

        if (!entries || entries.length === 0) {
            if (waterfallEmpty) { waterfallEmpty.style.display = 'block'; }
            if (waterfallContainer) { waterfallContainer.style.display = 'none'; }
            if (waterfallScrollControls) { waterfallScrollControls.style.display = 'none'; }
            if (waterfallInfo) { waterfallInfo.textContent = ''; }
            this.logFlameState = null;
            return;
        }

        if (waterfallEmpty) { waterfallEmpty.style.display = 'none'; }
        if (waterfallContainer) { waterfallContainer.style.display = ''; }

        const PAGE_SIZE = 200;
        if (totalCount > PAGE_SIZE) {
            if (waterfallScrollControls) { waterfallScrollControls.style.display = ''; }
            const pageEnd = Math.min(startIndex + entries.length, totalCount);
            const pageInfo = document.getElementById('logWaterfallPageInfo');
            if (pageInfo) { pageInfo.textContent = `${startIndex + 1} - ${pageEnd} of ${totalCount}`; }
            const prevBtn = document.getElementById('logBtnWaterfallPrev');
            const nextBtn = document.getElementById('logBtnWaterfallNext');
            if (prevBtn) { prevBtn.disabled = startIndex === 0; }
            if (nextBtn) { nextBtn.disabled = pageEnd >= totalCount; }
        } else {
            if (waterfallScrollControls) { waterfallScrollControls.style.display = 'none'; }
        }

        if (waterfallInfo) { waterfallInfo.textContent = `${totalCount} requests`; }

        // Compute data range
        let dataMin = Infinity;
        let dataMax = -Infinity;
        for (const e of entries) {
            if (e.startSec < dataMin) { dataMin = e.startSec; }
            if (e.endSec > dataMax) { dataMax = e.endSec; }
        }
        if (!isFinite(dataMin)) { dataMin = 0; }
        if (!isFinite(dataMax)) { dataMax = 86400; }
        let dataRange = dataMax - dataMin;
        if (dataRange < 10) { dataRange = 10; }
        const padding = dataRange * 0.05;
        const xMin = Math.max(0, dataMin - padding);
        const xMax = Math.min(86400, dataMax + padding);

        // Lane assignment (greedy bin-packing)
        const laneEnds = [];
        const entryLanes = new Array(entries.length);
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            let placed = false;
            for (let l = 0; l < laneEnds.length; l++) {
                if (e.startSec >= laneEnds[l]) {
                    entryLanes[i] = l;
                    laneEnds[l] = e.endSec;
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                entryLanes[i] = laneEnds.length;
                laneEnds.push(e.endSec);
            }
        }
        const numLanes = Math.max(laneEnds.length, 1);

        this.logFlameState = {
            entries,
            entryLanes,
            numLanes,
            xMin,
            xMax,
            xMinOrig: xMin,
            xMaxOrig: xMax,
            startIndex,
            layout: null,
        };

        document.getElementById('logBtnWaterfallResetZoom').style.display = 'none';
        this.drawLogFlameChart();
    },

    drawLogFlameChart() {
        if (!this.logFlameState) { return; }
        const s = this.logFlameState;
        const canvas = document.getElementById('logWaterfallCanvas');
        if (!canvas) { return; }
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const containerRect = document.getElementById('logWaterfallContainer').getBoundingClientRect();
        const W = containerRect.width;

        const AXIS_H = 24;
        const BAR_H = 14;
        const BAR_GAP = 2;
        const LANE_H = BAR_H + BAR_GAP;
        const CHART_TOP = AXIS_H;
        const contentHeight = CHART_TOP + s.numLanes * LANE_H + 4;
        const H = Math.max(contentHeight, containerRect.height);

        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        s.layout = { W, H, AXIS_H, BAR_H, LANE_H, CHART_TOP };

        const xMin = s.xMin;
        const xMax = s.xMax;
        const xRange = xMax - xMin;
        const timeToX = (sec) => (sec - xMin) / xRange * W;

        // Colors
        const cs = getComputedStyle(document.body);
        const textColor = cs.getPropertyValue('--text-primary')?.trim() || '#cccccc';
        const gridColor = cs.getPropertyValue('--border-color')?.trim() || '#3c3c3c';
        const bgColor = cs.getPropertyValue('--bg-primary')?.trim() || '#1e1e1e';

        ctx.clearRect(0, 0, W, H);

        // Axis background
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, W, AXIS_H);

        // Grid lines + labels
        const tickInterval = this.computeLogTickInterval(xRange, W);
        const firstTick = Math.ceil(xMin / tickInterval) * tickInterval;
        ctx.font = '10px Consolas, Monaco, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (let t = firstTick; t <= xMax; t += tickInterval) {
            const tx = timeToX(t);
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(tx, AXIS_H);
            ctx.lineTo(tx, H);
            ctx.stroke();
            ctx.fillStyle = textColor;
            ctx.fillText(this.formatLogTimeAxis(t, tickInterval), tx, AXIS_H - 4);
        }

        // Axis bottom line
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, AXIS_H);
        ctx.lineTo(W, AXIS_H);
        ctx.stroke();

        // Draw bars
        for (let i = 0; i < s.entries.length; i++) {
            const e = s.entries[i];
            const lane = s.entryLanes[i];
            const x1 = timeToX(e.startSec);
            const x2 = timeToX(e.endSec);
            const barW = Math.max(x2 - x1, 2);
            const y = CHART_TOP + lane * LANE_H;

            if (y + BAR_H < 0 || y > H) { continue; }
            if (x1 + barW < 0 || x1 > W) { continue; }

            ctx.fillStyle = this.logStatusColor(e.statusCode);
            ctx.fillRect(x1, y, barW, BAR_H);

            if (i === this.logFlameHoverIdx) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x1 - 0.5, y - 0.5, barW + 1, BAR_H + 1);
            }
        }

        // Drag selection overlay
        if (this.logFlameDragging && this.logFlameDragStartX !== null && this.logFlameDragCurrentX !== null) {
            const dx1 = Math.min(this.logFlameDragStartX, this.logFlameDragCurrentX);
            const dx2 = Math.max(this.logFlameDragStartX, this.logFlameDragCurrentX);
            ctx.fillStyle = 'rgba(55, 148, 255, 0.15)';
            ctx.fillRect(dx1, AXIS_H, dx2 - dx1, H - AXIS_H);
            ctx.strokeStyle = 'rgba(55, 148, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(dx1, AXIS_H, dx2 - dx1, H - AXIS_H);
        }
    },

    logFlameHitTest(px, py) {
        if (!this.logFlameState?.layout) { return -1; }
        const s = this.logFlameState;
        const L = s.layout;
        if (py < L.CHART_TOP) { return -1; }
        const xRange = s.xMax - s.xMin;
        const timeToX = (sec) => (sec - s.xMin) / xRange * L.W;

        for (let i = 0; i < s.entries.length; i++) {
            const e = s.entries[i];
            const lane = s.entryLanes[i];
            const x1 = timeToX(e.startSec);
            const x2 = timeToX(e.endSec);
            const barW = Math.max(x2 - x1, 2);
            const y = L.CHART_TOP + lane * L.LANE_H;
            if (px >= x1 && px <= x1 + barW && py >= y && py <= y + L.BAR_H) {
                return i;
            }
        }
        return -1;
    },

    showLogFlameTooltip(idx, clientX, clientY) {
        const tooltip = document.getElementById('logFlameTooltip');
        if (idx < 0 || !this.logFlameState) {
            tooltip.style.display = 'none';
            return;
        }
        const e = this.logFlameState.entries[idx];
        const dur = e.responseTime / 1000;
        tooltip.innerHTML =
            `<b>${this.escapeLogHtml(e.method)} ${this.escapeLogHtml(e.url || '')}</b><br>` +
            `Status: ${e.statusCode} &nbsp; Duration: ${dur.toFixed(1)}ms<br>` +
            `Start: ${this.formatLogTime(e.startSec)} &nbsp; End: ${this.formatLogTime(e.endSec)}<br>` +
            `Client: ${this.escapeLogHtml(e.clientIp)}`;
        tooltip.style.display = '';

        const tt = tooltip.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = clientX + 12;
        let top = clientY + 12;
        if (left + tt.width > vw - 8) { left = clientX - tt.width - 12; }
        if (top + tt.height > vh - 8) { top = clientY - tt.height - 12; }
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    },

    // ==================== BOTTOM PANEL TABS ====================

    switchLogBottomTab(tab) {
        this.logActiveBottomTab = tab;
        const tabGantt = document.getElementById('logTabGantt');
        const tabWaterfall = document.getElementById('logTabWaterfall');
        const ganttSection = document.getElementById('logGanttSection');
        const waterfallSection = document.getElementById('logWaterfallSection');

        if (tab === 'gantt') {
            tabGantt?.classList.add('active');
            tabWaterfall?.classList.remove('active');
            if (ganttSection) { ganttSection.style.display = ''; }
            if (waterfallSection) { waterfallSection.style.display = 'none'; }
        } else {
            tabWaterfall?.classList.add('active');
            tabGantt?.classList.remove('active');
            if (ganttSection) { ganttSection.style.display = 'none'; }
            if (waterfallSection) { waterfallSection.style.display = ''; }
            this.computeLogWaterfallData();
        }
    },

    // ==================== UTILITY FUNCTIONS ====================

    logStatusColor(code) {
        if (code >= 200 && code < 300) { return 'rgba(137, 209, 133, 0.85)'; }
        if (code >= 300 && code < 400) { return 'rgba(55, 148, 255, 0.85)'; }
        if (code >= 400 && code < 500) { return 'rgba(204, 167, 0, 0.85)'; }
        if (code >= 500) { return 'rgba(241, 76, 76, 0.85)'; }
        return 'rgba(177, 128, 215, 0.85)';
    },

    computeLogTickInterval(rangeSeconds, widthPx) {
        const targetTicks = Math.max(3, Math.floor(widthPx / 100));
        const rawInterval = rangeSeconds / targetTicks;
        const nice = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200];
        for (const n of nice) {
            if (n >= rawInterval) { return n; }
        }
        return 86400;
    },

    formatLogTime(seconds) {
        if (seconds == null) { return '??:??:??'; }
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },

    formatLogTimeAxis(seconds, tickInterval) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (tickInterval < 60) {
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    },

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

    // ==================== AUTO-LOAD FROM PASOE SERVER ====================

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

        const pasoePath = this.getEffectivePasoePath();
        if (!pasoePath) {
            Utils.showToast('PASOE path not available. Check Settings → PASOE Instance.', 'error');
            return;
        }

        if (!this.selectedApplication) {
            Utils.showToast('Please select an application first (login and connect).', 'error');
            return;
        }

        if (statusEl) { statusEl.textContent = 'Reading properties...'; }

        try {
            const pasoePathOption = this.getPasoePathOption();

            // 1. Read openedge.properties
            const propsResult = await this.agentService.readServerFile('conf/openedge.properties', {
                pasoePathOverride: pasoePathOption
            });

            // 2. Parse properties to find agent log path for the selected application
            const logPaths = this.logFileService.parsePropertiesContent(propsResult.content, pasoePath);
            const agentLogTemplate = logPaths.get(this.selectedApplication);

            if (!agentLogTemplate) {
                Utils.showToast(`No agentLogFile found for application "${this.selectedApplication}" in openedge.properties`, 'error');
                if (statusEl) { statusEl.textContent = 'No log path found'; }
                return;
            }

            // 3. Resolve date tokens → get actual log file path
            const agentLogPath = this.logFileService.resolveAgentLogPath(agentLogTemplate, date);
            const logDir = this.logFileService.getLogDirectory(agentLogPath);
            const accessLogPath = logDir + '/localhost-access.' + date + '.log';

            // Convert to relative paths for the servlet
            const agentLogRelPath = this.logFileService.toRelativePath(agentLogPath, pasoePath);
            const accessLogRelPath = this.logFileService.toRelativePath(accessLogPath, pasoePath);

            // Extract filenames for display
            const agentLogFileName = agentLogPath.split(/[\\/]/).pop();
            const accessLogFileName = accessLogPath.split(/[\\/]/).pop();

            // Store config for incremental refresh
            this.logAutoLoadConfig = {
                agentLogRelPath,
                accessLogRelPath,
                agentLogFileName,
                accessLogFileName,
                pasoePath: pasoePathOption
            };

            // 4. Clear existing data for fresh load
            this.logAllEntries = [];
            this.logAgentLogOffset = 0;
            this.logAccessLogOffset = 0;

            // Show resolved filenames immediately
            const agentStatusEl = document.getElementById('logAgentLogStatus');
            const accessStatusEl = document.getElementById('logAccessLogStatus');
            if (agentStatusEl) { agentStatusEl.textContent = `${agentLogFileName} (loading...)`; }
            if (accessStatusEl) { accessStatusEl.textContent = `${accessLogFileName} (loading...)`; }

            if (statusEl) { statusEl.textContent = 'Loading logs...'; }

            // 5. Load both logs
            await this.autoLoadIncremental();

            if (statusEl) { statusEl.textContent = `Loaded (${this.logAllEntries.length} entries)`; }

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
        const cfg = this.logAutoLoadConfig;
        if (!cfg) { return; }

        let newAgentEntries = [];
        let newAccessEntries = [];
        let agentLoaded = false;
        let agentError = null;
        let accessLoaded = false;
        let accessError = null;

        // Read agent log (incremental from offset)
        try {
            const agentResult = await this.agentService.readServerFile(cfg.agentLogRelPath, {
                offset: this.logAgentLogOffset,
                pasoePathOverride: cfg.pasoePath
            });
            agentLoaded = true;
            if (agentResult.content) {
                newAgentEntries = this.logFileService.parseAgentLog(agentResult.content);
                // Adjust line numbers to account for offset
                const lineOffset = this.logAllEntries.filter(e => e.source === 'agent').length;
                newAgentEntries.forEach(e => { e.lineNumber += lineOffset; });
                this.logAgentLogOffset = agentResult.newOffset;
            }
        } catch (e) {
            agentError = e.message;
            // Agent log may not exist for this date — not an error
            if (!e.message.includes('404')) {
                console.warn('Agent log read error:', e.message);
            }
        }

        // Read access log (incremental from offset)
        try {
            const accessResult = await this.agentService.readServerFile(cfg.accessLogRelPath, {
                offset: this.logAccessLogOffset,
                pasoePathOverride: cfg.pasoePath
            });
            accessLoaded = true;
            if (accessResult.content) {
                newAccessEntries = this.logFileService.parseAccessLog(accessResult.content);
                const lineOffset = this.logAllEntries.filter(e => e.source === 'access').length;
                newAccessEntries.forEach(e => { e.lineNumber += lineOffset; });
                this.logAccessLogOffset = accessResult.newOffset;
            }
        } catch (e) {
            accessError = e.message;
            if (!e.message.includes('404')) {
                console.warn('Access log read error:', e.message);
            }
        }

        // Always update status displays (even if no new entries)
        const agentStatus = document.getElementById('logAgentLogStatus');
        const accessStatus = document.getElementById('logAccessLogStatus');
        const agentCount = this.logAllEntries.filter(e => e.source === 'agent').length + newAgentEntries.length;
        const accessCount = this.logAllEntries.filter(e => e.source === 'access').length + newAccessEntries.length;

        if (agentStatus) {
            if (agentLoaded) {
                agentStatus.textContent = `${cfg.agentLogFileName} — ${agentCount.toLocaleString()} entries`;
            } else if (agentError && agentError.includes('404')) {
                agentStatus.textContent = `${cfg.agentLogFileName} (not found)`;
            } else {
                agentStatus.textContent = `${cfg.agentLogFileName} (error)`;
            }
        }
        if (accessStatus) {
            if (accessLoaded) {
                accessStatus.textContent = `${cfg.accessLogFileName} — ${accessCount.toLocaleString()} entries`;
            } else if (accessError && accessError.includes('404')) {
                accessStatus.textContent = `${cfg.accessLogFileName} (not found)`;
            } else {
                accessStatus.textContent = `${cfg.accessLogFileName} (error)`;
            }
        }

        // Merge new entries into existing data
        const newEntries = [...newAgentEntries, ...newAccessEntries];
        if (newEntries.length === 0) { return; }

        // Add new entries and re-sort
        this.logAllEntries.push(...newEntries);
        this.logAllEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        // Rebuild indexes
        this.logCorrelationIndex = this.logFileService.buildShortIdCorrelationIndex(this.logAllEntries);
        this.updateLogFilterMetadata();
        this.applyLogFiltersAndRender();
        this.computeLogGanttData();

        if (this.logActiveBottomTab === 'waterfall') {
            this.computeLogWaterfallData();
        }

        this.hideLogPlaceholder();
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
