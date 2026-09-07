[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Load only function declarations: never run bridge preflight or an external model.
$bridgePath = Join-Path $PSScriptRoot 'agent-cli.ps1'
$parseTokens = $null
$parseErrors = $null
$bridgeAst = [System.Management.Automation.Language.Parser]::ParseFile($bridgePath, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Bridge parse failed.' }
foreach ($declaration in $bridgeAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([scriptblock]::Create($declaration.Extent.Text))
}
$realCapturedProcess = ${function:Invoke-CapturedProcess}
$ExitUnavailable = 10
$ExitTimeout = 30
$ExitChildFailed = 40
$DefaultOpenCodeModel = 'opencode/big-pickle'
$TimeoutSec = 20
$Prompt = 'Synthetic test prompt'
$Mode = 'Plan'
$Model = ''
$script:failures = 0
$script:passed = 0

function Assert-True { param([bool]$Condition, [string]$Message) if (-not $Condition) { throw $Message } }
function Get-CommandInfo { param([string]$Name) [pscustomobject]@{ Path = 'fake-cli.exe'; Version = 'test' } }
function Stop-AgentCli { param([int]$Code, [string]$Reason) throw "STOP:$Code $Reason" }
function Invoke-CapturedProcess {
    param([string]$FileName, [string[]]$Arguments, [string]$WorkingDirectory, [int]$WaitTimeoutSec, [hashtable]$EnvironmentOverrides)
    $script:capturedArguments = $Arguments
    $script:capturedEnvironment = $EnvironmentOverrides
    return $script:childResult
}
function Invoke-TestRequest {
    param([string]$SelectedTool = 'OpenCode')
    $errorWriter = [System.IO.StringWriter]::new()
    $previousError = [Console]::Error
    $output = ''
    $failure = ''
    try {
        [Console]::SetError($errorWriter)
        try { $output = (Invoke-AgentRequest -SelectedTool $SelectedTool -Repository 'T:\Weav' | Out-String) }
        catch { $failure = $_.Exception.Message }
    }
    finally { [Console]::SetError($previousError) }
    [pscustomobject]@{ Output = $output; Diagnostic = $errorWriter.ToString(); Failure = $failure }
}
function Test-Case {
    param([string]$Name, [scriptblock]$Body)
    $script:childResult = [pscustomobject]@{ Started = $true; TimedOut = $false; ExitCode = 0; StdOut = 'synthetic answer'; StdErr = '' }
    try { & $Body; $script:passed++; Write-Output "PASS $Name" }
    catch { $script:failures++; Write-Output "FAIL $Name - $($_.Exception.Message)" }
}

Test-Case 'empty successful child response fails' {
    $script:childResult.StdOut = " `r`n"
    $actual = Invoke-TestRequest
    Assert-True ($actual.Failure -match 'STOP:40.*empty-response') 'Empty stdout must fail with code 40.'
}
Test-Case 'successful response keeps redacted stderr diagnostics' {
    $script:childResult.StdErr = "warning: token=synthetic-secret`nwarning: second detail"
    $actual = Invoke-TestRequest
    Assert-True ($actual.Failure -eq '') 'Nonempty successful response should complete.'
    Assert-True ($actual.Diagnostic -match 'second detail') 'Successful stderr details were suppressed.'
    Assert-True ($actual.Diagnostic -notmatch 'synthetic-secret') 'Diagnostic leaked a synthetic token.'
}
Test-Case 'diagnostics redact complete authorization and cookie header values' {
    foreach ($sensitiveLine in @('Authorization: Basic synthetic-basic-secret', 'Cookie: session=synthetic-session; second=synthetic-cookie-secret', 'Set-Cookie: session=synthetic-set-cookie-secret; Path=/')) {
        $safe = Get-SafeDiagnostic $sensitiveLine
        Assert-True ($safe -notmatch 'synthetic-') 'HTTP credential header retained a sensitive value.'
    }
}
Test-Case 'stderr output is bounded to five lines' {
    $script:childResult.StdErr = ((1..7 | ForEach-Object { "Synthetic diagnostic $_" }) -join "`n")
    $actual = Invoke-TestRequest
    Assert-True ($actual.Diagnostic -match 'Synthetic diagnostic 5') 'Expected fifth diagnostic missing.'
    Assert-True ($actual.Diagnostic -notmatch 'Synthetic diagnostic [67]') 'Diagnostic line bound exceeded.'
}
Test-Case 'provider failure preserves unavailable code' {
    $script:childResult.ExitCode = 1
    $script:childResult.StdErr = 'No available accounts'
    Assert-True ((Invoke-TestRequest).Failure -match 'STOP:10.*provider-or-credential-unavailable') 'Provider code changed.'
}
Test-Case 'ordinary child failure preserves code 40' {
    $script:childResult.ExitCode = 2
    $script:childResult.StdErr = 'Synthetic execution failed'
    Assert-True ((Invoke-TestRequest).Failure -match 'STOP:40') 'Child failure code changed.'
}
Test-Case 'timeout retains diagnostic and code 30' {
    $script:childResult.TimedOut = $true
    $script:childResult.StdErr = 'Synthetic timeout context'
    $actual = Invoke-TestRequest
    Assert-True ($actual.Failure -match 'STOP:30') 'Timeout code changed.'
    Assert-True ($actual.Diagnostic -match 'Synthetic timeout context') 'Timeout lost stderr evidence.'
}
Test-Case 'Antigravity forwards explicit model' {
    $Model = 'synthetic-model'
    $null = Invoke-TestRequest 'Antigravity'
    $index = [Array]::IndexOf($script:capturedArguments, '--model')
    Assert-True ($index -ge 0) 'Missing --model flag.'
    Assert-True ($script:capturedArguments[$index + 1] -eq $Model) 'Wrong forwarded model.'
}
Test-Case 'OpenCode Plan enforces process-local permission boundary' {
    $Mode = 'Plan'
    $null = Invoke-TestRequest
    $index = [Array]::IndexOf($script:capturedArguments, '--agent')
    Assert-True ($index -ge 0) 'Missing --agent flag.'
    Assert-True ($script:capturedArguments[$index + 1] -eq 'plan') 'Wrong Plan agent.'
    Assert-True ($null -ne $script:capturedEnvironment) 'Missing process permission overrides.'
    $policy = $script:capturedEnvironment['OPENCODE_PERMISSION'] | ConvertFrom-Json
    Assert-True ($policy.'*' -eq 'deny') 'Plan must deny unspecified tools including mutations.'
    Assert-True ($policy.read.'*.env' -eq 'deny') 'Plan must retain sensitive file protection.'
    Assert-True ($script:capturedArguments -notcontains '--auto') 'Unsafe auto flag present.'
}
Test-Case 'OpenCode AcceptEdits selects build without bypass' {
    $Mode = 'AcceptEdits'
    $null = Invoke-TestRequest
    $index = [Array]::IndexOf($script:capturedArguments, '--agent')
    Assert-True ($index -ge 0) 'Missing --agent flag.'
    Assert-True ($script:capturedArguments[$index + 1] -eq 'build') 'Wrong AcceptEdits agent.'
    Assert-True ($script:capturedArguments -notcontains '--auto') 'Unsafe auto flag present.'
}
Test-Case 'actual subprocess receives override without changing parent environment' {
    $priorValue = [Environment]::GetEnvironmentVariable('WEAV_BRIDGE_TEST_VALUE', 'Process')
    $actual = & $realCapturedProcess -FileName (Join-Path $PSHOME 'powershell.exe') -Arguments @('-NoProfile', '-Command', '[Console]::Write($env:WEAV_BRIDGE_TEST_VALUE)') -WorkingDirectory 'T:\Weav' -WaitTimeoutSec 10 -EnvironmentOverrides @{ WEAV_BRIDGE_TEST_VALUE = 'child-only-value' }
    Assert-True ($actual.ExitCode -eq 0 -and $actual.StdOut -eq 'child-only-value') 'Child did not receive process-local override.'
    Assert-True ([Environment]::GetEnvironmentVariable('WEAV_BRIDGE_TEST_VALUE', 'Process') -eq $priorValue) 'Parent environment changed.'
}

Write-Output ("Tests: {0} passed, {1} failed" -f $script:passed, $script:failures)
if ($script:failures -gt 0) { exit 1 }
