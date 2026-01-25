/**
 * OE Manager GUI - Charts View
 * Mixin for performance charts with time-series data
 * 
 * Methods are added to OeManagerApp.prototype
 */

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
        
        try {
            // Fetch agents with their sessions (like VS Code extension)
            const agentsWithSessions = await this.agentService.fetchAgentsWithSessions(this.selectedApplication);
            
            // Update per-session time-series data
            const currentTime = new Date();
            agentsWithSessions.forEach(agent => {
                if (agent.sessions && Array.isArray(agent.sessions)) {
                    agent.sessions.forEach(session => {
                        const sessionKey = `${agent.agentId}-${session.SessionId || session.sessionId}`;
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

                        // Keep only last 200 data points (like VS Code extension)
                        if (history.length > 200) {
                            history.shift();
                        }
                    });
                }
            });

            // Update all charts
            this.updateCharts(agentsWithSessions);
            
        } catch (error) {
            console.error('Error loading charts data:', error);
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
            return;
        }

        // Calculate time window
        const now = new Date();
        const windowPoints = 200;
        
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
                legend: {
                    display: true,
                    position: 'top',
                    labels: { 
                        usePointStyle: true, 
                        boxWidth: 6,
                        color: '#cccccc'
                    }
                },
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

        const datasets = historyData.map((sessionHistory, index) => {
            const color = colors[index % colors.length];
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
                spanGaps: false
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
