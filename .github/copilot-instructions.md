# OE Manager GUI - Static Web Application

## Project Overview

Static web application for managing OpenEdge PASOE agents and sessions. Deployed as a WAR file on the same Tomcat instance as PASOE. This is a port of the VS Code extension `oemanagergui` to a standalone web application.

**Source Project**: `oemanagergui` VS Code extension (TypeScript)

## Important Instructions for AI Agents

**Reference only these two projects:**
- **oemanagergui-java** - This static webapp project
- **oemanagergui** - The source VS Code extension it's ported from

Do NOT reference patterns from other projects in the workspace (bitbucket-manager, git-staging-view, OpenEdge-ABL-properties, apache-ant-manager, etc.).

## Architecture

```
Browser (HTML/CSS/JS) → Direct API calls → PASOE oemanager REST API
```

This is a **static webapp** with no backend. JavaScript in the browser makes direct REST API calls to the PASOE oemanager endpoint.

### Key Files
| File | Purpose |
|------|---------|
| `index.html` | Single-page application with all HTML structure |
| `css/style.css` | Dark theme styling (VS Code-inspired) |
| `js/agentService.js` | API wrapper for PASOE oemanager REST API |
| `js/app.js` | Main application class with 3 views |
| `WEB-INF/web.xml` | Servlet configuration for static deployment |
| `pom.xml` | Maven build configuration |

### Three Views (ported from oemanagergui)
1. **Agents View** - Agent/Session/Request management with context menus
2. **Charts View** - Performance charts (memory, requests) 
3. **Metrics View** - Agent statistics with expandable cards

## Development Workflow

```powershell
# Build WAR file
mvn clean package -DskipTests

# Deploy to PASOE Tomcat
Copy-Item target/oemanagergui.war $env:CATALINA_HOME/webapps/
```

## URL Auto-Detection

The app automatically derives the oemanager URL from the current page URL:
- User accesses: `https://server/oemanagergui`
- App calls API at: `https://server/oemanager/...`

See `getOemanagerBaseUrl()` in `app.js`.

## Code Patterns

### AgentService API Wrapper
All REST calls go through `agentService.js`:
```javascript
// API URL construction
apiUrl(path) {
    return `${this.config.baseUrl}/oemanager${path}`;
}

// Example method
async fetchAgents(applicationName) {
    const url = this.apiUrl(`/applications/${applicationName}/agents`);
    const response = await fetch(url, { headers: this.getHeaders() });
    // ...
}
```

### Authentication
Basic Auth via Authorization header:
```javascript
getHeaders() {
    const credentials = btoa(`${this.config.username}:${this.config.password}`);
    return {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json'
    };
}
```

### Context Menus
Event delegation pattern for right-click menus:
```javascript
// Store data in menu dataset
menu.dataset.agentId = row.dataset.agentId;

// Handle action
handleAgentContextMenuAction(action, agentId) {
    switch (action) {
        case 'trimAgent': this.trimAgent(agentId); break;
        // ...
    }
}
```

### Modal Pattern
```javascript
// Open modal
document.getElementById('propertiesModal').classList.remove('hidden');

// Close modal
document.getElementById('propertiesModal').classList.add('hidden');
```

### Toast Notifications
```javascript
this.showToast('Message text', 'success'); // or 'error', 'warning'
```

## PASOE API Endpoints

