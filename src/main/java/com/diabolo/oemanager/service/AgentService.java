package com.diabolo.oemanager.service;

import com.diabolo.oemanager.model.AgentInfo;
import com.diabolo.oemanager.model.ApplicationInfo;
import com.diabolo.oemanager.model.ServerConfig;
import com.diabolo.oemanager.model.SessionInfo;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.hc.client5.http.classic.methods.*;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.client5.http.ssl.NoopHostnameVerifier;
import org.apache.hc.client5.http.ssl.SSLConnectionSocketFactoryBuilder;
import org.apache.hc.core5.http.io.entity.EntityUtils;
import org.apache.hc.core5.http.io.entity.StringEntity;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.ssl.SSLContextBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.net.ssl.SSLContext;
import java.util.*;

/**
 * Service for interacting with the PASOE oemanager REST API.
 * Mirrors the functionality of agentService.ts from the VS Code extension.
 */
public class AgentService {
    
    private static final Logger logger = LoggerFactory.getLogger(AgentService.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    
    /**
     * Create an HTTP client that can handle self-signed certificates.
     */
    private CloseableHttpClient createHttpClient(boolean rejectUnauthorized) throws Exception {
        if (rejectUnauthorized) {
            return HttpClients.createDefault();
        }
        
        // Trust all certificates for development/internal PASOE servers
        SSLContext sslContext = SSLContextBuilder.create()
                .loadTrustMaterial((chain, authType) -> true)
                .build();
        
        return HttpClients.custom()
                .setConnectionManager(PoolingHttpClientConnectionManagerBuilder.create()
                        .setSSLSocketFactory(SSLConnectionSocketFactoryBuilder.create()
                                .setSslContext(sslContext)
                                .setHostnameVerifier(NoopHostnameVerifier.INSTANCE)
                                .build())
                        .build())
                .build();
    }
    
    /**
     * Get the Basic Auth header value.
     */
    private String getAuthHeader(ServerConfig config) {
        String credentials = config.getUsername() + ":" + config.getPassword();
        return "Basic " + Base64.getEncoder().encodeToString(credentials.getBytes());
    }
    
    /**
     * Fetch all applications from the PASOE server.
     */
    public List<ApplicationInfo> fetchApplications(ServerConfig config) throws Exception {
        String url = config.getBaseUrl() + "/oemanager/applications";
        logger.info("Fetching applications from: {}", url);
        
        try (CloseableHttpClient client = createHttpClient(config.isRejectUnauthorized())) {
            HttpGet request = new HttpGet(url);
            request.setHeader("Authorization", getAuthHeader(config));
            request.setHeader("Accept", "application/json");
            
            return client.execute(request, response -> {
                int status = response.getCode();
                String body = EntityUtils.toString(response.getEntity());
                
                if (status >= 200 && status < 300) {
                    JsonNode jsonData = objectMapper.readTree(body);
                    List<ApplicationInfo> applications = new ArrayList<>();
                    
                    JsonNode appArray = jsonData.path("result").path("Application");
                    if (appArray.isArray()) {
                        for (JsonNode appNode : appArray) {
                            ApplicationInfo app = new ApplicationInfo(
                                    appNode.path("name").asText(),
                                    appNode.path("version").asText(null),
                                    appNode.path("description").asText(null)
                            );
                            applications.add(app);
                        }
                    }
                    
                    logger.info("Found {} applications", applications.size());
                    return applications;
                } else {
                    throw new RuntimeException("HTTP error " + status + ": " + body);
                }
            });
        }
    }
    
    /**
     * Fetch all agents for an application.
     */
    public List<AgentInfo> fetchAgents(ServerConfig config, String applicationName) throws Exception {
        String url = config.getBaseUrl() + "/oemanager/applications/" + applicationName + "/agents";
        logger.info("Fetching agents from: {}", url);
        
        try (CloseableHttpClient client = createHttpClient(config.isRejectUnauthorized())) {
            HttpGet request = new HttpGet(url);
            request.setHeader("Authorization", getAuthHeader(config));
            request.setHeader("Accept", "application/json");
            
            return client.execute(request, response -> {
                int status = response.getCode();
                String body = EntityUtils.toString(response.getEntity());
                
                if (status >= 200 && status < 300) {
                    JsonNode jsonData = objectMapper.readTree(body);
                    List<AgentInfo> agents = new ArrayList<>();
                    
                    JsonNode agentArray = jsonData.path("result").path("agents");
                    if (agentArray.isArray()) {
                        for (JsonNode agentNode : agentArray) {
                            AgentInfo agent = objectMapper.treeToValue(agentNode, AgentInfo.class);
                            agents.add(agent);
                        }
                    }
                    
                    logger.info("Found {} agents", agents.size());
                    return agents;
                } else {
                    throw new RuntimeException("HTTP error " + status + ": " + body);
                }
            });
        }
    }
    
    /**
     * Fetch sessions for a specific agent.
     */
    public List<SessionInfo> fetchSessions(ServerConfig config, String applicationName, String agentId) throws Exception {
        String url = config.getBaseUrl() + "/oemanager/applications/" + applicationName + "/agents/" + agentId + "/sessions";
        logger.info("Fetching sessions from: {}", url);
        
        try (CloseableHttpClient client = createHttpClient(config.isRejectUnauthorized())) {
            HttpGet request = new HttpGet(url);
            request.setHeader("Authorization", getAuthHeader(config));
            request.setHeader("Accept", "application/json");
            
            return client.execute(request, response -> {
                int status = response.getCode();
                String body = EntityUtils.toString(response.getEntity());
                
                if (status >= 200 && status < 300) {
                    JsonNode jsonData = objectMapper.readTree(body);
                    List<SessionInfo> sessions = new ArrayList<>();
                    
                    JsonNode sessionArray = jsonData.path("result").path("AgentSession");
                    if (sessionArray.isArray()) {
                        for (JsonNode sessionNode : sessionArray) {
                            SessionInfo session = objectMapper.treeToValue(sessionNode, SessionInfo.class);
                            sessions.add(session);
                        }
                    }
                    
                    return sessions;
                } else {
                    throw new RuntimeException("HTTP error " + status + ": " + body);
                }
            });
        }
    }
    
    /**
     * Fetch metrics for the session manager.
     */
    public Map<String, Object> fetchMetrics(ServerConfig config, String applicationName) throws Exception {
        String url = config.getBaseUrl() + "/oemanager/applications/" + applicationName + "/metrics";
        logger.info("Fetching metrics from: {}", url);
        
        try (CloseableHttpClient client = createHttpClient(config.isRejectUnauthorized())) {
            HttpGet request = new HttpGet(url);
            request.setHeader("Authorization", getAuthHeader(config));
            request.setHeader("Accept", "application/json");
            
            return client.execute(request, response -> {
                int status = response.getCode();
                String body = EntityUtils.toString(response.getEntity());
                
                if (status >= 200 && status < 300) {
                    JsonNode jsonData = objectMapper.readTree(body);
                    return objectMapper.convertValue(jsonData.path("result"), Map.class);
                } else {
                    throw new RuntimeException("HTTP error " + status + ": " + body);
                }
            });
        }
    }
    
    /**
     * Fetch agent-specific metrics.
     */
    public Map<String, Object> fetchAgentMetrics(ServerConfig config, String applicationName, String agentId) throws Exception {
        String url = config.getBaseUrl() + "/oemanager/applications/" + applicationName + "/agents/" + agentId + "/metrics";
        
        try (CloseableHttpClient client = createHttpClient(config.isRejectUnauthorized())) {
            HttpGet request = new HttpGet(url);
            request.setHeader("Authorization", getAuthHeader(config));
            request.setHeader("Accept", "application/json");
            
            return client.execute(request, response -> {
                int status = response.getCode();
                String body = EntityUtils.toString(response.getEntity());
                
                if (status >= 200 && status < 300) {
                    JsonNode jsonData = objectMapper.readTree(body);
                    return objectMapper.convertValue(jsonData.path("result"), Map.class);
                } else {
                    throw new RuntimeException("HTTP error " + status + ": " + body);
                }
            });
        }
    }
    
    /**
     * Add a new agent.
     */
    public Map<String, Object> addAgent(ServerConfig config, String applicationName) throws Exception {
        String url = config.getBaseUrl() + "/oemanager/applications/" + applicationName + "/agents";
        logger.info("Adding agent at: {}", url);
        
        try (CloseableHttpClient client = createHttpClient(config.isRejectUnauthorized())) {
            HttpPost request = new HttpPost(url);
            request.setHeader("Authorization", getAuthHeader(config));
            request.setHeader("Accept", "application/json");
            request.setHeader("Content-Type", "application/json");
            
            return client.execute(request, response -> {
                int status = response.getCode();
                String body = EntityUtils.toString(response.getEntity());
                
                if (status >= 200 && status < 300) {
                    JsonNode jsonData = objectMapper.readTree(body);
                    return objectMapper.convertValue(jsonData, Map.class);
                } else {
                    throw new RuntimeException("HTTP error " + status + ": " + body);
                }
            });
        }
    }
    
    /**
     * Delete an agent.
     */
    public Map<String, Object> deleteAgent(ServerConfig config, String applicationName, String agentId, 
                                           int waitToFinish, int waitAfterStop) throws Exception {
        String url = String.format("%s/oemanager/applications/%s/agents/%s?waitToFinish=%d&waitAfterStop=%d",
                config.getBaseUrl(), applicationName, agentId, waitToFinish, waitAfterStop);
        logger.info("Deleting agent at: {}", url);
        
        try (CloseableHttpClient client = createHttpClient(config.isRejectUnauthorized())) {
            HttpDelete request = new HttpDelete(url);
            request.setHeader("Authorization", getAuthHeader(config));
            request.setHeader("Accept", "application/json");
            
            return client.execute(request, response -> {
                int status = response.getCode();
                String body = EntityUtils.toString(response.getEntity());
                
                if (status >= 200 && status < 300) {
                    JsonNode jsonData = objectMapper.readTree(body);
                    return objectMapper.convertValue(jsonData, Map.class);
                } else {
                    throw new RuntimeException("HTTP error " + status + ": " + body);
                }
            });
        }
    }
    
    /**
     * Trim an agent (close idle sessions).
     */
    public Map<String, Object> trimAgent(ServerConfig config, String applicationName, String agentId) throws Exception {
        String url = config.getBaseUrl() + "/oemanager/applications/" + applicationName + "/agents/" + agentId + "/trimSessions";
        logger.info("Trimming agent at: {}", url);
        
        try (CloseableHttpClient client = createHttpClient(config.isRejectUnauthorized())) {
            HttpPut request = new HttpPut(url);
            request.setHeader("Authorization", getAuthHeader(config));
            request.setHeader("Accept", "application/json");
            
            return client.execute(request, response -> {
                int status = response.getCode();
                String body = EntityUtils.toString(response.getEntity());
                
                if (status >= 200 && status < 300) {
                    JsonNode jsonData = objectMapper.readTree(body);
                    return objectMapper.convertValue(jsonData, Map.class);
                } else {
                    throw new RuntimeException("HTTP error " + status + ": " + body);
                }
            });
        }
    }
    
    /**
     * Reset agent statistics.
     */
    public Map<String, Object> resetAgentStatData(ServerConfig config, String applicationName, String agentId) throws Exception {
        String url = config.getBaseUrl() + "/oemanager/applications/" + applicationName + "/agents/" + agentId + "/agentStatData";
        
        try (CloseableHttpClient client = createHttpClient(config.isRejectUnauthorized())) {
            HttpDelete request = new HttpDelete(url);
            request.setHeader("Authorization", getAuthHeader(config));
            request.setHeader("Accept", "application/json");
            
            return client.execute(request, response -> {
                int status = response.getCode();
                String body = EntityUtils.toString(response.getEntity());
                
                if (status >= 200 && status < 300) {
                    JsonNode jsonData = objectMapper.readTree(body);
                    return objectMapper.convertValue(jsonData, Map.class);
                } else {
                    throw new RuntimeException("HTTP error " + status + ": " + body);
                }
            });
        }
    }
}
