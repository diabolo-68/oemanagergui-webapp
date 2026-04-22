<#
.SYNOPSIS
    Developer toolkit for the OE Manager GUI webapp.

.DESCRIPTION
    Wraps the most common developer workflows: install dependencies,
    run the Vitest unit-test suite, produce a coverage report,
    package the WAR via Maven, clean build artifacts, and combinations
    thereof (e.g. CI = install + test + coverage + package).

.PARAMETER Task
    Which task to run. When omitted, an interactive menu is shown. One of:
        menu        - Show interactive menu (default when no task is given)
        install     - npm install (only when node_modules is missing or -Force)
        test        - Run unit tests (vitest run)
        watch       - Run vitest in watch mode
        coverage    - Run unit tests with coverage report
        lint        - Reserved hook (no-op until a linter is configured)
        compile     - mvn clean package (skips tests)
        clean       - Remove target/, coverage/, .vitest-cache/
        deploy      - Copy target/oemanagergui.war to $env:CATALINA_HOME/webapps
        all         - install + test + coverage + compile
        ci          - Same as all, fails fast on any error
        help        - Show this help

.PARAMETER Force
    For 'install': re-run npm install even if node_modules exists.

.PARAMETER SkipTests
    For 'compile' / 'all' / 'ci': skip the unit-test step before packaging.

.EXAMPLE
    .\scripts\toolkit.ps1 test

.EXAMPLE
    .\scripts\toolkit.ps1 ci

.EXAMPLE
    .\scripts\toolkit.ps1 compile -SkipTests
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('install', 'test', 'watch', 'coverage', 'lint', 'compile',
                 'clean', 'deploy', 'all', 'ci', 'help', 'menu')]
    [string] $Task = 'menu',

    [switch] $Force,
    [switch] $SkipTests
)

$ErrorActionPreference = 'Stop'

# Always operate from the project root, regardless of current directory.
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $ProjectRoot

# ---- pretty printing ------------------------------------------------------
function Write-Section {
    param([string] $Title)
    Write-Host ''
    Write-Host ('=' * 72) -ForegroundColor DarkCyan
    Write-Host (" {0}" -f $Title) -ForegroundColor Cyan
    Write-Host ('=' * 72) -ForegroundColor DarkCyan
}

function Write-Ok    { param($msg) Write-Host "[ OK  ] $msg" -ForegroundColor Green }
function Write-Warn2 { param($msg) Write-Host "[WARN ] $msg" -ForegroundColor Yellow }
function Write-Err2  { param($msg) Write-Host "[FAIL ] $msg" -ForegroundColor Red }
function Write-Info  { param($msg) Write-Host "[INFO ] $msg" -ForegroundColor Gray }

# ---- helpers --------------------------------------------------------------
function Invoke-Step {
    param(
        [string]   $Name,
        [scriptblock] $Action
    )
    Write-Section $Name
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        & $Action
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
            throw "$Name failed with exit code $LASTEXITCODE"
        }
        $sw.Stop()
        Write-Ok ("{0} completed in {1:N1}s" -f $Name, $sw.Elapsed.TotalSeconds)
    }
    catch {
        $sw.Stop()
        Write-Err2 ("{0} failed after {1:N1}s: {2}" -f $Name, $sw.Elapsed.TotalSeconds, $_.Exception.Message)
        throw
    }
}

function Test-Tool {
    param([string] $Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "Required tool '$Name' was not found on PATH." }
    return $cmd.Source
}

# ---- task implementations -------------------------------------------------
function Task-Install {
    Test-Tool 'npm' | Out-Null
    if ((Test-Path node_modules) -and -not $Force) {
        Write-Info "node_modules already present (use -Force to reinstall). Skipping."
        return
    }
    Invoke-Step 'npm install' { npm install }
}

function Task-Test {
    Task-Install
    Invoke-Step 'Unit tests (vitest run)' { npm test }
}

function Task-Watch {
    Task-Install
    Write-Section 'Vitest watch mode (Ctrl+C to exit)'
    npm run test:watch
}

function Task-Coverage {
    Task-Install
    Invoke-Step 'Unit tests + coverage' { npm run test:coverage }
    $report = Join-Path $ProjectRoot 'coverage\index.html'
    if (Test-Path $report) {
        Write-Info "HTML coverage report: $report"
    }
}

function Task-Lint {
    Write-Warn2 "No linter configured. Skipping."
}

function Task-Clean {
    Write-Section 'Clean build artifacts'
    foreach ($dir in @('target', 'coverage', '.vitest-cache')) {
        $full = Join-Path $ProjectRoot $dir
        if (Test-Path $full) {
            Remove-Item $full -Recurse -Force
            Write-Ok "Removed $dir"
        } else {
            Write-Info "$dir not present"
        }
    }
}

function Task-Compile {
    Test-Tool 'mvn' | Out-Null
    if (-not $SkipTests) { Task-Test }
    Invoke-Step 'Maven package (mvn clean package -DskipTests)' {
        mvn clean package -DskipTests
    }
    $war = Get-ChildItem (Join-Path $ProjectRoot 'target') -Filter '*.war' -ErrorAction SilentlyContinue
    if ($war) {
        $sizeMb = [math]::Round($war.Length / 1MB, 2)
        Write-Ok ("WAR built: {0} ({1} MB)" -f $war.FullName, $sizeMb)
    } else {
        Write-Warn2 "No WAR found in target/."
    }
}

