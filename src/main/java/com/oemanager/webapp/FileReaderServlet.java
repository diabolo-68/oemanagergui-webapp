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
 *   <li>{@code GET /api/read-file?path=<relative>&direction=backward|forward&offset=<bytes>&maxBytes=<bytes>}
 *       — returns a bounded complete-line range with start/end and availability headers</li>
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
    private static final int NEWLINE_BYTE = '\n';

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

        String direction = req.getParameter("direction");
        if (direction == null || direction.isEmpty()) {
            handleLegacyFileRead(targetFile, req, resp);
            return;
        }

        if (!"forward".equals(direction) && !"backward".equals(direction)) {
            resp.sendError(HttpServletResponse.SC_BAD_REQUEST,
                    "Invalid 'direction' parameter. Expected 'forward' or 'backward'.");
            return;
        }

        Long offset = parseOptionalLong(req, resp, "offset");
        if (resp.isCommitted()) {
            return;
        }
        Long requestedBytes = parseOptionalLong(req, resp, "maxBytes");
        if (resp.isCommitted()) {
            return;
        }

        long maxBytes = requestedBytes == null ? MAX_READ_BYTES : requestedBytes;
        if (maxBytes <= 0) {
            resp.sendError(HttpServletResponse.SC_BAD_REQUEST, "'maxBytes' must be greater than zero.");
            return;
        }
        maxBytes = Math.min(maxBytes, MAX_READ_BYTES);

        handleRangeRead(targetFile, direction, offset, maxBytes, resp);
    }

    private void handleLegacyFileRead(File targetFile, HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        Long parsedOffset = parseOptionalLong(req, resp, "offset");
        if (resp.isCommitted()) {
            return;
        }
        long offset = parsedOffset == null ? 0 : Math.max(0, parsedOffset);
        long fileSize = targetFile.length();

        if (offset >= fileSize) {
            writeFileResponse(resp, new byte[0], 0, fileSize, fileSize, fileSize, false);
            return;
        }

        int bytesToRead = (int) Math.min(fileSize - offset, MAX_READ_BYTES);
        byte[] buffer = new byte[bytesToRead];
        int bytesRead;
        try (RandomAccessFile raf = new RandomAccessFile(targetFile, "r")) {
            raf.seek(offset);
            bytesRead = raf.read(buffer);
        }
        if (bytesRead < 0) {
            bytesRead = 0;
        }
        writeFileResponse(resp, buffer, bytesRead, offset, offset + bytesRead, fileSize, false);
    }

    private void handleRangeRead(File targetFile, String direction, Long requestedOffset, long maxBytes,
            HttpServletResponse resp) throws IOException {
        long fileSize = targetFile.length();
        boolean truncated = requestedOffset != null && requestedOffset > fileSize;
        long anchor = requestedOffset == null
                ? ("backward".equals(direction) ? fileSize : 0)
                : Math.max(0, Math.min(requestedOffset, fileSize));

        if (fileSize == 0 || truncated) {
            writeFileResponse(resp, new byte[0], 0, fileSize, fileSize, fileSize, truncated);
            return;
        }

        try (RandomAccessFile raf = new RandomAccessFile(targetFile, "r")) {
            if ("backward".equals(direction)) {
                readBackwardRange(raf, anchor, fileSize, maxBytes, resp);
            } else {
                readForwardRange(raf, anchor, fileSize, maxBytes, resp);
            }
        }
    }

    private void readBackwardRange(RandomAccessFile raf, long anchor, long fileSize, long maxBytes,
            HttpServletResponse resp) throws IOException {
        long requestedStart = Math.max(0, anchor - maxBytes);
        int length = (int) (anchor - requestedStart);
        byte[] buffer = new byte[length];
        raf.seek(requestedStart);
        int bytesRead = raf.read(buffer);
        if (bytesRead < 0) {
            bytesRead = 0;
        }

        int contentStart = 0;
        if (requestedStart > 0) {
            contentStart = indexAfterFirstNewline(buffer, bytesRead);
        }
        int contentEnd = lastCompleteLineEnd(buffer, contentStart, bytesRead);
        long startOffset = requestedStart + contentStart;
        long endOffset = requestedStart + contentEnd;
        int contentLength = Math.max(0, contentEnd - contentStart);
        byte[] content = copyRange(buffer, contentStart, contentLength);
        writeFileResponse(resp, content, contentLength, startOffset, endOffset, fileSize, false);
    }

    private void readForwardRange(RandomAccessFile raf, long anchor, long fileSize, long maxBytes,
            HttpServletResponse resp) throws IOException {
        if (anchor >= fileSize) {
            writeFileResponse(resp, new byte[0], 0, anchor, anchor, fileSize, false);
            return;
        }

        int length = (int) Math.min(fileSize - anchor, maxBytes);
        byte[] buffer = new byte[length];
        raf.seek(anchor);
        int bytesRead = raf.read(buffer);
        if (bytesRead < 0) {
            bytesRead = 0;
        }

        int contentEnd = lastCompleteLineEnd(buffer, 0, bytesRead);
        long endOffset = anchor + contentEnd;
        byte[] content = copyRange(buffer, 0, contentEnd);
        writeFileResponse(resp, content, contentEnd, anchor, endOffset, fileSize, false);
    }

    private int indexAfterFirstNewline(byte[] buffer, int length) {
        for (int i = 0; i < length; i++) {
            if (buffer[i] == NEWLINE_BYTE) {
                return i + 1;
            }
        }
        return length;
    }

    private int lastCompleteLineEnd(byte[] buffer, int start, int length) {
        for (int i = length - 1; i >= start; i--) {
            if (buffer[i] == NEWLINE_BYTE) {
                return i + 1;
            }
        }
        return start;
    }

    private byte[] copyRange(byte[] buffer, int start, int length) {
        byte[] content = new byte[length];
        if (length > 0) {
            System.arraycopy(buffer, start, content, 0, length);
        }
        return content;
    }

    private Long parseOptionalLong(HttpServletRequest req, HttpServletResponse resp, String parameter)
            throws IOException {
        String value = req.getParameter(parameter);
        if (value == null || value.isEmpty()) {
            return null;
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            resp.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid '" + parameter + "' parameter.");
            return null;
        }
    }

    private void writeFileResponse(HttpServletResponse resp, byte[] buffer, int length, long startOffset,
            long endOffset, long fileSize, boolean truncated) throws IOException {
        resp.setContentType("text/plain");
        resp.setCharacterEncoding("UTF-8");
        resp.setHeader("X-Start-Offset", String.valueOf(startOffset));
        resp.setHeader("X-New-Offset", String.valueOf(endOffset));
        resp.setHeader("X-Total-Size", String.valueOf(fileSize));
        resp.setHeader("X-Has-Older", String.valueOf(startOffset > 0));
        resp.setHeader("X-Has-Newer", String.valueOf(endOffset < fileSize));
        resp.setHeader("X-File-Truncated", String.valueOf(truncated));
        resp.getWriter().write(new String(buffer, 0, length, StandardCharsets.UTF_8));
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
