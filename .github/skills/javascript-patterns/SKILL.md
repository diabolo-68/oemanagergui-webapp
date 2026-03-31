---
name: javascript-patterns
description: "Modern JavaScript patterns for OE Manager GUI webapp. Use when writing or modifying JavaScript code, implementing view mixins, async operations, error handling, event delegation, or DOM manipulation."
---

# JavaScript Patterns

Modern JavaScript best practices for the OE Manager GUI webapp.

## Core Principles

1. **Vanilla JS Only** - No frameworks, no transpilation
2. **ES6+ Features** - Use modern syntax
3. **Async/Await** - For all async operations
4. **Mixin Pattern** - For view composition

## Patterns

### Variable Declarations
```javascript
// Use const by default, let when reassignment needed
const immutableData = { ... };
let mutableState = [];
// Never use var
```

### Template Literals
```javascript
const message = `Agent ${agentId} is ${state}`;
const html = `<div class="agent">${name}</div>`;
```

### Arrow Functions
```javascript
// Callbacks
items.forEach(item => this.process(item));
element.addEventListener('click', () => this.handleClick());

// Short functions
const double = x => x * 2;
const getState = agent => agent.state || 'UNKNOWN';
```

### Destructuring
```javascript
const { agentId, state, pid } = agent;
const [first, ...rest] = items;
function updateAgent({ agentId, state }) { }
```

### Optional Chaining & Nullish Coalescing
```javascript
const state = agent?.state ?? 'UNKNOWN';
const sessions = response?.result?.agents?.[0]?.sessions ?? [];
```

### Async/Await
```javascript
async loadAgents() {
    try {
        const agents = await this.agentService.fetchAgents(this.app);
        this.agents = agents;
        this.renderAgentsTable();
    } catch (error) {
        Utils.showToast(`Error: ${error.message}`, 'error');
    }
}
```

### Mixin Pattern
```javascript
const AgentsViewMixin = {
    loadAgents() { ... },
    renderAgentsTable() { ... },
    selectAgent(agentId) { ... }
};
Object.assign(OeManagerApp.prototype, AgentsViewMixin);
```

### Event Delegation
```javascript
document.getElementById('table').addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (row) this.handleRowClick(row);
});
```

## Anti-Patterns

- Never use `var`, `==`, `eval()`, `with`, or modify built-in prototypes
- Avoid nested ternaries and magic numbers
- Cache DOM queries, batch DOM updates
- Clean up intervals on disconnect
