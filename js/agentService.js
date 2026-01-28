/**
 * AgentService - API wrapper for PASOE oemanager REST API
 * Ported from oemanagergui VS Code extension (agentService.ts)
 */
class AgentService {
    // Set to true to enable verbose API logging
    static DEBUG = false;

    constructor() {
        this.config = {
            baseUrl: '',
            username: '',
            password: '',
            waitToFinish: 120000,
            waitAfterStop: 60000
        };
    }

    /**
     * Log message if debug mode is enabled
     */
    log(...args) {
        if (AgentService.DEBUG) {
            console.log('[AgentService]', ...args);
        }
    }

    /**
     * Set connection configuration
     */
    setConfig(baseUrl, username, password) {
        this.config.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.config.username = username;
        this.config.password = password;
    }

    /**
     * Get API headers with Basic Auth (for GET/DELETE - no Content-Type)
     */
    getHeaders() {
        const credentials = btoa(`${this.config.username}:${this.config.password}`);
        return {
            'Authorization': `Basic ${credentials}`,
            'Accept': '*/*'
        };
    }

    /**
     * Get API headers with Content-Type for POST/PUT with body
     */
    getHeadersWithBody(contentType = 'application/json') {
        return {
            ...this.getHeaders(),
            'Content-Type': contentType
        };
    }

    /**
     * Build API URL
     */
    apiUrl(path) {
        return `${this.config.baseUrl}/oemanager${path}`;
    }

    /**
     * Handle error response with better messaging
     */
    handleError(response, text, operation) {
        if (response.status === 405) {
            throw new Error(`${operation}: Method Not Allowed (405). This may be a CORS issue - ensure the webapp is deployed on the same PASOE instance, or configure CORS headers on the server.`);
        }
        throw new Error(`${operation}: ${response.status} ${text}`);
    }

    /**
     * Fetch list of applications
     */
    async fetchApplications() {
        const url = this.apiUrl('/applications');
        this.log('Fetching applications:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch applications: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        this.log('Applications response:', data);

        // Extract applications from result.Application array
        if (data.result && data.result.Application && Array.isArray(data.result.Application)) {
            return data.result.Application.map(app => ({
                name: app.name,
                version: app.version,
                description: app.description
            }));
        }
        return [];
    }

    /**
     * Fetch agents for an application
     */
    async fetchAgents(applicationName) {
        const url = this.apiUrl(`/applications/${applicationName}/agents`);
        this.log('Fetching agents:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch agents: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        this.log('Agents response:', data);

        // Handle various response formats
        if (data.result && data.result.agents && Array.isArray(data.result.agents)) {
            return data.result.agents;
        } else if (data.agents && Array.isArray(data.agents)) {
            return data.agents;
        } else if (Array.isArray(data)) {
            return data;
        }
        return [];
    }

    /**
     * Fetch sessions for a specific agent
     */
    async fetchSessions(applicationName, agentId) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/${agentId}/sessions`);
        this.log('Fetching sessions:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch sessions: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        this.log('Sessions response:', data);

        // Handle various response formats
        if (data.result && data.result.AgentSession && Array.isArray(data.result.AgentSession)) {
            return data.result.AgentSession;
        } else if (data.result && data.result.sessions && Array.isArray(data.result.sessions)) {
            return data.result.sessions;
        } else if (data.AgentSession && Array.isArray(data.AgentSession)) {
            return data.AgentSession;
        } else if (Array.isArray(data)) {
            return data;
        }
        return [];
    }

    /**
     * Fetch running requests for an application
     */
    async fetchRequests(applicationName) {
        const url = this.apiUrl(`/applications/${applicationName}/requests`);
        this.log('Fetching requests:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch requests: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        this.log('Requests response:', data);

        // Extract requests from result.Request array
        return data.result?.Request || [];
    }

    /**
     * Fetch SessionManager metrics for an application
     */
    async fetchMetrics(applicationName) {
        const url = this.apiUrl(`/applications/${applicationName}/metrics`);
        this.log('Fetching metrics:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch metrics: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        this.log('Metrics response:', data);

        return data.result || {};
    }

    /**
     * Fetch metrics for a specific agent
     */
    async fetchAgentMetrics(applicationName, agentId) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/${agentId}/metrics`);
        this.log('Fetching agent metrics:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch agent metrics: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        this.log('Agent metrics response:', data);
        // Return full response - let caller extract what they need
        return data;
    }

    /**
     * Fetch connections for a specific agent
     */
    async fetchAgentConnections(applicationName, agentId) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/${agentId}/connections`);
        this.log('Fetching agent connections:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch agent connections: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        this.log('Agent connections response:', data);
        return data.result?.AgentConnection || [];
    }

    /**
     * Fetch requests for a specific agent
     */
    async fetchAgentRequests(applicationName, agentId) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/${agentId}/requests`);
        this.log('Fetching agent requests:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch agent requests: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        this.log('Agent requests response:', data);
        return data.result?.AgentRequest || [];
    }

