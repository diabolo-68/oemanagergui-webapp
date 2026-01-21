package com.diabolo.oemanager.model;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.HashMap;
import java.util.Map;

/**
 * Represents an agent in the PASOE instance.
 * Uses dynamic properties to handle varying API responses.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class AgentInfo {
    
    private String agentId;
    private String pid;
    private String state;
    private int sessionCount;
    
    // Dynamic properties for additional fields from API
    private Map<String, Object> additionalProperties = new HashMap<>();
    
    public String getAgentId() {
        return agentId;
    }
    
    public void setAgentId(String agentId) {
        this.agentId = agentId;
    }
    
    public String getPid() {
        return pid;
    }
    
    public void setPid(String pid) {
        this.pid = pid;
    }
    
    public String getState() {
        return state;
    }
    
    public void setState(String state) {
        this.state = state;
    }
    
    public int getSessionCount() {
        return sessionCount;
    }
    
    public void setSessionCount(int sessionCount) {
        this.sessionCount = sessionCount;
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
