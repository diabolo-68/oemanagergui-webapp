/**
 * OE Manager GUI - Metrics View
 * Mixin for agent statistics: one summary row per agent plus combined
 * Threads, Connections and Requests grids covering all agents.
 * Ported from oemanagergui VS Code extension (metricsPanel.ts, release 1.15.0).
 *
 * Methods are added to OeManagerApp.prototype
 */

const METRICS_DEFAULT_REFRESH_SEC = 10;

function metricColumn(field, label, cls, format) {
    return {
        label,
        cls: cls || '',
        value: (agent) => {
            const raw = agent.metrics[field] || 0;
            return format ? format(raw) : raw;
        }
    };
}

function statusColumn(field, label) {
    return { label, cls: '', value: (agent) => agent.status[field] || 0 };
}

const METRICS_SUMMARY_GROUPS = [
    { label: 'Status', columns: [
        statusColumn('threads', 'Threads'),
        statusColumn('sessions', 'Sessions'),
        statusColumn('connections', 'Connections'),
        statusColumn('requests', 'Requests')
    ] },
    { label: 'Memory', columns: [
        metricColumn('CStackMemory', 'CStack', 'memory', (v) => Utils.formatBytes(v)),
        metricColumn('OverheadMemory', 'Overhead', 'memory', (v) => Utils.formatBytes(v))
    ] },
    { label: 'Active', columns: [
        metricColumn('ActiveThreads', 'Threads', 'active'),
        metricColumn('ActiveSessions', 'Sessions', 'active'),
        metricColumn('OpenConnections', 'Connections', 'active')
    ] },
    { label: 'Exited / Closed', columns: [
        metricColumn('ExitedThreads', 'Threads', 'exited'),
        metricColumn('ExitedSessions', 'Sessions', 'exited'),
        metricColumn('ClosedConnections', 'Connections', 'exited')
    ] },
    { label: 'Requests', columns: [
        metricColumn('RequestsCompleted', 'Completed', 'active'),
        metricColumn('RequestsFailed', 'Failed', 'exited'),
        metricColumn('RequestsQueued', 'Queued')
    ] },
    { label: 'Request Duration', columns: [
        metricColumn('TotalRequestsDuration', 'Total', '', (v) => Utils.formatDuration(v)),
        metricColumn('MinRequestDuration', 'Min', '', (v) => Utils.formatDuration(v)),
        metricColumn('MaxRequestDuration', 'Max', '', (v) => Utils.formatDuration(v)),
        metricColumn('AvgRequestDuration', 'Avg', '', (v) => Utils.formatDuration(v))
    ] }
];

const METRICS_SUMMARY_COLUMNS = METRICS_SUMMARY_GROUPS.flatMap(group =>
    group.columns.map((column, index) => ({ ...column, groupStart: index === 0 }))
);

