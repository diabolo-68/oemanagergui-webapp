---
name: webapp-patterns
description: "Static webapp development patterns for OE Manager GUI. Use when implementing views, modals, context menus, toast notifications, timers, view switching, or state persistence."
---

# Static Webapp Patterns

Patterns for the OE Manager GUI static webapp without frameworks.

## Architecture

```
index.html (SPA)
├── css/style.css
└── js/
    ├── app.js (main class + initialization)
    ├── agentService.js (API wrapper)
    ├── agentsView.js, chartsView.js, metricsView.js, pasoeStatsView.js (mixins)
    ├── templates.js (HTML generation)
    └── utils.js (utilities)
```

## Initialization

```javascript
class OeManagerApp {
    constructor() {
        this.agentService = new AgentService();
        this.config = this.loadStoredConfig();
        this.initializeUI();
    }
}
Object.assign(OeManagerApp.prototype, AgentsViewMixin);
document.addEventListener('DOMContentLoaded', () => {
    window.oemanagerApp = new OeManagerApp();
});
```

## View Switching

```javascript
switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(`${viewName}View`).classList.remove('hidden');
    this.currentView = viewName;
    this.onViewActivated(viewName);
}
```

## Modal Pattern

```javascript
showModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
}
hideModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}
// Close on Escape or backdrop click
```

## Context Menu

```javascript
showContextMenu(event, menuId, data) {
    event.preventDefault();
    this.hideAllContextMenus();
    const menu = document.getElementById(menuId);
    Object.assign(menu.dataset, data);
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.classList.remove('hidden');
}
```

## Toast Notifications

```javascript
Utils.showToast(message, type, duration);  // type: success, error, warning
```

## Timer Management

```javascript
startRefreshTimer(timerName, callback, interval) {
    this.stopRefreshTimer(timerName);
    this[timerName] = setInterval(() => callback.call(this), interval * 1000);
}
stopRefreshTimer(timerName) {
    clearInterval(this[timerName]);
    this[timerName] = null;
}
```

## State Persistence

localStorage for non-sensitive config. Never store password:
```javascript
saveConfig() {
    const toStore = { ...this.config };
    delete toStore.password;
    localStorage.setItem('oemanager.config', JSON.stringify(toStore));
}
```
