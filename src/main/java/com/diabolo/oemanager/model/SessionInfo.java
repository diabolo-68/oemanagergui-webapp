package com.diabolo.oemanager.model;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.HashMap;
import java.util.Map;

/**
 * Represents a session within an agent.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class SessionInfo {
    
    private String sessionId;
    private String sessionState;
    private String agentId;
    private long requestCount;
    
    // Dynamic properties for additional fields from API
    private Map<String, Object> additionalProperties = new HashMap<>();
    
    public String getSessionId() {
        return sessionId;
    }
    
    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }
    
    public String getSessionState() {
        return sessionState;
    }
    
    public void setSessionState(String sessionState) {
        this.sessionState = sessionState;
    }
    
    public String getAgentId() {
        return agentId;
    }
    
    public void setAgentId(String agentId) {
        this.agentId = agentId;
    }
    
    public long getRequestCount() {
        return requestCount;
    }
    
    public void setRequestCount(long requestCount) {
        this.requestCount = requestCount;
    }
    
    @JsonAnyGetter
    public Map<String, Object> getAdditionalProperties() {
        return additionalProperties;
    }
    
    @JsonAnySetter
    public void setAdditionalProperty(String name, Object value) {
        this.additionalProperties.put(name, value);
    }
}
