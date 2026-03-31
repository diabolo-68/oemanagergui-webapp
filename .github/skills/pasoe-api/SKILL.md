---
name: pasoe-api
description: "PASOE oemanager REST API reference and integration patterns. Use when working with API endpoints, response parsing, authentication, agent/session/thread operations, or AgentService methods."
---

# PASOE oemanager API

Complete reference for the PASOE oemanager REST API used by OE Manager GUI.

## Base URL

```
{protocol}://{server}:{port}/oemanager/applications/{applicationName}
```

## Authentication

HTTP Basic Authentication on every request:
```javascript
getHeaders() {
    const credentials = btoa(`${username}:${password}`);
    return {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    };
}
```

## Response Structure

All responses follow: `{ "operation": "...", "outcome": "SUCCESS", "result": { ... } }`

Always check `outcome === "SUCCESS"` before accessing `result`.

## Endpoints Reference

### List Applications
`GET /oemanager/applications` → `result.Application[]`

### List Agents
`GET /applications/{app}/agents` → `result.agents[]` (agentId, pid, state)

### Agents with Sessions
`GET /applications/{app}/agents/sessions` → `result.agents[].sessions[]`

### Agent Metrics
`GET /applications/{app}/agents/{id}/metrics` → `result.AgentStatHist[]`
Fields: ActiveThreads, ActiveSessions, OpenConnections, CStackMemory, OverheadMemory

### Agent Sessions
`GET /applications/{app}/agents/{id}/sessions` → `result.AgentSession[]`
Fields: SessionId, SessionState, SessionMemory, RequestsCompleted, RequestsFailed

### Agent Threads
`GET /applications/{app}/agents/{id}/threads` → `result.AgentThread[]`

### Agent Requests
`GET /applications/{app}/agents/{id}/requests` → `result.AgentRequest[]`

### Session Manager Metrics
`GET /applications/{app}/metrics` → flat result object
Fields: concurrentConnectedClients, maxConcurrentClients, requests, reads, writes

### Add Agent
`POST /applications/{app}/agents`

### Trim Agent
`DELETE /applications/{app}/agents/{id}?waitToFinish=120000&waitAfterStop=60000`

### Terminate Session
`DELETE /applications/{app}/agents/{id}/sessions/{sid}?terminateOpt=2`

### Reset Statistics
`DELETE /applications/{app}/agents/{id}/agentStatData`

### ABL Objects
`PUT /applications/{app}/agents/{id}/ABLObjects/status` (body: `{ "enable": true/false }`)
`GET /applications/{app}/agents/{id}/ABLObjects`

## State Values

| Type | States |
|------|--------|
| Agent | AVAILABLE, BUSY |
| Session | IDLE, BUSY, RESERVED |
| Thread | IDLE, RUNNING, TERMINATED |

## Date/Time

ISO 8601 with timezone: `2026-01-28T22:43:23.910-01:00`

Normalize `-00:00` → `Z` for browser compatibility.

## Memory Values

All in bytes. Convert: `const mib = bytes / (1024 * 1024);`
