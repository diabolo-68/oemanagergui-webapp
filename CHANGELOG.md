# Change Log

All notable changes to the OE Manager GUI webapp will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [1.3.0] - 2026-10-06

Ports the oemanagergui VS Code extension releases 1.14.0, 1.15.0 and 1.16.0.

### Added
- **Lifecycles view**: New sidebar entry showing agent (PID) and ABL session lifecycles derived from the agent log, in an expandable **Tree** mode or a **Packed lanes** mode. Includes drag/Ctrl+wheel zoom, error highlighting, tooltips and a **Min sessions** filter (default 4) that hides agents with fewer sessions.
- **Lifecycles – Flame Chart**: Optional chart (hidden by default) of all HTTP requests of the selected day, colored by status and sharing its zoom with the lifecycle chart. Requests are only loaded while it is shown. A warning appears above the new *Flame Chart Warning Threshold* setting (default 20000, `0` disables).
- **Lifecycles – Session Flame**: Optional chart with one bar per running session packed into lanes, colored by agent, with a red outline for sessions with errors.
- **Lifecycles – click-through**: Clicking a bar opens the Logfiles view filtered by PID, ABL session or request ID.
- **Logfiles – Session filter**: New Session filter (e.g. `AS-7`) that shows only agent log entries of that ABL session.
- **Agent Metrics – auto-refresh**: Statistics refresh in place without redrawing the view. New *Agent Metrics* refresh setting (default 10s, `0` disables) plus Pause/Resume and Refresh Now buttons.
- **Charts – optional legend**: A legend icon at the top right of the Session Memory / Requests Completed / Requests Failed Over Time charts shows the legend as a popover on hover; click to pin or unpin it. The legend is grouped by agent (ID, PID, state and metrics) and lists each session with its color, state, start time and current value. Click a session row to show or hide its line.

### Changed
- **Agent Metrics – condensed view**: The expandable per-agent cards are replaced by a single summary table (one row per agent, color-coded statistics, per-agent Reset button) and combined Threads, Connections and Requests grids covering all agents. Request IDs open the Logfiles view. The SessionManager Metrics section is unchanged.
- **Charts**: Each session keeps the same color across refreshes.
- **Logfiles – charts removed**: The hidden PID Timeline and Flame Chart panels were removed from the Logfiles view; they now live in the Lifecycles view.
- Logfiles now open at the tail and load older/newer complete-line chunks on demand instead of retaining the full file.
- Log filters and request correlation now explicitly cover the bounded loaded window.

### Fixed
- **Charts – legend growing forever**: Sessions that no longer exist are removed from the chart history and the legend once their data has left the 200-point time window.
- **Metrics – missing status values**: The per-agent status (threads, sessions, connections, requests) is now actually fetched; the old cards always showed 0.
- Bounded logfile reads prevent large agent and access logs from exhausting Tomcat or browser memory.

## [1.1.1] - 2026-01-28

### Fixed
- **Thread Times Display**: Fixed Start Time and End Time in Metrics view showing times converted to browser timezone instead of server time. Dates are now displayed exactly as returned by the PASOE API.

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
