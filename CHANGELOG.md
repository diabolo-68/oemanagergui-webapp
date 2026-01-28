# Change Log

All notable changes to the OE Manager GUI webapp will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.1.0] - 2026-01-28

### Added
- **Sessions & Agents Chart**: New chart showing Idle Sessions, Busy Sessions, and Stopping Agents over time
- **Delta Values for Rate Charts**: Requests, Reads, and Writes charts now show per-interval values instead of cumulative counters

### Changed
- **PASOE Stats Layout**: Charts now display 2 per row for better visibility
- **Memory Calculation**: Memory usage now correctly sums from all agent metrics (OverheadMemory + CStackMemory + SessionMemory)
- **Connections Handling**: Fixed display of 0 values for connections (was showing as null)

### Fixed
- Fixed threads list not showing in Metrics view
- Fixed memory always showing as null in PASOE Stats view
- Fixed connections always showing as null when value was 0

## [1.0.0] - 2026-01-25

### Added
- **Initial Release**: Static webapp port of the VS Code OE Manager GUI extension
- **Three Main Views**:
  - **Agents View**: Monitor and manage PASOE agents, sessions, and requests
  - **Charts View**: Visualize memory usage and request statistics over time
  - **Metrics View**: Display SessionManager metrics and per-agent statistics
  - **Settings View**: Configure trim agent settings and refresh intervals

### Features
- **Login/Logout**: Separate login modal for credentials (password not stored)
- **Settings Tab**: Dedicated sidebar tab for configuration
  - Trim Agent settings (Wait to Finish, Wait After Stop)
  - Refresh intervals (Agents, Requests, Charts)
- **Agent Management**:
  - View all agents and their states
  - Add new agents to the pool
  - Trim agents (graceful shutdown)
  - Right-click context menu for agent actions
- **Session Management**:
  - View sessions per agent
  - Terminate sessions via context menu
- **Request Monitoring**:
  - View running requests with auto-refresh
  - Cancel requests via context menu
  - Copy request URL to clipboard
- **Charts**:
  - Memory usage bar chart (per session)
  - Requests completed bar chart
  - Requests failed bar chart
  - Time-series line charts with historical data
- **Metrics**:
  - SessionManager metrics (collapsible section)
  - Per-agent metrics with expandable cards
  - Reset statistics per agent
  - Include/exclude requests toggle
- **Agent Properties Modal**: View and edit agent pool properties
- **ABL Objects**: Enable/disable tracking, view reports
- **Dark Theme**: VS Code-inspired dark color scheme
- **Toast Notifications**: Success, error, and warning messages
- **Auto-refresh**: Configurable intervals for all data grids
- **URL Auto-detection**: Derives oemanager API URL from webapp location

### Architecture
- Pure static HTML/CSS/JavaScript webapp
- No backend server required
- Direct REST API calls to PASOE oemanager
- Modular JavaScript structure:
  - `app.js` - Core application class
  - `agentService.js` - REST API wrapper
  - `agentsView.js` - Agents view mixin
  - `chartsView.js` - Charts view mixin
  - `metricsView.js` - Metrics view mixin
  - `templates.js` - HTML templates helper
  - `utils.js` - Utility functions
- HTML templates for dynamic content (CSP compliant)
- Chart.js for data visualization

### Deployment
- Copy oemanagergui.war into the PASOE's webapps folder
- Access the User Interface via https://<pasoe_base_url>/oemanagergui/  
