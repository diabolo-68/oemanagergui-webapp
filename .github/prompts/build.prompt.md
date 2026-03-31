---
description: "Build the OE Manager GUI WAR file with Maven"
tools: [execute]
argument-hint: "Optional: specify Maven profile or skip tests"
---

Build the OE Manager GUI WAR file for deployment.

Run the Maven build:
```powershell
mvn clean package -DskipTests
```

After building:
1. Verify the WAR file exists in `target/`
2. Report the file size
3. List any build warnings or errors

Reference: [pom.xml](../../pom.xml)
