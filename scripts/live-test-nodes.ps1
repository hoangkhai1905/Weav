<#
.SYNOPSIS
    Live test for Weav's Telegram and Google Calendar/Drive workflow nodes, driven through the API Gateway.

.DESCRIPTION
    Replaces the UI for a manual live test. Logs in through the gateway, creates the connections and
    workflows it needs, and walks through the Telegram echo flow and the Google Calendar/Drive checks.
    Tokens, passwords, cookies and the bot token are kept in memory only and are never printed or written.
    See scripts/README.md for the preconditions.

.EXAMPLE
    .\scripts\live-test-nodes.ps1 -Flow telegram -Cleanup
#>
[CmdletBinding()]
param(
    [string]$GatewayUrl = 'http://localhost:3000',
    [ValidateSet('telegram', 'google', 'all')][string]$Flow = 'all',
    [string]$WorkspaceId,
    [switch]$Cleanup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Base = $GatewayUrl.TrimEnd('/')
$script:Token = $null
$script:Ws = $null
$script:Results = New-Object System.Collections.Generic.List[object]
$script:Workflows = New-Object System.Collections.Generic.List[object]
$script:Stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')

# ---------- helpers ----------

function Get-Prop($Object, [string]$Name) {
    if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}

function Read-Secret([string]$Prompt) {
    $secure = Read-Host -AsSecureString $Prompt
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $secure.Dispose() }
}

function Short([object]$Value, [int]$Max = 80) {
    $text = [string]$Value
    if ($text.Length -gt $Max) { return $text.Substring(0, $Max) + '...' }
    return $text
}

function Add-Result([string]$Step, [bool]$Ok, [string]$Detail = '') {
    $script:Results.Add([pscustomobject]@{ Step = $Step; Result = $(if ($Ok) { 'PASS' } else { 'FAIL' }); Detail = $Detail })
    $color = if ($Ok) { 'Green' } else { 'Red' }
    Write-Host ('  -> ' + $(if ($Ok) { 'PASS' } else { 'FAIL' }) + ' ' + $Step + $(if ($Detail) { ' (' + $Detail + ')' } else { '' })) -ForegroundColor $color
}

# Never prints headers or bodies; only the label, HTTP status and the API error code/message.
function Invoke-Api {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        $Body = $null,
        [switch]$NoAuth
    )
    $headers = @{ Accept = 'application/json' }
    if (-not $NoAuth) { $headers['Authorization'] = 'Bearer ' + $script:Token }
    $req = @{ UseBasicParsing = $true; TimeoutSec = 30; Method = $Method; Uri = ($script:Base + $Path); Headers = $headers }
    if ($null -ne $Body) {
        $req['ContentType'] = 'application/json; charset=utf-8'
        $req['Body'] = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 20 -Compress))
    }
    $status = 0
    $text = ''
    $netError = $null
    try {
        $r = Invoke-WebRequest @req
        $status = [int]$r.StatusCode
        $content = $r.Content
        $text = if ($content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($content) } else { [string]$content }
    } catch {
        $resp = Get-Prop $_.Exception 'Response'
        if ($null -ne $resp) {
            $status = [int]$resp.StatusCode
            $reader = New-Object IO.StreamReader($resp.GetResponseStream())
            try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
        } else {
            $netError = $_.Exception.Message
        }
    }
    $data = $null
    if (-not [string]::IsNullOrWhiteSpace($text)) {
        try { $data = $text | ConvertFrom-Json } catch { $data = $null }
    }
    $ok = ($status -ge 200 -and $status -lt 300)
    $err = Get-Prop $data 'error'
    $code = Get-Prop $err 'code'
    $message = Get-Prop $err 'message'
    if ($ok) {
        Write-Host ("  [{0}] HTTP {1}" -f $Label, $status) -ForegroundColor DarkGray
    } elseif ($status -eq 0) {
        Write-Host ("  [{0}] no response: {1}" -f $Label, (Short $netError 160)) -ForegroundColor Red
    } else {
        Write-Host ("  [{0}] HTTP {1} {2}: {3}" -f $Label, $status, $code, (Short $message 200)) -ForegroundColor Red
    }
    return [pscustomobject]@{ Ok = $ok; Status = $status; Code = $code; Message = $message; Data = $data }
}

