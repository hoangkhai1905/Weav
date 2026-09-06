[CmdletBinding()]
param(
    [ValidateSet('Check', 'Run')]
    [string]$Action = 'Check',

    [ValidateSet('Auto', 'Antigravity', 'OpenCode')]
    [string]$Tool = 'Auto',

    [string]$Prompt,

    [string]$Model,

    [ValidateSet('Plan', 'AcceptEdits')]
    [string]$Mode = 'Plan',

    [ValidateRange(1, 3600)]
    [int]$TimeoutSec = 300,

    [switch]$AllowRepoContext
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExitSuccess = 0
$ExitUnavailable = 10
$ExitPrecondition = 20
$ExitTimeout = 30
$ExitChildFailed = 40

$CanonicalRepoRoot = 'T:\Weav'
$DefaultOpenCodeModel = 'opencode/big-pickle'
$UserProfilePath = [Environment]::GetFolderPath('UserProfile')
$AntigravitySettingsPath = Join-Path $UserProfilePath '.gemini\antigravity-cli\settings.json'

function Stop-AgentCli {
    param(
        [int]$Code,
        [string]$Reason
    )

    [Console]::Error.WriteLine(("agent-cli: status=blocked code={0} reason={1}" -f $Code, $Reason))
    exit $Code
}

function Get-CanonicalRepository {
    if (-not (Test-Path -LiteralPath $CanonicalRepoRoot -PathType Container)) {
        Stop-AgentCli $ExitPrecondition 'canonical-workspace-missing path=T:\Weav'
    }

    try {
        $resolved = (Resolve-Path -LiteralPath $CanonicalRepoRoot).Path.TrimEnd('\')
    }
    catch {
        Stop-AgentCli $ExitPrecondition 'canonical-workspace-unresolvable path=T:\Weav'
    }

    if (-not [string]::Equals($resolved, $CanonicalRepoRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Stop-AgentCli $ExitPrecondition ("canonical-workspace-required expected=T:\Weav actual={0}" -f $resolved)
    }

    return $resolved
}

function Get-CommandInfo {
    param(
        [string]$Name
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        return $null
    }

    $version = 'unknown'
    try {
        $versionLine = & $command.Source --version 2>$null | Select-Object -First 1
        if ($null -ne $versionLine) {
            $version = $versionLine.ToString().Trim()
        }
    }
    catch {
        $version = 'unknown'
    }

    return [pscustomobject]@{
        Name = $Name
        Path = $command.Source
        Version = $version
    }
}

function Test-AntigravityTrust {
    if (-not (Test-Path -LiteralPath $AntigravitySettingsPath -PathType Leaf)) {
        return [pscustomobject]@{
            Trusted = $false
            StaleAliases = @()
            Reason = 'antigravity-settings-missing'
        }
    }

    try {
        $settings = Get-Content -LiteralPath $AntigravitySettingsPath -Raw | ConvertFrom-Json
        $trustedWorkspaces = @($settings.trustedWorkspaces | ForEach-Object { $_.ToString() })
    }
    catch {
        return [pscustomobject]@{
            Trusted = $false
            StaleAliases = @()
            Reason = 'antigravity-settings-invalid-json'
        }
    }

    $trusted = $trustedWorkspaces | Where-Object {
        [string]::Equals($_.TrimEnd('\'), $CanonicalRepoRoot, [StringComparison]::OrdinalIgnoreCase)
    }
    $staleAliases = $trustedWorkspaces | Where-Object {
        [string]::Equals($_.TrimEnd('\'), 'T:\Weav_Alias', [StringComparison]::OrdinalIgnoreCase) -or
        [string]::Equals($_.TrimEnd('\'), 'E:\WeavSub', [StringComparison]::OrdinalIgnoreCase)
    }

    if ($null -eq $trusted) {
        return [pscustomobject]@{
            Trusted = $false
            StaleAliases = @($staleAliases)
            Reason = 'canonical-workspace-not-trusted'
        }
    }

    return [pscustomobject]@{
        Trusted = $true
        StaleAliases = @($staleAliases)
        Reason = 'ok'
    }
}

function ConvertTo-WindowsCommandLineArgument {
    param(
        [string]$Value
    )

    $doubleQuote = [char]34
    $escaped = $Value -replace ('(\\*)' + $doubleQuote), ('$1$1\' + $doubleQuote)
    $escaped = $escaped -replace '(\\+)$', '$1$1'
    return $doubleQuote + $escaped + $doubleQuote
}

function Invoke-CapturedProcess {
    param(
        [string]$FileName,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [int]$WaitTimeoutSec
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FileName
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $startInfo.Arguments = ($Arguments | ForEach-Object {
        ConvertTo-WindowsCommandLineArgument $_
    }) -join ' '

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo

    try {
        if (-not $process.Start()) {
            return [pscustomobject]@{
                Started = $false
                TimedOut = $false
                ExitCode = $ExitChildFailed
                StdOut = ''
                StdErr = 'process-start-returned-false'
            }
        }
    }
    catch {
        return [pscustomobject]@{
            Started = $false
            TimedOut = $false
            ExitCode = $ExitChildFailed
            StdOut = ''
            StdErr = $_.Exception.Message
        }
    }

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $completed = $process.WaitForExit($WaitTimeoutSec * 1000)

    if (-not $completed) {
        try {
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        }
        catch {
        }

        if (-not $process.HasExited) {
            try {
                $process.Kill()
            }
            catch {
            }
        }
        $process.WaitForExit()
        return [pscustomobject]@{
            Started = $true
            TimedOut = $true
            ExitCode = $ExitTimeout
            StdOut = $stdoutTask.GetAwaiter().GetResult()
            StdErr = $stderrTask.GetAwaiter().GetResult()
        }
    }

    return [pscustomobject]@{
        Started = $true
        TimedOut = $false
        ExitCode = $process.ExitCode
        StdOut = $stdoutTask.GetAwaiter().GetResult()
        StdErr = $stderrTask.GetAwaiter().GetResult()
    }
}

function Get-SafeDiagnostic {
    param(
        [string]$Text
    )

    $line = ($Text -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
    if ($null -eq $line) {
        return 'no-diagnostic-output'
    }

    $safe = $line.ToString()
    $safe = $safe -replace '(?i)(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+', '$1=[redacted]'
    $safe = $safe -replace '(?i)bearer\s+[^\s,;]+', 'Bearer [redacted]'
    if ($safe.Length -gt 240) {
        $safe = $safe.Substring(0, 240) + '...'
    }

    return $safe
}

function Get-FailureReason {
    param(
        [string]$StdOut,
        [string]$StdErr
    )

    $combined = "{0}`n{1}" -f $StdOut, $StdErr
    if ($combined -match '(?i)no available accounts|provider not found|credentials|agentrouter') {
        return 'provider-or-credential-unavailable'
    }
    if ($combined -match '(?i)sensitive words detected|policy') {
        return 'provider-policy-rejected'
    }
    if ($combined -match '(?i)concurrency limit|rate[_ -]?limit|too many requests') {
        return 'provider-concurrency-limited'
    }

    return 'child-cli-failed'
}

function Get-OpenCodeModel {
    if ([string]::IsNullOrWhiteSpace($Model)) {
        return $DefaultOpenCodeModel
    }

    if ($Model -match '(?i)^agentrouter/') {
        Stop-AgentCli $ExitUnavailable 'removed-agentrouter-model model=agentrouter/*'
    }

    return $Model.Trim()
}

function Get-Preflight {
    param(
        [ValidateSet('Antigravity', 'OpenCode')]
        [string]$CandidateTool
    )

    if ($CandidateTool -eq 'Antigravity') {
        $info = Get-CommandInfo 'agy'
        if ($null -eq $info) {
            return [pscustomobject]@{
                Tool = 'Antigravity'
                Ready = $false
                Code = $ExitUnavailable
                Reason = 'executable-not-found'
                Version = 'unknown'
            }
        }

        $trust = Test-AntigravityTrust
        if (-not $trust.Trusted) {
            return [pscustomobject]@{
                Tool = 'Antigravity'
                Ready = $false
                Code = $ExitPrecondition
                Reason = $trust.Reason
                Version = $info.Version
            }
        }

        $reason = 'ready'
        if ($trust.StaleAliases.Count -gt 0) {
            $reason = 'ready-stale-alias-ignored'
        }

        return [pscustomobject]@{
            Tool = 'Antigravity'
            Ready = $true
            Code = $ExitSuccess
            Reason = $reason
            Version = $info.Version
        }
    }

    $info = Get-CommandInfo 'opencode'
    if ($null -eq $info) {
        return [pscustomobject]@{
            Tool = 'OpenCode'
            Ready = $false
            Code = $ExitUnavailable
            Reason = 'executable-not-found'
            Version = 'unknown'
        }
    }

    $requestedModel = Get-OpenCodeModel
    $catalog = Invoke-CapturedProcess -FileName $info.Path -Arguments @('models') -WorkingDirectory $CanonicalRepoRoot -WaitTimeoutSec ([Math]::Min($TimeoutSec, 30))
    if ($catalog.TimedOut) {
        return [pscustomobject]@{
            Tool = 'OpenCode'
            Ready = $false
            Code = $ExitTimeout
            Reason = 'model-catalog-timeout'
            Version = $info.Version
        }
    }
    if ($catalog.ExitCode -ne 0) {
        return [pscustomobject]@{
            Tool = 'OpenCode'
            Ready = $false
            Code = $ExitUnavailable
            Reason = 'model-catalog-unavailable'
            Version = $info.Version
        }
    }

    $catalogModels = $catalog.StdOut -split '\r?\n' |
        ForEach-Object { $_ -replace '\x1b\[[0-9;]*m', '' } |
        ForEach-Object { $_.Trim() } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $modelIsAvailable = $catalogModels | Where-Object {
        [string]::Equals($_, $requestedModel, [StringComparison]::OrdinalIgnoreCase)
    }
    if ($null -eq $modelIsAvailable) {
        return [pscustomobject]@{
            Tool = 'OpenCode'
            Ready = $false
            Code = $ExitUnavailable
            Reason = ("model-not-in-catalog model={0}" -f $requestedModel)
            Version = $info.Version
        }
    }

    return [pscustomobject]@{
        Tool = 'OpenCode'
        Ready = $true
        Code = $ExitSuccess
        Reason = ("ready model={0}" -f $requestedModel)
        Version = $info.Version
    }
}

function Write-PreflightResult {
    param(
        [pscustomobject]$Result
    )

    $status = if ($Result.Ready) { 'ready' } else { 'blocked' }
    Write-Output ("agent-cli: tool={0} status={1} code={2} version={3} reason={4}" -f $Result.Tool, $status, $Result.Code, $Result.Version, $Result.Reason)
}

function Select-Tool {
    if ($Tool -ne 'Auto') {
        $result = Get-Preflight $Tool
        if (-not $result.Ready) {
            Stop-AgentCli $result.Code ("tool={0} reason={1}" -f $result.Tool, $result.Reason)
        }
        return $result.Tool
    }

    $antigravity = Get-Preflight 'Antigravity'
    if ($antigravity.Ready) {
        return 'Antigravity'
    }

    $openCode = Get-Preflight 'OpenCode'
    if ($openCode.Ready) {
        return 'OpenCode'
    }

    Stop-AgentCli $ExitUnavailable ("auto-selection-failed antigravity={0} opencode={1}" -f $antigravity.Reason, $openCode.Reason)
}

function Invoke-AgentRequest {
    param(
        [string]$SelectedTool,
        [string]$Repository
    )

    $arguments = [System.Collections.Generic.List[string]]::new()
    $childTimeoutSec = [Math]::Max(1, $TimeoutSec - 5)

    if ($SelectedTool -eq 'Antigravity') {
        [void]$arguments.Add('--print')
        [void]$arguments.Add($Prompt)
        [void]$arguments.Add('--output-format')
        [void]$arguments.Add('text')
        [void]$arguments.Add('--print-timeout')
        [void]$arguments.Add(("{0}s" -f $childTimeoutSec))
        [void]$arguments.Add('--mode')
        [void]$arguments.Add($(if ($Mode -eq 'AcceptEdits') { 'accept-edits' } else { 'plan' }))
        [void]$arguments.Add('--sandbox')
        $info = Get-CommandInfo 'agy'
    }
    else {
        [void]$arguments.Add('run')
        [void]$arguments.Add('--pure')
        [void]$arguments.Add('--dir')
        [void]$arguments.Add($Repository)
        [void]$arguments.Add('--format')
        [void]$arguments.Add('default')
        [void]$arguments.Add('-m')
        [void]$arguments.Add((Get-OpenCodeModel))
        [void]$arguments.Add($Prompt)
        $info = Get-CommandInfo 'opencode'
    }

    $result = Invoke-CapturedProcess -FileName $info.Path -Arguments $arguments.ToArray() -WorkingDirectory $Repository -WaitTimeoutSec $TimeoutSec
    if ($result.TimedOut) {
        Stop-AgentCli $ExitTimeout ("tool={0} reason=hard-timeout timeout_sec={1}" -f $SelectedTool, $TimeoutSec)
    }

    if (-not [string]::IsNullOrWhiteSpace($result.StdOut)) {
        Write-Output $result.StdOut.TrimEnd()
    }

    if ($result.ExitCode -ne 0) {
        $reason = Get-FailureReason $result.StdOut $result.StdErr
        $diagnostic = Get-SafeDiagnostic ("{0}`n{1}" -f $result.StdErr, $result.StdOut)
        if ($reason -eq 'provider-or-credential-unavailable' -or $reason -eq 'provider-policy-rejected' -or $reason -eq 'provider-concurrency-limited') {
            Stop-AgentCli $ExitUnavailable ("tool={0} reason={1} detail={2}" -f $SelectedTool, $reason, $diagnostic)
        }
        Stop-AgentCli $ExitChildFailed ("tool={0} reason={1} detail={2}" -f $SelectedTool, $reason, $diagnostic)
    }

    Write-Output ("agent-cli: tool={0} status=completed code=0" -f $SelectedTool)
}

$repository = Get-CanonicalRepository

if ($Action -eq 'Check') {
    if ($Tool -eq 'Auto') {
        $antigravityResult = Get-Preflight 'Antigravity'
        $openCodeResult = Get-Preflight 'OpenCode'
        Write-PreflightResult $antigravityResult
        Write-PreflightResult $openCodeResult
        if (-not $antigravityResult.Ready -and -not $openCodeResult.Ready) {
            $failedCode = [Math]::Max($antigravityResult.Code, $openCodeResult.Code)
            exit $failedCode
        }
        exit $ExitSuccess
    }

    $result = Get-Preflight $Tool
    Write-PreflightResult $result
    exit $result.Code
}

if ([string]::IsNullOrWhiteSpace($Prompt)) {
    Stop-AgentCli $ExitPrecondition 'run-prompt-required'
}
if (-not $AllowRepoContext) {
    Stop-AgentCli $ExitPrecondition 'explicit-AllowRepoContext-required-for-private-workspace'
}

$selectedTool = Select-Tool
Invoke-AgentRequest -SelectedTool $selectedTool -Repository $repository
