/**
 * OE Manager GUI - JavaScript Application
 * Manages PASOE agents and sessions through a web interface.
 */

class OeManagerApp {
    constructor() {
        this.config = null;
        this.selectedApplication = null;
        this.agents = [];
        this.refreshInterval = null;
        this.chartsRefreshInterval = null;
        this.memoryChart = null;
        this.requestsChart = null;
        this.chartData = {
            labels: [],
            memory: [],
            requestsCompleted: [],
            requestsFailed: []
        };

        this.initElements();
        this.initEventListeners();
        this.loadStoredConfig();
    }

    initElements() {
        // Header
        this.configureBtn = document.getElementById('configureBtn');
        this.refreshBtn = document.getElementById('refreshBtn');

        // Modal
        this.configModal = document.getElementById('configModal');
        this.closeConfigModal = document.getElementById('closeConfigModal');
        this.configForm = document.getElementById('configForm');
        this.cancelConfig = document.getElementById('cancelConfig');

        // Form inputs
        this.baseUrlInput = document.getElementById('baseUrl');
        this.usernameInput = document.getElementById('username');
        this.passwordInput = document.getElementById('password');
        this.rejectUnauthorizedInput = document.getElementById('rejectUnauthorized');

        // Navigation
        this.navItems = document.querySelectorAll('.nav-item');
        this.views = document.querySelectorAll('.view');

        // Application select
        this.applicationSelect = document.getElementById('applicationSelect');

        // Agent controls
        this.addAgentBtn = document.getElementById('addAgentBtn');
        this.trimAllBtn = document.getElementById('trimAllBtn');

        // Containers
        this.agentsContainer = document.querySelector('.agents-container');
        this.metricsContainer = document.querySelector('.metrics-container');

        // Status
        this.connectionStatus = document.getElementById('connectionStatus');
        this.lastUpdate = document.getElementById('lastUpdate');
    }

    initEventListeners() {
        // Configuration modal
        this.configureBtn.addEventListener('click', () => this.openConfigModal());
        this.closeConfigModal.addEventListener('click', () => this.closeModal());
        this.cancelConfig.addEventListener('click', () => this.closeModal());
        this.configForm.addEventListener('submit', (e) => this.handleConfigSubmit(e));

        // Navigation
        this.navItems.forEach(item => {
            item.addEventListener('click', () => this.switchView(item.dataset.view));
        });

        // Application select
        this.applicationSelect.addEventListener('change', () => this.handleApplicationChange());

        // Agent actions
        this.refreshBtn.addEventListener('click', () => this.refresh());
        this.addAgentBtn.addEventListener('click', () => this.addAgent());
        this.trimAllBtn.addEventListener('click', () => this.trimAllAgents());

        // Close modal on backdrop click
        this.configModal.addEventListener('click', (e) => {
            if (e.target === this.configModal) {
                this.closeModal();
            }
        });
    }

    loadStoredConfig() {
        const stored = localStorage.getItem('oemanager-config');
        if (stored) {
            try {
                this.config = JSON.parse(stored);
                this.baseUrlInput.value = this.config.baseUrl || '';
                this.usernameInput.value = this.config.username || '';
                this.rejectUnauthorizedInput.checked = this.config.rejectUnauthorized || false;
                // Don't auto-connect, require password
            } catch (e) {
                console.error('Failed to load stored config', e);
            }
        }
    }

    saveConfig() {
        const configToStore = {
            baseUrl: this.config.baseUrl,
            username: this.config.username,
            rejectUnauthorized: this.config.rejectUnauthorized
        };
        localStorage.setItem('oemanager-config', JSON.stringify(configToStore));
    }

    openConfigModal() {
        this.configModal.classList.remove('hidden');
    }

    closeModal() {
        this.configModal.classList.add('hidden');
    }

    async handleConfigSubmit(e) {
        e.preventDefault();

        this.config = {
            baseUrl: this.baseUrlInput.value.trim().replace(/\/$/, ''),
            username: this.usernameInput.value.trim(),
            password: this.passwordInput.value,
            rejectUnauthorized: this.rejectUnauthorizedInput.checked,
            waitToFinish: 120000,
            waitAfterStop: 60000
        };

        this.saveConfig();
        this.closeModal();

        try {
            await this.fetchApplications();
            this.connectionStatus.textContent = 'Connected to ' + this.config.baseUrl;
            this.refreshBtn.disabled = false;
            this.showToast('Connected successfully', 'success');
        } catch (error) {
            this.showToast('Connection failed: ' + error.message, 'error');
            this.connectionStatus.textContent = 'Connection failed';
        }
    }

    async fetchApplications() {
        const response = await fetch('/oemanagergui/api/agents/applications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.config)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to fetch applications');
        }

