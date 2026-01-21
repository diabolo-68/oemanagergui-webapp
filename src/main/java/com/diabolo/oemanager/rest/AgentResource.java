package com.diabolo.oemanager.rest;

import com.diabolo.oemanager.model.AgentInfo;
import com.diabolo.oemanager.model.ApplicationInfo;
import com.diabolo.oemanager.model.ServerConfig;
import com.diabolo.oemanager.model.SessionInfo;
import com.diabolo.oemanager.service.AgentService;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;

/**
 * REST resource for agent management operations.
 * Acts as a proxy between the web UI and the PASOE oemanager API.
 */
@Path("/agents")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AgentResource {
    
    private static final Logger logger = LoggerFactory.getLogger(AgentResource.class);
    private final AgentService agentService = new AgentService();
    
    /**
     * Fetch all applications from PASOE.
     */
    @POST
    @Path("/applications")
    public Response getApplications(ServerConfig config) {
        try {
            List<ApplicationInfo> applications = agentService.fetchApplications(config);
            return Response.ok(applications).build();
        } catch (Exception e) {
            logger.error("Failed to fetch applications", e);
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(Map.of("error", e.getMessage()))
                    .build();
        }
    }
    
    /**
     * Fetch all agents for an application.
     */
    @POST
    @Path("/list/{applicationName}")
    public Response getAgents(@PathParam("applicationName") String applicationName, ServerConfig config) {
        try {
            List<AgentInfo> agents = agentService.fetchAgents(config, applicationName);
            return Response.ok(agents).build();
        } catch (Exception e) {
            logger.error("Failed to fetch agents", e);
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(Map.of("error", e.getMessage()))
                    .build();
        }
    }
    
    /**
     * Fetch sessions for a specific agent.
     */
    @POST
    @Path("/{applicationName}/{agentId}/sessions")
    public Response getSessions(
            @PathParam("applicationName") String applicationName,
            @PathParam("agentId") String agentId,
            ServerConfig config) {
        try {
            List<SessionInfo> sessions = agentService.fetchSessions(config, applicationName, agentId);
            return Response.ok(sessions).build();
        } catch (Exception e) {
            logger.error("Failed to fetch sessions", e);
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(Map.of("error", e.getMessage()))
                    .build();
        }
    }
    
    /**
     * Fetch session manager metrics.
     */
    @POST
    @Path("/{applicationName}/metrics")
    public Response getMetrics(
            @PathParam("applicationName") String applicationName,
            ServerConfig config) {
        try {
            Map<String, Object> metrics = agentService.fetchMetrics(config, applicationName);
            return Response.ok(metrics).build();
        } catch (Exception e) {
            logger.error("Failed to fetch metrics", e);
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(Map.of("error", e.getMessage()))
                    .build();
        }
    }
    
    /**
     * Fetch agent-specific metrics.
     */
    @POST
    @Path("/{applicationName}/{agentId}/metrics")
    public Response getAgentMetrics(
            @PathParam("applicationName") String applicationName,
            @PathParam("agentId") String agentId,
            ServerConfig config) {
        try {
            Map<String, Object> metrics = agentService.fetchAgentMetrics(config, applicationName, agentId);
            return Response.ok(metrics).build();
        } catch (Exception e) {
            logger.error("Failed to fetch agent metrics", e);
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(Map.of("error", e.getMessage()))
                    .build();
        }
    }
    
    /**
     * Add a new agent.
     */
    @POST
    @Path("/{applicationName}/add")
    public Response addAgent(
            @PathParam("applicationName") String applicationName,
            ServerConfig config) {
        try {
            Map<String, Object> result = agentService.addAgent(config, applicationName);
            return Response.ok(result).build();
        } catch (Exception e) {
            logger.error("Failed to add agent", e);
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(Map.of("error", e.getMessage()))
                    .build();
        }
    }
    
    /**
     * Delete an agent.
     */
    @POST
    @Path("/{applicationName}/{agentId}/delete")
    public Response deleteAgent(
            @PathParam("applicationName") String applicationName,
            @PathParam("agentId") String agentId,
            ServerConfig config) {
        try {
            Map<String, Object> result = agentService.deleteAgent(
                    config, applicationName, agentId,
                    config.getWaitToFinish(), config.getWaitAfterStop()
            );
            return Response.ok(result).build();
        } catch (Exception e) {
            logger.error("Failed to delete agent", e);
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(Map.of("error", e.getMessage()))
                    .build();
        }
    }
    
    /**
     * Trim an agent (close idle sessions).
     */
    @POST
    @Path("/{applicationName}/{agentId}/trim")
    public Response trimAgent(
            @PathParam("applicationName") String applicationName,
            @PathParam("agentId") String agentId,
            ServerConfig config) {
        try {
            Map<String, Object> result = agentService.trimAgent(config, applicationName, agentId);
            return Response.ok(result).build();
        } catch (Exception e) {
            logger.error("Failed to trim agent", e);
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(Map.of("error", e.getMessage()))
                    .build();
        }
    }
    
    /**
     * Reset agent statistics.
     */
    @POST
    @Path("/{applicationName}/{agentId}/resetStats")
    public Response resetAgentStats(
            @PathParam("applicationName") String applicationName,
            @PathParam("agentId") String agentId,
            ServerConfig config) {
        try {
            Map<String, Object> result = agentService.resetAgentStatData(config, applicationName, agentId);
            return Response.ok(result).build();
        } catch (Exception e) {
            logger.error("Failed to reset agent stats", e);
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(Map.of("error", e.getMessage()))
                    .build();
        }
    }
}
