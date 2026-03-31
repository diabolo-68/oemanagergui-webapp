---
name: css-dark-theme
description: "VS Code inspired dark theme CSS patterns. Use when styling components, buttons, tables, modals, context menus, navigation, or applying the dark color palette."
---

# CSS Dark Theme Patterns

VS Code inspired dark theme styling for OE Manager GUI.

## Color Palette

```css
:root {
    --bg-primary: #1e1e1e;
    --bg-secondary: #252526;
    --bg-tertiary: #2d2d30;
    --bg-input: #3c3c3c;
    --text-primary: #cccccc;
    --text-secondary: #808080;
    --text-bright: #e0e0e0;
    --text-white: #ffffff;
    --accent-blue: #007acc;
    --accent-blue-hover: #3794ff;
    --accent-green: #388a34;
    --accent-red: #f48771;
    --accent-yellow: #ddb100;
    --border-color: #3c3c3c;
    --border-focus: #007acc;
    --state-available: #388a34;
    --state-busy: #ddb100;
    --state-locked: #f48771;
}
```

## Typography

```css
body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 13px;
    color: var(--text-primary);
    background: var(--bg-primary);
}
code { font-family: 'Consolas', 'Monaco', monospace; }
```

## Components

### Card
```css
.card {
    background: var(--bg-secondary);
    border-radius: 6px;
    padding: 16px;
    border: 1px solid var(--border-color);
}
```

### Table
```css
.data-table th { background: var(--bg-tertiary); color: var(--text-secondary); }
.data-table tr:hover { background: var(--bg-tertiary); }
.data-table tr.selected { background: rgba(0, 122, 204, 0.15); }
```

### Button
```css
.btn { background: var(--bg-input); color: var(--text-primary); border: none; border-radius: 4px; padding: 6px 12px; }
.btn:hover { background: var(--bg-tertiary); }
.btn-primary { background: var(--accent-blue); color: var(--text-white); }
.btn-danger { background: var(--accent-red); color: var(--text-white); }
```

### Input
```css
.input { background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); }
.input:focus { outline: none; border-color: var(--border-focus); }
```

### Navigation
```css
.sidebar { background: var(--bg-secondary); border-right: 1px solid var(--border-color); }
.nav-item { color: var(--text-secondary); }
.nav-item:hover { color: var(--text-bright); }
.nav-item.active { color: var(--text-white); border-left: 2px solid var(--accent-blue); }
```
