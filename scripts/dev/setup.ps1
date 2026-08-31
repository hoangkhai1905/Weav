[CmdletBinding()]
param(
    [switch]$SkipVerify,
    [switch]$SkipDocker
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ============================================================
# WEAV Development Environment Setup
# Windows / PowerShell
# ============================================================

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

function Write-Step {
    param([string]$Message)

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor DarkGray
    Write-Host " $Message" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor DarkGray
}

function Write-Ok {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Fail {
    param([string]$Message)

    Write-Host ""
    Write-Host "[ERROR] $Message" -ForegroundColor Red
    Write-Host ""
    exit 1
}

function Assert-Command {
    param(
        [string]$Command,
        [string]$InstallHint
    )

    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        Fail "'$Command' was not found. $InstallHint"
    }
}

function Invoke-Checked {
    param(
        [string]$Command,
        [string[]]$Arguments = @(),
        [string]$ErrorMessage = "Command failed."
    )

    & $Command @Arguments

    if ($LASTEXITCODE -ne 0) {
        Fail $ErrorMessage
    }
}

# ============================================================
# Read expected versions from repository
# ============================================================

Write-Step "Reading repository configuration"

if (-not (Test-Path ".java-version")) {
    Fail ".java-version not found."
}

if (-not (Test-Path ".node-version")) {
    Fail ".node-version not found."
}

if (-not (Test-Path ".python-version")) {
    Fail ".python-version not found."
}

if (-not (Test-Path "package.json")) {
    Fail "Root package.json not found."
}

$ExpectedJava = (Get-Content ".java-version" -Raw).Trim()
$ExpectedNode = (Get-Content ".node-version" -Raw).Trim()
$ExpectedPython = (Get-Content ".python-version" -Raw).Trim()

$RootPackage = Get-Content "package.json" -Raw | ConvertFrom-Json

if (-not $RootPackage.packageManager) {
    Fail "packageManager is missing from root package.json."
}

$ExpectedPnpm = $RootPackage.packageManager -replace "^pnpm@", ""

Write-Ok "Java:   $ExpectedJava"
Write-Ok "Node:   $ExpectedNode"
Write-Ok "Python: $ExpectedPython"
Write-Ok "pnpm:   $ExpectedPnpm"

# ============================================================
# Prerequisites
# ============================================================

Write-Step "Checking prerequisites"

Assert-Command "git" "Install Git first."
Assert-Command "java" "Install JDK $ExpectedJava and configure JAVA_HOME."
Assert-Command "node" "Install Node.js $ExpectedNode."
Assert-Command "pnpm" "Install/activate pnpm $ExpectedPnpm."
Assert-Command "uv" "Install uv first."
Assert-Command "docker" "Install and start Docker Desktop."

Write-Ok "Required commands are available."

# ============================================================
# Java
# ============================================================

Write-Step "Checking Java"

$JavaOutput = (& java --version 2>&1 | Out-String)

if ($LASTEXITCODE -ne 0) {
    Fail "Unable to execute Java."
}

$JavaFirstLine = ($JavaOutput -split "`r?`n")[0]

if ($JavaFirstLine -notmatch "\b$([regex]::Escape($ExpectedJava))(\.|\s)") {
    Fail "Expected Java $ExpectedJava but found: $JavaFirstLine"
}

Write-Ok $JavaFirstLine

# Maven Wrapper can use JAVA_HOME instead of the java executable in PATH,
# so verify it separately.
Push-Location "services/identity-service"

try {
    $MavenOutput = (& .\mvnw.cmd -v 2>&1 | Out-String)

    if ($LASTEXITCODE -ne 0) {
        Fail "Unable to execute Maven Wrapper."
    }

    if ($MavenOutput -notmatch "Java version:\s*$([regex]::Escape($ExpectedJava))(\.|,|\s)") {
        Write-Host $MavenOutput
        Fail "Maven Wrapper is not using Java $ExpectedJava. Check JAVA_HOME."
    }
}
finally {
    Pop-Location
}

Write-Ok "Maven Wrapper is using Java $ExpectedJava."

# ============================================================
# Node / pnpm
# ============================================================

Write-Step "Checking Node.js and pnpm"

$NodeVersion = (& node --version).Trim()

if ($LASTEXITCODE -ne 0) {
    Fail "Unable to execute Node.js."
}

if ($NodeVersion -notmatch "^v$([regex]::Escape($ExpectedNode))\.") {
    Fail "Expected Node $ExpectedNode.x but found $NodeVersion."
}

Write-Ok "Node $NodeVersion"

$PnpmVersion = (& pnpm --version).Trim()

if ($LASTEXITCODE -ne 0) {
    Fail "Unable to execute pnpm."
}

if ($PnpmVersion -ne $ExpectedPnpm) {
    Fail "Expected pnpm $ExpectedPnpm but found $PnpmVersion. Run: corepack prepare pnpm@$ExpectedPnpm --activate"
}

Write-Ok "pnpm $PnpmVersion"

# ============================================================
# Docker
# ============================================================

if (-not $SkipDocker) {
    Write-Step "Checking Docker"

    & docker info *> $null

    if ($LASTEXITCODE -ne 0) {
        Fail "Docker CLI is installed but Docker Engine is not running. Start Docker Desktop."
    }

    $DockerVersion = (& docker --version).Trim()
    $ComposeVersion = (& docker compose version).Trim()

    Write-Ok $DockerVersion
    Write-Ok $ComposeVersion
}

# ============================================================
# Python
# ============================================================

Write-Step "Setting up Python $ExpectedPython"

Invoke-Checked `
    "uv" `
    @("python", "install", $ExpectedPython) `
    "Unable to install/find Python $ExpectedPython using uv."

Write-Ok "Python $ExpectedPython is available."

# ============================================================
# JS / TS dependencies
# ============================================================

Write-Step "Installing Node workspace dependencies"

Invoke-Checked `
    "pnpm" `
    @("install", "--frozen-lockfile") `
    "pnpm install failed."

Write-Ok "Node workspace dependencies installed."

# ============================================================
# OCR / Python dependencies
# ============================================================

Write-Step "Syncing OCR environment"

Push-Location "services/ocr-service"

try {
    Invoke-Checked `
        "uv" `
        @("sync", "--locked") `
        "uv sync failed for OCR Service."

    $OcrPython = (& uv run python --version).Trim()

    if ($LASTEXITCODE -ne 0) {
        Fail "Unable to run OCR Python environment."
    }

    if ($OcrPython -notmatch "Python\s+$([regex]::Escape($ExpectedPython))\.") {
        Fail "OCR Service is not using Python $ExpectedPython.x. Found: $OcrPython"
    }

    Write-Ok "OCR environment: $OcrPython"
}
finally {
    Pop-Location
}

# ============================================================
# Environment variables
# ============================================================

Write-Step "Preparing environment variables"

if (-not (Test-Path ".env.example")) {
    Fail ".env.example not found."
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Ok "Created .env from .env.example."
    Write-Warn "Fill Supabase / Aiven / API credentials in .env when required."
}
else {
    Write-Ok ".env already exists. It was NOT overwritten."
}

# ============================================================
# Docker Compose
# ============================================================

if (-not $SkipDocker) {
    Write-Step "Validating Docker Compose"

    Invoke-Checked `
        "docker" `
        @(
            "compose",
            "-f", "compose.yml",
            "-f", "compose.dev.yml",
            "config",
            "--quiet"
        ) `
        "Docker Compose configuration is invalid."

    Write-Ok "Compose configuration is valid."

    Write-Step "Starting local infrastructure"

    Invoke-Checked `
        "docker" `
        @(
            "compose",
            "up",
            "-d",
            "--wait",
            "--wait-timeout", "90"
        ) `
        "Unable to start local infrastructure."

    Write-Ok "Local infrastructure started."
}

# ============================================================
# Verification
# ============================================================

if (-not $SkipVerify) {
    Write-Step "Verifying Java services"

    Push-Location "services/identity-service"

    try {
        Invoke-Checked `
            ".\mvnw.cmd" `
            @("clean", "compile") `
            "Identity Service failed to compile."
    }
    finally {
        Pop-Location
    }

    Write-Ok "Identity Service compiles."

    Push-Location "services/workspace-service"

    try {
        Invoke-Checked `
            ".\mvnw.cmd" `
            @("clean", "compile") `
            "Workspace Service failed to compile."
    }
    finally {
        Pop-Location
    }

    Write-Ok "Workspace Service compiles."

    Push-Location "services/workflow-service"

    try {
        Invoke-Checked `
            ".\mvnw.cmd" `
            @("clean", "compile") `
            "Workflow Service failed to compile."
    }
    finally {
        Pop-Location
    }

    Write-Ok "Workflow Service compiles."

    Write-Step "Verifying Web / NestJS projects"

    Invoke-Checked `
        "pnpm" `
        @("--dir", "apps/web", "build") `
        "Web build failed."

    Write-Ok "Web builds."

    Invoke-Checked `
        "pnpm" `
        @("--dir", "services/ai-service", "build") `
        "AI Service build failed."

    Write-Ok "AI Service builds."

    Invoke-Checked `
        "pnpm" `
        @("--dir", "services/api-gateway", "build") `
        "API Gateway build failed."

    Write-Ok "API Gateway builds."

    Invoke-Checked `
    "pnpm" `
    @("--dir", "services/bot-service", "build") `
    "Bot Service build failed."

    Write-Ok "Bot Service builds."

    Invoke-Checked `
        "pnpm" `
        @("--dir", "services/notification-service", "build") `
        "Notification Service build failed."

    Write-Ok "Notification Service builds."

    Write-Ok "Bot & Notification Service builds."

    Write-Step "Verifying OCR dependencies"

    Push-Location "services/ocr-service"

    try {
        Invoke-Checked `
            "uv" `
            @(
                "run",
                "python",
                "-c",
                "import fastapi, paddle, paddleocr, cv2; print('OCR environment OK')"
            ) `
            "OCR dependency verification failed."
    }
    finally {
        Pop-Location
    }

    Write-Ok "OCR dependencies are available."

    Write-Step "Checking Mobile workspace"

    & pnpm --filter "./apps/mobile" list --depth 0

    if ($LASTEXITCODE -ne 0) {
        Fail "Mobile app is not detected by pnpm workspace."
    }

    Write-Ok "Mobile app is detected by pnpm workspace."
}
else {
    Write-Warn "Build verification skipped."
}

# ============================================================
# Final status
# ============================================================

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " WEAV DEVELOPMENT SETUP COMPLETE" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""

Write-Host "Java       : $ExpectedJava" -ForegroundColor Green
Write-Host "Node       : $ExpectedNode" -ForegroundColor Green
Write-Host "pnpm       : $ExpectedPnpm" -ForegroundColor Green
Write-Host "Python     : $ExpectedPython" -ForegroundColor Green

if (-not $SkipDocker) {
    Write-Host ""
    Write-Host "Docker services:" -ForegroundColor Cyan
    & docker compose ps
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Check .env and fill shared development credentials."
Write-Host "  2. Do not commit .env."
Write-Host "  3. Start implementation only when needed."
Write-Host ""