# Records a PASS/FAIL result for a call and throws (aborting the current flow) when it failed.
function Confirm-Api($Response, [string]$Step) {
    if ($Response.Ok) { Add-Result $Step $true; return }
    Add-Result $Step $false ('HTTP ' + $Response.Status + ' ' + $Response.Code)
    throw ('Step failed: ' + $Step)
}

function New-Connection([string]$Provider, [string]$AuthType, [string]$Name) {
    $r = Invoke-Api 'create connection' 'POST' "/api/v1/workspaces/$script:Ws/connections" @{ name = $Name; provider = $Provider; authType = $AuthType }
    Confirm-Api $r "create $Provider connection"
    Write-Host ("  connection id={0} status={1}" -f $r.Data.id, $r.Data.status)
    return [string]$r.Data.id
}

function New-PublishedWorkflow([string]$Name, [hashtable]$Definition) {
    $base = "/api/v1/workspaces/$script:Ws/workflows"
    $r = Invoke-Api 'create workflow' 'POST' $base @{ name = $Name; description = 'Created by scripts/live-test-nodes.ps1' }
    Confirm-Api $r 'create workflow draft'
    $id = [string]$r.Data.workflowId
    $script:Workflows.Add([pscustomobject]@{ Name = $Name; Id = $id })
    $r = Invoke-Api 'save draft' 'PUT' "$base/$id/draft" @{ name = $Name; description = 'Created by scripts/live-test-nodes.ps1'; definition = $Definition; editorState = @{} }
    Confirm-Api $r 'save draft'
    $r = Invoke-Api 'publish' 'POST' "$base/$id/publish"
    if (-not $r.Ok) {
        switch ($r.Code) {
            'TELEGRAM_BOT_IN_USE' { Write-Host '  Hint: another active workflow already uses this bot connection. Pause it, or use a different bot.' -ForegroundColor Yellow }
            'TELEGRAM_WEBHOOK_REGISTRATION_FAILED' { Write-Host '  Hint: Telegram rejected setWebhook or could not be reached. Check the tunnel is up, WORKFLOW_PUBLIC_BASE_URL is the https tunnel URL, and the token is valid.' -ForegroundColor Yellow }
        }
        if ($r.Status -eq 409 -and $r.Code -ne 'TELEGRAM_BOT_IN_USE') { Write-Host '  Hint: 409 conflict; see the code above.' -ForegroundColor Yellow }
    }
    Confirm-Api $r 'publish workflow'
    Write-Host ("  workflow={0} version={1} (v{2}) status={3}" -f $id, $r.Data.versionId, $r.Data.version, $r.Data.status)
    return $id
}

function Show-Execution($Detail) {
    Write-Host ("    execution {0} status={1} trigger={2}" -f $Detail.executionId, $Detail.status, (Get-Prop $Detail 'triggerType'))
    foreach ($n in @(Get-Prop $Detail 'nodes')) {
        $err = Get-Prop $n 'error'
        $code = Get-Prop $err 'code'
        Write-Host ("      {0,-18} {1}{2}" -f $n.nodeId, $n.status, $(if ($code) { ' error=' + $code } else { '' }))
    }
}

function Find-Node($Detail, [string]$NodeId) {
    foreach ($n in @(Get-Prop $Detail 'nodes')) { if ($n.nodeId -eq $NodeId) { return $n } }
    return $null
}

# ---------- login, preflight, workspace ----------

