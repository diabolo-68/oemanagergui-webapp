---
description: "Deploy OE Manager GUI WAR to PASOE Tomcat"
tools: [execute]
argument-hint: "Optional: specify target server or CATALINA_HOME path"
---

Deploy the OE Manager GUI WAR file to the PASOE Tomcat instance.

Steps:
1. Verify the WAR file exists in `target/`
2. Copy to Tomcat webapps directory:
   ```powershell
   Copy-Item target/oemanagergui.war $env:CATALINA_HOME/webapps/
   ```
3. Verify deployment at `https://server/oemanagergui`

Ensure `CATALINA_HOME` environment variable is set before deploying.
