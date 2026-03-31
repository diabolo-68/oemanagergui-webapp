# Contributing to OE Manager GUI

Thank you for your interest in contributing to OE Manager GUI!

## Development Setup

### Prerequisites

- Java 8+ (for Maven build)
- Maven 3.6+
- A PASOE server for testing
- Modern web browser

### Getting Started

1. Clone the repository
2. Open in your preferred editor
3. Make changes to files in `js/`, `css/`, or `index.html`
4. Build and test:
   ```powershell
   mvn clean package
   ```

### Running Locally

You can test changes by:
1. Opening `index.html` directly in a browser (limited - CORS issues)
2. Deploying WAR to a local Tomcat/PASOE instance

## Project Structure

```
oemanagergui-webapp/
├── index.html          # Single-page application
├── css/style.css       # All styles (dark theme)
├── js/
│   ├── app.js          # Main application class
│   ├── agentService.js # REST API wrapper
│   ├── agentsView.js   # Agents view mixin
│   ├── chartsView.js   # Charts view mixin
│   ├── metricsView.js  # Metrics view mixin
│   ├── pasoeStatsView.js # PASOE stats mixin
│   ├── templates.js    # HTML templates
│   └── utils.js        # Utilities
├── WEB-INF/web.xml     # Servlet config
└── pom.xml             # Maven build
```

## Code Guidelines

### JavaScript

- **Vanilla JS only** - No frameworks or transpilation
- **ES6+ features** - Use modern syntax (const/let, arrow functions, async/await)
- **Mixin pattern** - Views are mixins applied to OeManagerApp
- **Template pattern** - Generate HTML via Templates class
- **API wrapper** - All REST calls through AgentService

### CSS

- **Dark theme** - VS Code inspired colors
- **CSS variables** - Use custom properties for colors
- **Mobile-first** - Responsive layouts

### HTML

- **Semantic** - Use appropriate elements
- **Accessible** - Include ARIA labels, keyboard support

## Pull Request Process

1. **Create a branch** - `feature/your-feature` or `fix/your-fix`
2. **Make changes** - Follow code guidelines
3. **Test thoroughly** - Test on PASOE server
4. **Update CHANGELOG** - Document your changes
5. **Submit PR** - Describe what and why

### PR Checklist

- [ ] Code follows project patterns
- [ ] No console.log statements left
- [ ] Tested with real PASOE server
- [ ] CHANGELOG.md updated
- [ ] No new dependencies added

## Types of Contributions

### Bug Fixes

1. Check existing issues
2. Create issue if new bug
3. Reference issue in PR

### Features

1. Discuss in issues first
2. Follow existing patterns
3. Add to appropriate view mixin

### Documentation

- README improvements
- Code comments
- New skill/agent definitions

## Questions?

Open a GitHub issue for questions or discussions.

## Code of Conduct

Please note that this project has a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.
