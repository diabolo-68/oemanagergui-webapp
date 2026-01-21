# OE Manager GUI - Java Web Application

A web-based GUI for managing OpenEdge PASOE (Progress Application Server) agents and sessions. This is a Java-based clone of the oemanagergui VS Code extension, designed to be deployed as a WAR file on the same Tomcat server running PASOE.

## Features

- **Agent Management**: View, add, delete, and trim PASOE agents
- **Session Monitoring**: View active sessions per agent
- **Performance Charts**: Real-time memory and request metrics visualization
- **Multi-Application Support**: Manage multiple PASOE applications
- **Dark Theme UI**: Consistent with VS Code aesthetics

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (Web UI)                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  Agents Panel   │  │  Charts Panel   │  │   Metrics Panel     │  │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘  │
└───────────┼─────────────────────┼──────────────────────┼────────────┘
            │                     │                      │
            └─────────────────────┼──────────────────────┘
                                  │ REST API (JSON)
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    oemanagergui.war (Tomcat)                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                 Jersey REST Resources                        │   │
│  │  /api/agents/applications, /api/agents/{app}/{id}/sessions  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      AgentService                            │   │
│  │  Proxies requests to PASOE oemanager REST API                │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ HTTP/HTTPS
┌─────────────────────────────────────────────────────────────────────┐
│                      PASOE Server                                    │
│              /oemanager/applications/...                             │
└─────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Java JDK 11+** (for building)
- **Maven 3.6+** (for building)
- **Tomcat 10+** (Jakarta EE 10 - for deployment)
  - Or Tomcat 9.x with `jakarta.servlet-api` replaced by `javax.servlet-api`

## Quick Start

### Build

```bash
cd oemanagergui-java
mvn clean package
```

This produces `target/oemanagergui.war`.

### Deploy to Tomcat

1. Copy `target/oemanagergui.war` to `$CATALINA_HOME/webapps/`
2. Tomcat will auto-deploy the application
3. Access at: `http://localhost:8080/oemanagergui/`

### Development Mode

Run with embedded Jetty (port 8090):

```bash
mvn jetty:run
```

Access at: `http://localhost:8090/oemanagergui/`

## Project Structure

```
oemanagergui-java/
├── pom.xml                           # Maven configuration
├── src/
│   ├── main/
│   │   ├── java/com/diabolo/oemanager/
│   │   │   ├── OeManagerApplication.java    # JAX-RS application config
│   │   │   ├── model/                       # Data models
│   │   │   │   ├── AgentInfo.java
│   │   │   │   ├── SessionInfo.java
│   │   │   │   ├── ApplicationInfo.java
│   │   │   │   └── ServerConfig.java
│   │   │   ├── service/
│   │   │   │   └── AgentService.java        # PASOE API client
│   │   │   └── rest/
│   │   │       └── AgentResource.java       # REST endpoints
│   │   ├── resources/
│   │   │   └── logback.xml                  # Logging config
│   │   └── webapp/
│   │       ├── index.html                   # Main UI
│   │       ├── css/style.css                # Styles
│   │       └── js/app.js                    # JavaScript app
│   └── test/
│       └── java/                            # Unit tests
└── .github/
    └── copilot-instructions.md              # AI agent instructions
```

## REST API

All endpoints accept `ServerConfig` in the request body for authentication.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents/applications` | POST | List PASOE applications |
| `/api/agents/list/{app}` | POST | List agents for an application |
| `/api/agents/{app}/{agentId}/sessions` | POST | Get sessions for an agent |
| `/api/agents/{app}/metrics` | POST | Get session manager metrics |
| `/api/agents/{app}/{agentId}/metrics` | POST | Get agent-specific metrics |
| `/api/agents/{app}/add` | POST | Add a new agent |
| `/api/agents/{app}/{agentId}/delete` | POST | Delete an agent |
| `/api/agents/{app}/{agentId}/trim` | POST | Trim idle sessions |
| `/api/agents/{app}/{agentId}/resetStats` | POST | Reset agent statistics |

### Example Request

```bash
curl -X POST http://localhost:8080/oemanagergui/api/agents/applications \
  -H "Content-Type: application/json" \
  -d '{
    "baseUrl": "https://pasoe-server:8810",
    "username": "admin",
    "password": "secret",
    "rejectUnauthorized": false
  }'
```

## Configuration

The web UI stores server configuration in browser localStorage (except password). On each request, the full configuration including password is sent to the backend.

For production, consider:
- Implementing server-side session management
- Using environment variables for default configuration
- Adding CORS restrictions

## Differences from VS Code Extension

| Feature | VS Code Extension | Java Web App |
|---------|------------------|--------------|
| Configuration | VS Code settings + SecretStorage | Browser localStorage + per-request |
| Authentication | Stored securely in VS Code | Must be entered each session |
| Auto-refresh | Visibility-aware timers | JavaScript intervals |
| Deployment | `.vsix` file | `.war` file on Tomcat |
| Charts | Internal rendering | Chart.js library |

## Development

### Adding a New API Endpoint

1. Add method to `AgentService.java`
2. Add REST endpoint in `AgentResource.java`
3. Call from JavaScript in `app.js`

### Modifying the UI

- HTML structure: `src/main/webapp/index.html`
- Styles: `src/main/webapp/css/style.css` (uses VS Code-like CSS variables)
- JavaScript: `src/main/webapp/js/app.js`

## License

MIT License - see [LICENSE](LICENSE) file.

## Related Projects

- [oemanagergui](../oemanagergui) - VS Code extension version