function Connect-Gateway {
    Write-Host '== Preflight ==' -ForegroundColor Cyan
    $r = Invoke-Api 'gateway ready' 'GET' '/ready' -NoAuth
    if (-not $r.Ok) {
        Add-Result 'gateway readiness' $false ('HTTP ' + $r.Status)
        throw ('Gateway is not ready at ' + $script:Base + '. Start the dev stack first.')
    }
    Add-Result 'gateway readiness' $true

    $email = Read-Host 'Weav email'
    $password = Read-Secret 'Weav password'
    $r = Invoke-Api 'login' 'POST' '/api/auth/login' @{ email = $email; password = $password } -NoAuth
    $password = $null
    if (-not $r.Ok -or -not (Get-Prop $r.Data 'accessToken')) {
        Add-Result 'login' $false ('HTTP ' + $r.Status)
        throw 'Login failed.'
    }
    $script:Token = [string]$r.Data.accessToken
    Add-Result 'login' $true

    if ([string]::IsNullOrWhiteSpace($WorkspaceId)) {
        $r = Invoke-Api 'list workspaces' 'GET' '/api/v1/workspaces'
        Confirm-Api $r 'list workspaces'
        $items = @(Get-Prop $r.Data 'items')
        if ($items.Count -eq 0) { throw 'The account has no workspace. Create one first.' }
        $script:Ws = [string]$items[0].id
        Write-Host ("  Using workspace '{0}' ({1})" -f $items[0].name, $script:Ws)
    } else {
        $script:Ws = $WorkspaceId
        $r = Invoke-Api 'get workspace' 'GET' "/api/v1/workspaces/$script:Ws"
        Confirm-Api $r 'get workspace'
        Write-Host ("  Using workspace '{0}' ({1})" -f $r.Data.name, $script:Ws)
    }
}

# ---------- Telegram flow ----------

function Invoke-TelegramFlow {
    Write-Host ''
    Write-Host '== Telegram echo flow ==' -ForegroundColor Cyan
    Write-Host @'
Preconditions (all must be true before you continue):
  1. The dev stack is up (gateway, workspace-service, workflow-service).
  2. A Cloudflare quick tunnel is running:  cloudflared tunnel --url http://localhost:3000
  3. WORKFLOW_PUBLIC_BASE_URL in .env is the tunnel's https URL and workflow-service was restarted.
  4. You created a bot with @BotFather and have its token.
'@
    [void](Read-Host 'Press Enter when ready')

    $botToken = Read-Secret 'Telegram bot token (input hidden)'
    $connId = New-Connection 'TELEGRAM' 'TOKEN' ('Weav live test bot ' + $script:Stamp)
    $base = "/api/v1/workspaces/$script:Ws/connections/$connId"
    $r = Invoke-Api 'save bot token' 'PUT' "$base/credential" @{ payload = @{ token = $botToken } }
    $botToken = $null
    Confirm-Api $r 'save bot token'
    $r = Invoke-Api 'test connection' 'POST' "$base/test"
    Confirm-Api $r 'verify bot token (getMe)'
    if ($r.Data.outcome -ne 'VERIFIED') {
        Add-Result 'bot token verified' $false ('outcome ' + $r.Data.outcome)
        throw 'Telegram rejected the bot token.'
    }
    $r = Invoke-Api 'get connection' 'GET' $base
    Confirm-Api $r 'read connection'
    Write-Host ("  connection id={0} status={1}" -f $connId, $r.Data.status)
    Add-Result 'telegram connection ACTIVE' ($r.Data.status -eq 'ACTIVE') ('status ' + $r.Data.status)
    if ($r.Data.status -ne 'ACTIVE') { throw 'Connection is not ACTIVE.' }

    $definition = @{
        schemaVersion = '1.0'
        nodes = @(
            @{ id = 'manual'; type = 'trigger.manual'; config = @{} },
            @{ id = 'telegram-trigger'; type = 'trigger.telegram'; config = @{ connectionId = $connId } },
            @{ id = 'echo'; type = 'telegram.send_message'; config = @{
                    connectionId = $connId
                    chatId = '{{ trigger.input.message.chat.id }}'
                    text = 'Echo: {{ trigger.input.message.text }}'
                } }
        )
        edges = @(
            @{ id = 'e1'; source = 'telegram-trigger'; target = 'echo' }
        )
    }
    $wf = New-PublishedWorkflow ('Live test Telegram echo ' + $script:Stamp) $definition

    $r = Invoke-Api 'get workflow' 'GET' "/api/v1/workspaces/$script:Ws/workflows/$wf"
    Confirm-Api $r 'read workflow triggers'
    $telegramTrigger = @(Get-Prop $r.Data 'triggers') | Where-Object { $_.type -eq 'TELEGRAM' } | Select-Object -First 1
    if ($null -eq $telegramTrigger) {
        Add-Result 'telegram trigger registered' $false 'no TELEGRAM trigger in workflow'
        throw 'No Telegram trigger registration found.'
    }
    Write-Host ("  trigger status={0} reasonCode={1}" -f $telegramTrigger.status, $telegramTrigger.reasonCode)
    if ($telegramTrigger.status -ne 'ACTIVE') {
        if ($telegramTrigger.reasonCode -eq 'DEPENDENCY_NOT_CONFIGURED') {
            Write-Host '  Hint: WORKFLOW_PUBLIC_BASE_URL is missing or not an https URL (or workflow-service was not restarted after setting it).' -ForegroundColor Yellow
        }
        Add-Result 'telegram trigger ACTIVE' $false ('reason ' + $telegramTrigger.reasonCode)
        throw 'Telegram trigger is disabled.'
    }
    Add-Result 'telegram trigger ACTIVE' $true

    Write-Host ''
    Write-Host 'Now send a text message to your bot in Telegram. Polling executions every 3 s for up to 2 minutes...' -ForegroundColor Yellow
    $seen = @{}
    $terminal = @('SUCCESS', 'FAILED', 'CANCELLED')
    $deadline = (Get-Date).AddSeconds(120)
    $anySuccess = $false
    $anyTerminal = $false
    while ((Get-Date) -lt $deadline -and -not $anyTerminal) {
        $page = Invoke-Api 'list executions' 'GET' "/api/v1/workspaces/$script:Ws/workflows/$wf/executions?page=0&size=20"
        if ($page.Ok) {
            foreach ($item in @(Get-Prop $page.Data 'items')) {
                if ($seen[$item.executionId] -eq $item.status) { continue }
                $seen[$item.executionId] = $item.status
                $d = Invoke-Api 'execution detail' 'GET' "/api/v1/workspaces/$script:Ws/workflows/$wf/executions/$($item.executionId)"
                if ($d.Ok) { Show-Execution $d.Data }
                if ($terminal -contains $item.status) {
                    $anyTerminal = $true
                    if ($item.status -eq 'SUCCESS') { $anySuccess = $true }
                }
            }
        }
        if (-not $anyTerminal) { Start-Sleep -Seconds 3 }
    }
    if ($seen.Count -eq 0) {
        Add-Result 'telegram execution observed' $false 'no execution within 2 minutes'
        Write-Host '  Hint: check the tunnel is reachable, getWebhookInfo shows the tunnel URL with no last_error_message, and you messaged the right bot with plain text.' -ForegroundColor Yellow
    } else {
        Add-Result 'telegram execution SUCCESS' $anySuccess
    }
    Write-Host '  Check Telegram: the bot should have replied "Echo: <your text>".' -ForegroundColor Yellow
    if ($Cleanup) {
        Write-Host '  After cleanup (pause) getWebhookInfo should show an empty url.' -ForegroundColor Yellow
    }
}

