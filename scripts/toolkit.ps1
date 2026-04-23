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
        release     - Build WAR and publish a GitHub Release with it
        all         - install + test + coverage + compile
        ci          - Same as all, fails fast on any error
        help        - Show this help

.PARAMETER Force
    For 'install': re-run npm install even if node_modules exists.
    For 'release': proceed even if the working tree is dirty.

.PARAMETER SkipTests
    For 'compile' / 'all' / 'ci' / 'release': skip the unit-test step before packaging.

.PARAMETER Tag
    For 'release': override the git tag (defaults to 'v<pom-version>').

.PARAMETER Draft
    For 'release': create the GitHub release as a draft.

.PARAMETER Prerelease
    For 'release': mark the GitHub release as a pre-release.

.PARAMETER NoBuild
    For 'release': skip the WAR build (requires an existing target/*.war).

.PARAMETER NoPush
    For 'release': create the local tag but do not push it to origin.
    Note: 'gh release create' will still try to upload; use -Draft together
    with -NoPush if you want a fully local dry-run-style execution.

.EXAMPLE
    .\scripts\toolkit.ps1 test

.EXAMPLE
    .\scripts\toolkit.ps1 ci

.EXAMPLE
    .\scripts\toolkit.ps1 compile -SkipTests

.EXAMPLE
    .\scripts\toolkit.ps1 release

.EXAMPLE
    .\scripts\toolkit.ps1 release -Tag v1.2.3 -Draft -SkipTests
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('install', 'test', 'watch', 'coverage', 'lint', 'compile',
                 'clean', 'deploy', 'release', 'all', 'ci', 'help', 'menu')]
    [string] $Task = 'menu',

    [switch] $Force,
    [switch] $SkipTests,
    [string] $Tag,
    [switch] $Draft,
    [switch] $Prerelease,
    [switch] $NoBuild,
    [switch] $NoPush
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

# ---- release helpers ------------------------------------------------------
function Get-PomVersion {
    $pom = Join-Path $ProjectRoot 'pom.xml'
    if (-not (Test-Path $pom)) { throw "pom.xml not found at $pom" }
    $content = Get-Content $pom -Raw
    # Match the first top-level <version> after </artifactId> (the project
    # version, not a dependency's). Non-greedy match scoped to project header.
    $match = [regex]::Match(
        $content,
        '<artifactId>\s*oemanagergui\s*</artifactId>\s*<version>\s*([^<]+?)\s*</version>'
    )
    if (-not $match.Success) {
        throw "Unable to determine project version from pom.xml."
    }
    return $match.Groups[1].Value.Trim()
}

function Get-ChangelogSection {
    param([string] $Version)
    $changelog = Join-Path $ProjectRoot 'CHANGELOG.md'
    if (-not (Test-Path $changelog)) {
        return "Release $Version"
    }
    $lines = Get-Content $changelog
    $headerPattern = '^##\s*\[' + [regex]::Escape($Version) + '\]'
    $startIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $headerPattern) { $startIdx = $i; break }
    }
    if ($startIdx -lt 0) {
        Write-Warn2 "No CHANGELOG.md section found for [$Version]; using generic notes."
        return "Release $Version"
    }
    $endIdx = $lines.Count
    for ($i = $startIdx + 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^##\s*\[') { $endIdx = $i; break }
    }
    $section = $lines[($startIdx + 1)..($endIdx - 1)] -join "`n"
    return $section.Trim()
}

function Test-WorkingTreeClean {
    $status = git status --porcelain 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to query git status. Is this a git repository?"
    }
    return [string]::IsNullOrWhiteSpace($status)
}

function Task-Release {
    Test-Tool 'git' | Out-Null
    Test-Tool 'gh'  | Out-Null

    Write-Section 'Verify GitHub CLI authentication'
    gh auth status 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI is not authenticated. Run 'gh auth login' first."
    }
    Write-Ok 'gh is authenticated.'

    $version = Get-PomVersion
    $tagName = if ([string]::IsNullOrWhiteSpace($Tag)) { "v$version" } else { $Tag }
    Write-Info "Project version : $version"
    Write-Info "Release tag     : $tagName"

    if (-not (Test-WorkingTreeClean)) {
        if ($Force) {
            Write-Warn2 'Working tree is dirty; continuing because -Force was specified.'
        } else {
            throw 'Working tree is dirty. Commit or stash changes, or pass -Force.'
        }
    }

    # Abort early if the release already exists on GitHub.
    gh release view $tagName 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
        throw "GitHub release '$tagName' already exists. Bump the version or delete it first."
    }

    # Build (or reuse) the WAR.
    $warPath = $null
    $existingWar = Get-ChildItem (Join-Path $ProjectRoot 'target') -Filter '*.war' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($NoBuild) {
        if (-not $existingWar) { throw "-NoBuild specified but no WAR found in target/." }
        $warPath = $existingWar.FullName
        Write-Info "Reusing existing WAR: $warPath"
    } else {
        Task-Compile
        $warPath = (Get-ChildItem (Join-Path $ProjectRoot 'target') -Filter '*.war' -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
        if (-not $warPath) { throw 'WAR build did not produce an artifact.' }
    }

    # Create the local tag if it doesn't already exist.
    git rev-parse -q --verify ("refs/tags/{0}" -f $tagName) 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Local tag '$tagName' already exists; reusing it."
    } else {
        Invoke-Step "Create git tag $tagName" {
            git tag -a $tagName -m ("Release {0}" -f $version)
        }
    }

    # Push the tag unless explicitly opted out.
    if ($NoPush) {
        Write-Warn2 "-NoPush specified; not pushing tag '$tagName' to origin."
    } else {
        Invoke-Step "Push tag $tagName to origin" {
            git push origin $tagName
        }
    }

    # Write release notes from the matching CHANGELOG.md section.
    $notes = Get-ChangelogSection -Version $version
    $notesFile = New-TemporaryFile
    try {
        Set-Content -Path $notesFile -Value $notes -Encoding UTF8

        $ghArgs = @(
            'release', 'create', $tagName, $warPath,
            '--title', ("OE Manager GUI {0}" -f $version),
            '--notes-file', $notesFile.FullName
        )
        if ($Draft)       { $ghArgs += '--draft' }
        if ($Prerelease)  { $ghArgs += '--prerelease' }

        Invoke-Step "Publish GitHub release $tagName" {
            gh @ghArgs
        }
    }
    finally {
        Remove-Item $notesFile -Force -ErrorAction SilentlyContinue
    }

    Write-Section 'Release URL'
    gh release view $tagName --json url --jq .url
}

function Read-YesNo {
    param(
        [string] $Prompt,
        [bool]   $Default = $false
    )
    $hint = if ($Default) { '[Y/n]' } else { '[y/N]' }
    $answer = Read-Host ("{0} {1}" -f $Prompt, $hint)
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return ($answer.Trim().ToLower() -in @('y', 'yes'))
}

function Task-ReleaseInteractive {
    Write-Section 'Release options'
    try {
        $version = Get-PomVersion
        Write-Info "Detected pom.xml version: $version (default tag: v$version)"
    } catch {
        Write-Warn2 $_.Exception.Message
    }

    $tagInput = Read-Host 'Custom tag (leave empty for default v<pom-version>)'
    if (-not [string]::IsNullOrWhiteSpace($tagInput)) {
        $script:Tag = $tagInput.Trim()
    } else {
        $script:Tag = ''
    }

    $script:Draft       = Read-YesNo -Prompt 'Create as DRAFT release?'      -Default $false
    $script:Prerelease  = Read-YesNo -Prompt 'Mark as PRE-RELEASE?'           -Default $false
    $script:NoBuild     = Read-YesNo -Prompt 'Skip WAR build (reuse existing target/*.war)?' -Default $false
    $script:SkipTests   = Read-YesNo -Prompt 'Skip unit tests during build?'  -Default $false
    $script:NoPush      = Read-YesNo -Prompt 'Skip pushing the git tag to origin?' -Default $false
    $script:Force       = Read-YesNo -Prompt 'Continue even if working tree is dirty?' -Default $false

    Write-Host ''
    Write-Info ('Summary => Tag: {0} | Draft: {1} | Prerelease: {2} | NoBuild: {3} | SkipTests: {4} | NoPush: {5} | Force: {6}' -f `
        ($(if ($script:Tag) { $script:Tag } else { '<auto>' })),
        $script:Draft, $script:Prerelease, $script:NoBuild, $script:SkipTests, $script:NoPush, $script:Force)
    if (-not (Read-YesNo -Prompt 'Proceed with release?' -Default $true)) {
        Write-Warn2 'Release cancelled.'
        return
    }

    Task-Release
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
    @{ Key = 'r'; Task = 'release';  Label = 'Publish GitHub Release (interactive)' }
    @{ Key = 'R'; Task = 'release-quick'; Label = 'Publish GitHub Release (defaults, no prompts)' }
    @{ Key = 'd'; Task = 'release-draft'; Label = 'Publish GitHub Release as DRAFT' }
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
        $choice = $choice.Trim()
        # Case-sensitive match first (so 'r' vs 'R' work), then case-insensitive fallback.
        $selected = $MenuItems | Where-Object { $_.Key -ceq $choice } | Select-Object -First 1
        if (-not $selected) {
            $selected = $MenuItems | Where-Object { $_.Key -ieq $choice } | Select-Object -First 1
        }
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
                'install'        { Task-Install }
                'test'           { Task-Test }
                'watch'          { Task-Watch }
                'coverage'       { Task-Coverage }
                'compile'        { Task-Compile }
                'clean'          { Task-Clean }
                'deploy'         { Task-Deploy }
                'release'        { Task-ReleaseInteractive }
                'release-quick'  { Task-Release }
                'release-draft'  {
                    $script:Draft = $true
                    Task-Release
                }
                'all'            { Task-All }
                'ci'             { Task-All }
                'help'           { Task-Help }
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
        'release'  { Task-Release }
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
