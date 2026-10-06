/**
 * OE Manager GUI - Charts View
 * Mixin for performance charts with time-series data
 * 
 * Methods are added to OeManagerApp.prototype
 */

// Samples kept per session; also the width of the time-series chart window
const CHART_WINDOW_POINTS = 200;

// Time-series charts that have a legend popover (keyed by the legend id used in index.html)
const CHART_LEGENDS = {
    memory: { chartProp: 'memoryTimeChart', value: (s) => `${(s.memory || 0).toFixed(1)} MB` },
    completed: { chartProp: 'requestsCompletedTimeChart', value: (s) => String(s.requestsCompleted || 0) },
    failed: { chartProp: 'requestsFailedTimeChart', value: (s) => String(s.requestsFailed || 0) }
};

const ChartsViewMixin = {
    /**
     * Initialize Chart.js charts - creates empty chart instances
     * Charts are populated by loadChartsData()
     */
    initCharts() {
        // Charts are created dynamically when data is loaded
        // This matches the VS Code extension behavior
    },

    /**
     * Color palette for different sessions (matches VS Code extension)
     */
    getChartColors() {
        return [
            'rgba(255, 99, 132, 1)',   // Red
            'rgba(54, 162, 235, 1)',   // Blue
            'rgba(75, 192, 192, 1)',   // Teal
            'rgba(255, 206, 86, 1)',   // Yellow
            'rgba(153, 102, 255, 1)',  // Purple
            'rgba(255, 159, 64, 1)',   // Orange
            'rgba(201, 203, 207, 1)',  // Grey
            'rgba(100, 181, 246, 1)',  // Light Blue
            'rgba(156, 39, 176, 1)',   // Deep Purple
            'rgba(0, 150, 136, 1)'     // Teal Dark
        ];
    },

    /**
     * Load charts data - fetches agents with sessions and updates all charts
     * Matches VS Code extension chartsPanel.ts loadChartsData()
     */
    async loadChartsData() {
        if (!this.selectedApplication) return;
        if (!Utils.ensureChartLibrary()) return;
        this.ensureChartLegendState();
        
        try {
            const applicationName = this.selectedApplication;

            // Fetch agents with their sessions (like VS Code extension)
            const agentsWithSessions = await this.agentService.fetchAgentsWithSessions(applicationName);
            if (applicationName !== this.selectedApplication) return;
            
            // Update per-session time-series data
            const currentTime = new Date();
            this.chartRefreshTick++;
            agentsWithSessions.forEach(agent => {
                const agentId = agent.agentId;
                // Metrics arrive separately (refreshChartAgentMetrics) so a slow agent never delays the charts
                const previous = this.chartAgentInfo.get(agentId);
                this.chartAgentInfo.set(agentId, {
                    agentId,
                    pid: agent.pid ?? agent.PID ?? '',
                    state: agent.state ?? agent.State ?? '',
                    metrics: previous?.metrics ?? {},
                    lastSeenTick: this.chartRefreshTick
                });

                if (agent.sessions && Array.isArray(agent.sessions)) {
                    agent.sessions.forEach(session => {
                        const sessionId = session.SessionId ?? session.sessionId;
                        const sessionKey = `${agentId}-${sessionId}`;
                        const memory = (session.SessionMemory || session.sessionMemory || 0) / (1024 * 1024); // Convert to MB
                        const requestsCompleted = session.RequestsCompleted || session.requestsCompleted || 0;
                        const requestsFailed = session.RequestsFailed || session.requestsFailed || 0;

                        if (!this.chartHistoryData.has(sessionKey)) {
                            this.chartHistoryData.set(sessionKey, []);
                        }

                        const history = this.chartHistoryData.get(sessionKey);
                        history.push({ 
                            time: currentTime, 
                            memory: memory, 
                            requestsCompleted: requestsCompleted, 
                            requestsFailed: requestsFailed 
                        });

                        // Keep only the last CHART_WINDOW_POINTS data points
                        if (history.length > CHART_WINDOW_POINTS) {
                            history.shift();
                        }

                        this.chartSessionInfo.set(sessionKey, {
                            sessionKey,
                            agentId,
                            sessionId: String(sessionId ?? ''),
                            state: session.SessionState ?? session.sessionState ?? '',
                            startTime: session.StartTime ?? session.startTime ?? '',
                            lastSeenTick: this.chartRefreshTick
                        });
                    });
                }
            });

            this.pruneChartHistory();

            // Update all charts
            this.updateCharts(agentsWithSessions);

            this.chartMetricsPromise = this.refreshChartAgentMetrics(applicationName, agentsWithSessions);
            
        } catch (error) {
            Utils.reportChartProblem(`Failed to update charts: ${error.message}`);
        }
    },

    /**
     * Fetch per-agent metrics for the legend. Runs after the charts are drawn and skips a tick
     * while the previous request is still pending; a failure keeps the last known metrics.
     */
    async refreshChartAgentMetrics(applicationName, agents) {
        if (this._chartMetricsLoading) return;
        this._chartMetricsLoading = true;
        try {
            const results = await Promise.allSettled(
                agents.map(agent => this.agentService.fetchAgentMetrics(applicationName, agent.agentId))
            );
            if (applicationName !== this.selectedApplication) return;

            results.forEach((result, index) => {
                const info = this.chartAgentInfo.get(agents[index].agentId);
                if (info && result.status === 'fulfilled') {
                    info.metrics = result.value?.result?.AgentStatHist?.[0] ?? {};
                }
            });
            this.chartLegendInfo = this.buildChartLegendInfo();
            this.renderChartLegends();
        } finally {
            this._chartMetricsLoading = false;
        }
    },

    // ==================== LEGEND STATE ====================

    /** Lazily create the legend caches (kept off the constructor so tests can use bare objects). */
    ensureChartLegendState() {
        if (this.chartSessionInfo) return;
        this.chartAgentInfo = new Map();
        this.chartSessionInfo = new Map();
        this.chartSessionColors = new Map();
        this.chartHiddenSessions = { memory: new Set(), completed: new Set(), failed: new Set() };
        this.chartLegendPinned = { memory: false, completed: false, failed: false };
        this.chartRefreshTick = 0;
    },

    /** Forget all history, e.g. after an application change or logout. */
    clearChartHistory() {
        this.chartHistoryData.clear();
        this.ensureChartLegendState();
        this.chartAgentInfo.clear();
        this.chartSessionInfo.clear();
        this.chartSessionColors.clear();
        Object.values(this.chartHiddenSessions).forEach(set => set.clear());
        this.chartRefreshTick = 0;
        this.chartLegendInfo = { agents: [] };
        this.renderChartLegends();
    },

    /**
     * Drop sessions whose last sample has left the chart window, so terminated sessions
     * disappear from the charts and the legend instead of accumulating forever.
     */
    pruneChartHistory() {
        const minTick = this.chartRefreshTick - CHART_WINDOW_POINTS;
        for (const [key, info] of this.chartSessionInfo) {
            if (info.lastSeenTick <= minTick) {
                this.chartSessionInfo.delete(key);
                this.chartHistoryData.delete(key);
            }
        }
        for (const key of this.chartHistoryData.keys()) {
            if (!this.chartSessionInfo.has(key)) {
                this.chartHistoryData.delete(key);
            }
        }
        const agentsInUse = new Set(Array.from(this.chartSessionInfo.values()).map(s => s.agentId));
        for (const [agentId, info] of this.chartAgentInfo) {
            if (info.lastSeenTick <= minTick && !agentsInUse.has(agentId)) {
                this.chartAgentInfo.delete(agentId);
            }
        }
    },

    /** Legend data grouped by agent: agent info and metrics plus each session's latest values. */
    buildChartLegendInfo() {
        const agents = new Map();
        for (const [sessionKey, session] of this.chartSessionInfo) {
            const history = this.chartHistoryData.get(sessionKey);
            const last = history && history.length > 0 ? history[history.length - 1] : undefined;
            let agent = agents.get(session.agentId);
            if (!agent) {
                const info = this.chartAgentInfo.get(session.agentId);
                agent = {
                    agentId: session.agentId,
                    pid: info?.pid ?? '',
                    state: info?.state ?? '',
                    metrics: info?.metrics ?? {},
                    sessions: []
                };
                agents.set(session.agentId, agent);
            }
            agent.sessions.push({
                sessionKey,
                sessionId: session.sessionId,
                state: session.state,
                startTime: session.startTime,
                memory: last?.memory ?? 0,
                requestsCompleted: last?.requestsCompleted ?? 0,
                requestsFailed: last?.requestsFailed ?? 0
            });
        }
        return { agents: Array.from(agents.values()) };
    },

    /** Keep a session's color across refreshes; free palette entries are reused first. */
    assignChartSessionColors(keys) {
        const palette = this.getChartColors();
        const active = new Set(keys);
        for (const key of Array.from(this.chartSessionColors.keys())) {
            if (!active.has(key)) { this.chartSessionColors.delete(key); }
        }
        for (const key of keys) {
            if (this.chartSessionColors.has(key)) continue;
            const used = new Set(this.chartSessionColors.values());
            const free = palette.find(color => !used.has(color));
            this.chartSessionColors.set(key, free || palette[this.chartSessionColors.size % palette.length]);
        }
        for (const hidden of Object.values(this.chartHiddenSessions)) {
            for (const key of Array.from(hidden)) {
                if (!active.has(key)) { hidden.delete(key); }
            }
        }
    },

    // ==================== LEGEND RENDERING ====================

    renderChartAgentMetrics(m) {
        if (!m || Object.keys(m).length === 0) {
            return '<div class="legend-muted">No metrics available</div>';
        }
        const rows = [
            ['Memory', `CStack ${Utils.formatBytes(m.CStackMemory || 0)} / Overhead ${Utils.formatBytes(m.OverheadMemory || 0)}`],
            ['Active', `${m.ActiveThreads || 0} threads, ${m.ActiveSessions || 0} sessions, ${m.OpenConnections || 0} connections`],
            ['Exited', `${m.ExitedThreads || 0} threads, ${m.ExitedSessions || 0} sessions, ${m.ClosedConnections || 0} connections`],
            ['Requests', `${m.RequestsCompleted || 0} completed, ${m.RequestsFailed || 0} failed, ${m.RequestsQueued || 0} queued`],
            ['Duration', `avg ${Utils.formatDuration(m.AvgRequestDuration || 0)}, min ${Utils.formatDuration(m.MinRequestDuration || 0)}, max ${Utils.formatDuration(m.MaxRequestDuration || 0)}`]
        ];
        const cells = rows.map(([label, value]) =>
            `<span class="legend-muted">${label}</span><span>${Utils.escapeHtml(value)}</span>`).join('');
        return `<div class="legend-agent-metrics">${cells}</div>`;
    },

    renderChartLegend(legendId) {
        const popover = document.querySelector(`.legend-popover[data-chart="${legendId}"]`);
        if (!popover) return;
        const esc = Utils.escapeHtml;
        const agents = this.chartLegendInfo?.agents ?? [];
        if (agents.length === 0) {
            popover.innerHTML = '<div class="legend-empty">No sessions</div>';
            return;
        }

        const hidden = this.chartHiddenSessions[legendId];
        const valueOf = CHART_LEGENDS[legendId].value;
        let html = '';
        for (const agent of agents) {
            html += '<div class="legend-agent">' +
                '<div class="legend-agent-header">' +
                `<span>Agent ${esc(String(agent.agentId))}</span>` +
                `<span class="legend-muted">PID ${esc(String(agent.pid || '-'))}</span>` +
                `<span class="legend-muted">${esc(String(agent.state || ''))}</span>` +
                '</div>' +
                this.renderChartAgentMetrics(agent.metrics);
            for (const s of agent.sessions || []) {
                const color = this.chartSessionColors.get(s.sessionKey) || 'rgba(201, 203, 207, 1)';
                html += `<div class="legend-session${hidden.has(s.sessionKey) ? ' hidden-series' : ''}"` +
                    ` data-session-key="${esc(s.sessionKey)}" title="Click to show/hide this session">` +
                    `<span class="legend-swatch" style="background-color: ${esc(color)}"></span>` +
                    `<span>S${esc(String(s.sessionId))}</span>` +
                    `<span class="legend-muted">${esc(String(s.state || ''))}</span>` +
                    `<span class="legend-muted">${esc(Utils.formatIsoDate(s.startTime))}</span>` +
                    `<span class="legend-session-value">${esc(valueOf(s))}</span>` +
                    '</div>';
            }
            html += '</div>';
        }
        const scrollTop = popover.scrollTop;
        popover.innerHTML = html;
        popover.scrollTop = scrollTop;
    },

    renderChartLegends() {
        Object.keys(CHART_LEGENDS).forEach(id => this.renderChartLegend(id));
    },

    setChartLegendPinned(legendId, pinned) {
        this.chartLegendPinned[legendId] = pinned;
        document.querySelector(`.legend-control[data-chart="${legendId}"]`)?.classList.toggle('pinned', pinned);
    },

    toggleChartSeries(legendId, sessionKey) {
        const hidden = this.chartHiddenSessions[legendId];
        if (hidden.has(sessionKey)) { hidden.delete(sessionKey); } else { hidden.add(sessionKey); }

        const chart = this[CHART_LEGENDS[legendId].chartProp];
        if (chart) {
            chart.data.datasets.forEach((dataset, index) => {
                if (dataset.label === sessionKey) {
                    dataset.hidden = hidden.has(sessionKey);
                    const meta = chart.getDatasetMeta?.(index);
                    if (meta) { meta.hidden = null; }
                }
            });
            chart.update('none');
        }
        this.renderChartLegend(legendId);
    },

    /** Delegated clicks: legend icon pins the popover, a session row shows/hides its line. */
    handleChartLegendClick(event) {
        this.ensureChartLegendState();
        const toggle = event.target.closest('.legend-toggle');
        if (toggle) {
            const legendId = toggle.dataset.chart;
            this.setChartLegendPinned(legendId, !this.chartLegendPinned[legendId]);
            return;
        }
        const row = event.target.closest('.legend-session');
        if (row) {
            const popover = row.closest('.legend-popover');
            if (popover) { this.toggleChartSeries(popover.dataset.chart, row.dataset.sessionKey); }
        }
    },

    /**
     * Update charts with current data
     * Matches VS Code extension's updateCharts message handler
     */
    updateCharts(agentsWithSessions) {
        const colors = this.getChartColors();
        const historyData = Array.from(this.chartHistoryData.entries()).map(([key, data]) => ({
            sessionKey: key,
            data: data
        }));

        if (historyData.length === 0) {
            // No history data yet - will populate on next refresh
            this.ensureChartLegendState();
            this.chartLegendInfo = this.buildChartLegendInfo();
            this.chartSessionColors.clear();
            this.renderChartLegends();
            return;
        }

        this.ensureChartLegendState();
        this.chartLegendInfo = this.buildChartLegendInfo();
        this.assignChartSessionColors(historyData.map(h => h.sessionKey));
        this.renderChartLegends();

        // Calculate time window
        const now = new Date();
        const windowPoints = CHART_WINDOW_POINTS;
        
        // Calculate average interval from actual data
        let intervalMs = this.refreshIntervals.charts * 1000; // Default to refresh interval
        let totalIntervals = 0;
        let intervalCount = 0;

        historyData.forEach(sessionHistory => {
            if (sessionHistory.data && sessionHistory.data.length > 1) {
                for (let i = 1; i < sessionHistory.data.length; i++) {
                    const t1 = new Date(sessionHistory.data[i - 1].time);
                    const t2 = new Date(sessionHistory.data[i].time);
                    totalIntervals += (t2.getTime() - t1.getTime());
                    intervalCount++;
                }
            }
        });

        if (intervalCount > 0) {
            intervalMs = totalIntervals / intervalCount;
        }

        const windowMs = windowPoints * intervalMs;
        const minTime = new Date(now.getTime() - windowMs);

        // Common chart options for time-series
        const timeSeriesOptions = {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: { mode: 'index', intersect: false }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        displayFormats: { second: 'HH:mm:ss' },
                        tooltipFormat: 'HH:mm:ss'
                    },
                    min: minTime,
                    max: now,
                    ticks: { display: false },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    border: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#9d9d9d' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    border: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            }
        };

        // === Memory Time Chart ===
        this.updateTimeSeriesChart(
            'memoryTimeChart',
            'memoryTimeChart',
            historyData,
            d => d.memory,
            'Memory (MB)',
            colors,
            minTime,
            now,
            intervalMs,
            windowPoints,
            timeSeriesOptions
        );

        // === Requests Completed Time Chart ===
        this.updateTimeSeriesChart(
            'requestsCompletedTimeChart',
            'requestsCompletedTimeChart',
            historyData,
            d => d.requestsCompleted,
            'Requests Completed',
            colors,
            minTime,
            now,
            intervalMs,
            windowPoints,
            timeSeriesOptions
        );

        // === Requests Failed Time Chart ===
        this.updateTimeSeriesChart(
            'requestsFailedTimeChart',
            'requestsFailedTimeChart',
            historyData,
            d => d.requestsFailed,
            'Requests Failed',
            colors,
            minTime,
            now,
            intervalMs,
            windowPoints,
            timeSeriesOptions
        );

        // === Session Bar Charts (current values) ===
        this.updateSessionBarCharts(agentsWithSessions, colors);
    },

    /**
     * Update a time-series line chart
     */
    updateTimeSeriesChart(canvasId, chartProp, historyData, dataExtractor, yAxisTitle, colors, minTime, maxTime, intervalMs, windowPoints, baseOptions) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        const legendId = Object.keys(CHART_LEGENDS).find(id => CHART_LEGENDS[id].chartProp === chartProp);

        const datasets = historyData.map((sessionHistory, index) => {
            const color = this.chartSessionColors?.get(sessionHistory.sessionKey) ?? colors[index % colors.length];
            let data = sessionHistory.data.map(d => ({ x: new Date(d.time), y: dataExtractor(d) }));
            
            // Pad with null values if needed
            if (data.length < windowPoints) {
                let padStart = [];
                for (let i = 0; i < windowPoints - data.length; i++) {
                    padStart.push({ x: new Date(minTime.getTime() + i * intervalMs), y: null });
                }
                data = padStart.concat(data);
            }
            
            return {
                label: sessionHistory.sessionKey,
                data: data,
                borderColor: color,
                backgroundColor: color,
                borderWidth: 2,
                tension: 0.4,
                fill: false,
                pointRadius: 0,
                pointHitRadius: 5,
                spanGaps: false,
                hidden: Boolean(this.chartHiddenSessions?.[legendId]?.has(sessionHistory.sessionKey))
            };
        });

        if (this[chartProp]) {
            // Update existing chart
            this[chartProp].data.datasets = datasets;
            this[chartProp].options.scales.x.min = minTime;
            this[chartProp].options.scales.x.max = maxTime;
            this[chartProp].update('none');
        } else {
            // Create new chart
            const options = JSON.parse(JSON.stringify(baseOptions));
            options.scales.y.title = { display: true, text: yAxisTitle, color: '#cccccc' };
            
            this[chartProp] = new Chart(ctx, {
                type: 'line',
                data: { datasets: datasets },
                options: options
            });
        }
    },

    /**
     * Update session bar charts (current values)
     */
    updateSessionBarCharts(agentsWithSessions, colors) {
        // Collect all sessions from all agents
        const allSessions = [];
        agentsWithSessions.forEach(agent => {
            if (agent.sessions && Array.isArray(agent.sessions)) {
                agent.sessions.forEach(session => {
                    allSessions.push({
                        agentId: agent.agentId || 'Unknown',
                        sessionId: session.SessionId || session.sessionId || 'Unknown',
                        sessionMemory: session.SessionMemory || session.sessionMemory || 0,
                        requestsCompleted: session.RequestsCompleted || session.requestsCompleted || 0,
                        requestsFailed: session.RequestsFailed || session.requestsFailed || 0
                    });
                });
            }
        });

        if (allSessions.length === 0) {
            return;
        }

        // Prepare data
        const labels = allSessions.map(s => `A${s.agentId.substring(0, 4)}-S${s.sessionId}`);
        const memoryData = allSessions.map(s => (s.sessionMemory / (1024 * 1024)).toFixed(2));
        const completedData = allSessions.map(s => s.requestsCompleted);
        const failedData = allSessions.map(s => s.requestsFailed);

        // Common options for bar charts
        const barOptions = {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#9d9d9d' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    border: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                x: {
                    ticks: { color: '#9d9d9d', maxTicksLimit: 8 },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    border: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            }
        };

        // Session Memory Chart
        this.updateBarChart('sessionMemoryChart', labels, memoryData, 
            'rgba(54, 162, 235, 0.6)', 'rgba(54, 162, 235, 1)', barOptions);

        // Requests Completed Chart
        this.updateBarChart('sessionCompletedChart', labels, completedData,
            'rgba(75, 192, 192, 0.6)', 'rgba(75, 192, 192, 1)', barOptions);

        // Requests Failed Chart
        this.updateBarChart('sessionFailedChart', labels, failedData,
            'rgba(255, 99, 132, 0.6)', 'rgba(255, 99, 132, 1)', barOptions);
    },

    /**
     * Update a bar chart
     */
    updateBarChart(canvasId, labels, data, bgColor, borderColor, options) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        const chartProp = canvasId; // Use canvas ID as property name
        
        if (this[chartProp]) {
            // Update existing chart
            this[chartProp].data.labels = labels;
            this[chartProp].data.datasets[0].data = data;
            this[chartProp].update('none');
        } else {
            // Create new chart
            this[chartProp] = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: bgColor,
                        borderColor: borderColor,
                        borderWidth: 1
                    }]
                },
                options: options
            });
        }
    },

    /**
     * Destroy all chart instances
     */
    destroyCharts() {
        if (this.memoryTimeChart) {
            this.memoryTimeChart.destroy();
            this.memoryTimeChart = null;
        }
        if (this.requestsCompletedTimeChart) {
            this.requestsCompletedTimeChart.destroy();
            this.requestsCompletedTimeChart = null;
        }
        if (this.requestsFailedTimeChart) {
            this.requestsFailedTimeChart.destroy();
            this.requestsFailedTimeChart = null;
        }
        if (this.sessionMemoryChart) {
            this.sessionMemoryChart.destroy();
            this.sessionMemoryChart = null;
        }
        if (this.sessionCompletedChart) {
            this.sessionCompletedChart.destroy();
            this.sessionCompletedChart = null;
        }
        if (this.sessionFailedChart) {
            this.sessionFailedChart.destroy();
            this.sessionFailedChart = null;
        }
    }
};

// Apply mixin to OeManagerApp prototype when app.js loads
// This is done at the end of app.js after class definition

// Allow CommonJS require() in test environments without affecting browser usage.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ChartsViewMixin };
}
