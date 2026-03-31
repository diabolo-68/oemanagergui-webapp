# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :white_check_mark: |

## Security Considerations

### Authentication

- **Credentials are not stored** - Password is only held in memory during the session
- **Basic Auth** - Uses HTTP Basic Authentication to PASOE server
- **HTTPS recommended** - Always deploy behind HTTPS in production

### API Access

- This webapp makes direct API calls to the PASOE oemanager endpoint
- It requires the same permissions as the oemanager REST API
- Only deploy in secured network environments

### Best Practices

1. **Deploy behind HTTPS** - Never use HTTP in production
2. **Network restrictions** - Limit access to trusted networks
3. **Strong credentials** - Use strong passwords for oemanager
4. **Session management** - Log out when done using the app

## Reporting a Vulnerability

If you discover a security vulnerability:

1. **Do not** open a public issue
2. Email details to the maintainers
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity

## Security Updates

Security updates will be released as soon as possible once a vulnerability is confirmed and fixed.