All endpoints follow pattern: `{baseUrl}/oemanager/applications/{app}/...`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/oemanager/applications` | GET | List applications |
| `/applications/{app}` | GET | Get application details with webapps/transports |
| `/applications/{app}/agents` | GET | List agents |
| `/applications/{app}/agents/sessions` | GET | List agents with embedded sessions |
| `/applications/{app}/agents/{id}/sessions` | GET | Agent sessions |
| `/applications/{app}/agents/{id}/requests` | GET | Agent requests |
| `/applications/{app}/agents/{id}/connections` | GET | Agent connections |
| `/applications/{app}/agents/{id}/threads` | GET | Agent threads |
| `/applications/{app}/agents/{id}/status` | GET | Agent status summary |
| `/applications/{app}/agents/{id}/metrics` | GET | Agent metrics (memory, threads, sessions) |
| `/applications/{app}/agents/properties` | GET/PUT | Agent properties |
| `/applications/{app}/metrics` | GET | Session manager metrics |
| `/applications/{app}/requests` | GET | Active requests on server |
| `/applications/{app}/clients` | GET | Client connections |
| `/applications/{app}/sessions` | GET | Client sessions (OEABLSession) |
| `/applications/{app}/agentConnections` | GET | Broker agent connections |
| `/applications/{app}/webapps` | GET | List webapps |
| `/applications/{app}/webapps/{webapp}/transports/{transport}/metrics` | GET | Transport metrics |
| `/applications/{app}/agents` | POST | Add agent |
| `/applications/{app}/agents/{id}?waitToFinish=...&waitAfterStop=...` | DELETE | Trim agent (graceful shutdown) |
| `/applications/{app}/agents/{id}/sessions/{sid}?terminateOpt=2` | DELETE | Terminate session |
| `/applications/{app}/agents/{id}/agentStatData` | DELETE | Reset statistics |
| `/applications/{app}/agents/{id}/ABLObjects/status` | PUT | Enable/Disable ABL objects |
| `/applications/{app}/agents/{id}/ABLObjects` | GET | ABL objects report |
| `/applications/{app}/requests?requestID=...&sessionID=...` | DELETE | Cancel request |

## API Response Structures

### GET /oemanager/applications
```json
{
  "operation": "GET OEABL SERVICES",
  "outcome": "SUCCESS",
  "result": {
    "Application": [
      {
        "name": "PASOE_DEVSET",
        "version": "v12.8.9 ( 2025-08-04 )",
        "description": "PAS Application",
        "type": "OPENEDGE",
        "webapps": [...],
        "oetype": "APPLICATION"
      }
    ]
  }
}
```

### GET /applications/{app}/agents
```json
{
  "operation": "GET AGENTS",
  "outcome": "SUCCESS",
  "result": {
    "agents": [
      {
        "agentId": "VbzWF_OzQ3OkgYmfmfuIDQ",
        "pid": "43320",
        "state": "AVAILABLE"
      }
    ]
  }
}
```

### GET /applications/{app}/agents/sessions
Returns agents with embedded sessions array:
```json
{
  "operation": "GET AGENTS",
  "outcome": "SUCCESS",
  "result": {
    "agents": [
      {
        "agentId": "VbzWF_OzQ3OkgYmfmfuIDQ",
        "pid": "43320",
        "state": "AVAILABLE",
        "overheadMemory": 119789538,
        "agentStartTime": "2026-01-27T18:07:27.090-01:00",
        "sessions": [
          {
            "SessionId": 4,
            "SessionState": "IDLE",
            "StartTime": "2026-01-27T18:07:27.090-01:00",
            "EndTime": null,
            "ThreadId": -1,
            "ConnectionId": -1,
            "SessionExternalState": 0,
            "SessionMemory": 667455029,
            "RequestsCompleted": 1,
            "RequestsFailed": 0,
            "IdleTimeHighWater": 0,
            "MemAtRestHighWater": 667455052,
            "MemActiveHighWater": 669962431
          }
        ]
      }
    ]
  }
}
```

### GET /applications/{app}/agents/{id}/metrics
```json
{
  "operation": "GET AGENT METRICS",
  "outcome": "SUCCESS",
  "result": {
    "AgentStatHist": [
      {
        "ActiveThreads": 7,
        "ActiveSessions": 6,
        "OpenConnections": 5,
        "ExitedThreads": 0,
        "ExitedSessions": 0,
        "ClosedConnections": 0,
        "CStackMemory": 11534336,
        "OverheadMemory": 122704318
      }
    ]
  }
}
```

### GET /applications/{app}/agents/{id}/status
```json
{
  "operation": "GET AGENT STATUS",
  "outcome": "SUCCESS",
  "result": {
    "threads": 6,
    "sessions": 6,
    "connections": 5,
    "requests": 266
  }
}
```

### GET /applications/{app}/agents/{id}/sessions
```json
{
  "operation": "GET AGENT SESSIONS",
  "outcome": "SUCCESS",
  "result": {
    "AgentSession": [
      {
        "SessionId": 4,
        "SessionState": "IDLE",
        "StartTime": "2026-01-27T18:07:27.090-01:00",
        "EndTime": null,
        "ThreadId": -1,
        "ConnectionId": -1,
        "SessionExternalState": 0,
        "SessionMemory": 667455029,
        "RequestsCompleted": 1,
        "RequestsFailed": 0,
        "IdleTimeHighWater": 0,
        "MemAtRestHighWater": 667455052,
        "MemActiveHighWater": 669962431
      }
    ]
  }
}
```

### GET /applications/{app}/agents/{id}/threads
```json
{
  "operation": "GET AGENT THREADS",
  "outcome": "SUCCESS",
  "result": {
    "AgentThread": [
      {
        "ThreadId": 4,
        "ThreadState": "IDLE",
        "StartTime": "2026-01-27T18:07:27.090-01:00",
        "EndTime": null
      },
      {
        "ThreadId": 6,
        "ThreadState": "TERMINATED",
        "StartTime": "2026-01-27T18:07:27.090-01:00",
        "EndTime": "2026-01-27T20:55:52.206-00:00"
      }
    ]
  }
}
```

### GET /applications/{app}/agents/{id}/connections
```json
{
  "operation": "GET AGENT CONNECTIONS",
  "outcome": "SUCCESS",
  "result": {
    "AgentConnection": [
      {
        "ConnectionId": 2784,
        "ConnectionState": "CONNECTED",
        "SessionId": 8
      }
    ]
  }
}
```

### GET /applications/{app}/agents/{id}/requests
```json
{
  "operation": "GET AGENT REQUESTS",
  "outcome": "SUCCESS",
  "result": {
    "AgentRequest": [
      {
        "RequestProcName": "Progress.Web.InternalWebHandler:HandleRequest",
        "SessionId": 4,
        "ConnectionId": 2784,
        "StartTime": "2026-01-27T18:08:42.876-01:00",
        "EndTime": "2026-01-27T18:08:44.221-01:00",
        "RequestNum": 1,
        "BrokerSessionId": "uAogFMUkRwyZtW45MI_v2w",
        "requestID": "ROOT:w:00000001",
        "RequestLen": 1345,
        "RequestStatus": 0
      }
    ]
  }
}
```

### GET /applications/{app}/metrics (Session Manager)
```json
{
  "operation": "GET SESSION-MGR METRICS",
  "outcome": "SUCCESS",
  "result": {
    "concurrentConnectedClients": 0,
    "minAgentReadTime": 0,
    "avgAgentReadTime": 0,
    "writeErrors": 0,
    "maxAgentReadTime": 0,
    "reads": 629,
    "numReserveABLSessionWaits": 54,
    "requests": 205,
    "readErrors": 0,
    "stdDevAgentReadTime": 0,
    "totReserveABLSessionWaitTime": 4749,
    "maxConcurrentClients": 6,
    "numReserveABLSessionTimeouts": 0,
    "maxReserveABLSessionWaitTime": 347,
    "writes": 410,
    "avgReserveABLSessionWaitTime": 87,
    "type": "OE_BROKER",
    "startTime": "2026-01-27T18:07:14.741+01:00",
    "accessTime": "2026-01-27T18:20:25.623+01:00"
  }
}
```

### GET /applications/{app}/requests (Active Server Requests)
```json
{
  "operation": "GET ACTIVE REQUESTS ON SERVER",
  "outcome": "SUCCESS",
  "result": {
    "Request": [
      {
        "requestID": "ROOT:w:0000004c",
        "tomcat": {
          "methodType": "GET",
          "startTime": "2026-01-27T18:13:36.879+0100",
          "url": "https://nr.ivnet.ch/web/SmartMenuStructure"
        },
        "sessionManager": {
          "sessionId": "UUpm9Z2xS6CPbtqY_6nVaQ",
          "requestState": "RUNNING",
          "userId": "axadmin@de.ivnet.ch",
          "requestStartTimeStamp": "2026-01-27T18:13:36.882+0100",
          "requestElapsedTime": 9
        },
        "agent": {
          "sessionId": "4",
          "requestProcName": "Progress.Web.InternalWebHandler:HandleRequest",
          "connectionId": "2960",
          "startTime": "2026-01-27T18:13:36.634-01:00",
          "endTime": "2026-01-27T18:13:36.797-01:00",
          "requestNum": 73
        }
      }
    ]
  }
}
```

### GET /applications/{app}/clients
```json
{
  "operation": "GET CLIENT CONNECTIONS",
  "outcome": "SUCCESS",
  "result": {
    "ClientConnection": [
      {
        "clientName": "127.0.0.1",
        "requestID": "ROOT:w:00000122",
        "sessionID": "uNVWv15ZQzeSzuVrssuryg",
        "adapterType": "WEB",
        "reqStartTimeStr": "2026-01-27T21:06:52.966+0100",
        "elapsedTimeMs": 292,
        "executerThreadId": "thd-2",
        "requestUrl": null,
        "requestProcedure": "Progress.Web.InternalWebHandler:HandleRequest",
        "httpSessionId": "8B144EB7864AAC128B692BE08FD92FC558A875ADCFD8.PASOE_DEVSET"
      }
    ]
  }
}
```

### GET /applications/{app}/sessions
```json
{
  "operation": "GET CLIENT SESSIONS",
  "outcome": "SUCCESS",
  "result": {
    "OEABLSession": [
      {
        "sessionID": "Ik4iwG8QRCWayFM9u6Vrzw",
        "requestID": "",
        "sessionPoolID": "8ENTUVnMQcqaaCsKQwB2eA",
        "agentID": "",
        "ablSessionID": "",
        "lastAccessStr": "2026-01-27T18:11:50.566+0100",
        "elapsedTimeMs": 697059,
        "sessionState": "RESERVED",
        "requestState": "READY",
        "sessionType": "SESSION_FREE",
        "adapterType": "",
        "bound": false,
        "clientConnInfo": null,
        "agentConnInfo": null
      }
    ]
  }
}
```

### GET /applications/{app}/agentConnections
```json
{
  "operation": "GET BROKERS AGENT CONNECTIONS",
  "outcome": "SUCCESS",
  "result": {
    "AgentConnection": [
      {
        "agentID": "VbzWF_OzQ3OkgYmfmfuIDQ",
        "connID": "U6Zq9hrnQQGdRIylGVm1UQ",
        "connPoolID": "pXVsz_kPRCyOjBqWOCNnwA",
        "state": "RESERVED",
        "agentAddr": "localhost/127.0.0.1:62004",
        "localAddr": "/127.0.0.1:55124"
      }
    ]
  }
}
```

### GET /applications/{app}/webapps/{webapp}/transports/{transport}/metrics
```json
{
  "operation": "GET OE_REST_TRANSPORT METRICS",
  "outcome": "SUCCESS",
  "result": {
    "stdDevConnectTime": -1,
    "minSessionTime": 2,
    "serviceNotFoundErrors": 0,
    "minConnectTime": 40,
    "requests": 2,
    "expressionErrors": 0,
    "maxSessionTime": 2,
    "runRequests": 2,
    "maxConnectTime": 228,
    "successfulRunRequests": 2,
    "failedRequests": 0,
    "stdDevSessionTime": -1,
    "minDisconnectTime": 35,
    "successfulConnectRequests": 1,
    "maxDisconnectTime": 35,
    "serviceUnavailableRequests": 0,
    "avgSessionTime": 2,
    "avgDisconnectTime": 35,
    "successfulRequests": 2,
    "stdDevDisconnectTime": -1,
    "avgConnectTime": 134,
    "connectRequests": 1,
    "statusRequests": 0,
    "type": "OE_REST_TRANSPORT",
    "startTime": "2026-01-27T18:07:14.738+01:00",
    "accessTime": "2026-01-27T18:26:58.419+01:00"
  }
}
```

## Key Response Field Mappings

### Session Manager Metrics (for PASOE Stats charts)
| Field | Description |
|-------|-------------|
| `concurrentConnectedClients` | Current connected clients |
| `maxConcurrentClients` | Peak connected clients |
| `requests` | Total requests processed |
| `reads` | Total read operations |
| `writes` | Total write operations |
| `numReserveABLSessionWaits` | Session wait count |
| `numReserveABLSessionTimeouts` | Session timeout count |

### Agent Metrics (AgentStatHist)
| Field | Description |
|-------|-------------|
| `ActiveThreads` | Currently active threads |
| `ActiveSessions` | Currently active sessions |
| `OpenConnections` | Open connections count |
| `ExitedThreads` | Terminated threads |
| `ExitedSessions` | Terminated sessions |
| `ClosedConnections` | Closed connections |
| `CStackMemory` | C stack memory (bytes) |
| `OverheadMemory` | Overhead memory (bytes) |

### Session States
- `IDLE` - Session is idle
- `BUSY` - Session is processing
- `RESERVED` - Session is reserved

### Thread States
- `IDLE` - Thread is idle
- `RUNNING` - Thread is executing
- `TERMINATED` - Thread has ended

### Agent States
- `AVAILABLE` - Agent is available for work
- `BUSY` - Agent is processing requests

## Configuration

Stored in localStorage (except password):
- `username` - Basic auth username
- `waitToFinish` - Wait time for agent trim (ms)
- `waitAfterStop` - Wait after agent stop (ms)
- `agentsRefreshSec` - Agents grid refresh interval
- `requestsRefreshSec` - Requests grid refresh interval
- `chartsRefreshSec` - Charts refresh interval

## File Structure

```
oemanagergui-java/
├── index.html              # Main SPA
├── css/
│   └── style.css           # Dark theme styling
├── js/
│   ├── agentService.js     # API wrapper (~450 lines)
│   └── app.js              # Main app class (~1500 lines)
├── WEB-INF/
│   └── web.xml             # Servlet config
├── pom.xml                 # Maven build
├── README.md               # Project documentation
└── .github/
    └── copilot-instructions.md  # This file
```

## Debugging

- **Browser DevTools**: Network tab for API calls, Console for JS errors
- **Console logging**: `console.log('[AgentService]', ...)` pattern used throughout
- **API responses**: Check Network tab for response structure

## Mapping from oemanagergui VS Code Extension

| VS Code Extension | Static Webapp |
|-------------------|---------------|
| `agentPanel.ts` | `js/app.js` (Agents view methods) |
| `chartsPanel.ts` | `js/app.js` (Charts view methods) |
| `metricsPanel.ts` | `js/app.js` (Metrics view methods) |
| `agentService.ts` | `js/agentService.js` |
| Webview HTML | `index.html` |
| VS Code SecretStorage | Browser prompt (password not stored) |
| vscode.postMessage | Direct method calls |
