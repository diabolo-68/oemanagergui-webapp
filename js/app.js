/**
 * OE Manager GUI - Main Application
 * Static webapp for managing PASOE agents
 * 
 * Three views ported from oemanagergui VS Code extension:
 * 1. Agents View (agentPanel.ts) - Agent/Session/Request management
 * 2. Charts View (chartsPanel.ts) - Performance charts
 * 3. Metrics View (metricsPanel.ts) - Agent statistics
 * 
 * Architecture:
 * - app.js: Core application class with initialization, config, navigation
 * - agentsView.js: Agent/Session/Request management (mixin)
 * - chartsView.js: Performance charts (mixin)
 * - metricsView.js: Agent statistics (mixin)
 * - utils.js: Shared utility functions
 * - agentService.js: REST API wrapper
 */
class OeManagerApp {
    constructor() {
        // Services
        this.agentService = new AgentService();
        
        // State
        this.config = this.loadStoredConfig();
        this.isConnected = false;
        this.applications = [];
        this.selectedApplication = '';
        this.currentView = 'agents';
        
        // Agents view state
        this.agents = [];
        this.selectedAgentId = '';
        this.selectedAgentStatus = '';
        this.sessions = [];
        this.requests = [];
        
        // Charts view state
        this.chartHistoryData = new Map();  // Per-session time-series data
        // Bar charts (current values)
        this.sessionMemoryChart = null;
        this.sessionCompletedChart = null;
        this.sessionFailedChart = null;
        // Time-series line charts
        this.memoryTimeChart = null;
        this.requestsCompletedTimeChart = null;
        this.requestsFailedTimeChart = null;
        
        // Metrics view state
        this.metricsData = {};
        this.includeRequests = false;  // Toggle for including requests in metrics view
        
        // Properties modal state
        this.currentProperties = null;
        
        // Timers
        this.agentsRefreshTimer = null;
        this.sessionsRefreshTimer = null;
        this.requestsRefreshTimer = null;
        this.chartsRefreshTimer = null;
        
        // Refresh intervals (seconds)
        this.refreshIntervals = {
            agents: this.config.agentsRefreshSec || 10,
            requests: this.config.requestsRefreshSec || 5,
            charts: this.config.chartsRefreshSec || 10
        };
        
        // Initialize UI
        this.initializeUI();
    }

    // ==================== CONFIGURATION ====================

    /**
     * Load stored configuration from localStorage
     */
    loadStoredConfig() {
        try {
            const stored = localStorage.getItem('oemanager.config');
            if (stored) {
                const config = JSON.parse(stored);
                return {
                    username: config.username || '',
                    password: '', // Never store password
                    waitToFinish: config.waitToFinish || 120000,
                    waitAfterStop: config.waitAfterStop || 60000,
                    agentsRefreshSec: config.agentsRefreshSec || 10,
                    requestsRefreshSec: config.requestsRefreshSec || 5,
                    chartsRefreshSec: config.chartsRefreshSec || 10
                };
            }
        } catch (e) {
            console.error('Error loading config:', e);
        }
        return {
            username: '',
            password: '',
            waitToFinish: 120000,
            waitAfterStop: 60000,
            agentsRefreshSec: 10,
            requestsRefreshSec: 5,
            chartsRefreshSec: 10
        };
    }

    /**
     * Get the base URL for oemanager API derived from the current page URL.
     * Removes the webapp name from the path to get the server base URL.
     * Example: https://nr.ivnet.ch/oemanagergui -> https://nr.ivnet.ch
     * The agentService will append /oemanager to this base URL.
     */
    getOemanagerBaseUrl() {
        const loc = window.location;
        // Get origin (protocol + host)
        const origin = loc.origin;
        // Get pathname and remove the oemanagergui part
        let path = loc.pathname;
        // Remove trailing slash and any file name
        path = path.replace(/\/index\.html$/i, '').replace(/\/+$/, '');
        // Remove the webapp name (oemanagergui) from the path
        path = path.replace(/\/oemanagergui$/i, '');
        return origin + path;
    }

    /**
     * Save configuration to localStorage (excluding password)
     */
    saveConfig() {
        const toStore = {
            username: this.config.username,
            waitToFinish: this.config.waitToFinish,
            waitAfterStop: this.config.waitAfterStop,
            agentsRefreshSec: this.refreshIntervals.agents,
            requestsRefreshSec: this.refreshIntervals.requests,
            chartsRefreshSec: this.refreshIntervals.charts
        };
        localStorage.setItem('oemanager.config', JSON.stringify(toStore));
    }

