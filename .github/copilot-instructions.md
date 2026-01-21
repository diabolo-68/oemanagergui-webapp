# OE Manager GUI - Java Web Application

## Project Overview

Java-based web application for managing OpenEdge PASOE agents and sessions. Deployed as a WAR file on Tomcat alongside PASOE. This is a port of the VS Code extension `oemanagergui` to a standalone web application.

## Architecture

```
Browser (HTML/CSS/JS) → REST API (Jersey/JAX-RS) → AgentService → PASOE oemanager API
```

### Key Components
| Component | Location | Purpose |
|-----------|----------|---------|
| `OeManagerApplication.java` | `src/main/java/.../` | JAX-RS application config, registers REST resources |
| `AgentResource.java` | `src/.../rest/` | REST endpoints - proxies to PASOE API |
| `AgentService.java` | `src/.../service/` | HTTP client for PASOE oemanager REST API |
| `model/` | `src/.../model/` | POJOs: AgentInfo, SessionInfo, ApplicationInfo, ServerConfig |
| `index.html` | `src/main/webapp/` | Single-page application entry point |
| `app.js` | `src/main/webapp/js/` | JavaScript application logic |

### Data Flow
1. User configures server connection in browser
2. JavaScript sends POST to `/api/agents/*` with `ServerConfig` in body
3. `AgentResource` receives request, passes to `AgentService`
4. `AgentService` makes HTTP request to PASOE `oemanager` API
5. Response JSON proxied back to browser
6. JavaScript updates UI

## Development Workflow

```powershell
# Build WAR file
mvn clean package

# Run in development mode with Jetty (port 8090)
mvn jetty:run

# Deploy to Tomcat
Copy-Item target/oemanagergui.war $env:CATALINA_HOME/webapps/
```

## Code Patterns

### REST Resource Pattern
All endpoints use POST with `ServerConfig` in request body for stateless authentication:
```java
@POST
@Path("/list/{applicationName}")
public Response getAgents(@PathParam("applicationName") String appName, ServerConfig config) {
    List<AgentInfo> agents = agentService.fetchAgents(config, appName);
    return Response.ok(agents).build();
}
```

### HTTP Client Pattern
`AgentService` creates clients that optionally trust self-signed certificates:
```java
private CloseableHttpClient createHttpClient(boolean rejectUnauthorized) {
    if (rejectUnauthorized) {
        return HttpClients.createDefault();
    }
    // Trust all certificates for internal PASOE servers
    SSLContext sslContext = SSLContextBuilder.create()
            .loadTrustMaterial((chain, authType) -> true)
            .build();
    // ... configure with NoopHostnameVerifier
}
```

### JavaScript Communication
Frontend uses Fetch API with JSON payloads:
```javascript
const response = await fetch(`/oemanagergui/api/agents/list/${appName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(this.config)
});
const agents = await response.json();
```

## File Organization

```
src/main/
├── java/com/diabolo/oemanager/
│   ├── OeManagerApplication.java   # @ApplicationPath("/api")
│   ├── model/
│   │   ├── AgentInfo.java          # @JsonAnyGetter for dynamic props
│   │   ├── SessionInfo.java
│   │   ├── ApplicationInfo.java
│   │   └── ServerConfig.java       # Connection config (URL, auth)
│   ├── service/
│   │   └── AgentService.java       # All PASOE API calls
│   └── rest/
│       └── AgentResource.java      # All REST endpoints
├── resources/
│   └── logback.xml                 # Logging to catalina.base/logs
└── webapp/
    ├── index.html                  # SPA with nav sidebar
    ├── css/style.css               # Dark theme, VS Code variables
    └── js/app.js                   # OeManagerApp class
```

## PASOE API Endpoints Used

All endpoints follow pattern: `{baseUrl}/oemanager/applications/{app}/...`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/oemanager/applications` | GET | List applications |
| `/applications/{app}/agents` | GET | List agents |
| `/applications/{app}/agents/{id}/sessions` | GET | Agent sessions |
| `/applications/{app}/metrics` | GET | Session manager metrics |
| `/applications/{app}/agents/{id}/metrics` | GET | Agent metrics |
| `/applications/{app}/agents` | POST | Add agent |
| `/applications/{app}/agents/{id}` | DELETE | Delete agent |
| `/applications/{app}/agents/{id}/trimSessions` | PUT | Trim idle sessions |

## Key Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| Jakarta Servlet API | 6.0.0 | Servlet container interface (provided) |
| Jersey | 3.1.3 | JAX-RS implementation |
| Jackson | 2.15.3 | JSON serialization |
| Apache HttpClient5 | 5.2.1 | HTTP client for PASOE API |
| Logback | 1.4.11 | Logging |
| Chart.js | 4.4.1 | Browser charts (CDN) |

## Important Conventions

- **Stateless authentication**: Every API call includes credentials in request body
- **SSL flexibility**: `rejectUnauthorized: false` for self-signed certs
- **Dynamic properties**: Use `@JsonAnyGetter/@JsonAnySetter` for variable API responses
- **Error handling**: Return 500 with `{"error": "message"}` JSON on failures
- **Logging**: Use SLF4J, logs to `catalina.base/logs/oemanagergui.log`
- **Context path**: Deploy as `/oemanagergui` to match API paths in JavaScript

## Debugging

- **Server logs**: `$CATALINA_HOME/logs/oemanagergui.log`
- **Browser DevTools**: Network tab for API calls, Console for JS errors
- **Jetty dev mode**: `mvn jetty:run -X` for debug output
