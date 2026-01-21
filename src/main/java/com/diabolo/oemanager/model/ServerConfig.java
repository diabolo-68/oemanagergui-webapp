package com.diabolo.oemanager.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Configuration for connecting to a PASOE server.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class ServerConfig {
    
    private String id;
    private String name;
    private String baseUrl;
    private String username;
    private String password;
    private boolean rejectUnauthorized;
    private int waitToFinish = 120000;
    private int waitAfterStop = 60000;
    
    public String getId() {
        return id;
    }
    
    public void setId(String id) {
        this.id = id;
    }
    
    public String getName() {
        return name;
    }
    
    public void setName(String name) {
        this.name = name;
    }
    
    public String getBaseUrl() {
        return baseUrl;
    }
    
    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }
    
    public String getUsername() {
        return username;
    }
    
    public void setUsername(String username) {
        this.username = username;
    }
    
    public String getPassword() {
        return password;
    }
    
    public void setPassword(String password) {
        this.password = password;
    }
    
    public boolean isRejectUnauthorized() {
        return rejectUnauthorized;
    }
    
    public void setRejectUnauthorized(boolean rejectUnauthorized) {
        this.rejectUnauthorized = rejectUnauthorized;
    }
    
    public int getWaitToFinish() {
        return waitToFinish;
    }
    
    public void setWaitToFinish(int waitToFinish) {
        this.waitToFinish = waitToFinish;
    }
    
    public int getWaitAfterStop() {
        return waitAfterStop;
    }
    
    public void setWaitAfterStop(int waitAfterStop) {
        this.waitAfterStop = waitAfterStop;
    }
}