    /**
     * Fetch threads for a specific agent
     */
    async fetchAgentThreads(applicationName, agentId) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/${agentId}/threads`);
        this.log('Fetching agent threads:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch agent threads: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        this.log('Agent threads response:', data);
        return data.result?.AgentThread || [];
    }

    /**
     * Fetch agent properties
     */
    async fetchAgentProperties(applicationName) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/properties`);
        this.log('Fetching agent properties:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch agent properties: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.result || data;
    }

    /**
     * Update agent properties
     */
    async updateAgentProperties(applicationName, properties) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/properties`);
        this.log('Updating agent properties:', url);

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                ...this.getHeaders(),
                'Content-Type': 'application/vnd.progress+json'
            },
            body: JSON.stringify(properties)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to update agent properties: ${response.status} ${text}`);
        }
    }

    /**
     * Add a new agent
     */
    async addAgent(applicationName) {
        const url = this.apiUrl(`/applications/${applicationName}/addAgent`);
        this.log('Adding agent:', url);

        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to add agent: ${response.status} ${text}`);
        }

        return await response.json();
    }

    /**
     * Trim an agent (graceful shutdown)
     * Uses DELETE method with waitToFinish and waitAfterStop parameters
     */
    async trimAgent(applicationName, agentId, waitToFinish = 120000, waitAfterStop = 60000) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/${agentId}?waitToFinish=${waitToFinish}&waitAfterStop=${waitAfterStop}`);
        this.log('Trimming agent:', url);

        const response = await fetch(url, {
            method: 'DELETE',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            const text = await response.text();
            this.handleError(response, text, 'Failed to trim agent');
        }
    }

    /**
     * Cancel a running request
     */
    async cancelRequest(applicationName, requestId, sessionId) {
        const url = this.apiUrl(`/applications/${applicationName}/requests?requestID=${encodeURIComponent(requestId)}&sessionID=${encodeURIComponent(sessionId)}`);
        this.log('Cancelling request:', url);

        const response = await fetch(url, {
            method: 'DELETE',
            headers: this.getHeaders()
        });

        // Silently succeed even on failure - request may have completed
        if (!response.ok) {
            this.log('Cancel request failed (request may have completed)');
        }
    }

    /**
     * Terminate a session
     * Uses DELETE with terminateOpt=2
     */
    async terminateSession(applicationName, agentId, sessionId) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/${agentId}/sessions/${sessionId}?terminateOpt=2`);
        this.log('Terminating session:', url);

        const response = await fetch(url, {
            method: 'DELETE',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            const text = await response.text();
            this.handleError(response, text, 'Failed to terminate session');
        }
    }

    /**
     * Enable ABL Objects tracking for an agent
     */
    async enableABLObjects(applicationName, agentId) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/${agentId}/ABLObjects/status`);
        this.log('Enabling ABL Objects:', url);

        const response = await fetch(url, {
            method: 'PUT',
            headers: this.getHeadersWithBody('application/vnd.progress+json'),
            body: JSON.stringify({ enable: "true" })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to enable ABL Objects: ${response.status} ${text}`);
        }
    }

    /**
     * Disable ABL Objects tracking for an agent
     */
    async disableABLObjects(applicationName, agentId) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/${agentId}/ABLObjects/status`);
        this.log('Disabling ABL Objects:', url);

        const response = await fetch(url, {
            method: 'PUT',
            headers: this.getHeadersWithBody('application/vnd.progress+json'),
            body: JSON.stringify({ enable: "false" })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to disable ABL Objects: ${response.status} ${text}`);
        }
    }

    /**
     * Get ABL Objects report for an agent
     */
    async getABLObjectsReport(applicationName, agentId) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/${agentId}/ABLObjects`);
        this.log('Getting ABL Objects report:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to get ABL Objects report: ${response.status} ${text}`);
        }

        return await response.text();
    }

    /**
     * Reset agent statistics
     */
    async resetAgentStatistics(applicationName, agentId) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/${agentId}/agentStatData`);
        this.log('Resetting agent statistics:', url);

        const response = await fetch(url, {
            method: 'DELETE',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            const text = await response.text();
            this.handleError(response, text, 'Failed to reset agent statistics');
        }
    }

    /**
     * Fetch agents with session counts
     */
    async fetchAgentsWithSessions(applicationName) {
        const url = this.apiUrl(`/applications/${applicationName}/agents/sessions`);
        this.log('Fetching agents with sessions:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch agents with sessions: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data.result && data.result.agents && Array.isArray(data.result.agents)) {
            return data.result.agents;
        } else if (Array.isArray(data)) {
            return data;
        }
        return [];
    }
}

// Export as global
window.AgentService = AgentService;
