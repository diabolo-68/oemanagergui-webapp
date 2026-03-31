---
description: "Use when writing or modifying JavaScript, HTML, or CSS code. Covers coding style, naming conventions, and formatting standards for OE Manager GUI."
applyTo: ["**/*.js", "**/*.html", "**/*.css"]
---

# Coding Style

## JavaScript

- Use `const` by default, `let` when reassignment needed, never `var`
- Use template literals for string interpolation
- Use arrow functions for callbacks, regular functions for methods
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Use destructuring for object and array access
- Use `async/await` instead of `.then()` chains
- Single quotes for strings, except template literals

## HTML

- Use semantic elements where appropriate
- Use `data-*` attributes for JavaScript hooks
- Keep inline styles to a minimum - use CSS classes

## CSS

- Use CSS custom properties (variables) from `:root`
- Use `rem` or `px` for sizes (match existing patterns)
- Follow BEM-like naming: `.component-name`, `.component-name__element`
- Dark theme colors only - no light theme variants

## Naming

- **Functions**: `camelCase` - verb prefix (`loadAgents`, `handleClick`, `renderTable`)
- **Classes**: `PascalCase` (`OeManagerApp`, `AgentService`, `Templates`)
- **Constants**: `UPPER_SNAKE_CASE` for true constants
- **CSS classes**: `kebab-case` (`agent-row`, `context-menu`)
- **IDs**: `camelCase` (`agentsTable`, `loginForm`)

## Formatting

- 4 spaces indentation
- Opening braces on same line
- Semicolons required
- Max line length ~120 characters