function Task-Deploy {
    if (-not $env:CATALINA_HOME) {
        throw "CATALINA_HOME is not set. Cannot deploy."
    }
    $war = Get-ChildItem (Join-Path $ProjectRoot 'target') -Filter '*.war' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $war) {
        throw "No WAR in target/. Run 'compile' first."
    }
    $dest = Join-Path $env:CATALINA_HOME 'webapps'
    if (-not (Test-Path $dest)) { throw "Webapps folder not found: $dest" }
    Invoke-Step "Deploy $($war.Name) to $dest" {
        Copy-Item $war.FullName -Destination $dest -Force
    }
}

function Task-All {
    Task-Install
    if (-not $SkipTests) {
        Task-Test
        Task-Coverage
    }
    Task-Compile -SkipTests:$true   # tests already ran above
}

function Task-Help {
    Get-Help $PSCommandPath -Detailed
}

# ---- interactive menu -----------------------------------------------------
$MenuItems = @(
    @{ Key = '1'; Task = 'install';  Label = 'Install dependencies (npm install)' }
    @{ Key = '2'; Task = 'test';     Label = 'Run unit tests (vitest run)' }
    @{ Key = '3'; Task = 'watch';    Label = 'Run unit tests in watch mode' }
    @{ Key = '4'; Task = 'coverage'; Label = 'Run tests with coverage report' }
    @{ Key = '5'; Task = 'compile';  Label = 'Build WAR (mvn clean package)' }
    @{ Key = '6'; Task = 'clean';    Label = 'Clean build artifacts (target, coverage, cache)' }
    @{ Key = '7'; Task = 'deploy';   Label = 'Deploy WAR to $env:CATALINA_HOME/webapps' }
    @{ Key = '8'; Task = 'all';      Label = 'Full pipeline: install + test + coverage + compile' }
    @{ Key = '9'; Task = 'ci';       Label = 'CI pipeline (alias of all)' }
    @{ Key = 'h'; Task = 'help';     Label = 'Show detailed help' }
    @{ Key = 'q'; Task = '__quit';   Label = 'Quit' }
)

function Show-Menu {
    Clear-Host
    Write-Host ''
    Write-Host ('=' * 72) -ForegroundColor DarkCyan
    Write-Host ' OE Manager GUI Webapp - Developer Toolkit' -ForegroundColor Cyan
    Write-Host ('=' * 72) -ForegroundColor DarkCyan
    Write-Host (' Project : {0}' -f $ProjectRoot) -ForegroundColor Gray
    Write-Host ''
    foreach ($item in $MenuItems) {
        Write-Host ('  [{0}] {1}' -f $item.Key, $item.Label)
    }
    Write-Host ''
}

function Task-Menu {
    while ($true) {
        Show-Menu
        $choice = Read-Host 'Choose an option'
        if ([string]::IsNullOrWhiteSpace($choice)) { continue }
        $choice = $choice.Trim().ToLower()
        $selected = $MenuItems | Where-Object { $_.Key -eq $choice } | Select-Object -First 1
        if (-not $selected) {
            Write-Warn2 "Unknown option: '$choice'"
            Start-Sleep -Seconds 1
            continue
        }
        if ($selected.Task -eq '__quit') {
            Write-Info 'Goodbye.'
            return
        }
        try {
            switch ($selected.Task) {
                'install'  { Task-Install }
                'test'     { Task-Test }
                'watch'    { Task-Watch }
                'coverage' { Task-Coverage }
                'compile'  { Task-Compile }
                'clean'    { Task-Clean }
                'deploy'   { Task-Deploy }
                'all'      { Task-All }
                'ci'       { Task-All }
                'help'     { Task-Help }
            }
        }
        catch {
            Write-Err2 $_.Exception.Message
        }
        Write-Host ''
        Read-Host 'Press Enter to return to the menu'
    }
}

# ---- summary --------------------------------------------------------------
$RunStart = Get-Date
$Failed = $false
try {
    switch ($Task) {
        'install'  { Task-Install }
        'test'     { Task-Test }
        'watch'    { Task-Watch }
        'coverage' { Task-Coverage }
        'lint'     { Task-Lint }
        'compile'  { Task-Compile }
        'clean'    { Task-Clean }
        'deploy'   { Task-Deploy }
        'all'      { Task-All }
        'ci'       { Task-All }
        'help'     { Task-Help }
        'menu'     { Task-Menu }
    }
}
catch {
    $Failed = $true
    Write-Err2 $_.Exception.Message
}
finally {
    Pop-Location
    $elapsed = (Get-Date) - $RunStart
    Write-Section 'Summary'
    Write-Host ("Task     : {0}" -f $Task)
    Write-Host ("Duration : {0:N1}s" -f $elapsed.TotalSeconds)
    if ($Failed) {
        Write-Err2 'One or more steps failed.'
        exit 1
    } else {
        Write-Ok 'Toolkit run completed.'
        exit 0
    }
}
