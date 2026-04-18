package com.oemanager.webapp;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.io.Writer;
import java.nio.charset.StandardCharsets;

/**
 * Generic file reader servlet restricted to the PASOE instance directory.
 *
 * <p>Endpoints:
 * <ul>
 *   <li>{@code GET /api/read-file?info=true} — returns JSON with auto-detected catalinaBase</li>
 *   <li>{@code GET /api/read-file?path=<relative>&offset=<bytes>} — returns file content as text/plain
 *       with headers {@code X-New-Offset} and {@code X-Total-Size}</li>
 *   <li>{@code GET /api/read-file?list=<relative>} — returns directory listing as JSON array of filenames</li>
 * </ul>
 *
 * <p>The base path defaults to {@code System.getProperty("catalina.base")}.
 * An optional {@code X-Pasoe-Path} request header overrides this.
 *
 * <p>Security: resolved canonical path must be within the base path (prevents directory traversal).
 */
public class FileReaderServlet extends HttpServlet {

    private static final long MAX_READ_BYTES = 2 * 1024 * 1024; // 2 MB

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        // CORS not needed — same Tomcat instance

        // --- Info endpoint ---
        String infoParam = req.getParameter("info");
        if ("true".equalsIgnoreCase(infoParam)) {
            String catalinaBase = System.getProperty("catalina.base", "");
            resp.setContentType("application/json");
            resp.setCharacterEncoding("UTF-8");
            // Manually build tiny JSON to avoid adding a Gson/Jackson dependency
            Writer w = resp.getWriter();
            w.write("{\"catalinaBase\":");
            w.write(jsonString(catalinaBase));
            w.write("}");
            return;
        }

        // --- Resolve base path ---
        String basePath = resolvePasoePath(req);
        if (basePath == null || basePath.isEmpty()) {
            resp.sendError(HttpServletResponse.SC_INTERNAL_SERVER_ERROR,
                    "Cannot determine PASOE path. catalina.base is not set and no X-Pasoe-Path header provided.");
            return;
        }

        File baseDir = new File(basePath).getCanonicalFile();
        if (!baseDir.isDirectory()) {
            resp.sendError(HttpServletResponse.SC_INTERNAL_SERVER_ERROR,
                    "PASOE base path is not a directory: " + baseDir.getPath());
            return;
        }

        // --- Directory listing endpoint ---
        String listParam = req.getParameter("list");
        if (listParam != null) {
            handleDirectoryListing(baseDir, listParam, resp);
            return;
        }

        // --- File read endpoint ---
        String relativePath = req.getParameter("path");
        if (relativePath == null || relativePath.isEmpty()) {
            resp.sendError(HttpServletResponse.SC_BAD_REQUEST, "Missing 'path' parameter.");
            return;
        }

        // Resolve and validate the target file
        File targetFile = new File(baseDir, relativePath).getCanonicalFile();

        // Security: ensure the resolved path is within the base directory
        if (!targetFile.getPath().startsWith(baseDir.getPath() + File.separator)
                && !targetFile.getPath().equals(baseDir.getPath())) {
            resp.sendError(HttpServletResponse.SC_FORBIDDEN, "Access denied: path outside PASOE directory.");
            return;
        }

        if (!targetFile.isFile()) {
            resp.sendError(HttpServletResponse.SC_NOT_FOUND, "File not found: " + relativePath);
            return;
        }

        // Parse offset parameter
        long offset = 0;
        String offsetParam = req.getParameter("offset");
        if (offsetParam != null) {
            try {
                offset = Long.parseLong(offsetParam);
            } catch (NumberFormatException e) {
                resp.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid 'offset' parameter.");
                return;
            }
            if (offset < 0) {
                offset = 0;
            }
        }

        long fileSize = targetFile.length();

        // If offset is beyond file size, return empty with current offset
        if (offset >= fileSize) {
            resp.setContentType("text/plain");
            resp.setCharacterEncoding("UTF-8");
            resp.setHeader("X-New-Offset", String.valueOf(fileSize));
            resp.setHeader("X-Total-Size", String.valueOf(fileSize));
            resp.getWriter().write("");
            return;
        }

        // Read up to MAX_READ_BYTES from offset
        long bytesToRead = Math.min(fileSize - offset, MAX_READ_BYTES);

        byte[] buffer = new byte[(int) bytesToRead];
        try (RandomAccessFile raf = new RandomAccessFile(targetFile, "r")) {
            raf.seek(offset);
            int bytesRead = raf.read(buffer);
            if (bytesRead < 0) {
                bytesRead = 0;
            }

            long newOffset = offset + bytesRead;

            resp.setContentType("text/plain");
            resp.setCharacterEncoding("UTF-8");
            resp.setHeader("X-New-Offset", String.valueOf(newOffset));
            resp.setHeader("X-Total-Size", String.valueOf(fileSize));
            resp.getWriter().write(new String(buffer, 0, bytesRead, StandardCharsets.UTF_8));
        }
    }

    /**
     * List files in a directory (non-recursive).
     */
    private void handleDirectoryListing(File baseDir, String relativePath, HttpServletResponse resp) throws IOException {
        File targetDir = new File(baseDir, relativePath).getCanonicalFile();

        // Security: ensure within base
        if (!targetDir.getPath().startsWith(baseDir.getPath() + File.separator)
                && !targetDir.getPath().equals(baseDir.getPath())) {
            resp.sendError(HttpServletResponse.SC_FORBIDDEN, "Access denied: path outside PASOE directory.");
            return;
        }

        if (!targetDir.isDirectory()) {
            resp.sendError(HttpServletResponse.SC_NOT_FOUND, "Directory not found: " + relativePath);
            return;
        }

        String[] files = targetDir.list();
        if (files == null) {
            files = new String[0];
        }

        resp.setContentType("application/json");
        resp.setCharacterEncoding("UTF-8");

        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < files.length; i++) {
            if (i > 0) {
                sb.append(",");
            }
            sb.append(jsonString(files[i]));
        }
        sb.append("]");
        resp.getWriter().write(sb.toString());
    }

    /**
     * Resolve the PASOE base path from header override or catalina.base system property.
     */
    private String resolvePasoePath(HttpServletRequest req) {
        String headerOverride = req.getHeader("X-Pasoe-Path");
        if (headerOverride != null && !headerOverride.trim().isEmpty()) {
            return headerOverride.trim();
        }
        return System.getProperty("catalina.base", "");
    }

    /**
     * Produce a JSON-safe quoted string (escapes backslash, quote, control chars).
     */
    private static String jsonString(String value) {
        if (value == null) {
            return "null";
        }
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append("\"");
        return sb.toString();
    }
}
