---
name: chart-patterns
description: "Chart.js visualization patterns for OE Manager GUI. Use when creating charts, updating time-series data, configuring dark theme chart options, or managing chart lifecycle."
---

# Chart.js Patterns

Patterns for Chart.js visualizations in OE Manager GUI.

## Initialization

```javascript
initializeChart(canvasId, config) {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return null;
    return new Chart(ctx, {
        type: config.type || 'line',
        data: config.data,
        options: this.getChartOptions(config.options)
    });
}
```

## Dark Theme Options

```javascript
getChartOptions(custom = {}) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
            legend: { labels: { color: '#cccccc' } },
            tooltip: {
                backgroundColor: '#2d2d30',
                titleColor: '#ffffff',
                bodyColor: '#cccccc',
                borderColor: '#3c3c3c', borderWidth: 1
            }
        },
        scales: {
            x: { ticks: { color: '#808080' }, grid: { color: '#3c3c3c' } },
            y: { ticks: { color: '#808080' }, grid: { color: '#3c3c3c' }, beginAtZero: true }
        },
        ...custom
    };
}
```

## Time Series Updates

```javascript
updateTimeSeriesChart(chart, timestamp, values) {
    if (!chart) return;
    chart.data.labels.push(timestamp);
    values.forEach((value, i) => chart.data.datasets[i].data.push(value));
    const maxPoints = 60;
    if (chart.data.labels.length > maxPoints) {
        chart.data.labels.shift();
        chart.data.datasets.forEach(ds => ds.data.shift());
    }
    chart.update('none'); // No animation for real-time
}
```

## Color Palette

```javascript
chartColors = [
    '#3794ff', '#388a34', '#d16969', '#ddb100',
    '#b267e6', '#4ec9b0', '#ce9178', '#9cdcfe'
];
```

## Responsive Layout

```css
.charts-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
}
@media (max-width: 768px) {
    .charts-grid { grid-template-columns: 1fr; }
}
```

## Cleanup

```javascript
destroyChart(chart) { if (chart) chart.destroy(); }
```