const MetricsViewMixin = {

    // ==================== LOADING ====================

    /**
     * Load metrics data. Timer ticks pass queueIfBusy=false so they are dropped
     * instead of piling up behind a slow server.
     */
    async loadMetricsData(queueIfBusy = true) {
        if (!this.selectedApplication) return;
        if (this._metricsLoading) {
            this._metricsReloadQueued = this._metricsReloadQueued || queueIfBusy;
            return;
        }

        this._metricsLoading = true;
        const applicationName = this.selectedApplication;
        const includeRequests = this.includeRequests;
        document.getElementById('metricsSpinner')?.classList.add('visible');

        try {
            const [sessionMetrics, agents] = await Promise.all([
                this.agentService.fetchMetrics(applicationName).catch(() => null),
                this.agentService.fetchAgents(applicationName)
            ]);
            const agentMetrics = await Promise.all(
                agents.map(agent => this.fetchAgentSnapshot(applicationName, agent, includeRequests))
            );

            // The application may have changed while the requests were in flight
            if (applicationName === this.selectedApplication) {
                this.metricsData = { sessionMetrics, agentMetrics };
                this.metricsLastUpdated = new Date();
                this.showMetricsError('');
                this.renderMetricsView();
            }
        } catch (error) {
            console.error('Error loading metrics:', error);
            this.showMetricsError(`Error loading metrics: ${error.message}`);
        } finally {
            this._metricsLoading = false;
            document.getElementById('metricsSpinner')?.classList.remove('visible');
            this.updateMetricsRefreshStatus();
            if (this._metricsReloadQueued) {
                this._metricsReloadQueued = false;
                this.loadMetricsData();
            }
        }
    },

    /** Fetch everything shown for one agent; a failure is reported in the agent's row only. */
    async fetchAgentSnapshot(applicationName, agent, includeRequests) {
        const agentId = agent.agentId || agent.id;
        try {
            const [metricsResponse, connections, threads, status, requests] = await Promise.all([
                this.agentService.fetchAgentMetrics(applicationName, agentId),
                this.agentService.fetchAgentConnections(applicationName, agentId),
                this.agentService.fetchAgentThreads(applicationName, agentId),
                this.agentService.fetchAgentStatus(applicationName, agentId),
                includeRequests ? this.agentService.fetchAgentRequests(applicationName, agentId) : Promise.resolve([])
            ]);
            return {
                agentId,
                pid: agent.pid,
                metrics: metricsResponse?.result?.AgentStatHist?.[0] || metricsResponse?.AgentStatHist?.[0] || {},
                status: status || {},
                requests: requests || [],
                connections: connections || [],
                threads: threads || []
            };
        } catch (error) {
            console.error(`Error fetching data for agent ${agentId}:`, error);
            return {
                agentId, pid: agent.pid, metrics: {}, status: {}, requests: [], connections: [], threads: [],
                error: error.message
            };
        }
    },

    // ==================== AUTO-REFRESH ====================

    startMetricsAutoRefresh() {
        this.stopMetricsAutoRefresh();
        const seconds = this.refreshIntervals?.metrics ?? METRICS_DEFAULT_REFRESH_SEC;
        if (this.metricsPaused || seconds <= 0) {
            this.updateMetricsRefreshStatus();
            return;
        }
        this.metricsRefreshTimer = setInterval(() => this.loadMetricsData(false), seconds * 1000);
        this.updateMetricsRefreshStatus();
    },

    stopMetricsAutoRefresh() {
        if (this.metricsRefreshTimer) {
            clearInterval(this.metricsRefreshTimer);
            this.metricsRefreshTimer = null;
        }
    },

    toggleMetricsPause() {
        this.metricsPaused = !this.metricsPaused;
        if (this.metricsPaused) {
            this.stopMetricsAutoRefresh();
            this.updateMetricsRefreshStatus();
        } else {
            this.loadMetricsData();
            this.startMetricsAutoRefresh();
        }
    },

    updateMetricsRefreshStatus() {
        const status = document.getElementById('metricsRefreshStatus');
        const pauseBtn = document.getElementById('pauseMetricsBtn');
        const seconds = this.refreshIntervals?.metrics ?? METRICS_DEFAULT_REFRESH_SEC;
        let text = this.metricsLastUpdated ? `Updated ${this.metricsLastUpdated.toLocaleTimeString()}` : 'Not loaded yet';
        if (this.metricsPaused) {
            text += ' · auto-refresh paused';
        } else if (seconds > 0) {
            text += ` · auto-refresh every ${seconds}s`;
        } else {
            text += ' · auto-refresh off';
        }
        if (status) { status.textContent = text; }
        if (pauseBtn) { pauseBtn.textContent = this.metricsPaused ? 'Resume' : 'Pause'; }
    },

    // ==================== RENDERING ====================

    showMetricsError(message) {
        const box = document.getElementById('metricsError');
        if (!box) return;
        box.textContent = message;
        box.classList.toggle('hidden', !message);
    },

    /** Reset all grids, e.g. on logout or application change. */
    clearMetricsView(placeholder = 'Loading...') {
        this.metricsData = {};
        this.metricsLastUpdated = null;
        this.showMetricsError('');
        const sessionContent = document.getElementById('sessionManagerContent');
        if (sessionContent) { sessionContent.textContent = ''; }
        this.renderMetrics([], this.includeRequests, placeholder);
        this.updateMetricsRefreshStatus();
    },

    renderMetricsView() {
        if (!document.getElementById('metricsContainer')) return;
        const { sessionMetrics, agentMetrics } = this.metricsData;

        const sessionContent = document.getElementById('sessionManagerContent');
        if (sessionContent) {
            sessionContent.textContent = '';
            const table = Templates.sessionManagerMetrics(sessionMetrics);
            if (table) { sessionContent.appendChild(table); }
        }
        this.renderMetrics(agentMetrics || [], this.includeRequests);
    },

    /** Build the summary header once; later renders only touch body rows. */
    buildMetricsSummaryHeader() {
        const head = document.getElementById('metricsSummaryHead');
        if (!head || head.rows.length > 0) return;

        const appendHeader = (row, text, { rowSpan = 1, colSpan = 1, className = '' } = {}) => {
            const th = document.createElement('th');
            th.textContent = text;
            th.rowSpan = rowSpan;
            th.colSpan = colSpan;
            th.className = className;
            row.appendChild(th);
        };

        const groupRow = document.createElement('tr');
        const columnRow = document.createElement('tr');
        appendHeader(groupRow, 'Agent', { rowSpan: 2, className: 'agent-cell' });
        for (const group of METRICS_SUMMARY_GROUPS) {
            appendHeader(groupRow, group.label, { colSpan: group.columns.length, className: 'group-start' });
            group.columns.forEach((column, index) => {
                appendHeader(columnRow, column.label, { className: index === 0 ? 'group-start' : '' });
            });
        }
        appendHeader(groupRow, '', { rowSpan: 2, className: 'group-start' });
        head.appendChild(groupRow);
        head.appendChild(columnRow);
    },

    metricsAgentLabel(agent) {
        return agent.pid ? `${agent.agentId} (PID ${agent.pid})` : String(agent.agentId);
    },

    metricsSummaryCells(agent) {
        const label = { text: this.metricsAgentLabel(agent), cls: 'agent-cell' };
        const resetCell = {
            cls: 'group-start action-cell',
            button: { label: 'Reset', title: 'Reset statistics for this agent', agentId: agent.agentId }
        };
        if (agent.error) {
            return [label, { text: agent.error, cls: 'group-start error-cell', colSpan: METRICS_SUMMARY_COLUMNS.length }, resetCell];
        }
        const values = { metrics: agent.metrics || {}, status: agent.status || {} };
        const metricCells = METRICS_SUMMARY_COLUMNS.map(column => ({
            text: column.value(values),
            cls: `${column.groupStart ? 'group-start ' : ''}${column.cls}`.trim()
        }));
        return [label, ...metricCells, resetCell];
    },

    /** One row per (agent, item) pair, so every agent's items share one grid. */
    flattenMetricsRows(agents, field) {
        const rows = [];
        for (const agent of agents) {
            for (const item of agent[field] || []) {
                rows.push({ agent, item });
            }
        }
        return rows;
    },

    renderMetrics(agents, includeRequests, placeholder) {
        this.buildMetricsSummaryHeader();

        this.renderMetricsGrid('summary', agents,
            (agent) => agent.agentId,
            (agent) => this.metricsSummaryCells(agent),
            placeholder || 'No agents found',
            (agent) => (agent.error ? 'error-row' : ''));

        const agentCell = (row) => ({ text: this.metricsAgentLabel(row.agent), cls: 'agent-col' });
        const startTime = (row) => new Date(row.item.StartTime).getTime() || 0;

        const threads = this.flattenMetricsRows(agents, 'threads').sort((a, b) => startTime(b) - startTime(a));
        this.renderMetricsGrid('threads', threads,
            (row) => `${row.agent.agentId}|${row.item.ThreadId}`,
            (row) => [agentCell(row), { text: row.item.ThreadId }, { text: row.item.ThreadState },
                { text: Utils.formatIsoDate(row.item.StartTime) }, { text: Utils.formatIsoDate(row.item.EndTime) }],
            placeholder || 'No threads');

        this.renderMetricsGrid('connections', this.flattenMetricsRows(agents, 'connections'),
            (row) => `${row.agent.agentId}|${row.item.ConnectionId}`,
            (row) => [agentCell(row), { text: row.item.ConnectionId }, { text: row.item.ConnectionState },
                { text: row.item.SessionId }],
            placeholder || 'No connections');

        const requests = includeRequests ? this.flattenMetricsRows(agents, 'requests') : [];
        this.renderMetricsGrid('requests', requests,
            (row) => `${row.agent.agentId}|${row.item.RequestNum}|${row.item.requestID || ''}`,
            (row) => {
                const req = row.item;
                const requestIdCell = req.requestID
                    ? { text: req.requestID, cls: 'request-id-link', requestId: req.requestID, title: 'Open in Logfiles' }
                    : { text: '' };
                return [agentCell(row), { text: req.RequestNum }, { text: req.RequestProcName }, { text: req.SessionId },
                    { text: req.ConnectionId }, { text: Utils.formatIsoDate(req.StartTime) }, { text: req.RequestLen },
                    { text: req.RequestStatus }, requestIdCell];
            },
            placeholder || (includeRequests ? 'No running requests' : 'Enable "Include Requests" to load running requests'));
    },

    renderMetricsGrid(name, rows, keyOf, cellsOf, emptyText, rowClassOf) {
        const table = document.getElementById(`metrics${this.capitalize(name)}Table`);
        if (!table) return;
        this.syncMetricsRows(table.tBodies[0], rows, keyOf, cellsOf, rowClassOf);

        const visible = document.getElementById(`metrics${this.capitalize(name)}Wrapper`) || table;
        visible.classList.toggle('hidden', rows.length === 0);
        const empty = document.getElementById(`metrics${this.capitalize(name)}Empty`);
        if (empty) {
            empty.textContent = emptyText;
            empty.classList.toggle('hidden', rows.length > 0);
        }
        const count = document.getElementById(`metrics${this.capitalize(name)}Count`);
        if (count) { count.textContent = rows.length > 0 ? `(${rows.length})` : ''; }
    },

    capitalize(text) {
        return text.charAt(0).toUpperCase() + text.slice(1);
    },

    /** Reuse rows by key and only touch changed cells, so text selection and hover survive refreshes. */
    syncMetricsRows(tbody, items, keyOf, cellsOf, rowClassOf) {
        const unused = new Set(Array.from(tbody.rows));
        const byKey = new Map();
        unused.forEach(row => {
            if (!byKey.has(row.dataset.key)) { byKey.set(row.dataset.key, row); }
        });

        let previous = null;
        for (const item of items) {
            const key = String(keyOf(item));
            let row = byKey.get(key);
            if (row) {
                byKey.delete(key);
                unused.delete(row);
            } else {
                row = document.createElement('tr');
                row.dataset.key = key;
            }

            const cells = cellsOf(item);
            while (row.cells.length > cells.length) { row.deleteCell(-1); }
            cells.forEach((spec, index) => this.setMetricsCell(row.cells[index] || row.insertCell(-1), spec));

            const rowClass = rowClassOf ? rowClassOf(item) : '';
            if (row.className !== rowClass) { row.className = rowClass; }
            const expected = previous ? previous.nextSibling : tbody.firstChild;
            if (row !== expected) { tbody.insertBefore(row, expected); }
            previous = row;
        }
        unused.forEach(row => row.remove());
    },

    setMetricsCell(cell, spec) {
        const className = spec.cls || '';
        if (cell.className !== className) { cell.className = className; }
        const colSpan = spec.colSpan || 1;
        if (cell.colSpan !== colSpan) { cell.colSpan = colSpan; }

        if (spec.button) {
            let button = cell.querySelector('button');
            if (!button) {
                cell.textContent = '';
                button = document.createElement('button');
                button.className = 'btn btn-secondary btn-small btn-reset-agent';
                cell.appendChild(button);
            }
            button.textContent = spec.button.label;
            button.title = spec.button.title;
            button.dataset.agentId = spec.button.agentId;
            return;
        }

        const text = spec.text === null || spec.text === undefined ? '' : String(spec.text);
        if (cell.firstElementChild || cell.textContent !== text) { cell.textContent = text; }
        this.setMetricsAttribute(cell, 'data-request-id', spec.requestId);
        this.setMetricsAttribute(cell, 'title', spec.title);
    },

    setMetricsAttribute(element, name, value) {
        if (value === undefined || value === null || value === '') {
            element.removeAttribute(name);
        } else if (element.getAttribute(name) !== String(value)) {
            element.setAttribute(name, String(value));
        }
    },

    /** Delegated clicks: Request ID opens Logfiles, Reset resets one agent's statistics. */
    handleMetricsClick(event) {
        const requestCell = event.target.closest('.request-id-link');
        if (requestCell?.dataset.requestId) {
            this.openLogfilesWith({
                applicationName: this.selectedApplication,
                requestId: requestCell.dataset.requestId
            });
            return;
        }
        const resetBtn = event.target.closest('.btn-reset-agent');
        if (resetBtn?.dataset.agentId) {
            this.resetAgentStatistics(resetBtn.dataset.agentId);
        }
    },

    /**
     * Reset agent statistics
     */
    async resetAgentStatistics(agentId) {
        if (!confirm(`Reset statistics for agent ${agentId}?`)) {
            return;
        }
        
        try {
            await this.agentService.resetAgentStatistics(this.selectedApplication, agentId);
            Utils.showToast(`Statistics reset for agent ${agentId}`, 'success');
            await this.loadMetricsData();
        } catch (error) {
            Utils.showToast(`Failed to reset statistics: ${error.message}`, 'error');
        }
    },

    /**
     * Reset all statistics
     */
    async resetAllStatistics() {
        if (!confirm('Reset statistics for ALL agents?')) {
            return;
        }
        
        try {
            const agents = await this.agentService.fetchAgents(this.selectedApplication);
            for (const agent of agents) {
                const agentId = agent.agentId || agent.id;
                try {
                    await this.agentService.resetAgentStatistics(this.selectedApplication, agentId);
                } catch (e) {
                    // Continue with others
                }
            }
            Utils.showToast('Statistics reset for all agents', 'success');
            await this.loadMetricsData();
        } catch (error) {
            Utils.showToast(`Failed to reset statistics: ${error.message}`, 'error');
        }
    }
};

// Apply mixin to OeManagerApp prototype when app.js loads
// This is done at the end of app.js after class definition

// Allow CommonJS require() in test environments without affecting browser usage.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MetricsViewMixin };
}
