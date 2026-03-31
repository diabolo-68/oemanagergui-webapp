---
description: "Review code quality and patterns in OE Manager GUI files"
agent: "code-reviewer"
argument-hint: "Specify the file or feature to review"
---

Review the specified code for quality, patterns, and best practices.

Check for:
- Proper use of mixin pattern, Templates class, and AgentService
- Error handling with try/catch and user feedback via showToast()
- Modern JavaScript (const/let, async/await, optional chaining)
- No security issues (XSS, credential exposure)
- DRY principles and clean function design

Provide severity-rated findings (Critical/Major/Minor) with specific line references and fixes.
