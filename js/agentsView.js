/**
 * OE Manager GUI - Agents View
 * Mixin for agent/session/request management
 * 
 * Methods are added to OeManagerApp.prototype
 */

const AgentsViewMixin = {
    /**
     * Load agents for selected application
     */
    async loadAgents() {
        if (!this.selectedApplication) return;
        
        try {
            this.agents = await this.agentService.fetchAgents(this.selectedApplication);
            this.renderAgentsTable();
            document.getElementById('agentCount').textContent = this.agents.length;
        } catch (error) {
            console.error('Error loading agents:', error);
            Utils.showToast(`Failed to load agents: ${error.message}`, 'error');
        }
    },

    /**
     * Render agents table using Templates
     */
    renderAgentsTable() {
        const tbody = document.getElementById('agentsTableBody');
        tbody.innerHTML = '';
        
        if (this.agents.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = '<td colspan="5" class="empty-state">No agents found</td>';
            tbody.appendChild(emptyRow);
            return;
        }

        this.agents.forEach(agent => {
            const agentId = agent.agentId || agent.id;
            const state = agent.state || 'UNKNOWN';
            const stateClass = this.getStateClass(state);
            const isSelected = agentId === this.selectedAgentId;
            
            const row = Templates.agentRow(agent, isSelected, stateClass);
            
            // Add event listeners
            row.addEventListener('click', () => this.selectAgent(agentId, state));
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showAgentContextMenu(e, agentId);
            });
            
            const actionBtn = row.querySelector('.action-btn');
            actionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showAgentContextMenu(e, agentId);
            });
            
            tbody.appendChild(row);
        });
    },

    /**
     * Get CSS class for agent state
     */
    getStateClass(state) {
        switch (state?.toUpperCase()) {
            case 'AVAILABLE': return 'state-available';
            case 'RUNNING': return 'state-running';
            case 'IDLE': return 'state-idle';
            case 'LOCKED': return 'state-locked';
            default: return '';
        }
    },

    /**
     * Select an agent
     */
    selectAgent(agentId, state) {
        this.selectedAgentId = agentId;
        this.selectedAgentStatus = state;
        
        // Update selection in table
        document.querySelectorAll('#agentsTableBody tr').forEach(row => {
            row.classList.toggle('selected', row.dataset.agentId === agentId);
        });
        
        // Update selected agent info
        document.getElementById('selectedAgentInfo').textContent = `Agent: ${agentId}`;
        
        // Load sessions
        this.loadSessions(agentId);
        this.startSessionsAutoRefresh();
    },

    /**
     * Load sessions for selected agent
     */
    async loadSessions(agentId) {
        if (!this.selectedApplication || !agentId) return;
        
        try {
            this.sessions = await this.agentService.fetchSessions(this.selectedApplication, agentId);
            this.renderSessionsTable();
            document.getElementById('sessionCount').textContent = this.sessions.length;
        } catch (error) {
            console.error('Error loading sessions:', error);
            document.getElementById('sessionsTableBody').innerHTML = 
                `<tr><td colspan="5" class="empty-state">Error: ${error.message}</td></tr>`;
        }
    },

    /**
     * Render sessions table using Templates
     * PASOE API returns: SessionId, SessionState, ConnectionId, RequestCount, SessionStartTime, etc.
     */
    renderSessionsTable() {
        const tbody = document.getElementById('sessionsTableBody');
        tbody.innerHTML = '';
        
        if (this.sessions.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = '<td colspan="5" class="empty-state">No sessions found</td>';
            tbody.appendChild(emptyRow);
            return;
        }

        this.sessions.forEach(session => {
            const state = session.SessionState || session.state || session.sessionState || 'UNKNOWN';
            const stateClass = this.getStateClass(state);
            
            const row = Templates.sessionRow(session, stateClass);
            
            // Add context menu for session termination
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const sessionId = row.dataset.sessionId;
                this.showSessionContextMenu(e, sessionId);
            });
            
            tbody.appendChild(row);
        });
    },

    /**
     * Load running requests
     */
    async loadRequests() {
        if (!this.selectedApplication) return;
        
        try {
            this.requests = await this.agentService.fetchRequests(this.selectedApplication);
            this.renderRequestsTable();
            document.getElementById('requestCount').textContent = this.requests.length;
        } catch (error) {
            console.error('Error loading requests:', error);
            // Don't show error toast for requests - they may simply be empty
        }
    },

    /**
     * Render requests table using Templates
     * PASOE API returns nested structure with: requestID, tomcat.{methodType, url}, 
     * sessionManager.{sessionId, requestState, userId, requestElapsedTime}, 
     * agent.{agentId, procedureName}
     */
    renderRequestsTable() {
        const tbody = document.getElementById('requestsTableBody');
        tbody.innerHTML = '';
        
        if (this.requests.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = '<td colspan="6" class="empty-state">No running queries</td>';
            tbody.appendChild(emptyRow);
            return;
        }

        this.requests.forEach(request => {
            const row = Templates.requestRow(request);
            const requestId = row.dataset.requestId;
            const sessionId = row.dataset.sessionId;
            const url = row.dataset.url;
            
            // Add context menu
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showRequestContextMenu(e, requestId, sessionId, url);
            });
            
            // Add cancel button handler
            const cancelBtn = row.querySelector('.cancel-btn');
            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.cancelRequest(requestId, sessionId);
            });
            
            tbody.appendChild(row);
        });
    },

    /**
     * Show agent context menu
     */
    showAgentContextMenu(event, agentId) {
        event.preventDefault();
        event.stopPropagation();
        
        // Hide other context menus
        document.getElementById('requestContextMenu')?.classList.add('hidden');
        document.getElementById('sessionContextMenu')?.classList.add('hidden');
        
        const menu = document.getElementById('contextMenu');
        menu.dataset.agentId = agentId;
        menu.style.left = `${event.pageX}px`;
        menu.style.top = `${event.pageY}px`;
        menu.classList.remove('hidden');
    },

    /**
     * Handle agent context menu action
     */
    async handleAgentContextMenuAction(action, agentId) {
        switch (action) {
            case 'trimAgent':
                await this.trimAgent(agentId);
                break;
            case 'enableABLObjects':
                await this.enableABLObjects(agentId);
                break;
            case 'disableABLObjects':
                await this.disableABLObjects(agentId);
                break;
            case 'getABLObjectsReport':
                await this.getABLObjectsReport(agentId);
                break;
            case 'resetStatistics':
                await this.resetAgentStatistics(agentId);
                break;
        }
    },

    /**
     * Handle request context menu action
     */
    async handleRequestContextMenuAction(action, requestId, sessionId, requestUrl) {
        switch (action) {
            case 'cancelRequest':
                await this.cancelRequest(requestId, sessionId);
                break;
            case 'copyRequest':
                this.copyRequestToClipboard(requestId, requestUrl);
                break;
        }
    },

    /**
     * Copy request ID and URL to clipboard
     */
    copyRequestToClipboard(requestId, requestUrl) {
        const text = `Request ID: ${requestId}\nURL: ${requestUrl}`;
        navigator.clipboard.writeText(text)
            .then(() => Utils.showToast('Request copied to clipboard', 'success'))
            .catch(err => Utils.showToast('Failed to copy: ' + err.message, 'error'));
    },

    /**
     * Handle session context menu action
     */
    async handleSessionContextMenuAction(action, sessionId) {
        switch (action) {
            case 'terminateSession':
                await this.terminateSession(sessionId);
                break;
        }
    },

    /**
     * Terminate a session
     */
    async terminateSession(sessionId) {
        if (!confirm(`Are you sure you want to terminate session ${sessionId}?`)) {
            return;
        }
        
        try {
            await this.agentService.terminateSession(
                this.selectedApplication, 
                this.selectedAgentId, 
                sessionId
            );
            Utils.showToast(`Session ${sessionId} terminated`, 'success');
            await this.loadSessions(this.selectedAgentId);
        } catch (error) {
            Utils.showToast(`Failed to terminate session: ${error.message}`, 'error');
        }
    },

    /**
     * Add a new agent
     */
    async addAgent() {
        if (!this.selectedApplication) return;
        
        try {
            const result = await this.agentService.addAgent(this.selectedApplication);
            Utils.showToast('Agent added successfully', 'success');
            await this.loadAgents();
        } catch (error) {
            Utils.showToast(`Failed to add agent: ${error.message}`, 'error');
        }
    },

    /**
     * Open properties modal and load agent properties
     */
    async openPropertiesModal() {
        if (!this.selectedApplication) return;
        
        const modal = document.getElementById('propertiesModal');
        const modalBody = document.getElementById('propertiesModalBody');
        
        // Show modal with loading state
        modalBody.innerHTML = '';
        modalBody.appendChild(Templates.loading('Loading properties...'));
        modal.classList.remove('hidden');
        
        try {
            const properties = await this.agentService.fetchAgentProperties(this.selectedApplication);
            this.currentProperties = properties;
            this.renderPropertiesForm(properties);
        } catch (error) {
            modalBody.innerHTML = '';
            modalBody.appendChild(Templates.errorMessage(`Failed to load properties: ${error.message}`));
        }
    },

    /**
     * Render properties form in modal using Templates
     */
    renderPropertiesForm(properties) {
        const modalBody = document.getElementById('propertiesModalBody');
        const keys = Object.keys(properties);
        
        if (keys.length === 0) {
            modalBody.innerHTML = '';
            modalBody.appendChild(Templates.emptyState('No properties found'));
            return;
        }
        
        // Build properties form with editable inputs
        const table = document.createElement('table');
        table.className = 'properties-table';
        const tbody = document.createElement('tbody');
        
        keys.forEach(key => {
            const row = Templates.propertyRow(key, properties[key]);
            tbody.appendChild(row);
        });
        
        table.appendChild(tbody);
        modalBody.innerHTML = '';
        modalBody.appendChild(table);
    },

    /**
     * Close properties modal
     */
    closePropertiesModal() {
        document.getElementById('propertiesModal').classList.add('hidden');
        this.currentProperties = null;
    },

    /**
     * Save agent properties
     */
    async saveAgentProperties() {
        if (!this.selectedApplication) return;
        
        // Collect all property values from inputs
        const inputs = document.querySelectorAll('.property-input');
        const updatedProperties = {};
        
        inputs.forEach(input => {
            const propertyName = input.dataset.property;
            const propertyValue = input.value;
            updatedProperties[propertyName] = propertyValue;
        });
        
        try {
            await this.agentService.updateAgentProperties(this.selectedApplication, updatedProperties);
            Utils.showToast('Properties saved successfully', 'success');
            this.closePropertiesModal();
        } catch (error) {
            Utils.showToast(`Failed to save properties: ${error.message}`, 'error');
        }
    },

    /**
     * Trim an agent (graceful shutdown using DELETE with waitToFinish/waitAfterStop)
     */
    async trimAgent(agentId) {
        if (!confirm(`Are you sure you want to trim agent ${agentId}?`)) {
            return;
        }
        
        try {
            await this.agentService.trimAgent(this.selectedApplication, agentId, 
                this.config.waitToFinish, this.config.waitAfterStop);
            Utils.showToast(`Agent ${agentId} trimmed`, 'success');
            if (this.selectedAgentId === agentId) {
                this.selectedAgentId = '';
                this.sessions = [];
                this.renderSessionsTable();
            }
            await this.loadAgents();
        } catch (error) {
            Utils.showToast(`Failed to trim agent: ${error.message}`, 'error');
        }
    },

    /**
     * Trim all agents
     */
    async trimAllAgents() {
        if (!confirm('Are you sure you want to trim ALL agents?')) {
            return;
        }
        
        try {
            let successCount = 0;
            let failCount = 0;
            
            for (const agent of this.agents) {
                const agentId = agent.agentId || agent.id;
                try {
                    await this.agentService.trimAgent(this.selectedApplication, agentId,
                        this.config.waitToFinish, this.config.waitAfterStop);
                    successCount++;
                } catch (e) {
                    failCount++;
                }
            }
            
            Utils.showToast(`Trimmed ${successCount} agents, ${failCount} failed`, 
                           failCount > 0 ? 'warning' : 'success');
            this.selectedAgentId = '';
            this.sessions = [];
            await this.loadAgents();
            this.renderSessionsTable();
        } catch (error) {
            Utils.showToast(`Failed to trim agents: ${error.message}`, 'error');
        }
    },

    /**
     * Cancel a running request
     */
    async cancelRequest(requestId, sessionId) {
        try {
            await this.agentService.cancelRequest(this.selectedApplication, requestId, sessionId);
            Utils.showToast('Cancel request sent', 'info');
            // Request will disappear on next refresh
        } catch (error) {
            Utils.showToast(`Failed to cancel request: ${error.message}`, 'error');
        }
    },

    /**
     * Enable ABL Objects tracking for an agent
     */
    async enableABLObjects(agentId) {
        try {
            await this.agentService.enableABLObjects(this.selectedApplication, agentId);
            Utils.showToast(`ABL Objects enabled for agent ${agentId}`, 'success');
        } catch (error) {
            Utils.showToast(`Failed to enable ABL Objects: ${error.message}`, 'error');
        }
    },

    /**
     * Disable ABL Objects tracking for an agent
     */
    async disableABLObjects(agentId) {
        try {
            await this.agentService.disableABLObjects(this.selectedApplication, agentId);
            Utils.showToast(`ABL Objects disabled for agent ${agentId}`, 'success');
        } catch (error) {
            Utils.showToast(`Failed to disable ABL Objects: ${error.message}`, 'error');
        }
    },

    /**
     * Get ABL Objects report for an agent
     */
    async getABLObjectsReport(agentId) {
        try {
            const report = await this.agentService.getABLObjectsReport(this.selectedApplication, agentId);
            
            // Create a downloadable JSON file
            const blob = new Blob([report], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ABLObjects_Agent_${agentId}_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            Utils.showToast('ABL Objects Report downloaded', 'success');
        } catch (error) {
            Utils.showToast(`Failed to get ABL Objects Report: ${error.message}`, 'error');
        }
    }
};

// Apply mixin to OeManagerApp prototype when app.js loads
// This is done at the end of app.js after class definition