# ---------- Google flow ----------

function Connect-GoogleProvider([string]$Provider, [string]$Name) {
    Write-Host ''
    Write-Host ("-- {0} --" -f $Provider) -ForegroundColor Cyan
    $connId = New-Connection $Provider 'OAUTH2' $Name
    $base = "/api/v1/workspaces/$script:Ws/connections/$connId"
    $r = Invoke-Api 'start oauth' 'POST' "$base/oauth/authorize"
    Confirm-Api $r 'start Google OAuth'
    Write-Host ''
    Write-Host 'Open this URL in your browser and grant access (do not share it, it holds one-time state):' -ForegroundColor Yellow
    Write-Host ('  ' + $r.Data.authorizationUrl)
    Write-Host @'

After consent Google redirects to GOOGLE_OAUTH_FRONTEND_RETURN_URL (default http://localhost:5173/connections)
with oauth=pending&completion=... in the address bar. The page itself may not load; that is fine.
Copy the full URL from the address bar (or just the completion value) within 5 minutes.
'@
    $raw = Read-Secret 'Redirected URL or completion value (input hidden)'
    if ($raw -match 'oauth=failed') {
        $reason = [regex]::Match($raw, 'reason=([a-z_]+)').Groups[1].Value
        Add-Result "$Provider authorization" $false ('oauth=failed ' + $reason)
        throw 'Google authorization failed.'
    }
    $m = [regex]::Match($raw, 'completion=([A-Za-z0-9_-]{32,128})')
    if ($m.Success) { $completion = $m.Groups[1].Value }
    elseif ($raw.Trim() -match '^[A-Za-z0-9_-]{32,128}$') { $completion = $raw.Trim() }
    else {
        Add-Result "$Provider authorization" $false 'no completion value found in input'
        throw 'No completion value found.'
    }
    $raw = $null
    $r = Invoke-Api 'complete oauth' 'POST' "$base/oauth/complete" @{ completion = $completion }
    $completion = $null
    Confirm-Api $r 'complete Google OAuth'
    if ($r.Data.outcome -ne 'VERIFIED') {
        Add-Result "$Provider verified" $false ('outcome ' + $r.Data.outcome)
        throw 'Google connection was not verified (required scopes missing?).'
    }
    $deadline = (Get-Date).AddMinutes(5)
    $status = ''
    do {
        $r = Invoke-Api 'get connection' 'GET' $base
        Confirm-Api $r 'read connection'
        $status = [string]$r.Data.status
        if ($status -eq 'ACTIVE') { break }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    Write-Host ("  connection id={0} status={1}" -f $connId, $status)
    Add-Result "$Provider connection ACTIVE" ($status -eq 'ACTIVE') ('status ' + $status)
    if ($status -ne 'ACTIVE') { throw 'Connection did not become ACTIVE.' }
    return $connId
}

function Invoke-GoogleFlow {
    Write-Host ''
    Write-Host '== Google Calendar and Drive flow ==' -ForegroundColor Cyan
    Write-Host @'
Preconditions: GOOGLE_OAUTH_CLIENT_ID/SECRET are set in .env, the Google OAuth client allows the redirect URI
http://localhost:8082/oauth/google/callback, and your Google account is a test user of the OAuth consent screen.
'@
    [void](Read-Host 'Press Enter when ready')
    $calId = Connect-GoogleProvider 'GOOGLE_CALENDAR' ('Weav live test calendar ' + $script:Stamp)
    $driveId = Connect-GoogleProvider 'GOOGLE_DRIVE' ('Weav live test drive ' + $script:Stamp)

    # ponytail: no IANA time zone mapping on PowerShell 5.1; RFC 3339 date-times carry the local offset instead.
    $fmt = "yyyy-MM-dd'T'HH:mm:sszzz"
    $now = [DateTimeOffset]::Now
    $start = $now.AddHours(1).ToString($fmt, [Globalization.CultureInfo]::InvariantCulture)
    $end = $now.AddMinutes(90).ToString($fmt, [Globalization.CultureInfo]::InvariantCulture)
    $fileName = 'weav-live-test-' + $script:Stamp + '.txt'
    $definition = @{
        schemaVersion = '1.0'
        nodes = @(
            @{ id = 'manual'; type = 'trigger.manual'; config = @{} },
            @{ id = 'calendar'; type = 'google.calendar'; config = @{
                    connectionId = $calId; summary = 'Weav live test'; start = $start; end = $end; sendInvitations = $false } },
            @{ id = 'drive-upload'; type = 'google.drive'; config = @{
                    connectionId = $driveId; operation = 'upload'; name = $fileName
                    content = ('Weav live test ' + $script:Stamp); mimeType = 'text/plain' } },
            @{ id = 'drive-list'; type = 'google.drive'; config = @{
                    connectionId = $driveId; operation = 'list'; nameContains = 'weav-live-test'; pageSize = 10 } }
        )
        edges = @(
            @{ id = 'e1'; source = 'manual'; target = 'calendar' },
            @{ id = 'e2'; source = 'calendar'; target = 'drive-upload' },
            @{ id = 'e3'; source = 'drive-upload'; target = 'drive-list' }
        )
    }
    $wf = New-PublishedWorkflow ('Live test Google ' + $script:Stamp) $definition

    $base = "/api/v1/workspaces/$script:Ws/workflows/$wf"
    $r = Invoke-Api 'run manually' 'POST' "$base/executions" @{ input = @{} }
    Confirm-Api $r 'start manual execution'
    $execId = [string]$r.Data.executionId

    $deadline = (Get-Date).AddMinutes(2)
    $detail = $null
    do {
        Start-Sleep -Seconds 2
        $d = Invoke-Api 'execution detail' 'GET' "$base/executions/$execId"
        if ($d.Ok) { $detail = $d.Data }
    } while ((Get-Date) -lt $deadline -and ($null -eq $detail -or @('SUCCESS', 'FAILED', 'CANCELLED') -notcontains $detail.status))
    if ($null -eq $detail) { Add-Result 'google execution detail' $false 'never readable'; throw 'No execution detail.' }
    Show-Execution $detail

    foreach ($id in @('calendar', 'drive-upload', 'drive-list')) {
        $n = Find-Node $detail $id
        $ok = ($null -ne $n -and $n.status -eq 'SUCCESS')
        Add-Result ("google node $id") $ok $(if ($null -ne $n) { [string]$n.status } else { 'missing' })
    }
    $out = Get-Prop (Find-Node $detail 'calendar') 'output'
    if ($out) { Write-Host ("  event id={0} link={1}" -f (Get-Prop $out 'eventId'), (Get-Prop $out 'htmlLink')) }
    $out = Get-Prop (Find-Node $detail 'drive-upload') 'output'
    if ($out) { Write-Host ("  file id={0} name={1} link={2}" -f (Get-Prop $out 'id'), (Get-Prop $out 'name'), (Get-Prop $out 'webViewLink')) }
    $out = Get-Prop (Find-Node $detail 'drive-list') 'output'
    if ($out) {
        $names = @(Get-Prop $out 'files') | ForEach-Object { Get-Prop $_ 'name' }
        Write-Host ("  listed files: {0}" -f ($names -join ', '))
    }
    Add-Result 'google execution SUCCESS' ($detail.status -eq 'SUCCESS') ('status ' + $detail.status)
}

# ---------- main ----------

try {
    Connect-Gateway
    if ($Flow -in @('telegram', 'all')) {
        try { Invoke-TelegramFlow } catch { Write-Host ('  Telegram flow stopped: ' + $_.Exception.Message) -ForegroundColor Red }
    }
    if ($Flow -in @('google', 'all')) {
        try { Invoke-GoogleFlow } catch { Write-Host ('  Google flow stopped: ' + $_.Exception.Message) -ForegroundColor Red }
    }
    if ($Cleanup -and $script:Workflows.Count -gt 0) {
        Write-Host ''
        Write-Host '== Cleanup (pause created workflows) ==' -ForegroundColor Cyan
        foreach ($w in $script:Workflows) {
            $r = Invoke-Api 'pause' 'POST' "/api/v1/workspaces/$script:Ws/workflows/$($w.Id)/pause"
            Add-Result ('pause ' + $w.Name) $r.Ok $(if ($r.Ok) { '' } else { 'HTTP ' + $r.Status + ' ' + $r.Code })
        }
    }
} catch {
    Write-Host ('Stopped: ' + $_.Exception.Message) -ForegroundColor Red
    if (-not ($script:Results | Where-Object { $_.Result -eq 'FAIL' })) { Add-Result 'run' $false (Short $_.Exception.Message 120) }
} finally {
    $script:Token = $null
}

Write-Host ''
Write-Host '== Summary ==' -ForegroundColor Cyan
($script:Results | Format-Table Step, Result, Detail -AutoSize | Out-String).TrimEnd() | Write-Host
Write-Host ''
Write-Host 'Verify by eye:' -ForegroundColor Cyan
Write-Host '  [ ] Telegram: the bot echoed "Echo: <your text>" back to you'
Write-Host '  [ ] Google Calendar: event "Weav live test" exists at the expected local time (about 1 h from the run, 30 min long)'
Write-Host '  [ ] Google Drive: file weav-live-test-<timestamp>.txt exists'
Write-Host '  [ ] Consent screens listed only calendar.events (Calendar) / drive.file (Drive) plus openid and email'

$failed = @($script:Results | Where-Object { $_.Result -eq 'FAIL' }).Count
if ($failed -gt 0) { exit 1 }
exit 0
