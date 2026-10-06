/**
 * OE Manager GUI - Templates
 * Helper class for working with HTML <template> elements
 * 
 * Templates are defined in index.html and cloned/populated dynamically
 */

const Templates = {
    /**
     * Get a template by ID and return a cloned fragment
     * @param {string} templateId - ID of the template element (without '#')
     * @returns {DocumentFragment} - Cloned template content
     */
    get(templateId) {
        const template = document.getElementById(templateId);
        if (!template) {
            console.error(`Template not found: ${templateId}`);
            return null;
        }
        return template.content.cloneNode(true);
    },

    /**
     * Get a template, populate it with data, and return the first element
     * @param {string} templateId - ID of the template element
     * @param {Object} data - Key-value pairs to populate (keys match data-field attributes)
     * @returns {Element} - Populated element
     */
    populate(templateId, data) {
        const fragment = this.get(templateId);
        if (!fragment) return null;

        // Find the root element (first child that's an element)
        const element = fragment.querySelector('*');
        if (!element) return null;

        // Populate data-field elements
        Object.keys(data).forEach(key => {
            const field = element.querySelector(`[data-field="${key}"]`);
            if (field) {
                if (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA' || field.tagName === 'SELECT') {
                    field.value = data[key];
                } else {
                    field.textContent = data[key];
                }
            }
        });

        // Populate data-* attributes on root element
        Object.keys(data).forEach(key => {
            if (element.dataset && element.dataset[key] !== undefined) {
                element.dataset[key] = data[key];
            }
        });

        return element;
    },

    /**
     * Render an agent table row
     */
    agentRow(agent, isSelected, stateClass) {
        const agentId = agent.agentId || agent.id;
        const state = agent.state || 'UNKNOWN';
        const fragment = this.get('tmpl-agent-row');
        const row = fragment.querySelector('tr');
        
        if (isSelected) row.classList.add('selected');
        row.dataset.agentId = agentId;
        row.dataset.state = state;
        
        row.querySelector('[data-field="agentId"]').textContent = agentId;
        row.querySelector('[data-field="pid"]').textContent = agent.pid || '-';
        const stateCell = row.querySelector('[data-field="state"]');
        stateCell.textContent = state;
        stateCell.className = stateClass;
        row.querySelector('[data-field="sessions"]').textContent = agent.sessionCount || agent.numSessions || 0;
        
        // Set up action button
        const actionBtn = row.querySelector('.action-btn');
        actionBtn.dataset.agentId = agentId;
        
        return row;
    },

    /**
     * Render a session table row
     */
    sessionRow(session, stateClass) {
        const sessionId = session.SessionId || session.sessionId || session.id || '-';
        const state = session.SessionState || session.state || session.sessionState || 'UNKNOWN';
        const connectionId = session.ConnectionId || session.connectionId || session.connId || '-';
        const requestCount = session.RequestCount || session.requestCount || session.numRequests || 0;
        const startTime = session.SessionStartTime || session.startTime || session.started;
        
        const fragment = this.get('tmpl-session-row');
        const row = fragment.querySelector('tr');
        
        row.dataset.sessionId = sessionId;
        
        row.querySelector('[data-field="sessionId"]').textContent = sessionId;
        const stateCell = row.querySelector('[data-field="state"]');
        stateCell.textContent = state;
        stateCell.className = stateClass;
        row.querySelector('[data-field="connectionId"]').textContent = connectionId;
        row.querySelector('[data-field="requestCount"]').textContent = requestCount;
        row.querySelector('[data-field="startTime"]').textContent = Utils.formatTimestamp(startTime);
        
        return row;
    },

    /**
     * Render a request table row
     */
    requestRow(request) {
        const requestId = request.requestID || request.requestId || request.id || '-';
        const sessionId = request.sessionManager?.sessionId || request.sessionId || '-';
        const url = request.tomcat?.url || request.url || '-';
        const state = request.sessionManager?.requestState || request.state || '-';
        const elapsed = request.sessionManager?.requestElapsedTime || request.elapsedTime || 0;
        
        const fragment = this.get('tmpl-request-row');
        const row = fragment.querySelector('tr');
        
        row.dataset.requestId = requestId;
        row.dataset.sessionId = sessionId;
        row.dataset.url = url;
        
        row.querySelector('[data-field="requestId"]').textContent = requestId;
        row.querySelector('[data-field="sessionId"]').textContent = sessionId;
        const urlCell = row.querySelector('[data-field="url"]');
        urlCell.textContent = Utils.truncate(url, 40);
        urlCell.title = url;
        row.querySelector('[data-field="state"]').textContent = state;
        row.querySelector('[data-field="elapsed"]').textContent = `${elapsed}ms`;
        
        // Set up cancel button
        const cancelBtn = row.querySelector('.cancel-btn');
        cancelBtn.dataset.requestId = requestId;
        cancelBtn.dataset.sessionId = sessionId;
        
        return row;
    },

    /**
     * Render a property form row
     */
    propertyRow(key, value) {
        const displayValue = value !== null && value !== undefined ? String(value) : '';
        const fragment = this.get('tmpl-property-row');
        const row = fragment.querySelector('tr');
        
        row.querySelector('[data-field="name"]').textContent = key;
        const input = row.querySelector('.property-input');
        input.dataset.property = key;
        input.value = displayValue;
        
        return row;
    },

    /**
     * Render session manager metrics table (two columns)
     */
    sessionManagerMetrics(metrics) {
        if (!metrics || typeof metrics !== 'object') {
            return this.emptyState('No SessionManager metrics found');
        }
        
        const keys = Object.keys(metrics);
        if (keys.length === 0) {
            return this.emptyState('No SessionManager metrics found');
        }
        
        const fragment = this.get('tmpl-session-manager-metrics');
        const container = fragment.querySelector('.session-manager-metrics-grid');
        
        const halfCount = Math.ceil(keys.length / 2);
        const firstColumnKeys = keys.slice(0, halfCount);
        const secondColumnKeys = keys.slice(halfCount);
        
        const tables = container.querySelectorAll('tbody');
        
        // First column
        firstColumnKeys.forEach(k => {
            const row = this.metricsKeyValueRow(k, metrics[k]);
            tables[0].appendChild(row);
        });
        
        // Second column
        secondColumnKeys.forEach(k => {
            const row = this.metricsKeyValueRow(k, metrics[k]);
            tables[1].appendChild(row);
        });
        
        return container;
    },

    /**
     * Helper: Create a key-value row for metrics tables
     */
    metricsKeyValueRow(key, value) {
        const displayValue = value !== null && value !== undefined ? String(value) : '';
        const row = document.createElement('tr');
        row.innerHTML = `<th>${Utils.escapeHtml(key)}</th><td>${Utils.escapeHtml(displayValue)}</td>`;
        return row;
    },

    /**
     * Helper: Create empty state element
     */
    emptyState(message) {
        const div = document.createElement('div');
        div.className = 'empty-state';
        div.textContent = message;
        return div;
    },

    /**
     * Helper: Create error message element
     */
    errorMessage(message) {
        const div = document.createElement('div');
        div.className = 'error-message';
        div.textContent = message;
        return div;
    },

    /**
     * Helper: Create loading element
     */
    loading(message = 'Loading...') {
        const div = document.createElement('div');
        div.className = 'loading';
        div.textContent = message;
        return div;
    }
};
// CommonJS export for unit tests (no-op in the browser script-tag context).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Templates };
}