/**
 * OE Manager GUI - Metrics View
 * Mixin for agent statistics and metrics display
 * 
 * Methods are added to OeManagerApp.prototype
 */

const MetricsViewMixin = {
    /**
     * Load metrics data
     */
    async loadMetricsData() {
        if (!this.selectedApplication) return;
        
        try {
            // Get SessionManager metrics
            const sessionMetrics = await this.agentService.fetchMetrics(this.selectedApplication);
            
            // Get agent metrics
            const agents = await this.agentService.fetchAgents(this.selectedApplication);
            
            // Get detailed metrics and status for each agent
            const agentMetrics = await Promise.all(
                agents.map(async (agent) => {
                    const agentId = agent.agentId || agent.id;
                    try {
                        // Build API calls - always fetch metrics, connections, threads
                        const apiCalls = [
                            this.agentService.fetchAgentMetrics(this.selectedApplication, agentId),
                            this.agentService.fetchAgentConnections(this.selectedApplication, agentId),
                        ];
                        
                        // Conditionally add requests API if toggle is checked
                        if (this.includeRequests) {
                            apiCalls.push(this.agentService.fetchAgentRequests(this.selectedApplication, agentId));
                        }
                        
                        const results = await Promise.all(apiCalls);
                        const [metricsResponse, connections, threads] = results;
                        const requests = this.includeRequests ? results[3] : [];
                        
                        // Extract metrics from AgentStatHist array
                        const metrics = metricsResponse?.result?.AgentStatHist?.[0] || metricsResponse?.AgentStatHist?.[0] || {};
                        
                        // Debug logging disabled - enable AgentService.DEBUG for verbose output
                        
                        return { agentId, metrics, threads, connections, requests, agent };
                    } catch (e) {
                        console.error(`Error fetching data for agent ${agentId}:`, e);
                        return { agentId, metrics: {}, threads: [], connections: [], requests: [], agent };
                    }
                })
            );
            
            this.metricsData = { sessionMetrics, agentMetrics };
            this.renderMetricsView();
            
        } catch (error) {
            console.error('Error loading metrics:', error);
            Utils.showToast(`Failed to load metrics: ${error.message}`, 'error');
        }
    },

    /**
     * Render metrics view using Templates
     */
    renderMetricsView() {
        const container = document.getElementById('metricsContainer');
        if (!container) return;
        
        const { sessionMetrics, agentMetrics } = this.metricsData;
        container.innerHTML = '';
        
        // Build SessionManager Metrics section
        const sessionSection = document.createElement('div');
        sessionSection.className = 'session-manager-section';
        sessionSection.innerHTML = `
            <div class="section-header" id="sessionManagerHeader">
                <span class="collapse-icon">▼</span>
                <span>SessionManager Metrics</span>
            </div>
            <div class="section-content expanded" id="sessionManagerContent"></div>
        `;
        
        // Render session manager metrics using Templates
        const metricsContent = sessionSection.querySelector('#sessionManagerContent');
        const metricsTable = Templates.sessionManagerMetrics(sessionMetrics);
        if (metricsTable) {
            metricsContent.appendChild(metricsTable);
        }
        
        container.appendChild(sessionSection);
        
        // Build Agents section
        if (agentMetrics && agentMetrics.length > 0) {
            const agentsSection = document.createElement('div');
            agentsSection.className = 'metrics-section';
            agentsSection.innerHTML = '<h3>Agents</h3><div class="agent-metrics-list"></div>';
            
            const agentsList = agentsSection.querySelector('.agent-metrics-list');
            agentMetrics.forEach(am => {
                const card = Templates.agentMetricsCard(am, this.getStateClass.bind(this), this.includeRequests);
                if (card) {
                    agentsList.appendChild(card);
                }
            });
            
            container.appendChild(agentsSection);
        }
        
        // Add event handler for SessionManager section collapse toggle
        document.getElementById('sessionManagerHeader')?.addEventListener('click', function() {
            const content = document.getElementById('sessionManagerContent');
            const icon = this.querySelector('.collapse-icon');
            if (content && icon) {
                if (content.classList.contains('expanded')) {
                    content.classList.remove('expanded');
                    icon.classList.add('collapsed');
                } else {
                    content.classList.add('expanded');
                    icon.classList.remove('collapsed');
                }
            }
        });
        
        // Add event handlers for agent card collapse toggle
        container.querySelectorAll('.agent-metric-header').forEach(header => {
            header.addEventListener('click', (e) => {
                // Don't toggle if clicking on button
                if (e.target.closest('.btn')) return;
                
                const body = header.nextElementSibling;
                const icon = header.querySelector('.collapse-icon');
                if (body && icon) {
                    if (body.classList.contains('expanded')) {
                        body.classList.remove('expanded');
                        body.classList.add('collapsed');
                        header.classList.add('collapsed');
                    } else {
                        body.classList.remove('collapsed');
                        body.classList.add('expanded');
                        header.classList.remove('collapsed');
                    }
                }
            });
        });
        
        // Add event handlers for reset buttons
        container.querySelectorAll('.reset-stats-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent triggering collapse
                const agentId = e.target.dataset.agentId;
                this.resetAgentStatistics(agentId);
            });
        });
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