        const applications = await response.json();
        this.populateApplications(applications);
    }

    populateApplications(applications) {
        this.applicationSelect.innerHTML = '<option value="">-- Select Application --</option>';
        applications.forEach(app => {
            const option = document.createElement('option');
            option.value = app.name;
            option.textContent = app.name + (app.version ? ` (${app.version})` : '');
            this.applicationSelect.appendChild(option);
        });
        this.applicationSelect.disabled = false;
    }

    async handleApplicationChange() {
        this.selectedApplication = this.applicationSelect.value;
        if (!this.selectedApplication) {
            this.disableAgentControls();
            return;
        }

        this.enableAgentControls();
        await this.refresh();
        this.startAutoRefresh();
    }

    enableAgentControls() {
        this.addAgentBtn.disabled = false;
        this.trimAllBtn.disabled = false;
    }

    disableAgentControls() {
        this.addAgentBtn.disabled = true;
        this.trimAllBtn.disabled = true;
    }

    async refresh() {
        if (!this.selectedApplication) return;

        try {
            await this.fetchAgents();
            this.lastUpdate.textContent = 'Last update: ' + new Date().toLocaleTimeString();
        } catch (error) {
            this.showToast('Refresh failed: ' + error.message, 'error');
        }
    }

    async fetchAgents() {
        const response = await fetch(`/oemanagergui/api/agents/list/${this.selectedApplication}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.config)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to fetch agents');
        }

        this.agents = await response.json();
        this.renderAgents();
    }

    renderAgents() {
        if (this.agents.length === 0) {
            this.agentsContainer.innerHTML = `
                <div class="placeholder">
                    <p>No agents found for this application</p>
                </div>`;
            return;
        }

        this.agentsContainer.innerHTML = this.agents.map(agent => `
            <div class="agent-card" data-agent-id="${agent.agentId}">
                <div class="agent-card-header">
                    <span class="agent-card-title">Agent ${agent.agentId}</span>
                    <div class="agent-card-actions">
                        <button class="btn btn-secondary" onclick="app.viewSessions('${agent.agentId}')">Sessions</button>
                        <button class="btn btn-warning" onclick="app.trimAgent('${agent.agentId}')">Trim</button>
                        <button class="btn btn-danger" onclick="app.deleteAgent('${agent.agentId}')">Delete</button>
                    </div>
                </div>
                <div class="agent-info">
                    <div class="agent-info-item">
                        <span class="agent-info-label">PID</span>
                        <span class="agent-info-value">${agent.pid || 'N/A'}</span>
                    </div>
                    <div class="agent-info-item">
                        <span class="agent-info-label">State</span>
                        <span class="agent-info-value">
                            <span class="status-badge ${(agent.state || '').toLowerCase()}">${agent.state || 'Unknown'}</span>
                        </span>
                    </div>
                    <div class="agent-info-item">
                        <span class="agent-info-label">Sessions</span>
                        <span class="agent-info-value">${agent.sessionCount || 0}</span>
                    </div>
                </div>
                <div class="sessions-container" id="sessions-${agent.agentId}" style="display: none;"></div>
            </div>
        `).join('');
    }

    async viewSessions(agentId) {
        const container = document.getElementById(`sessions-${agentId}`);
        if (container.style.display === 'block') {
            container.style.display = 'none';
            return;
        }

        try {
            const response = await fetch(`/oemanagergui/api/agents/${this.selectedApplication}/${agentId}/sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.config)
            });

            if (!response.ok) throw new Error('Failed to fetch sessions');

            const sessions = await response.json();
            this.renderSessions(container, sessions);
            container.style.display = 'block';
        } catch (error) {
            this.showToast('Failed to load sessions: ' + error.message, 'error');
        }
    }

    renderSessions(container, sessions) {
        if (sessions.length === 0) {
            container.innerHTML = '<p style="padding: 12px; color: var(--text-secondary);">No active sessions</p>';
            return;
        }

        container.innerHTML = `
            <table class="sessions-table">
                <thead>
                    <tr>
                        <th>Session ID</th>
                        <th>State</th>
                        <th>Requests</th>
                    </tr>
                </thead>
                <tbody>
                    ${sessions.map(session => `
                        <tr>
                            <td>${session.sessionId || 'N/A'}</td>
                            <td><span class="status-badge ${(session.sessionState || '').toLowerCase()}">${session.sessionState || 'Unknown'}</span></td>
                            <td>${session.requestCount || 0}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    async addAgent() {
        if (!confirm('Add a new agent to this application?')) return;

        try {
            const response = await fetch(`/oemanagergui/api/agents/${this.selectedApplication}/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.config)
            });

            if (!response.ok) throw new Error('Failed to add agent');

            this.showToast('Agent added successfully', 'success');
            await this.refresh();
        } catch (error) {
            this.showToast('Failed to add agent: ' + error.message, 'error');
        }
    }

    async deleteAgent(agentId) {
        if (!confirm(`Delete agent ${agentId}? This will terminate all sessions.`)) return;

        try {
            const response = await fetch(`/oemanagergui/api/agents/${this.selectedApplication}/${agentId}/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.config)
            });

            if (!response.ok) throw new Error('Failed to delete agent');

            this.showToast('Agent deleted successfully', 'success');
            await this.refresh();
        } catch (error) {
            this.showToast('Failed to delete agent: ' + error.message, 'error');
        }
    }

    async trimAgent(agentId) {
        try {
            const response = await fetch(`/oemanagergui/api/agents/${this.selectedApplication}/${agentId}/trim`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.config)
            });

            if (!response.ok) throw new Error('Failed to trim agent');

            this.showToast('Agent trimmed successfully', 'success');
            await this.refresh();
        } catch (error) {
            this.showToast('Failed to trim agent: ' + error.message, 'error');
        }
    }

    async trimAllAgents() {
        if (!confirm('Trim all agents? This will close idle sessions.')) return;

        for (const agent of this.agents) {
            try {
                await this.trimAgent(agent.agentId);
            } catch (error) {
                console.error(`Failed to trim agent ${agent.agentId}:`, error);
            }
        }
    }

    switchView(viewName) {
        this.navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewName);
        });

        this.views.forEach(view => {
            view.classList.toggle('hidden', view.id !== `${viewName}View`);
            view.classList.toggle('active', view.id === `${viewName}View`);
        });

        if (viewName === 'charts') {
            this.initCharts();
            this.startChartsRefresh();
        } else {
            this.stopChartsRefresh();
        }

        if (viewName === 'metrics') {
            this.fetchMetrics();
        }
    }

    initCharts() {
        if (this.memoryChart) return;

        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { color: '#3c3c3c' }, ticks: { color: '#858585' } },
                y: { grid: { color: '#3c3c3c' }, ticks: { color: '#858585' } }
            },
            plugins: {
                legend: { labels: { color: '#cccccc' } }
            }
        };

        const memoryCtx = document.getElementById('memoryChart').getContext('2d');
        this.memoryChart = new Chart(memoryCtx, {
            type: 'line',
            data: {
                labels: this.chartData.labels,
                datasets: [{
                    label: 'Memory (MB)',
                    data: this.chartData.memory,
                    borderColor: '#0e639c',
                    backgroundColor: 'rgba(14, 99, 156, 0.1)',
                    fill: true
                }]
            },
            options: chartOptions
        });

        const requestsCtx = document.getElementById('requestsChart').getContext('2d');
        this.requestsChart = new Chart(requestsCtx, {
            type: 'line',
            data: {
                labels: this.chartData.labels,
                datasets: [
                    {
                        label: 'Completed',
                        data: this.chartData.requestsCompleted,
                        borderColor: '#4caf50',
                        backgroundColor: 'rgba(76, 175, 80, 0.1)',
                        fill: true
                    },
                    {
                        label: 'Failed',
                        data: this.chartData.requestsFailed,
                        borderColor: '#f44336',
                        backgroundColor: 'rgba(244, 67, 54, 0.1)',
                        fill: true
                    }
                ]
            },
            options: chartOptions
        });
    }

    async fetchMetrics() {
        if (!this.selectedApplication) {
            this.metricsContainer.innerHTML = `
                <div class="placeholder">
                    <p>Select an application to view metrics</p>
                </div>`;
            return;
        }

        try {
            const response = await fetch(`/oemanagergui/api/agents/${this.selectedApplication}/metrics`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.config)
            });

            if (!response.ok) throw new Error('Failed to fetch metrics');

            const metrics = await response.json();
            this.renderMetrics(metrics);
            this.updateChartData(metrics);
        } catch (error) {
            this.showToast('Failed to load metrics: ' + error.message, 'error');
        }
    }

    renderMetrics(metrics) {
        const keys = Object.keys(metrics).filter(k => typeof metrics[k] !== 'object');
        this.metricsContainer.innerHTML = keys.map(key => `
            <div class="metric-card">
                <h4>${this.formatMetricName(key)}</h4>
                <div class="metric-value">${this.formatMetricValue(metrics[key])}</div>
            </div>
        `).join('');
    }

    formatMetricName(name) {
        return name.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    }

    formatMetricValue(value) {
        if (typeof value === 'number') {
            return value.toLocaleString();
        }
        return value;
    }

    updateChartData(metrics) {
        const time = new Date().toLocaleTimeString();
        this.chartData.labels.push(time);
        this.chartData.memory.push(metrics.memory || 0);
        this.chartData.requestsCompleted.push(metrics.requestsCompleted || 0);
        this.chartData.requestsFailed.push(metrics.requestsFailed || 0);

        // Keep last 20 data points
        if (this.chartData.labels.length > 20) {
            this.chartData.labels.shift();
            this.chartData.memory.shift();
            this.chartData.requestsCompleted.shift();
            this.chartData.requestsFailed.shift();
        }

        if (this.memoryChart) {
            this.memoryChart.update();
            this.requestsChart.update();
        }
    }

    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshInterval = setInterval(() => this.refresh(), 10000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    startChartsRefresh() {
        this.stopChartsRefresh();
        this.chartsRefreshInterval = setInterval(() => this.fetchMetrics(), 5000);
    }

    stopChartsRefresh() {
        if (this.chartsRefreshInterval) {
            clearInterval(this.chartsRefreshInterval);
            this.chartsRefreshInterval = null;
        }
    }

    showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 5000);
    }
}

// Initialize the application
const app = new OeManagerApp();
