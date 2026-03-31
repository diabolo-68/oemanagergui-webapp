---
description: "Use when writing or modifying JavaScript patterns, view mixins, template functions, or application architecture in OE Manager GUI."
applyTo: "**/*.js"
---

# JavaScript Patterns

## Mixin Pattern

Views are implemented as mixins applied to OeManagerApp:
```javascript
const ViewMixin = {
    loadData() { /* ... */ },
    renderView() { /* ... */ }
};
Object.assign(OeManagerApp.prototype, ViewMixin);
```

## Template Functions

HTML generation via static Templates class:
```javascript
const row = Templates.agentRow(agent, isSelected, stateClass);
```

## API Calls

All REST calls through AgentService - never use `fetch()` directly:
```javascript
await this.agentService.fetchAgents(this.selectedApplication);
```

## Error Handling

```javascript
try {
    await this.agentService.someMethod(args);
    this.showToast('Success message', 'success');
} catch (error) {
    console.error('[Context]', error);
    this.showToast(`Failed: ${error.message}`, 'error');
}
```

## State Management

- Application state stored as class properties
- Configuration in localStorage (except password)
- UI state via CSS classes (`hidden`, `selected`, `active`)

## Event Delegation

Use document-level listeners for dynamic content:
```javascript
document.addEventListener('click', (e) => {
    if (e.target.matches('.action-btn')) { /* handle */ }
});
```

## Timer Management

- Store timer IDs for cleanup: `this.refreshTimer = setInterval(...)`
- Clear timers on view switch: `clearInterval(this.refreshTimer)`
- Configurable intervals from settings
