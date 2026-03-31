# OE Manager GUI Agents

> Agent definitions for GitHub Copilot

## Project Overview

Static webapp for managing OpenEdge PASOE agents and sessions. Pure vanilla JavaScript with no frameworks.

## Available Agents

### Development Agents

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `planner` | Feature planning | Starting new features |
| `code-reviewer` | Code quality | Before/after changes |
| `api-reviewer` | API integration | Working with PASOE API |
| `ui-reviewer` | UI/UX review | Styling and accessibility |
| `tdd-guide` | Test-driven dev | Writing tests |

### Agent Locations

```
.github/agents/
├── planner.agent.md
├── code-reviewer.agent.md
├── api-reviewer.agent.md
├── ui-reviewer.agent.md
└── tdd-guide.agent.md
```

## Prompts

| Prompt | Purpose | When to Use |
|--------|---------|-------------|
| `/plan` | Feature planning | Starting new features |
| `/code-review` | Code quality review | Before/after changes |
| `/build` | Maven WAR build | Building for deployment |
| `/deploy` | Deploy to Tomcat | Deploying WAR file |
| `/tdd` | TDD test writing | Writing test cases |

### Prompt Locations

```
.github/prompts/
├── plan.prompt.md
├── code-review.prompt.md
├── build.prompt.md
├── deploy.prompt.md
└── tdd.prompt.md
```

## Instructions

| Instruction | Scope | Purpose |
|-------------|-------|--------|
| `coding-style` | `**/*.js, **/*.html, **/*.css` | Naming, formatting, style |
| `security` | `**/*.js` | XSS prevention, auth, input validation |
| `javascript-patterns` | `**/*.js` | Mixins, templates, error handling |
| `git-workflow` | On-demand | Commits, branches, PRs |

### Instruction Locations

```
.github/instructions/
├── coding-style.instructions.md
├── security.instructions.md
├── javascript-patterns.instructions.md
└── git-workflow.instructions.md
```

## Skills

| Skill | Purpose |
|-------|--------|
| `javascript-patterns` | Modern JS best practices |
| `pasoe-api` | PASOE oemanager API reference |
| `webapp-patterns` | Static webapp patterns |
| `chart-patterns` | Chart.js visualization |
| `css-dark-theme` | VS Code dark theme styling |

### Skill Locations

```
.github/skills/
├── javascript-patterns/SKILL.md
├── pasoe-api/SKILL.md
├── webapp-patterns/SKILL.md
├── chart-patterns/SKILL.md
└── css-dark-theme/SKILL.md
```

## Architecture

```
Browser (HTML/CSS/JS) → REST API → PASOE oemanager
```

### Key Files
- `js/app.js` - Main application
- `js/agentService.js` - API wrapper
- `js/*View.js` - View mixins
- `css/style.css` - Dark theme
- `index.html` - SPA

## Patterns

### Mixin Pattern
```javascript
const ViewMixin = { /* methods */ };
Object.assign(OeManagerApp.prototype, ViewMixin);
```

### Template Pattern
```javascript
const row = Templates.agentRow(agent);
```

### API Pattern
```javascript
await this.agentService.fetchAgents(app);
```

## Memory

- PASOE API returns nested objects (`result.agents`, `result.AgentStatHist`)
- Memory values in bytes, display in MiB
- Dates in ISO format with timezone
- Session states: IDLE, BUSY, RESERVED
- Agent states: AVAILABLE, BUSY
