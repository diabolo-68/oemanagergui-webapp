/**
 * OE Manager GUI - ABL Objects View
 * Mixin for ABL Objects tracking, retrieval, and consolidation with access logs
 * 
 * Workflow:
 * 1. Select an agent
 * 2. Enable ABL Objects tracking
 * 3. (Wait for activity on the server)
 * 4. Get ABL Objects report
 * 5. Load Tomcat access log file
 * 6. Consolidate: match ABL objects with HTTP requests via request ID
 * 7. Export consolidated data as CSV
 * 
 * Methods are added to OeManagerApp.prototype
 */

const AblObjectsViewMixin = {

    // ==================== ABL OBJECTS VIEW INITIALIZATION ====================

    /**
     * Initialize ABL Objects view state
     */
    initAblObjectsState() {
        this.ablAgents = [];
        this.ablSelectedAgentId = '';
        this.ablObjectsReport = null;       // Raw JSON report from API
        this.ablAccessLogData = null;       // Parsed access log entries
        this.ablConsolidatedData = [];      // Consolidated results
        this.ablAccessLogFileName = '';     // Name of the loaded file
        this.ablDisplayMode = 'bySource';  // Current display mode
        this.ablSortColumn = '';           // Current sort column
        this.ablSortDirection = '';        // 'asc' or 'desc'
    },

    /**
     * Load ABL Objects view data
     */
    async loadAblObjectsView() {
        if (!this.selectedApplication) return;
        await this.loadAblAgents();
    },

    /**
     * Load agents for the ABL Objects view
     */
    async loadAblAgents() {
        if (!this.selectedApplication) return;

        try {
            this.ablAgents = await this.agentService.fetchAgents(this.selectedApplication);
            this.renderAblAgentSelect();
        } catch (error) {
            console.error('[AblObjects] Error loading agents:', error);
            Utils.showToast(`Failed to load agents: ${error.message}`, 'error');
        }
    },

    /**
     * Render agent select dropdown for ABL Objects view
     */
    renderAblAgentSelect() {
        const select = document.getElementById('ablAgentSelect');
        if (!select) return;

        const currentValue = select.value;
        select.innerHTML = '<option value="">-- Select Agent --</option>';

        this.ablAgents.forEach(agent => {
            const agentId = agent.agentId || agent.id;
            const pid = agent.pid || '';
            const state = agent.state || '';
            const option = document.createElement('option');
            option.value = agentId;
            option.textContent = `${agentId} (PID: ${pid}, ${state})`;
            select.appendChild(option);
        });

        // Restore selection if still valid
        if (currentValue && this.ablAgents.some(a => (a.agentId || a.id) === currentValue)) {
            select.value = currentValue;
        }

        this.updateAblButtonStates();
    },

    /**
     * Handle agent selection change in ABL Objects view
     */
    onAblAgentChange(agentId) {
        this.ablSelectedAgentId = agentId;
        this.updateAblButtonStates();
    },

    /**
     * Update button enabled/disabled states
     */
    updateAblButtonStates() {
        const hasAgent = !!this.ablSelectedAgentId;
        const hasReport = !!this.ablObjectsReport;
        const hasAccessLog = !!this.ablAccessLogData;

        const enableBtn = document.getElementById('ablEnableBtn');
        const disableBtn = document.getElementById('ablDisableBtn');
        const getReportBtn = document.getElementById('ablGetReportBtn');
        const downloadReportBtn = document.getElementById('ablDownloadReportBtn');
        const consolidateBtn = document.getElementById('ablConsolidateBtn');
        const exportCsvBtn = document.getElementById('ablExportCsvBtn');

        if (enableBtn) enableBtn.disabled = !hasAgent;
        if (disableBtn) disableBtn.disabled = !hasAgent;
        if (getReportBtn) getReportBtn.disabled = !hasAgent;
        if (downloadReportBtn) downloadReportBtn.disabled = !hasReport;
        if (consolidateBtn) consolidateBtn.disabled = !hasReport || !hasAccessLog;
        if (exportCsvBtn) exportCsvBtn.disabled = this.ablConsolidatedData.length === 0;
    },

    // ==================== ABL OBJECTS OPERATIONS ====================

    /**
     * Enable ABL Objects tracking for selected agent
     */
    async ablEnableTracking() {
        if (!this.selectedApplication || !this.ablSelectedAgentId) return;

        try {
            await this.agentService.enableABLObjects(this.selectedApplication, this.ablSelectedAgentId);
            Utils.showToast(`ABL Objects tracking enabled for agent ${this.ablSelectedAgentId}`, 'success');
            this.updateAblStatusMessage('ABL Objects tracking is ENABLED. Server activity will be tracked.');
        } catch (error) {
            console.error('[AblObjects] Enable error:', error);
            Utils.showToast(`Failed to enable ABL Objects: ${error.message}`, 'error');
        }
    },

    /**
     * Disable ABL Objects tracking for selected agent
     */
    async ablDisableTracking() {
        if (!this.selectedApplication || !this.ablSelectedAgentId) return;

        try {
            await this.agentService.disableABLObjects(this.selectedApplication, this.ablSelectedAgentId);
            Utils.showToast(`ABL Objects tracking disabled for agent ${this.ablSelectedAgentId}`, 'success');
            this.updateAblStatusMessage('ABL Objects tracking is DISABLED.');
        } catch (error) {
            console.error('[AblObjects] Disable error:', error);
            Utils.showToast(`Failed to disable ABL Objects: ${error.message}`, 'error');
        }
    },

    /**
     * Get ABL Objects report from the selected agent
     */
    async ablGetReport() {
        if (!this.selectedApplication || !this.ablSelectedAgentId) return;

        const statusEl = document.getElementById('ablReportStatus');
        if (statusEl) statusEl.textContent = 'Fetching ABL Objects report...';

        try {
            const reportText = await this.agentService.getABLObjectsReport(
                this.selectedApplication, this.ablSelectedAgentId
            );

            // Parse the JSON report
            this.ablObjectsReport = JSON.parse(reportText);

            // Count objects
            const objectCount = this.countAblObjects(this.ablObjectsReport);
            if (statusEl) {
                statusEl.textContent = `Report loaded: ${objectCount} ABL object(s) found`;
            }

            Utils.showToast(`ABL Objects report loaded (${objectCount} objects)`, 'success');
            this.updateAblButtonStates();
            this.renderAblObjectsSummary();
        } catch (error) {
            console.error('[AblObjects] Get report error:', error);
            if (statusEl) statusEl.textContent = 'Failed to load report';
            Utils.showToast(`Failed to get ABL Objects report: ${error.message}`, 'error');
        }
    },

    /**
     * Count total ABL objects in the report
     */
    countAblObjects(report) {
        let count = 0;
        const ablObjects = report?.result?.ABLOutput?.ABLObjects;
        if (Array.isArray(ablObjects)) {
            ablObjects.forEach(session => {
                if (Array.isArray(session.Objects)) {
                    count += session.Objects.length;
                }
            });
        }
        return count;
    },

    /**
     * Render a summary of ABL Objects (before consolidation)
     */
    renderAblObjectsSummary() {
        const container = document.getElementById('ablObjectsSummary');
        if (!container) return;

        if (!this.ablObjectsReport) {
            container.innerHTML = '<p class="empty-state">No report loaded</p>';
            return;
        }

        const ablObjects = this.ablObjectsReport?.result?.ABLOutput?.ABLObjects;
        if (!Array.isArray(ablObjects) || ablObjects.length === 0) {
            container.innerHTML = '<p class="empty-state">No ABL objects in report</p>';
            return;
        }

        // Show session summary
        let html = '<table class="data-grid"><thead><tr>' +
            '<th>Agent Session ID</th><th>Object Count</th>' +
            '</tr></thead><tbody>';

        ablObjects.forEach(session => {
            const sessionId = session.AgentSessionId ?? '-';
            const objCount = Array.isArray(session.Objects) ? session.Objects.length : 0;
            html += `<tr><td>${Utils.escapeHtml(String(sessionId))}</td>` +
                    `<td>${objCount}</td></tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    },

    // ==================== ACCESS LOG HANDLING ====================

    /**
     * Handle access log file selection
     */
    handleAccessLogFile(file) {
        if (!file) return;

        this.ablAccessLogFileName = file.name;
        const statusEl = document.getElementById('ablAccessLogStatus');
        if (statusEl) {
            statusEl.innerHTML = `<span class="abl-spinner"></span> Loading ${Utils.escapeHtml(file.name)}\u2026`;
        }

        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const content = e.target.result;
                this.ablAccessLogData = this.parseAccessLog(content);

                if (statusEl) {
                    statusEl.textContent = `Loaded: ${file.name} (${this.ablAccessLogData.length} entries)`;
                }

                Utils.showToast(`Access log loaded: ${this.ablAccessLogData.length} entries`, 'success');
                this.updateAblButtonStates();
            } catch (error) {
                console.error('[AblObjects] Parse access log error:', error);
                if (statusEl) {
                    statusEl.textContent = `Failed to parse: ${file.name}`;
                }
                Utils.showToast(`Failed to parse access log: ${error.message}`, 'error');
            }
        };

        reader.onerror = () => {
            if (statusEl) {
                statusEl.textContent = `Failed to read: ${file.name}`;
            }
            Utils.showToast('Failed to read file', 'error');
        };

        reader.readAsText(file);
    },

    /**
     * Parse Tomcat access log (space-delimited)
     * Format: IP - USER [DATESTAMP] "HTTP QUERY" STATUS - QUERYID RESPTIME
     * Example: 192.168.1.1 - tomcat [27/Jan/2026:18:13:36.879 +0100] "GET /web/Menu HTTP/1.1" 200 - ROOT:w:0000004c 9
     * 
     * @param {string} content - Raw access log file content
     * @returns {Array<{ip: string, user: string, datestamp: string, query: string, status: string, queryid: string, resptime: string}>}
     */
    parseAccessLog(content) {
        const entries = [];
        const lines = content.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Parse using regex for the standard Tomcat access log format
            // IP - USER [DATETIME] "METHOD PATH PROTOCOL" STATUS SIZE QUERYID RESPTIME
            const match = trimmed.match(
                /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/
            );

            if (match) {
                entries.push({
                    ip: match[1],
                    sep1: match[2],
                    user: match[3],
                    datestamp: match[4],
                    query: match[5],
                    status: match[6],
                    sep2: match[7],
                    queryid: match[8],
                    resptime: match[9]
                });
            }
        }

        return entries;
    },

    // ==================== CONSOLIDATION ====================

    /**
     * Consolidate ABL Objects report with access log data
     * Algorithm (ported from abl-objects.p):
     * 1. Parse ABL objects, group by (requestId, source, sessionId)
     * 2. Match with access log entries by queryid = cRqstIdOrig
     */
    consolidateData() {
        if (!this.ablObjectsReport || !this.ablAccessLogData) {
            Utils.showToast('Both ABL Objects report and access log are required', 'warning');
            return;
        }

        // Show spinner while consolidating
        const resultsContainer = document.getElementById('ablResultsContainer');
        if (resultsContainer) {
            resultsContainer.innerHTML = '<span class="abl-spinner"></span> Consolidating\u2026';
        }
        this.showAblResultsControls(false);

        // Use setTimeout to allow the spinner to render before heavy processing
        setTimeout(() => { this._doConsolidate(); }, 50);
    },

    /**
     * Internal consolidation logic (called after spinner is shown)
     */
    _doConsolidate() {
        try {
            // Phase 1: Extract and flatten ABL objects
            const ablObjects = this.ablObjectsReport?.result?.ABLOutput?.ABLObjects;
            if (!Array.isArray(ablObjects)) {
                Utils.showToast('Invalid ABL Objects report structure', 'error');
                return;
            }

            const flatObjects = [];
            ablObjects.forEach(session => {
                const agentSessionId = session.AgentSessionId;
                if (Array.isArray(session.Objects)) {
                    session.Objects.forEach(obj => {
                        flatObjects.push({
                            name: obj.name || '',
                            objType: obj.ObjType || '',
                            handleId: obj.HandleId || 0,
                            origRqId: obj.origRqId || 0,
                            cRqstIdOrig: obj.cRqstIdOrig || '',
                            source: obj.Source || '',
                            line: obj.Line || 0,
                            sessionId: obj.sessionId || agentSessionId || 0
                        });
                    });
                }
            });

            // Phase 2: Group/deduplicate by (cRqstIdOrig, source, sessionId)
            const summaryMap = new Map();
            flatObjects.forEach(obj => {
                const key = `${obj.cRqstIdOrig}|${obj.source}|${obj.sessionId}`;
                if (!summaryMap.has(key)) {
                    summaryMap.set(key, {
                        sessionId: obj.sessionId,
                        cRqstIdOrig: obj.cRqstIdOrig,
                        source: obj.source,
                        query: '',
                        objectCount: 0
                    });
                }
                summaryMap.get(key).objectCount++;
            });

            // Phase 3: Build access log lookup by queryid
            const accessLogMap = new Map();
            this.ablAccessLogData.forEach(entry => {
                if (entry.queryid && !accessLogMap.has(entry.queryid)) {
                    accessLogMap.set(entry.queryid, entry);
                }
            });

            // Phase 4: Match ABL objects with access log entries
            const consolidated = [];
            summaryMap.forEach(summary => {
                const accessEntry = accessLogMap.get(summary.cRqstIdOrig);
                consolidated.push({
                    sessionId: summary.sessionId,
                    cRqstIdOrig: summary.cRqstIdOrig,
                    source: summary.source,
                    query: accessEntry?.query ?? '',
                    objectCount: summary.objectCount
                });
            });

            this.ablConsolidatedData = consolidated;
            this.ablDisplayMode = 'bySource';
            this.ablSortColumn = '';
            this.ablSortDirection = '';

            // Show controls and render
            this.showAblResultsControls(true);
            this.updateAblSummaryStats();
            this.renderAblResults();
            this.updateAblButtonStates();

            const matched = consolidated.filter(r => r.query).length;
            Utils.showToast(
                `Consolidated: ${consolidated.length} entries, ${matched} matched with access log`,
                'success'
            );
        } catch (error) {
            console.error('[AblObjects] Consolidation error:', error);
            Utils.showToast(`Consolidation failed: ${error.message}`, 'error');
        }
    },

    // ==================== DISPLAY MODES & AGGREGATION ====================

    /**
     * Show/hide results controls (tabs, filters, stats)
     */
    showAblResultsControls(visible) {
        const ids = ['ablSummaryStats', 'ablModeTabs', 'ablFilterBar'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', !visible);
        });

        // Set active tab
        if (visible) {
            document.querySelectorAll('.abl-mode-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.mode === this.ablDisplayMode);
            });
        }
    },

    /**
     * Update summary stats badges
     */
    updateAblSummaryStats() {
        const data = this.ablConsolidatedData;
        const totalObjects = data.reduce((sum, r) => sum + r.objectCount, 0);
        const uniqueSources = new Set(data.map(r => r.source)).size;
        const uniqueRequests = new Set(data.map(r => r.cRqstIdOrig)).size;
        const uniqueSessions = new Set(data.map(r => r.sessionId)).size;

        const el = (id, text) => {
            const e = document.getElementById(id);
            if (e) e.textContent = text;
        };
        el('ablStatTotal', `Objects: ${totalObjects}`);
        el('ablStatSources', `Sources: ${uniqueSources}`);
        el('ablStatRequests', `Requests: ${uniqueRequests}`);
        el('ablStatSessions', `Sessions: ${uniqueSessions}`);
    },

    /**
     * Handle display mode tab click
     */
    onAblModeChange(mode) {
        this.ablDisplayMode = mode;
        this.ablSortColumn = '';
        this.ablSortDirection = '';
        document.querySelectorAll('.abl-mode-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.mode === mode);
        });
        this.renderAblResults();
    },

    /**
     * Aggregate data by source class
     * Columns: Source | Total Objects | Distinct Requests | Avg Objects/Request
     */
    aggregateBySource(data) {
        const map = new Map();
        data.forEach(row => {
            if (!map.has(row.source)) {
                map.set(row.source, { source: row.source, totalObjects: 0, requests: new Set(), sessions: new Set() });
            }
            const entry = map.get(row.source);
            entry.totalObjects += row.objectCount;
            entry.requests.add(row.cRqstIdOrig);
            entry.sessions.add(row.sessionId);
        });
        return Array.from(map.values()).map(e => ({
            source: e.source,
            totalObjects: e.totalObjects,
            distinctRequests: e.requests.size,
            avgPerRequest: e.requests.size > 0 ? +(e.totalObjects / e.requests.size).toFixed(1) : 0
        })).sort((a, b) => b.totalObjects - a.totalObjects);
    },

    /**
     * Aggregate data by request ID
     * Columns: Request ID | HTTP Request | Total Objects | Distinct Sources
     */
    aggregateByRequest(data) {
        const map = new Map();
        data.forEach(row => {
            if (!map.has(row.cRqstIdOrig)) {
                map.set(row.cRqstIdOrig, { cRqstIdOrig: row.cRqstIdOrig, query: row.query, totalObjects: 0, sources: new Set() });
            }
            const entry = map.get(row.cRqstIdOrig);
            entry.totalObjects += row.objectCount;
            entry.sources.add(row.source);
            if (!entry.query && row.query) entry.query = row.query;
        });
        return Array.from(map.values()).map(e => ({
            cRqstIdOrig: e.cRqstIdOrig,
            query: e.query,
            totalObjects: e.totalObjects,
            distinctSources: e.sources.size
        })).sort((a, b) => b.totalObjects - a.totalObjects);
    },

    /**
     * Aggregate data by session ID
     * Columns: Session ID | Total Objects | Distinct Requests | Distinct Sources
     */
    aggregateBySession(data) {
        const map = new Map();
        data.forEach(row => {
            if (!map.has(row.sessionId)) {
                map.set(row.sessionId, { sessionId: row.sessionId, totalObjects: 0, requests: new Set(), sources: new Set() });
            }
            const entry = map.get(row.sessionId);
            entry.totalObjects += row.objectCount;
            entry.requests.add(row.cRqstIdOrig);
            entry.sources.add(row.source);
        });
        return Array.from(map.values()).map(e => ({
            sessionId: e.sessionId,
            totalObjects: e.totalObjects,
            distinctRequests: e.requests.size,
            distinctSources: e.sources.size
        })).sort((a, b) => b.totalObjects - a.totalObjects);
    },

    // ==================== SORTING ====================

    /**
     * Handle column header click for sorting
     */
    onAblSortClick(column) {
        if (this.ablSortColumn === column) {
            // Cycle: asc → desc → none
            if (this.ablSortDirection === 'asc') {
                this.ablSortDirection = 'desc';
            } else {
                this.ablSortColumn = '';
                this.ablSortDirection = '';
            }
        } else {
            this.ablSortColumn = column;
            this.ablSortDirection = 'asc';
        }
        this.renderAblResults();
    },

    /**
     * Sort array by column and direction
     */
    sortAblData(data, column, direction) {
        if (!column || !direction) return data;
        const sorted = [...data];
        const dir = direction === 'asc' ? 1 : -1;
        sorted.sort((a, b) => {
            const va = a[column] ?? '';
            const vb = b[column] ?? '';
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
            return String(va).localeCompare(String(vb)) * dir;
        });
        return sorted;
    },

    // ==================== FILTERING ====================

    /**
     * Get current filter values and apply them to data
     */
    applyAblFilters(data) {
        const searchInput = document.getElementById('ablSearchInput');
        const minInput = document.getElementById('ablMinObjects');
        const searchText = (searchInput?.value ?? '').toLowerCase().trim();
        const minObjects = parseInt(minInput?.value ?? '0', 10) || 0;

        let filtered = data;

        // Min objects filter (uses the 'objects count' field — named differently per mode)
        if (minObjects > 0) {
            filtered = filtered.filter(row => {
                const count = row.totalObjects ?? row.objectCount ?? 0;
                return count >= minObjects;
            });
        }

        // Text search across all visible string fields
        if (searchText) {
            filtered = filtered.filter(row => {
                return Object.values(row).some(val =>
                    String(val).toLowerCase().includes(searchText)
                );
            });
        }

        return filtered;
    },

    /**
     * Setup debounced filter inputs
     */
    setupAblFilterListeners() {
        if (this._ablFilterListenersSet) return;
        this._ablFilterListenersSet = true;

        let debounceTimer = null;
        const onFilterChange = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => this.renderAblResults(), 300);
        };

        document.getElementById('ablSearchInput')?.addEventListener('input', onFilterChange);
        document.getElementById('ablMinObjects')?.addEventListener('input', onFilterChange);
    },

    // ==================== RENDERING ====================

    /**
     * Compute heat-map background color for a value in range [0, maxVal]
     */
    ablHeatColor(value, maxVal) {
        if (!maxVal || maxVal <= 0) return '';
        const intensity = Math.min(value / maxVal, 1);
        // Red channel, capped at 0.5 opacity for dark theme readability
        return `rgba(244, 135, 113, ${(intensity * 0.45).toFixed(2)})`;
    },

    /**
     * Build sortable header HTML
     */
    ablSortableHeader(label, column) {
        const isActive = this.ablSortColumn === column;
        const arrow = isActive
            ? (this.ablSortDirection === 'asc' ? '▲' : '▼')
            : '▲';
        const sortClass = isActive
            ? (this.ablSortDirection === 'asc' ? 'abl-sort-asc' : 'abl-sort-desc')
            : '';
        return `<th class="abl-sortable ${sortClass}" data-sort-col="${column}">${Utils.escapeHtml(label)}<span class="abl-sort-arrow">${arrow}</span></th>`;
    },

    /**
     * Main render dispatcher — picks the right mode and renders
     */
    renderAblResults() {
        this.setupAblFilterListeners();

        switch (this.ablDisplayMode) {
            case 'bySource':
                this.renderAblBySource();
                break;
            case 'byRequest':
                this.renderAblByRequest();
                break;
            case 'bySession':
                this.renderAblBySession();
                break;
            case 'detail':
            default:
                this.renderAblDetail();
                break;
        }
    },

    /**
     * Render "By Source" aggregation view
     */
    renderAblBySource() {
        const container = document.getElementById('ablResultsContainer');
        if (!container) return;

        let aggregated = this.aggregateBySource(this.ablConsolidatedData);
        aggregated = this.sortAblData(aggregated, this.ablSortColumn, this.ablSortDirection);
        const filtered = this.applyAblFilters(aggregated);
        const maxObjects = Math.max(...aggregated.map(r => r.totalObjects), 1);

        this.updateAblFilterCount(filtered.length, aggregated.length);

        let html = '<div class="grid-container abl-results-grid"><table class="data-grid"><thead><tr>' +
            this.ablSortableHeader('Source', 'source') +
            this.ablSortableHeader('Total Objects', 'totalObjects') +
            this.ablSortableHeader('Distinct Requests', 'distinctRequests') +
            this.ablSortableHeader('Avg/Request', 'avgPerRequest') +
            '</tr></thead><tbody>';

        filtered.forEach(row => {
            const bg = this.ablHeatColor(row.totalObjects, maxObjects);
            html += '<tr>' +
                `<td title="${Utils.escapeHtml(row.source)}">${Utils.escapeHtml(row.source)}</td>` +
                `<td class="abl-heat-cell" style="background:${bg}">${row.totalObjects}</td>` +
                `<td>${row.distinctRequests}</td>` +
                `<td>${row.avgPerRequest}</td>` +
                '</tr>';
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
        this.bindAblSortHeaders(container);
    },

    /**
     * Render "By Request" aggregation view
     */
    renderAblByRequest() {
        const container = document.getElementById('ablResultsContainer');
        if (!container) return;

        let aggregated = this.aggregateByRequest(this.ablConsolidatedData);
        aggregated = this.sortAblData(aggregated, this.ablSortColumn, this.ablSortDirection);
        const filtered = this.applyAblFilters(aggregated);
        const maxObjects = Math.max(...aggregated.map(r => r.totalObjects), 1);

        this.updateAblFilterCount(filtered.length, aggregated.length);

        let html = '<div class="grid-container abl-results-grid"><table class="data-grid"><thead><tr>' +
            this.ablSortableHeader('Request ID', 'cRqstIdOrig') +
            this.ablSortableHeader('HTTP Request', 'query') +
            this.ablSortableHeader('Total Objects', 'totalObjects') +
            this.ablSortableHeader('Distinct Sources', 'distinctSources') +
            '</tr></thead><tbody>';

        filtered.forEach(row => {
            const bg = this.ablHeatColor(row.totalObjects, maxObjects);
            const matchClass = row.query ? 'abl-matched' : 'abl-unmatched';
            html += `<tr class="${matchClass}">` +
                `<td>${Utils.escapeHtml(row.cRqstIdOrig)}</td>` +
                `<td title="${Utils.escapeHtml(row.query)}">${Utils.escapeHtml(Utils.truncate(row.query, 60))}</td>` +
                `<td class="abl-heat-cell" style="background:${bg}">${row.totalObjects}</td>` +
                `<td>${row.distinctSources}</td>` +
                '</tr>';
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
        this.bindAblSortHeaders(container);
    },

    /**
     * Render "By Session" aggregation view
     */
    renderAblBySession() {
        const container = document.getElementById('ablResultsContainer');
        if (!container) return;

        let aggregated = this.aggregateBySession(this.ablConsolidatedData);
        aggregated = this.sortAblData(aggregated, this.ablSortColumn, this.ablSortDirection);
        const filtered = this.applyAblFilters(aggregated);
        const maxObjects = Math.max(...aggregated.map(r => r.totalObjects), 1);

        this.updateAblFilterCount(filtered.length, aggregated.length);

        let html = '<div class="grid-container abl-results-grid"><table class="data-grid"><thead><tr>' +
            this.ablSortableHeader('Session ID', 'sessionId') +
            this.ablSortableHeader('Total Objects', 'totalObjects') +
            this.ablSortableHeader('Distinct Requests', 'distinctRequests') +
            this.ablSortableHeader('Distinct Sources', 'distinctSources') +
            '</tr></thead><tbody>';

        filtered.forEach(row => {
            const bg = this.ablHeatColor(row.totalObjects, maxObjects);
            html += '<tr>' +
                `<td>${Utils.escapeHtml(String(row.sessionId))}</td>` +
                `<td class="abl-heat-cell" style="background:${bg}">${row.totalObjects}</td>` +
                `<td>${row.distinctRequests}</td>` +
                `<td>${row.distinctSources}</td>` +
                '</tr>';
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
        this.bindAblSortHeaders(container);
    },

    /**
     * Render "Detail" flat table (original view)
     */
    renderAblDetail() {
        const container = document.getElementById('ablResultsContainer');
        if (!container) return;

        let data = [...this.ablConsolidatedData];
        data = this.sortAblData(data, this.ablSortColumn, this.ablSortDirection);
        const filtered = this.applyAblFilters(data);
        const maxObjects = Math.max(...data.map(r => r.objectCount), 1);

        this.updateAblFilterCount(filtered.length, data.length);

        let html = '<div class="grid-container abl-results-grid"><table class="data-grid"><thead><tr>' +
            this.ablSortableHeader('Session ID', 'sessionId') +
            this.ablSortableHeader('Request ID', 'cRqstIdOrig') +
            this.ablSortableHeader('Source', 'source') +
            this.ablSortableHeader('HTTP Request', 'query') +
            this.ablSortableHeader('Objects', 'objectCount') +
            '</tr></thead><tbody>';

        filtered.forEach(row => {
            const bg = this.ablHeatColor(row.objectCount, maxObjects);
            const matchClass = row.query ? 'abl-matched' : 'abl-unmatched';
            html += `<tr class="${matchClass}">` +
                `<td>${Utils.escapeHtml(String(row.sessionId))}</td>` +
                `<td>${Utils.escapeHtml(row.cRqstIdOrig)}</td>` +
                `<td title="${Utils.escapeHtml(row.source)}">${Utils.escapeHtml(Utils.truncate(row.source, 50))}</td>` +
                `<td title="${Utils.escapeHtml(row.query)}">${Utils.escapeHtml(Utils.truncate(row.query, 50))}</td>` +
                `<td class="abl-heat-cell" style="background:${bg}">${row.objectCount}</td>` +
                '</tr>';
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
        this.bindAblSortHeaders(container);
    },

    /**
     * Bind click handlers on sortable table headers (event delegation)
     */
    bindAblSortHeaders(container) {
        container.querySelectorAll('th.abl-sortable').forEach(th => {
            th.addEventListener('click', () => {
                this.onAblSortClick(th.dataset.sortCol);
            });
        });
    },

    /**
     * Update filter count display
     */
    updateAblFilterCount(shown, total) {
        const el = document.getElementById('ablFilterCount');
        if (el) {
            el.textContent = shown === total ? `${total} entries` : `${shown} of ${total} entries`;
        }
    },

    /**
     * Render consolidated results (called after consolidation)
     * @deprecated Use renderAblResults() — kept for backward compatibility
     */
    renderConsolidatedResults() {
        if (this.ablConsolidatedData.length === 0) {
            const container = document.getElementById('ablResultsContainer');
            if (container) container.innerHTML = '<p class="empty-state">No consolidated data</p>';
            this.showAblResultsControls(false);
            return;
        }
        this.showAblResultsControls(true);
        this.updateAblSummaryStats();
        this.renderAblResults();
    },

    // ==================== EXPORT ====================

    /**
     * Export consolidated data as CSV (semicolon-delimited, matching abl-objects.p output)
     */
    exportConsolidatedCsv() {
        if (this.ablConsolidatedData.length === 0) {
            Utils.showToast('No data to export', 'warning');
            return;
        }

        const mode = this.ablDisplayMode || 'detail';
        let lines;

        if (mode === 'bySource') {
            const rows = this.applyAblFilters(this.aggregateBySource(this.ablConsolidatedData));
            lines = ['source;totalObjects;distinctRequests;avgPerRequest'];
            rows.forEach(r => lines.push([r.source, r.totalObjects, r.distinctRequests, r.avgPerRequest].join(';')));
        } else if (mode === 'byRequest') {
            const rows = this.applyAblFilters(this.aggregateByRequest(this.ablConsolidatedData));
            lines = ['cRqstIdOrig;query;totalObjects;distinctSources'];
            rows.forEach(r => lines.push([r.cRqstIdOrig, r.query, r.totalObjects, r.distinctSources].join(';')));
        } else if (mode === 'bySession') {
            const rows = this.applyAblFilters(this.aggregateBySession(this.ablConsolidatedData));
            lines = ['sessionId;totalObjects;distinctRequests;distinctSources'];
            rows.forEach(r => lines.push([r.sessionId, r.totalObjects, r.distinctRequests, r.distinctSources].join(';')));
        } else {
            const rows = this.applyAblFilters(this.ablConsolidatedData);
            lines = ['sessionId;cRqstIdOrig;source;query;objectCount'];
            rows.forEach(r => lines.push([r.sessionId, r.cRqstIdOrig, r.source, r.query, r.objectCount].join(';')));
        }

        const csvContent = lines.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ABLObjects_${mode}_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        Utils.showToast('CSV exported', 'success');
    },

    /**
     * Download the raw ABL Objects report as JSON
     */
    downloadAblReport() {
        if (!this.ablObjectsReport) {
            Utils.showToast('No report to download', 'warning');
            return;
        }

        const json = JSON.stringify(this.ablObjectsReport, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ABLObjects_Agent_${this.ablSelectedAgentId}_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        Utils.showToast('ABL Objects report downloaded', 'success');
    },

    // ==================== HELPERS ====================

    /**
     * Update the status message in the ABL Objects view
     */
    updateAblStatusMessage(message) {
        const el = document.getElementById('ablStatusMessage');
        if (el) el.textContent = message;
    }
};

// Mixin is applied in app.js after class definition
