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
| `/applications/{app}/agents` | GET | List agents |
| `/applications/{app}/agents/{id}/sessions` | GET | Agent sessions |
| `/applications/{app}/agents/{id}/requests` | GET | Running requests |
| `/applications/{app}/agents/properties` | GET/PUT | Agent properties |
| `/applications/{app}/metrics` | GET | Session manager metrics |
| `/applications/{app}/agents/{id}/metrics` | GET | Agent metrics |
| `/applications/{app}/agents` | POST | Add agent |
| `/applications/{app}/agents/{id}?waitToFinish=...&waitAfterStop=...` | DELETE | Trim agent (graceful shutdown) |
| `/applications/{app}/agents/{id}/sessions/{sid}?terminateOpt=2` | DELETE | Terminate session |
| `/applications/{app}/agents/{id}/agentStatData` | DELETE | Reset statistics |
| `/applications/{app}/agents/{id}/ABLObjects` | PUT | Enable/Disable ABL objects |
| `/applications/{app}/agents/{id}/ABLObjectsReport` | GET | ABL objects report |
| `/requests?requestID=...&sessionID=...` | DELETE | Cancel request |

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