    // ==================== UI INITIALIZATION ====================

    /**
     * Initialize UI event handlers
     */
    initializeUI() {
        // Wait for DOM
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupEventHandlers());
        } else {
            this.setupEventHandlers();
        }
    }

    /**
     * Setup all event handlers
     */
    setupEventHandlers() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const view = item.dataset.view;
                if (view) this.switchView(view);
            });
        });

        // Header buttons
        document.getElementById('loginBtn')?.addEventListener('click', () => this.openLoginModal());
        document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
        document.getElementById('refreshBtn')?.addEventListener('click', () => {
            this.refresh();
        });

        // Login modal
        document.getElementById('closeLoginModal')?.addEventListener('click', () => this.closeLoginModal());
        document.getElementById('cancelLogin')?.addEventListener('click', () => this.closeLoginModal());
        document.getElementById('loginForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Settings view save button
        document.getElementById('saveSettingsBtn')?.addEventListener('click', () => this.saveSettings());

        // Application selector
        document.getElementById('applicationSelect')?.addEventListener('change', (e) => {
            this.selectApplication(e.target.value);
        });

        // Toolbar buttons
        document.getElementById('propertiesBtn')?.addEventListener('click', () => this.openPropertiesModal());
        document.getElementById('addAgentBtn')?.addEventListener('click', () => this.addAgent());
        document.getElementById('trimAllBtn')?.addEventListener('click', () => this.trimAllAgents());

        // Properties modal buttons
        document.getElementById('closePropertiesModal')?.addEventListener('click', () => this.closePropertiesModal());
        document.getElementById('cancelPropertiesBtn')?.addEventListener('click', () => this.closePropertiesModal());
        document.getElementById('savePropertiesBtn')?.addEventListener('click', () => this.saveAgentProperties());

        // Auto-refresh toggle
        document.getElementById('requestsAutoRefresh')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.startRequestsAutoRefresh();
            } else {
                this.stopRequestsAutoRefresh();
            }
        });

        // Metrics view buttons
        document.getElementById('refreshMetricsBtn')?.addEventListener('click', () => this.loadMetricsData());
        document.getElementById('resetStatsBtn')?.addEventListener('click', () => this.resetAllStatistics());
        
        // Include Requests checkbox
        document.getElementById('chkIncludeRequests')?.addEventListener('change', (e) => {
            this.includeRequests = e.target.checked;
            this.loadMetricsData();  // Reload to fetch/hide requests
        });

        // Context menus - hide on click outside
        document.addEventListener('click', (e) => {
            const agentMenu = document.getElementById('contextMenu');
            const requestMenu = document.getElementById('requestContextMenu');
            const sessionMenu = document.getElementById('sessionContextMenu');
            
            if (agentMenu && !agentMenu.contains(e.target)) {
                agentMenu.classList.add('hidden');
            }
            if (requestMenu && !requestMenu.contains(e.target)) {
                requestMenu.classList.add('hidden');
            }
            if (sessionMenu && !sessionMenu.contains(e.target)) {
                sessionMenu.classList.add('hidden');
            }
        });

        // Agent context menu actions
        document.querySelectorAll('#contextMenu .context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = item.dataset.action;
                const agentId = document.getElementById('contextMenu').dataset.agentId;
                this.handleAgentContextMenuAction(action, agentId);
                document.getElementById('contextMenu').classList.add('hidden');
            });
        });

        // Request context menu actions
        document.querySelectorAll('#requestContextMenu .context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = item.dataset.action;
                const menu = document.getElementById('requestContextMenu');
                const requestId = menu.dataset.requestId;
                const sessionId = menu.dataset.sessionId;
                const requestUrl = menu.dataset.requestUrl;
                this.handleRequestContextMenuAction(action, requestId, sessionId, requestUrl);
                menu.classList.add('hidden');
            });
        });

        // Requests table - right-click context menu (event delegation)
        document.getElementById('requestsTableBody')?.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('tr[data-request-id]');
            if (row) {
                e.preventDefault();
                const menu = document.getElementById('requestContextMenu');
                menu.dataset.requestId = row.dataset.requestId;
                menu.dataset.sessionId = row.dataset.sessionId;
                // Get URL from the third column (index 2)
                const urlCell = row.cells[2];
                menu.dataset.requestUrl = urlCell?.title || urlCell?.textContent || '';
                menu.style.left = `${e.pageX}px`;
                menu.style.top = `${e.pageY}px`;
                menu.classList.remove('hidden');
                // Hide other menus
                document.getElementById('contextMenu').classList.add('hidden');
                document.getElementById('sessionContextMenu').classList.add('hidden');
            }
        });

        // Session context menu actions
        document.querySelectorAll('#sessionContextMenu .context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = item.dataset.action;
                const menu = document.getElementById('sessionContextMenu');
                const sessionId = menu.dataset.sessionId;
                this.handleSessionContextMenuAction(action, sessionId);
                menu.classList.add('hidden');
            });
        });

        // Sessions table - right-click context menu (event delegation)
        document.getElementById('sessionsTableBody')?.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('tr[data-session-id]');
            if (row) {
                e.preventDefault();
                const menu = document.getElementById('sessionContextMenu');
                menu.dataset.sessionId = row.dataset.sessionId;
                menu.style.left = `${e.pageX}px`;
                menu.style.top = `${e.pageY}px`;
                menu.classList.remove('hidden');
                // Hide other menus
                document.getElementById('contextMenu').classList.add('hidden');
                document.getElementById('requestContextMenu').classList.add('hidden');
            }
        });

        // Show login modal if not connected (password is never stored, so always show on page load)
        this.openLoginModal();
    }

    // ==================== NAVIGATION ====================

    /**
     * Switch between views
     */
    switchView(viewName) {
        // Stop all timers first
        this.stopAllTimers();
        
        // Update navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewName);
        });

        // Show/hide views
        document.querySelectorAll('.view').forEach(view => {
            view.classList.toggle('active', view.id === `${viewName}View`);
            view.classList.toggle('hidden', view.id !== `${viewName}View`);
        });

        // Show/hide toolbars based on view
        const agentsToolbar = document.getElementById('agentsToolbar');
        const metricsToolbar = document.getElementById('metricsToolbar');
        if (agentsToolbar) {
            agentsToolbar.classList.toggle('hidden', viewName !== 'agents');
        }
        if (metricsToolbar) {
            metricsToolbar.classList.toggle('hidden', viewName !== 'metrics');
        }

        this.currentView = viewName;

        // Handle settings view (always available, no data loading needed)
        if (viewName === 'settings') {
            this.loadSettingsView();
            return;
        }

        // Start appropriate timers and load data
        if (this.isConnected && this.selectedApplication) {
            switch (viewName) {
                case 'agents':
                    this.loadAgents();
                    this.startAgentsAutoRefresh();
                    if (this.selectedAgentId) {
                        this.startSessionsAutoRefresh();
                    }
                    this.startRequestsAutoRefresh();
                    break;
                case 'charts':
                    this.initCharts();
                    this.loadChartsData();
                    this.startChartsAutoRefresh();
                    break;
                case 'metrics':
                    this.loadMetricsData();
                    break;
            }
        }
    }

    // ==================== MODALS ====================

    /**
     * Open login modal
     */
    openLoginModal() {
        document.getElementById('username').value = this.config.username;
        document.getElementById('password').value = '';
        document.getElementById('loginModal').classList.remove('hidden');
    }

    /**
     * Close login modal
     */
    closeLoginModal() {
        document.getElementById('loginModal').classList.add('hidden');
    }

    /**
     * Load settings view values
     */
    loadSettingsView() {
        document.getElementById('waitToFinish').value = this.config.waitToFinish;
        document.getElementById('waitAfterStop').value = this.config.waitAfterStop;
        document.getElementById('agentsRefreshSec').value = this.refreshIntervals.agents;
        document.getElementById('requestsRefreshSec').value = this.refreshIntervals.requests;
        document.getElementById('chartsRefreshSec').value = this.refreshIntervals.charts;
    }

    /**
     * Save settings from settings view
     */
    saveSettings() {
        // Update trim settings
        this.config.waitToFinish = parseInt(document.getElementById('waitToFinish').value) || 120000;
        this.config.waitAfterStop = parseInt(document.getElementById('waitAfterStop').value) || 60000;
        
        // Update refresh intervals
        this.refreshIntervals.agents = parseInt(document.getElementById('agentsRefreshSec').value) || 10;
        this.refreshIntervals.requests = parseInt(document.getElementById('requestsRefreshSec').value) || 5;
        this.refreshIntervals.charts = parseInt(document.getElementById('chartsRefreshSec').value) || 10;

        // Save to localStorage
        this.saveConfig();
        
        Utils.showToast('Settings saved', 'success');
    }

    /**
     * Handle login
     */
    async handleLogin() {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) {
            Utils.showToast('Please enter username and password', 'error');
            return;
        }

        // Derive baseUrl from current page URL
        const baseUrl = this.getOemanagerBaseUrl();

        // Update config
        this.config.username = username;
        this.config.password = password;

        // Configure service
        this.agentService.setConfig(baseUrl, username, password);

        // Try to connect
        try {
            Utils.updateStatus('Connecting...');
            this.applications = await this.agentService.fetchApplications();
            
            // Mark as connected regardless of applications found
            this.isConnected = true;
            this.saveConfig();
            this.closeLoginModal();
            this.updateLoginUI(true);
            this.enableControls();
            
            if (this.applications.length === 0) {
                Utils.showToast('No applications found', 'warning');
                Utils.updateStatus(`Connected to ${baseUrl} (no applications)`);
            } else {
                this.selectedApplication = this.applications[0].name;
                this.populateApplicationDropdown();
                Utils.updateStatus(`Connected to ${baseUrl}`);
                Utils.showToast(`Connected! Found ${this.applications.length} application(s)`, 'success');
                
                // Load initial data for current view
                this.switchView(this.currentView);
            }
        } catch (error) {
            console.error('Connection error:', error);
            Utils.showToast(`Connection failed: ${error.message}`, 'error');
            Utils.updateStatus('Connection failed');
        }
    }

    /**
     * Populate application dropdown
     */
    populateApplicationDropdown() {
        const select = document.getElementById('applicationSelect');
        select.innerHTML = '';
        
        this.applications.forEach(app => {
            const option = document.createElement('option');
            option.value = app.name;
            option.textContent = app.name;
            if (app.name === this.selectedApplication) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    }

    /**
     * Select an application
     */
    selectApplication(appName) {
        this.selectedApplication = appName;
        this.selectedAgentId = '';
        this.selectedAgentStatus = '';
        this.sessions = [];
        
        // Clear chart history data
        this.chartHistoryData.clear();
        
        // Destroy existing chart instances to reset them
        this.destroyCharts();
        
        // Reload current view
        this.switchView(this.currentView);
    }

    /**
     * Enable controls after connection
     */
    enableControls() {
        document.getElementById('refreshBtn').disabled = false;
        document.getElementById('applicationSelect').disabled = false;
        document.getElementById('propertiesBtn').disabled = false;
        document.getElementById('addAgentBtn').disabled = false;
        document.getElementById('trimAllBtn').disabled = false;
    }

    /**
     * Disable controls after logout
     */
    disableControls() {
        document.getElementById('refreshBtn').disabled = true;
        document.getElementById('applicationSelect').disabled = true;
        document.getElementById('propertiesBtn').disabled = true;
        document.getElementById('addAgentBtn').disabled = true;
        document.getElementById('trimAllBtn').disabled = true;
    }

    /**
     * Update login/logout UI state
     */
    updateLoginUI(isLoggedIn) {
        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const userDisplay = document.getElementById('userDisplay');
        
        if (isLoggedIn) {
            loginBtn.style.display = 'none';
            logoutBtn.style.display = '';
            userDisplay.textContent = this.config.username;
            userDisplay.classList.remove('hidden');
        } else {
            loginBtn.style.display = '';
            logoutBtn.style.display = 'none';
            userDisplay.textContent = '';
            userDisplay.classList.add('hidden');
        }
    }

    /**
     * Logout and reset state
     */
    logout() {
        // Stop all timers
        this.stopAllTimers();
        
        // Reset state
        this.isConnected = false;
        this.config.password = '';
        this.applications = [];
        this.selectedApplication = '';
        this.agents = [];
        this.selectedAgentId = '';
        this.sessions = [];
        this.requests = [];
        this.chartHistoryData.clear();
        this.metricsData = {};
        
        // Reset UI
        this.updateLoginUI(false);
        this.disableControls();
        
        // Reset application dropdown
        const select = document.getElementById('applicationSelect');
        select.innerHTML = '<option value="">-- Login to view applications --</option>';
        
        // Reset tables
        document.getElementById('agentsTableBody').innerHTML = 
            '<tr><td colspan="5" class="empty-state">Login to view agents</td></tr>';
        document.getElementById('sessionsTableBody').innerHTML = 
            '<tr><td colspan="5" class="empty-state">Select an agent to view sessions</td></tr>';
        document.getElementById('requestsTableBody').innerHTML = 
            '<tr><td colspan="6" class="empty-state">Login to view running queries</td></tr>';
        document.getElementById('metricsContainer').innerHTML = 
            '<div class="placeholder"><p>Login to view metrics</p></div>';
        
        // Update counts
        document.getElementById('agentCount').textContent = '0';
        document.getElementById('sessionCount').textContent = '0';
        document.getElementById('requestCount').textContent = '0';
        document.getElementById('selectedAgentInfo').textContent = '';
        
        // Destroy charts
        if (typeof this.destroyCharts === 'function') {
            this.destroyCharts();
        }
        
        // Update status
        Utils.updateStatus('Not connected');
        Utils.showToast('Logged out', 'info');
    }

    /**
     * Refresh current view
     */
    async refresh() {
        if (!this.isConnected) {
            return;
        }
        
        try {
            switch (this.currentView) {
                case 'agents':
                    await this.loadAgents();
                    if (this.selectedAgentId) {
                        await this.loadSessions(this.selectedAgentId);
                    }
                    await this.loadRequests();
                    break;
                case 'charts':
                    await this.loadChartsData();
                    break;
                case 'metrics':
                    await this.loadMetricsData();
                    break;
            }
            
            Utils.updateLastRefresh();
        } catch (error) {
            console.error('[App] Refresh error:', error);
            Utils.showToast(`Refresh failed: ${error.message}`, 'error');
        }
    }

    // ==================== AUTO-REFRESH TIMERS ====================

    startAgentsAutoRefresh() {
        this.stopAgentsAutoRefresh();
        if (this.refreshIntervals.agents > 0) {
            this.agentsRefreshTimer = setInterval(() => this.loadAgents(), this.refreshIntervals.agents * 1000);
        }
    }

    stopAgentsAutoRefresh() {
        if (this.agentsRefreshTimer) {
            clearInterval(this.agentsRefreshTimer);
            this.agentsRefreshTimer = null;
        }
    }

    startSessionsAutoRefresh() {
        this.stopSessionsAutoRefresh();
        if (this.refreshIntervals.agents > 0 && this.selectedAgentId) {
            this.sessionsRefreshTimer = setInterval(() => {
                if (this.selectedAgentId) {
                    this.loadSessions(this.selectedAgentId);
                }
            }, this.refreshIntervals.agents * 1000);
        }
    }

    stopSessionsAutoRefresh() {
        if (this.sessionsRefreshTimer) {
            clearInterval(this.sessionsRefreshTimer);
            this.sessionsRefreshTimer = null;
        }
    }

    startRequestsAutoRefresh() {
        this.stopRequestsAutoRefresh();
        const checkbox = document.getElementById('requestsAutoRefresh');
        if (this.refreshIntervals.requests > 0 && (!checkbox || checkbox.checked)) {
            this.requestsRefreshTimer = setInterval(() => this.loadRequests(), this.refreshIntervals.requests * 1000);
        }
    }

    stopRequestsAutoRefresh() {
        if (this.requestsRefreshTimer) {
            clearInterval(this.requestsRefreshTimer);
            this.requestsRefreshTimer = null;
        }
    }

    startChartsAutoRefresh() {
        this.stopChartsAutoRefresh();
        if (this.refreshIntervals.charts > 0) {
            this.chartsRefreshTimer = setInterval(() => this.loadChartsData(), this.refreshIntervals.charts * 1000);
        }
    }

    stopChartsAutoRefresh() {
        if (this.chartsRefreshTimer) {
            clearInterval(this.chartsRefreshTimer);
            this.chartsRefreshTimer = null;
        }
    }

    stopAllTimers() {
        this.stopAgentsAutoRefresh();
        this.stopSessionsAutoRefresh();
        this.stopRequestsAutoRefresh();
        this.stopChartsAutoRefresh();
    }
}

// ==================== APPLY MIXINS ====================
// Add view methods to OeManagerApp prototype

Object.assign(OeManagerApp.prototype, AgentsViewMixin);
Object.assign(OeManagerApp.prototype, ChartsViewMixin);
Object.assign(OeManagerApp.prototype, MetricsViewMixin);

// ==================== INITIALIZE APP ====================

const app = new OeManagerApp();
