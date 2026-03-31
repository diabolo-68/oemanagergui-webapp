# OE Manager GUI - AI Agent Instructions

> Static webapp for managing OpenEdge PASOE agents and sessions. Deployed as a WAR file on Tomcat.

## Project Context

This is a **static web application** (HTML/CSS/JavaScript) that makes direct REST API calls to the PASOE oemanager endpoint. No backend server required - the JavaScript runs entirely in the browser.

**Source Project**: Ported from `oemanagergui` VS Code extension (TypeScript)

## Architecture

```
Browser (HTML/CSS/JS) → Direct API calls → PASOE oemanager REST API
```

### Key Files

| File | Purpose |
|------|---------|
| `index.html` | Single-page application |
| `css/style.css` | Dark theme styling (VS Code-inspired) |
| `js/app.js` | Main application class with initialization |
| `js/agentService.js` | REST API wrapper for PASOE oemanager |
| `js/agentsView.js` | Agent/Session/Request management mixin |
| `js/chartsView.js` | Performance charts mixin |
| `js/metricsView.js` | Agent statistics mixin |
| `js/pasoeStatsView.js` | PASOE time-series charts mixin |
| `js/templates.js` | HTML template functions |
| `js/utils.js` | Shared utility functions |

### Views

1. **Agents View** - Agent/Session/Request management with context menus
2. **Charts View** - Per-agent memory and request charts
3. **Metrics View** - Agent statistics with expandable cards
4. **PASOE Stats View** - Session manager time-series charts
5. **Settings View** - Configuration management

## Development Workflow

```powershell
# Build WAR file
mvn clean package -DskipTests

# Deploy to PASOE Tomcat
Copy-Item target/oemanagergui.war $env:CATALINA_HOME/webapps/
```

## Code Patterns

### Mixin Pattern
Views are implemented as mixins applied to OeManagerApp:
```javascript
Object.assign(OeManagerApp.prototype, AgentsViewMixin);
Object.assign(OeManagerApp.prototype, ChartsViewMixin);
```

### Template Functions
HTML is generated via Templates class:
```javascript
const row = Templates.agentRow(agent, isSelected, stateClass);
```

### API Wrapper
All REST calls go through AgentService:
```javascript
await this.agentService.fetchAgents(applicationName);
```

### Authentication
Basic Auth via Authorization header (password never stored):
```javascript
getHeaders() {
    const credentials = btoa(`${this.config.username}:${this.config.password}`);
    return { 'Authorization': `Basic ${credentials}` };
}
```

## PASOE API Reference

Base URL: `{server}/oemanager/applications/{app}/...`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/agents` | GET | List agents |
| `/agents/sessions` | GET | Agents with embedded sessions |
| `/agents/{id}/metrics` | GET | Agent metrics |
| `/agents/{id}/sessions` | DELETE | Terminate session |
| `/agents` | POST | Add agent |
| `/agents/{id}` | DELETE | Trim agent |
| `/metrics` | GET | Session manager metrics |

## Copilot Customizations

All customization files are under `.github/`:

### Agents (`.github/agents/`)
- **planner** - Feature planning and implementation design
- **code-reviewer** - JavaScript code quality review
- **api-reviewer** - PASOE API integration review
- **ui-reviewer** - UI/UX and accessibility review
- **tdd-guide** - Test-driven development guidance

### Skills (`.github/skills/`)
- **javascript-patterns** - Modern JS idioms, async/await, error handling
- **pasoe-api** - PASOE oemanager REST API specifics
- **webapp-patterns** - Static webapp patterns (no framework)
- **chart-patterns** - Chart.js visualization patterns
- **css-dark-theme** - VS Code inspired dark theme styling

### Instructions (`.github/instructions/`)
- **coding-style** - Naming, formatting, code style (auto-applied to JS/HTML/CSS)
- **security** - XSS prevention, auth, input validation (auto-applied to JS)
- **javascript-patterns** - Mixins, templates, error handling (auto-applied to JS)
- **git-workflow** - Conventional commits and branching (on-demand)

### Prompts (`.github/prompts/`)
- `/plan` - Plan feature implementation
- `/code-review` - Review code quality
- `/build` - Build WAR with Maven
- `/deploy` - Deploy to PASOE Tomcat
- `/tdd` - Write TDD test cases

## Memory Notes

- API responses have fields like `AgentStatHist`, `AgentSession`, `AgentThread`
- Session states: IDLE, BUSY, RESERVED
- Agent states: AVAILABLE, BUSY
- Thread states: IDLE, RUNNING, TERMINATED
- Memory values are in bytes, display in MiB
