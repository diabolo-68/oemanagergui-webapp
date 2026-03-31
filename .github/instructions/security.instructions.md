---
description: "Use when handling user input, authentication, API calls, or security-sensitive code. Covers XSS prevention, credential handling, and input validation for OE Manager GUI."
applyTo: "**/*.js"
---

# Security Guidelines

## Authentication

- Never store passwords in localStorage or cookies
- Use `btoa()` for Base64 encoding of credentials (Basic Auth)
- Clear credentials from memory when no longer needed
- Password is prompted each session, never persisted

## XSS Prevention

- Use `textContent` instead of `innerHTML` when displaying user/API data
- When using `innerHTML`, sanitize dynamic values first
- Use `document.createElement()` + property assignment for untrusted content
- Template literals in HTML: escape special characters in dynamic values

## API Security

- Always use HTTPS in production
- Include Authorization header on every API call
- Validate API responses before processing
- Handle HTTP error codes (401, 403, 500) gracefully

## Input Validation

- Validate configuration values before storing in localStorage
- Sanitize any user-provided input before use in API URLs
- Use URL encoding for path parameters

## Content Security

- No `eval()` or `Function()` constructor
- No inline event handlers in generated HTML
- Use `addEventListener()` for event binding
