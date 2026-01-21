package com.diabolo.oemanager;

import jakarta.ws.rs.ApplicationPath;
import org.glassfish.jersey.server.ResourceConfig;

/**
 * JAX-RS Application configuration.
 * Maps all REST endpoints under /api/*
 */
@ApplicationPath("/api")
public class OeManagerApplication extends ResourceConfig {
    
    public OeManagerApplication() {
        // Register all REST resource classes
        packages("com.diabolo.oemanager.rest");
        
        // Register Jackson JSON provider
        register(org.glassfish.jersey.jackson.JacksonFeature.class);
    }
}
