/**
 * OE Manager GUI - PASOE Stats View
 * Mixin for PASOE performance statistics with time-series charts
 * 
 * Shows historical data for:
 * - Memory Usage
 * - Connections (Current/Max)
 * - Requests (Completed/Failed/Queued)
 * - Read/Write operations
 * 
 * Methods are added to OeManagerApp.prototype
 */

const PasoeStatsViewMixin = {
    /**
     * Initialize PASOE stats charts
     */
    initPasoeStatsCharts() {
        // Charts are created dynamically when data is loaded
    },

    /**
     * Load PASOE stats data - fetches metrics and updates charts
     */
    async loadPasoeStatsData() {
        if (!this.selectedApplication) return;
        
        try {
            // Fetch SessionManager metrics and agents in parallel
            const [metrics, agents] = await Promise.all([
                this.agentService.fetchMetrics(this.selectedApplication),
                this.agentService.fetchAgents(this.selectedApplication)
            ]);
            
            // Calculate total memory from all agents and count session states
            let totalMemory = 0;
            let idleSessions = 0;
            let busySessions = 0;
            let stoppingAgents = 0;
            
            // Count agent states (STOPPING, BUSY, etc.)
            if (agents && agents.length > 0) {
                for (const agent of agents) {
                    const state = (agent.state || '').toUpperCase();
                    if (state === 'STOPPING' || state === 'STOPPED') {
                        stoppingAgents++;
                    }
                }
            }
            
            if (agents && agents.length > 0) {
                // Fetch metrics for each agent to get memory usage
                const agentMetricsPromises = agents.map(agent => 
                    this.agentService.fetchAgentMetrics(this.selectedApplication, agent.agentId || agent.pid)
                        .catch(() => null) // Ignore errors for individual agents
                );
                const agentMetricsResults = await Promise.all(agentMetricsPromises);
                
                // Sum up memory from all agents
                for (const agentMetrics of agentMetricsResults) {
                    if (agentMetrics?.result?.AgentStatHist?.[0]) {
                        const stats = agentMetrics.result.AgentStatHist[0];
                        // OverheadMemory is the agent's memory overhead
                        totalMemory += stats.OverheadMemory || 0;
                        // CStackMemory is C stack memory
                        totalMemory += stats.CStackMemory || 0;
                    }
                }
                
                // Also fetch session memory and count session states from agents/sessions endpoint
                try {
                    const agentsWithSessions = await this.agentService.fetchAgentsWithSessions(this.selectedApplication);
                    for (const agent of agentsWithSessions) {
                        if (agent.sessions && Array.isArray(agent.sessions)) {
                            for (const session of agent.sessions) {
                                totalMemory += session.SessionMemory || 0;
                                // Count session states
                                const sessionState = (session.SessionState || '').toUpperCase();
                                if (sessionState === 'IDLE') {
                                    idleSessions++;
                                } else if (sessionState === 'BUSY' || sessionState === 'RESERVED') {
                                    busySessions++;
                                }
                            }
                        }
                        // Also include agent's overheadMemory if available directly
                        if (agent.overheadMemory) {
                            // Don't double-count - only add if we didn't get metrics above
                            // totalMemory += agent.overheadMemory;
                        }
                    }
                } catch (e) {
                    // Ignore errors fetching session memory
                }
            }
            
            // Update time-series history
            const currentTime = new Date();
            
            if (!this.pasoeStatsHistory) {
                this.pasoeStatsHistory = [];
            }
            
            // Extract metrics - handle different field naming conventions
            // Use nullish coalescing (??) to properly handle 0 values
            const dataPoint = {
                time: currentTime,
                // Memory - calculated sum from all agents
                memoryUsed: totalMemory,
                // Connections - use correct field names from API
                currConnections: metrics?.concurrentConnectedClients ?? metrics?.ConcurrentConnectedClients ?? 0,
                maxConnections: metrics?.maxConcurrentClients ?? metrics?.MaxConcurrentClients ?? 0,
                // Requests
                requests: metrics?.requests ?? metrics?.Requests ?? 0,
                // Timeouts/Waits
                timeouts: metrics?.numReserveABLSessionTimeouts ?? metrics?.timeouts ?? metrics?.Timeouts ?? 0,
                waits: metrics?.numReserveABLSessionWaits ?? metrics?.waits ?? metrics?.Waits ?? 0,
                // Reads/Writes
                reads: metrics?.reads ?? metrics?.Reads ?? 0,
                readErrors: metrics?.readErrors ?? metrics?.ReadErrors ?? 0,
                writes: metrics?.writes ?? metrics?.Writes ?? 0,
                writeErrors: metrics?.writeErrors ?? metrics?.WriteErrors ?? 0,
                // Sessions & Agents
                idleSessions: idleSessions,
                busySessions: busySessions,
                stoppingAgents: stoppingAgents
            };
            
            // Debug logging - can be enabled via AgentService.DEBUG
            if (AgentService.DEBUG) {
                console.log('[PASOE Stats] Raw metrics:', metrics);
                console.log('[PASOE Stats] Data point:', dataPoint);
                console.log('[PASOE Stats] reads=' + dataPoint.reads + ', writes=' + dataPoint.writes);
            }
            
            this.pasoeStatsHistory.push(dataPoint);
            
            // Keep only last 500 data points (longer history for stats view)
            if (this.pasoeStatsHistory.length > 500) {
                this.pasoeStatsHistory.shift();
            }
            
            // Update all charts
            this.updatePasoeStatsCharts();
            
        } catch (error) {
            console.error('Error loading PASOE stats data:', error);
        }
    },

    /**
     * Update PASOE stats charts with current data
     */
    updatePasoeStatsCharts() {
        if (!this.pasoeStatsHistory || this.pasoeStatsHistory.length === 0) {
            return;
        }

        const history = this.pasoeStatsHistory;
        
        // Calculate time window
        const now = new Date();
        const windowPoints = 500;
        
        // Calculate average interval from actual data
        let intervalMs = this.refreshIntervals.pasoeStats * 1000;
        if (history.length > 1) {
            let totalIntervals = 0;
            for (let i = 1; i < history.length; i++) {
                const t1 = new Date(history[i - 1].time);
                const t2 = new Date(history[i].time);
                totalIntervals += (t2.getTime() - t1.getTime());
            }
            intervalMs = totalIntervals / (history.length - 1);
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
                        displayFormats: { 
                            second: 'HH:mm:ss',
                            minute: 'HH:mm',
                            hour: 'HH:mm',
                            day: 'MM/dd'
                        },
                        tooltipFormat: 'yyyy-MM-dd HH:mm:ss'
                    },
                    min: minTime,
                    max: now,
                    ticks: { 
                        color: '#9d9d9d',
                        maxTicksLimit: 8
                    },
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

        // === Memory Usage Chart ===
        this.updatePasoeStatsChart(
            'pasoeMemoryChart',
            'pasoeMemoryChartInstance',
            [
                { 
                    label: 'Memory Used', 
                    data: history.map(d => ({ x: new Date(d.time), y: d.memoryUsed / (1024 * 1024) })),
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    fill: true
                }
            ],
            'Memory (MiB)',
            minTime,
            now,
            timeSeriesOptions
        );

        // === Connections Chart ===
        this.updatePasoeStatsChart(
            'pasoeConnectionsChart',
            'pasoeConnectionsChartInstance',
            [
                { 
                    label: 'CurrCnx', 
                    data: history.map(d => ({ x: new Date(d.time), y: d.currConnections })),
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    fill: true
                },
                { 
                    label: 'MaxCnx', 
                    data: history.map(d => ({ x: new Date(d.time), y: d.maxConnections })),
                    borderColor: 'rgba(255, 206, 86, 1)',
                    backgroundColor: 'transparent',
                    fill: false,
                    borderDash: [5, 5]
                }
            ],
            'Connections',
            minTime,
            now,
            timeSeriesOptions
        );

        // Helper function to calculate delta values (difference between consecutive points)
        const calculateDeltas = (data, field) => {
            return data.map((d, i) => {
                if (i === 0) {
                    return { x: new Date(d.time), y: 0 };
                }
                const prev = data[i - 1];
                const delta = (d[field] ?? 0) - (prev[field] ?? 0);
                // Only show positive deltas (counter resets on restart give negative values)
                return { x: new Date(d.time), y: Math.max(0, delta) };
            });
        };

        // === Requests Chart (showing delta/rate, not cumulative) ===
        this.updatePasoeStatsChart(
            'pasoeRequestsChart',
            'pasoeRequestsChartInstance',
            [
                { 
                    label: 'Requests', 
                    data: calculateDeltas(history, 'requests'),
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'transparent',
                    fill: false
                },
                { 
                    label: 'Time Outs', 
                    data: calculateDeltas(history, 'timeouts'),
                    borderColor: 'rgba(255, 159, 64, 1)',
                    backgroundColor: 'transparent',
                    fill: false
                },
                { 
                    label: 'Waits', 
                    data: calculateDeltas(history, 'waits'),
                    borderColor: 'rgba(54, 162, 235, 1)',
                    backgroundColor: 'transparent',
                    fill: false
                }
            ],
            'Count/Interval',
            minTime,
            now,
            timeSeriesOptions
        );

        // === Reads Chart (showing delta/rate, not cumulative) ===
        this.updatePasoeStatsChart(
            'pasoeReadsChart',
            'pasoeReadsChartInstance',
            [
                { 
                    label: 'Reads', 
                    data: calculateDeltas(history, 'reads'),
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'transparent',
                    fill: false
                },
                { 
                    label: 'Read Errors', 
                    data: calculateDeltas(history, 'readErrors'),
                    borderColor: 'rgba(255, 159, 64, 1)',
                    backgroundColor: 'transparent',
                    fill: false
                }
            ],
            'Count/Interval',
            minTime,
            now,
            timeSeriesOptions
        );

        // === Writes Chart (showing delta/rate, not cumulative) ===
        this.updatePasoeStatsChart(
            'pasoeWritesChart',
            'pasoeWritesChartInstance',
            [
                { 
                    label: 'Writes', 
                    data: calculateDeltas(history, 'writes'),
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'transparent',
                    fill: false
                },
                { 
                    label: 'Write Errors', 
                    data: calculateDeltas(history, 'writeErrors'),
                    borderColor: 'rgba(255, 159, 64, 1)',
                    backgroundColor: 'transparent',
                    fill: false
                }
            ],
            'Count/Interval',
            minTime,
            now,
            timeSeriesOptions
        );

        // === Sessions & Agents Chart (current values, not deltas) ===
        this.updatePasoeStatsChart(
            'pasoeSessionsChart',
            'pasoeSessionsChartInstance',
            [
                { 
                    label: 'Idle Sessions', 
                    data: history.map(d => ({ x: new Date(d.time), y: d.idleSessions ?? 0 })),
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    fill: true
                },
                { 
                    label: 'Busy Sessions', 
                    data: history.map(d => ({ x: new Date(d.time), y: d.busySessions ?? 0 })),
                    borderColor: 'rgba(255, 206, 86, 1)',
                    backgroundColor: 'rgba(255, 206, 86, 0.2)',
                    fill: true
                },
                { 
                    label: 'Stopping Agents', 
                    data: history.map(d => ({ x: new Date(d.time), y: d.stoppingAgents ?? 0 })),
                    borderColor: 'rgba(255, 99, 132, 1)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    fill: true
                }
            ],
            'Count',
            minTime,
            now,
            timeSeriesOptions
        );
    },

    /**
     * Update a single PASOE stats chart
     */
    updatePasoeStatsChart(canvasId, chartProp, datasets, yAxisTitle, minTime, maxTime, baseOptions) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        // Style datasets
        const styledDatasets = datasets.map(ds => ({
            ...ds,
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 0,
            pointHitRadius: 5
        }));

        if (this[chartProp]) {
            // Update existing chart
            this[chartProp].data.datasets = styledDatasets;
            this[chartProp].options.scales.x.min = minTime;
            this[chartProp].options.scales.x.max = maxTime;
            this[chartProp].update('none');
        } else {
            // Create new chart
            const options = JSON.parse(JSON.stringify(baseOptions));
            options.scales.y.title = { display: true, text: yAxisTitle, color: '#cccccc' };
            
            this[chartProp] = new Chart(ctx, {
                type: 'line',
                data: { datasets: styledDatasets },
                options: options
            });
        }
    },

    /**
     * Destroy all PASOE stats chart instances
     */
    destroyPasoeStatsCharts() {
        const chartProps = [
            'pasoeMemoryChartInstance',
            'pasoeConnectionsChartInstance',
            'pasoeRequestsChartInstance',
            'pasoeReadsChartInstance',
            'pasoeWritesChartInstance'
        ];
        
        chartProps.forEach(prop => {
            if (this[prop]) {
                this[prop].destroy();
                this[prop] = null;
            }
        });
    },

    /**
     * Clear PASOE stats history (called when switching applications)
     */
    clearPasoeStatsHistory() {
        this.pasoeStatsHistory = [];
        this.destroyPasoeStatsCharts();
    }
};

// Apply mixin to OeManagerApp prototype when app.js loads
// This is done at the end of app.js after class definition
