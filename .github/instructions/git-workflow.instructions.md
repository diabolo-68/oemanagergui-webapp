---
description: "Use when writing commit messages, creating branches, or preparing pull requests. Covers conventional commits and git workflow for OE Manager GUI."
---

# Git Workflow

## Commit Messages

Use conventional commits format:
```
type(scope): description

feat(agents): add agent trim confirmation dialog
fix(charts): correct memory unit conversion
refactor(api): extract common fetch error handling
style(css): align button spacing in toolbar
docs: update API endpoint documentation
```

### Types
- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code restructuring (no behavior change)
- `style` - Formatting, CSS changes
- `docs` - Documentation only
- `chore` - Build, config changes

### Scopes
- `agents` - Agents view
- `charts` - Charts view
- `metrics` - Metrics view
- `pasoe-stats` - PASOE Stats view
- `api` - AgentService / API calls
- `css` - Styling
- `config` - Settings / configuration

## Branches

- `main` - Production-ready code
- `feature/description` - New features
- `fix/description` - Bug fixes

## Pull Requests

- One feature/fix per PR
- Reference related issues
- Include screenshots for UI changes
