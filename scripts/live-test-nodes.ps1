<#
.SYNOPSIS
    Live test for Weav's workflow nodes (Telegram, Google, logic.switch/data.set, ai.generate, trigger.gmail) and the AI assistant, driven through the API Gateway.

.DESCRIPTION
    Replaces the UI for a manual live test. Logs in through the gateway, creates the connections and
    workflows it needs, and walks through the Telegram echo flow and the Google Calendar/Drive checks.
    Tokens, passwords, cookies and the bot token are kept in memory only and are never printed or written.
    See scripts/README.md for the preconditions.

    The assistant flow makes about 4 chats (roughly 8-12 small DeepSeek calls per run). It needs
    AI_ASSISTANT_ENABLED=true, the ai-service DB migrated (pnpm --dir services/ai-service db:migrate)
    and identity signing RS256 access tokens.

.EXAMPLE
    .\scripts\live-test-nodes.ps1 -Flow telegram -Cleanup
#>
[CmdletBinding()]
param(
    [string]$GatewayUrl = 'http://localhost:3000',
    [ValidateSet('telegram', 'google', 'logic', 'ai', 'gmail', 'attachments', 'assistant', 'all')][string]$Flow = 'all',
    [string]$WorkspaceId,
    [ValidateScript({ [string]::IsNullOrEmpty($_) -or ($_ -as [guid]) })][string]$GmailConnectionId,
    [switch]$Cleanup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Base = $GatewayUrl.TrimEnd('/')
$script:Token = $null
$script:Ws = $null
$script:Results = New-Object System.Collections.Generic.List[object]
$script:Workflows = New-Object System.Collections.Generic.List[object]
$script:Conversations = New-Object System.Collections.Generic.List[string]
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
                } },
            @{ id = 'echo-html'; type = 'telegram.send_message'; config = @{
                    connectionId = $connId
                    chatId = '{{ trigger.input.message.chat.id }}'
                    text = '<b>Weav</b> live test: HTML, silent, reply'
                    parseMode = 'HTML'
                    disableNotification = $true
                    replyToMessageId = '{{ trigger.input.message.messageId }}'
                } }
        )
        edges = @(
            @{ id = 'e1'; source = 'telegram-trigger'; target = 'echo' },
            @{ id = 'e2'; source = 'echo'; target = 'echo-html' }
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
    $doneDetail = $null
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
                    if ($d.Ok) { $doneDetail = $d.Data }
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
        if ($null -ne $doneDetail) {
            $n = Find-Node $doneDetail 'echo-html'
            Add-Result 'telegram send with parseMode HTML, silent, reply' ($null -ne $n -and $n.status -eq 'SUCCESS') $(if ($null -ne $n) { [string]$n.status } else { 'missing' })
        }
    }
    Write-Host '  Check Telegram: the bot should have replied "Echo: <your text>", then a bold "Weav" message as a silent reply to your message.' -ForegroundColor Yellow
    if ($Cleanup) {
        Write-Host '  After cleanup (pause) getWebhookInfo should show an empty url.' -ForegroundColor Yellow
    }
}

# ---------- Google flow ----------

function Connect-GoogleProvider([string]$Provider, [string]$Name, [string]$ExistingConnectionId = '') {
    Write-Host ''
    Write-Host ("-- {0} --" -f $Provider) -ForegroundColor Cyan
    # An existing id means reconnect: the same authorize/complete flow replaces the stored grant and keeps the id.
    $connId = if ($ExistingConnectionId) { $ExistingConnectionId } else { New-Connection $Provider 'OAUTH2' $Name }
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
                    connectionId = $driveId; operation = 'list'; nameContains = 'weav-live-test'; pageSize = 10 } },
            @{ id = 'calendar-list'; type = 'google.calendar'; config = @{
                    connectionId = $calId; operation = 'list'; maxResults = 5 } }
        )
        edges = @(
            @{ id = 'e1'; source = 'manual'; target = 'calendar' },
            @{ id = 'e2'; source = 'calendar'; target = 'drive-upload' },
            @{ id = 'e3'; source = 'drive-upload'; target = 'drive-list' },
            @{ id = 'e4'; source = 'drive-list'; target = 'calendar-list' }
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

    foreach ($id in @('calendar', 'drive-upload', 'drive-list', 'calendar-list')) {
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
    $out = Get-Prop (Find-Node $detail 'calendar-list') 'output'
    $listCount = Get-Prop $out 'count'
    $listOk = ($null -ne $listCount) -and ([int]$listCount -le 5) -and ($null -ne (Get-Prop $out 'truncated'))
    Add-Result 'calendar list returns count (max 5) and truncated' $listOk ('count ' + $listCount + ' truncated ' + (Get-Prop $out 'truncated'))
    Add-Warn 'sheets lookup not run' 'this flow has no Sheets connection; add one and a google.sheets lookup step to cover it'
    Add-Result 'google execution SUCCESS' ($detail.status -eq 'SUCCESS') ('status ' + $detail.status)
}

# Runs a published workflow manually and waits (up to 2 minutes) for a terminal state. Returns the execution detail.
function Invoke-ManualRun([string]$WorkflowId, [hashtable]$InputData, [string]$Label) {
    $base = "/api/v1/workspaces/$script:Ws/workflows/$WorkflowId"
    $r = Invoke-Api 'run manually' 'POST' "$base/executions" @{ input = $InputData }
    Confirm-Api $r "start $Label"
    $execId = [string]$r.Data.executionId
    $deadline = (Get-Date).AddMinutes(2)
    $detail = $null
    do {
        Start-Sleep -Seconds 2
        $d = Invoke-Api 'execution detail' 'GET' "$base/executions/$execId"
        if ($d.Ok) { $detail = $d.Data }
    } while ((Get-Date) -lt $deadline -and ($null -eq $detail -or @('SUCCESS', 'FAILED', 'CANCELLED') -notcontains $detail.status))
    if ($null -eq $detail) { Add-Result "$Label execution detail" $false 'never readable'; throw 'No execution detail.' }
    Show-Execution $detail
    return $detail
}

# ---------- logic flow (logic.switch, data.set) ----------

function Invoke-LogicFlow {
    Write-Host ''
    Write-Host '== Logic flow (data.set + logic.switch) ==' -ForegroundColor Cyan
    Write-Host 'Preconditions: dev stack up. No external service, connection or AI is used.'
    [void](Read-Host 'Press Enter when ready')

    $definition = @{
        schemaVersion = '1.0'
        nodes = @(
            @{ id = 'manual'; type = 'trigger.manual'; config = @{} },
            @{ id = 'shape'; type = 'data.set'; config = @{ fields = @{
                        name = '{{ trigger.input.user.first }}'
                        n = '{{ trigger.input.count }}'
                        plan = '{{ trigger.input.plan }}' } } },
            @{ id = 'route'; type = 'logic.switch'; config = @{ value = '{{ nodes.shape.output.plan }}'; cases = @('1', '2') } },
            @{ id = 'branch-one'; type = 'data.set'; config = @{ fields = @{ branch = 'one' } } },
            @{ id = 'branch-two'; type = 'data.set'; config = @{ fields = @{ branch = 'two' } } },
            @{ id = 'branch-default'; type = 'data.set'; config = @{ fields = @{ branch = 'default' } } },
            @{ id = 'all-of'; type = 'logic.condition'; config = @{ combinator = 'and'; conditions = @(
                        @{ left = '{{ nodes.shape.output.n }}'; operator = 'gt'; right = 5 },
                        @{ left = '{{ nodes.shape.output.plan }}'; operator = 'ne'; right = 'gold' }) } },
            @{ id = 'any-of'; type = 'logic.condition'; config = @{ combinator = 'or'; conditions = @(
                        @{ left = '{{ nodes.shape.output.n }}'; operator = 'gt'; right = 100 },
                        @{ left = '{{ nodes.shape.output.plan }}'; operator = 'eq'; right = 'gold' }) } },
            @{ id = 'all-yes'; type = 'data.set'; config = @{ fields = @{ branch = 'all-yes' } } },
            @{ id = 'all-no'; type = 'data.set'; config = @{ fields = @{ branch = 'all-no' } } },
            @{ id = 'any-yes'; type = 'data.set'; config = @{ fields = @{ branch = 'any-yes' } } },
            @{ id = 'any-no'; type = 'data.set'; config = @{ fields = @{ branch = 'any-no' } } }
        )
        edges = @(
            @{ id = 'e1'; source = 'manual'; target = 'shape' },
            @{ id = 'e2'; source = 'shape'; target = 'route' },
            @{ id = 'e3'; source = 'route'; target = 'branch-one'; sourcePort = '1' },
            @{ id = 'e4'; source = 'route'; target = 'branch-two'; sourcePort = '2' },
            @{ id = 'e5'; source = 'route'; target = 'branch-default'; sourcePort = 'default' },
            @{ id = 'e6'; source = 'shape'; target = 'all-of' },
            @{ id = 'e7'; source = 'shape'; target = 'any-of' },
            @{ id = 'e8'; source = 'all-of'; target = 'all-yes'; sourcePort = 'true' },
            @{ id = 'e9'; source = 'all-of'; target = 'all-no'; sourcePort = 'false' },
            @{ id = 'e10'; source = 'any-of'; target = 'any-yes'; sourcePort = 'true' },
            @{ id = 'e11'; source = 'any-of'; target = 'any-no'; sourcePort = 'false' }
        )
    }
    $wf = New-PublishedWorkflow ('Live test logic ' + $script:Stamp) $definition

    $branches = @('branch-one', 'branch-two', 'branch-default')
    $runs = @(
        @{ Label = 'case 1'; Input = @{ plan = 1; count = 7; user = @{ first = 'Ada' } }; Expect = 'branch-one'; Port = '1' },
        @{ Label = 'case 2'; Input = @{ plan = 2; count = 7; user = @{ first = 'Ada' } }; Expect = 'branch-two'; Port = '2' },
        @{ Label = 'no match'; Input = @{ plan = 'gold'; count = 7; user = @{ first = 'Ada' } }; Expect = 'branch-default'; Port = 'default' }
    )
    foreach ($run in $runs) {
        $label = 'logic ' + $run.Label
        Write-Host ("  -- run: {0} (plan={1})" -f $run.Label, $run.Input.plan)
        $detail = Invoke-ManualRun $wf $run.Input $label
        Add-Result "$label execution SUCCESS" ($detail.status -eq 'SUCCESS') ('status ' + $detail.status)

        $shape = Get-Prop (Find-Node $detail 'shape') 'output'
        $renamed = ([string](Get-Prop $shape 'name') -eq 'Ada') -and ([string](Get-Prop $shape 'plan') -eq [string]$run.Input.plan)
        $numOk = ($null -ne (Get-Prop $shape 'n')) -and ([string](Get-Prop $shape 'n') -eq '7')
        Add-Result "$label data.set renamed field and number" ($renamed -and $numOk) ('output ' + (Short (ConvertTo-Json -InputObject $shape -Compress -Depth 5) 100))

        $route = Get-Prop (Find-Node $detail 'route') 'output'
        Add-Result "$label switch port" ([string](Get-Prop $route 'port') -eq $run.Port) ('port ' + (Get-Prop $route 'port'))

        foreach ($b in $branches) {
            $n = Find-Node $detail $b
            $status = if ($null -ne $n) { [string]$n.status } else { 'missing' }
            $want = if ($b -eq $run.Expect) { 'SUCCESS' } else { 'SKIPPED' }
            Add-Result "$label $b is $want" ($status -eq $want) ('status ' + $status)
        }

        # Multi-condition form: all-of = (n > 5 AND plan != gold), any-of = (n > 100 OR plan == gold). n is always 7 here.
        $isGold = ([string]$run.Input.plan -eq 'gold')
        $want = @{
            'all-yes' = $(if ($isGold) { 'SKIPPED' } else { 'SUCCESS' }); 'all-no' = $(if ($isGold) { 'SUCCESS' } else { 'SKIPPED' })
            'any-yes' = $(if ($isGold) { 'SUCCESS' } else { 'SKIPPED' }); 'any-no' = $(if ($isGold) { 'SKIPPED' } else { 'SUCCESS' })
        }
        foreach ($b in @('all-yes', 'all-no', 'any-yes', 'any-no')) {
            $n = Find-Node $detail $b
            $status = if ($null -ne $n) { [string]$n.status } else { 'missing' }
            Add-Result "$label condition $b is $($want[$b])" ($status -eq $want[$b]) ('status ' + $status)
        }
    }
    Write-Host '  Text coercion (a mapped number into a string-only field) is not re-checked here: no side-effect-free node has such a field. The telegram flow (numeric chat id) and unit tests cover it.' -ForegroundColor DarkGray
}

# ---------- AI flow (ai.generate) ----------

function Invoke-AiFlow {
    Write-Host ''
    Write-Host '== AI flow (ai.generate) ==' -ForegroundColor Cyan
    Write-Host @'
Preconditions: the AI service is enabled (node scripts/ai-dev-keys.mjs; DEEPSEEK_API_KEY and DEEPSEEK_MODEL in .env;
WORKFLOW_AI_ENABLED=true and WORKFLOW_AI_GENERATION_ENABLED=true; stack started WITHOUT compose.ai-local.yml;
curl http://localhost:3001/health/ready is OK).
COST: one run; up to 3 real DeepSeek calls if it times out (retries). Each call uses 1 of the daily AI quota.
'@
    $answer = Read-Host 'Type yes to run it'
    if ($answer -ne 'yes') { Write-Host '  AI flow skipped.' -ForegroundColor Yellow; return }

    $definition = @{
        schemaVersion = '1.0'
        nodes = @(
            @{ id = 'manual'; type = 'trigger.manual'; config = @{} },
            @{ id = 'gen'; type = 'ai.generate'; config = @{
                    prompt = 'Write one short greeting about: {{ trigger.input.topic }}'
                    instructions = 'Answer in one sentence.'
                    maxLength = 200 } }
        )
        edges = @( @{ id = 'e1'; source = 'manual'; target = 'gen' } )
    }
    $wf = New-PublishedWorkflow ('Live test AI ' + $script:Stamp) $definition
    $detail = Invoke-ManualRun $wf @{ topic = 'coffee' } 'ai'
    $gen = Find-Node $detail 'gen'
    $code = Get-Prop (Get-Prop $gen 'error') 'code'
    if ($code -in @('DEPENDENCY_NOT_CONFIGURED')) {
        Write-Host '  Hint: AI is disabled. Follow the preconditions above (keys, WORKFLOW_AI_ENABLED, no compose.ai-local.yml), then restart workflow-service and ai-service.' -ForegroundColor Yellow
    } elseif ($code -eq 'AI_QUOTA_EXCEEDED') {
        Write-Host '  Hint: the daily AI quota is used up.' -ForegroundColor Yellow
    }
    Add-Result 'ai execution SUCCESS' ($detail.status -eq 'SUCCESS') ('status ' + $detail.status + $(if ($code) { ' error ' + $code } else { '' }))
    $text = [string](Get-Prop (Get-Prop $gen 'output') 'text')
    Add-Result 'ai.generate text non-empty' (-not [string]::IsNullOrWhiteSpace($text)) ('length ' + $text.Length)
    if ($text) {
        Write-Host ('  generated: ' + (Short $text 120))
        Add-Result 'ai.generate text within maxLength 200' ($text.Length -le 200) ('length ' + $text.Length)
    }
}

# ---------- Gmail trigger flow (trigger.gmail) ----------

function Invoke-GmailFlow {
    Write-Host ''
    Write-Host '== Gmail trigger flow (trigger.gmail) ==' -ForegroundColor Cyan
    Write-Host @'
Preconditions: GOOGLE_OAUTH_CLIENT_ID/SECRET set; gmail.readonly is added to the Google Cloud consent screen scopes
and the Gmail API is enabled; your Google account is a test user. A Gmail connection made before gmail.readonly was
added must be reconnected (pass -GmailConnectionId <id> to reconnect it instead of creating a new one).
You will need to send one email yourself while the script waits (a few minutes).
'@
    $answer = Read-Host 'Press Enter when ready (type skip to skip this flow)'
    if ($answer -eq 'skip') { Write-Host '  Gmail flow skipped.' -ForegroundColor Yellow; return }

    $connId = Connect-GoogleProvider 'GMAIL' ('Weav live test gmail ' + $script:Stamp) $GmailConnectionId
    $subject = 'Weav live test ' + $script:Stamp
    $definition = @{
        schemaVersion = '1.0'
        nodes = @(
            @{ id = 'manual'; type = 'trigger.manual'; config = @{} },
            @{ id = 'mail'; type = 'trigger.gmail'; config = @{
                    connectionId = $connId; query = ('in:inbox subject:"' + $subject + '"'); pollIntervalMinutes = 1 } },
            @{ id = 'copy'; type = 'data.set'; config = @{ fields = @{
                        from = '{{ trigger.input.from }}'
                        subject = '{{ trigger.input.subject }}'
                        snippet = '{{ trigger.input.snippet }}'
                        bodyTruncated = '{{ trigger.input.bodyTruncated }}'
                        bodyOmitted = '{{ trigger.input.bodyOmitted }}' } } }
        )
        edges = @( @{ id = 'e1'; source = 'mail'; target = 'copy' } )
    }
    $wf = New-PublishedWorkflow ('Live test Gmail ' + $script:Stamp) $definition
    $base = "/api/v1/workspaces/$script:Ws/workflows/$wf"

    $r = Invoke-Api 'get workflow' 'GET' $base
    Confirm-Api $r 'read workflow triggers'
    $trigger = @(Get-Prop $r.Data 'triggers') | Where-Object { $_.type -eq 'GMAIL' } | Select-Object -First 1
    if ($null -eq $trigger) { Add-Result 'gmail trigger registered' $false 'no GMAIL trigger in workflow'; throw 'No Gmail trigger registration found.' }
    Write-Host ("  trigger status={0} reasonCode={1}" -f $trigger.status, (Get-Prop $trigger 'reasonCode'))
    Add-Result 'gmail trigger ACTIVE' ($trigger.status -eq 'ACTIVE') ('status ' + $trigger.status)

    Write-Host ''
    Write-Host 'Send an email to the connected Gmail account now with this EXACT subject (any body):' -ForegroundColor Yellow
    Write-Host ('  ' + $subject) -ForegroundColor White
    Write-Host 'Polling the executions list every 10 s for up to 3 minutes...' -ForegroundColor Yellow
    $items = @()
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline -and $items.Count -eq 0) {
        Start-Sleep -Seconds 10
        $page = Invoke-Api 'list executions' 'GET' "$base/executions?page=0&size=20"
        if ($page.Ok) { $items = @(@(Get-Prop $page.Data 'items') | Where-Object { $_.triggerType -eq 'GMAIL' }) }
    }
    if ($items.Count -eq 0) {
        Add-Result 'gmail execution observed' $false 'no GMAIL run within 3 minutes'
        $r = Invoke-Api 'get workflow' 'GET' $base
        $trigger = @(Get-Prop $r.Data 'triggers') | Where-Object { $_.type -eq 'GMAIL' } | Select-Object -First 1
        $reason = Get-Prop $trigger 'reasonCode'
        Write-Host ("  trigger status={0} reasonCode={1}" -f (Get-Prop $trigger 'status'), $reason)
        $hints = @{
            CONNECTION_RECONNECT_REQUIRED = 'the connection lacks gmail.readonly, or its refresh token expired (Testing mode: 7 days). Re-run with -Flow gmail -GmailConnectionId <id> to reconnect it.'
            AUTHENTICATION_REJECTED = 'Google rejected the stored credential; reconnect the connection (-GmailConnectionId <id>).'
            CONNECTION_FORBIDDEN = 'the connection is not allowed for this workspace or Google denied access; check the connection and the test-user list.'
            CONNECTION_UNAVAILABLE = 'workspace-service could not resolve the connection; check the stack and retry.'
            GMAIL_POLL_FAILED = 'the Gmail poll failed (rate limit or outage); it retries every interval, check workflow-service logs.'
            GMAIL_MESSAGE_SKIPPED = 'a matching message was skipped (unreadable or vanished); send another email.'
            GMAIL_BACKLOG_TRUNCATED = 'more than 10 new matching emails arrived in one poll; only the newest were admitted.'
        }
        if ($reason -and $hints.ContainsKey([string]$reason)) {
            Write-Host ('  Hint: ' + $hints[[string]$reason]) -ForegroundColor Yellow
        } elseif ($reason) {
            Write-Host '  Hint: the poller recorded this reason; fix it and wait one more interval.' -ForegroundColor Yellow
        } else {
            Write-Host '  Hint: check the subject matches exactly, the mail is in the inbox, and the poller is enabled (weav.workflow.gmail.poller.enabled).' -ForegroundColor Yellow
        }
        return
    }
    Add-Result 'gmail exactly one run for the email' ($items.Count -eq 1) ('GMAIL runs ' + $items.Count)

    $detail = $null
    $execId = [string]$items[0].executionId
    $deadline = (Get-Date).AddMinutes(1)
    do {
        $d = Invoke-Api 'execution detail' 'GET' "$base/executions/$execId"
        if ($d.Ok) { $detail = $d.Data }
        $done = ($null -ne $detail -and @('SUCCESS', 'FAILED', 'CANCELLED') -contains $detail.status)
        if (-not $done) { Start-Sleep -Seconds 2 }
    } while ((Get-Date) -lt $deadline -and -not $done)
    if ($null -eq $detail) { Add-Result 'gmail execution detail' $false 'never readable'; throw 'No execution detail.' }
    Show-Execution $detail
    Add-Result 'gmail execution SUCCESS' ($detail.status -eq 'SUCCESS') ('status ' + $detail.status)
    Add-Result 'gmail trigger type GMAIL' ($detail.triggerType -eq 'GMAIL')

    # The body is never printed; its length is only known if the trigger node exposes its input as output.
    $in = Get-Prop (Find-Node $detail 'mail') 'output'
    if ($null -ne (Get-Prop $in 'input')) { $in = Get-Prop $in 'input' }
    $copy = Get-Prop (Find-Node $detail 'copy') 'output'
    $body = Get-Prop $in 'body'
    $bodyLen = if ($null -ne $body) { ([string]$body).Length } else { 'n/a' }
    Write-Host ("  from={0}" -f (Short (Get-Prop $copy 'from') 80))
    Write-Host ("  subject={0}" -f (Short (Get-Prop $copy 'subject') 80))
    Write-Host ("  snippet length={0}" -f ([string](Get-Prop $copy 'snippet')).Length)
    Write-Host ("  body length={0} bodyTruncated={1} bodyOmitted={2}" -f $bodyLen, (Get-Prop $copy 'bodyTruncated'), (Get-Prop $copy 'bodyOmitted'))
    Add-Result 'gmail subject copied by data.set' ([string](Get-Prop $copy 'subject') -like ('*' + $subject + '*')) (Short (Get-Prop $copy 'subject') 60)

    Write-Host '  Waiting two poll intervals (130 s) to check the same email does not start a duplicate run...' -ForegroundColor Yellow
    Start-Sleep -Seconds 130
    $page = Invoke-Api 'list executions' 'GET' "$base/executions?page=0&size=20"
    Confirm-Api $page 'list executions again'
    $count = @(@(Get-Prop $page.Data 'items') | Where-Object { $_.triggerType -eq 'GMAIL' }).Count
    Add-Result 'gmail no duplicate run after another poll' ($count -eq 1) ("GMAIL runs $count, expected 1")
}

# ---------- email attachments flow (email.send attachments/reply, trigger.gmail attachments) ----------

# Prints a hint for the failure codes this flow is most likely to hit; looks at every failed node of an execution.
function Write-AttachmentHints($Detail) {
    foreach ($n in @(Get-Prop $Detail 'nodes')) {
        $code = Get-Prop (Get-Prop $n 'error') 'code'
        if (-not $code) { continue }
        switch ([string]$code) {
            'DEPENDENCY_NOT_CONFIGURED' { Write-Host ("  Hint ({0}): the file store is not configured. Set WORKFLOW_FILES_S3_ENDPOINT, _BUCKET, _ACCESS_KEY_ID and _SECRET_ACCESS_KEY in .env and restart workflow-service." -f $n.nodeId) -ForegroundColor Yellow }
            'CONNECTION_RECONNECT_REQUIRED' { Write-Host ("  Hint ({0}): reconnect the Gmail connection (re-run with -GmailConnectionId <id>); it needs gmail.send and gmail.readonly." -f $n.nodeId) -ForegroundColor Yellow }
            'ATTACHMENT_LIMIT_EXCEEDED' { Write-Host ("  Hint ({0}): more than 5 attachments or over 20 MiB in total." -f $n.nodeId) -ForegroundColor Yellow }
            'ATTACHMENT_TOO_LARGE' { Write-Host ("  Hint ({0}): an attachment is over 10 MiB, or the URL host refused or redirected the download (redirects are not followed)." -f $n.nodeId) -ForegroundColor Yellow }
            'REPLY_MESSAGE_NOT_FOUND' { Write-Host ("  Hint ({0}): replyToMessageId is not a message of the connected mailbox." -f $n.nodeId) -ForegroundColor Yellow }
            'FILE_NOT_FOUND' { Write-Host ("  Hint ({0}): the stored file is unknown, expired (7 days) or belongs to another workspace." -f $n.nodeId) -ForegroundColor Yellow }
            'FILE_STORE_UNAVAILABLE' { Write-Host ("  Hint ({0}): the file store (R2 or the database) failed; check the WORKFLOW_FILES_S3_* values and workflow-service logs." -f $n.nodeId) -ForegroundColor Yellow }
            default { Write-Host ("  Node {0} failed with {1}." -f $n.nodeId, $code) -ForegroundColor Yellow }
        }
    }
}

function Invoke-AttachmentsFlow {
    Write-Host ''
    Write-Host '== Email attachments flow (email.send + trigger.gmail attachments) ==' -ForegroundColor Cyan
    Write-Host @'
Preconditions: as for the gmail flow (Google OAuth client, gmail.readonly and gmail.send scopes, test user), AND the
workflow file store is configured: WORKFLOW_FILES_S3_ENDPOINT/_BUCKET/_ACCESS_KEY_ID/_SECRET_ACCESS_KEY in .env, workflow-service
restarted. The script emails YOUR OWN Gmail address (one email with a small PDF attached, plus one threaded reply), so you do
not need to send anything. A Gmail connection made earlier must be reconnected (-GmailConnectionId <id>).
Attachment source: https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf (W3C test PDF, about 13 KB).
'@
    $answer = Read-Host 'Press Enter when ready (type skip to skip this flow)'
    if ($answer -eq 'skip') { Write-Host '  Attachments flow skipped.' -ForegroundColor Yellow; return }
    $addr = (Read-Host 'Gmail address of the account you are about to connect').Trim()
    if ($addr -notmatch '^[^@\s,;<>]+@[^@\s,;<>]+$') { throw 'That is not a single email address.' }

    $connId = Connect-GoogleProvider 'GMAIL' ('Weav live test attachments ' + $script:Stamp) $GmailConnectionId
    $driveAnswer = Read-Host 'Also upload the received attachment to Google Drive (needs a second Google sign-in, GOOGLE_DRIVE)? yes/no'
    $driveId = if ($driveAnswer -eq 'yes') { Connect-GoogleProvider 'GOOGLE_DRIVE' ('Weav live test attachments drive ' + $script:Stamp) } else { $null }
    $token = 'weav-att-' + $script:Stamp
    $subject = 'Weav attachments live test ' + $token
    $pdfUrl = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'

    # (b) first, so its poller is already watching when the email in (a) arrives.
    $triggerNodes = @(
        @{ id = 'manual'; type = 'trigger.manual'; config = @{} },
        @{ id = 'mail'; type = 'trigger.gmail'; config = @{
                # No in:inbox: the connected account's own sent copy matches even if the typed address is another
                # account; has:attachment and -subject:Re skip replies (ours, or an auto-reply from the recipient).
                connectionId = $connId; query = ('subject:"' + $token + '" has:attachment -subject:Re'); pollIntervalMinutes = 1 } },
        @{ id = 'reply'; type = 'email.send'; config = @{
                connectionId = $connId; to = $addr
                subject = 'Re: {{ trigger.input.subject }}'
                body = 'Reply with the same attachments (Weav live test).'
                replyToMessageId = '{{ trigger.input.messageId }}'
                attachments = '{{ trigger.input.attachments }}' } }
    )
    $triggerEdges = @( @{ id = 'e1'; source = 'mail'; target = 'reply' } )
    if ($null -ne $driveId) {
        $triggerNodes += @{ id = 'drive'; type = 'google.drive'; config = @{
                connectionId = $driveId; operation = 'upload'; file = '{{ trigger.input.attachments[0] }}' } }
        $triggerEdges += @{ id = 'e2'; source = 'mail'; target = 'drive' }
    }
    $triggerDef = @{ schemaVersion = '1.0'; nodes = $triggerNodes; edges = $triggerEdges }
    $trigWf = New-PublishedWorkflow ('Live test attachments trigger ' + $script:Stamp) $triggerDef
    $trigBase = "/api/v1/workspaces/$script:Ws/workflows/$trigWf"

    Write-Host ''
    Write-Host '-- (a) email.send: html body, sender name, cc, one URL attachment --' -ForegroundColor Cyan
    $sendDef = @{
        schemaVersion = '1.0'
        nodes = @(
            @{ id = 'manual'; type = 'trigger.manual'; config = @{} },
            @{ id = 'send'; type = 'email.send'; config = @{
                    connectionId = $connId; to = $addr; cc = $addr; subject = $subject
                    bodyType = 'html'; senderName = 'Weav live test'
                    body = '<p>Weav <b>attachments</b> live test <i>' + $token + '</i></p>'
                    attachments = @( @{ url = $pdfUrl; filename = 'weav-live-test.pdf' } ) } }
        )
        edges = @( @{ id = 'e1'; source = 'manual'; target = 'send' } )
    }
    $sendWf = New-PublishedWorkflow ('Live test email attachments ' + $script:Stamp) $sendDef
    $detail = Invoke-ManualRun $sendWf @{} 'email.send'
    $send = Find-Node $detail 'send'
    $out = Get-Prop $send 'output'
    Add-Result 'email.send execution SUCCESS' ($detail.status -eq 'SUCCESS') ('status ' + $detail.status)
    Add-Result 'email.send status SENT' ([string](Get-Prop $out 'status') -eq 'SENT') ('status ' + (Get-Prop $out 'status'))
    Add-Result 'email.send attachmentCount 1' ([string](Get-Prop $out 'attachmentCount') -eq '1') ('attachmentCount ' + (Get-Prop $out 'attachmentCount'))
    $origThread = [string](Get-Prop $out 'threadId')
    if ($detail.status -ne 'SUCCESS') {
        Write-AttachmentHints $detail
        Write-Host '  Part (b) needs the email; stopping.' -ForegroundColor Yellow
        return
    }
    Write-Host '  Check your inbox: from "Weav live test", cc to yourself, bold text, weav-live-test.pdf attached.' -ForegroundColor Yellow

    Write-Host ''
    Write-Host '-- (b) trigger.gmail attachments -> threaded reply with the same attachments --' -ForegroundColor Cyan
    Write-Host 'Polling the trigger workflow every 10 s for up to 4 minutes (it fires on the email just sent)...' -ForegroundColor Yellow
    $items = @()
    $deadline = (Get-Date).AddMinutes(4)
    while ((Get-Date) -lt $deadline -and $items.Count -eq 0) {
        Start-Sleep -Seconds 10
        $page = Invoke-Api 'list executions' 'GET' "$trigBase/executions?page=0&size=20"
        if ($page.Ok) { $items = @(@(Get-Prop $page.Data 'items') | Where-Object { $_.triggerType -eq 'GMAIL' }) }
    }
    # The reply carries the token in its subject too, so stop the trigger before it can see its own reply.
    $r = Invoke-Api 'pause trigger workflow' 'POST' "$trigBase/pause"
    if ($r.Ok) {
        # Already paused: keep -Cleanup from pausing it a second time.
        # RemoveAt by index: List[object].Remove(<pscustomobject>) fails in Windows PowerShell 5.1 ("Argument types do not match").
        for ($i = $script:Workflows.Count - 1; $i -ge 0; $i--) { if ($script:Workflows[$i].Id -eq $trigWf) { $script:Workflows.RemoveAt($i) } }
    } else {
        Write-Host '  WARNING: could not pause the trigger workflow; pause it manually or it will keep replying to its own replies.' -ForegroundColor Red
    }
    if ($items.Count -eq 0) {
        Add-Result 'attachments gmail run observed' $false 'no GMAIL run within 4 minutes'
        Write-Host '  Hint: CONNECTION_RECONNECT_REQUIRED means the connection lacks gmail.readonly (reconnect with -GmailConnectionId); also check the poller is enabled.' -ForegroundColor Yellow
        return
    }
    $execId = [string]$items[0].executionId
    $detail = $null
    $deadline = (Get-Date).AddMinutes(1)
    do {
        $d = Invoke-Api 'execution detail' 'GET' "$trigBase/executions/$execId"
        if ($d.Ok) { $detail = $d.Data }
        $done = ($null -ne $detail -and @('SUCCESS', 'FAILED', 'CANCELLED') -contains $detail.status)
        if (-not $done) { Start-Sleep -Seconds 2 }
    } while ((Get-Date) -lt $deadline -and -not $done)
    if ($null -eq $detail) { Add-Result 'attachments gmail execution detail' $false 'never readable'; throw 'No execution detail.' }
    Show-Execution $detail
    Write-AttachmentHints $detail
    Add-Result 'attachments gmail execution SUCCESS' ($detail.status -eq 'SUCCESS') ('status ' + $detail.status)

    # The trigger node's output wraps the run input: {input: {..., attachments}}.
    $in = Get-Prop (Find-Node $detail 'mail') 'output'
    if ($null -ne (Get-Prop $in 'input')) { $in = Get-Prop $in 'input' }
    $atts = @(Get-Prop $in 'attachments')
    $first = if ($atts.Count -gt 0) { $atts[0] } else { $null }
    if ($null -eq $in) {
        Add-Warn 'trigger attachments not inspected' 'the trigger node exposes no output; the reply node result below still proves the hand-over'
    } else {
        Add-Result 'trigger input has an attachment with fileId' ($null -ne $first -and [bool](Get-Prop $first 'fileId')) $(if ($null -ne $first) { 'name ' + (Short (Get-Prop $first 'filename') 40) + ' size ' + (Get-Prop $first 'size') + ' skipped ' + (Get-Prop $first 'skipped') } else { 'no attachments' })
        if ($null -ne $first -and (Get-Prop $first 'skipped') -eq 'not_stored') {
            Write-Host '  Hint (DEPENDENCY_NOT_CONFIGURED): the file store is not configured, so the attachment was skipped. Set WORKFLOW_FILES_S3_* in .env and restart workflow-service.' -ForegroundColor Yellow
        }
    }
    $reply = Get-Prop (Find-Node $detail 'reply') 'output'
    Add-Result 'reply status SENT with the attachments' (([string](Get-Prop $reply 'status') -eq 'SENT') -and ([string](Get-Prop $reply 'attachmentCount') -eq '1')) ('status ' + (Get-Prop $reply 'status') + ' attachmentCount ' + (Get-Prop $reply 'attachmentCount'))
    Add-Result 'reply stays in the original thread' ($origThread -ne '' -and [string](Get-Prop $reply 'threadId') -eq $origThread) 'threadId equals the thread of the first email'

    if ($null -ne $driveId) {
        $up = Find-Node $detail 'drive'
        $upOut = Get-Prop $up 'output'
        Add-Result 'drive upload from attachments[0] SUCCESS' ($null -ne $up -and $up.status -eq 'SUCCESS' -and [bool](Get-Prop $upOut 'id')) $(if ($null -ne $up) { 'status ' + $up.status + ' name ' + (Short (Get-Prop $upOut 'name') 40) } else { 'node missing' })
    } else {
        Add-Warn 'drive upload from an email attachment not run' 'answered no; re-run and answer yes to cover google.drive upload with file = attachments[0]'
    }
    Write-Host '  Check your inbox: one threaded reply with weav-live-test.pdf. The trigger workflow is paused.' -ForegroundColor Yellow
}

# ---------- assistant flow ----------

function Add-Warn([string]$Step, [string]$Detail = '') {
    $script:Results.Add([pscustomobject]@{ Step = $Step; Result = 'WARN'; Detail = $Detail })
    Write-Host ('  -> WARN ' + $Step + $(if ($Detail) { ' (' + $Detail + ')' } else { '' })) -ForegroundColor Yellow
}

# POSTs one chat message and parses the buffered SSE body (the stream ends with done/error).
# Never prints the token or the raw stream; returns Status, Raw, Events (Name, Data).
function Invoke-AssistantChat([string]$Label, [hashtable]$Body) {
    $req = @{
        UseBasicParsing = $true; TimeoutSec = 120; Method = 'POST'; Uri = ($script:Base + '/api/v1/assistant/chat')
        Headers = @{ Accept = 'text/event-stream'; Authorization = ('Bearer ' + $script:Token) }
        ContentType = 'application/json; charset=utf-8'
        Body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 10 -Compress))
    }
    $status = 0; $raw = ''
    try {
        $r = Invoke-WebRequest @req
        $status = [int]$r.StatusCode
        $raw = if ($r.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($r.Content) } else { [string]$r.Content }
    } catch {
        $resp = Get-Prop $_.Exception 'Response'
        if ($null -ne $resp) { $status = [int]$resp.StatusCode } else { Write-Host ("  [{0}] no response: {1}" -f $Label, (Short $_.Exception.Message 160)) -ForegroundColor Red }
    }
    $events = New-Object System.Collections.Generic.List[object]
    foreach ($block in ($raw -split '\r?\n\r?\n')) {
        $name = $null; $data = $null
        foreach ($line in ($block -split '\r?\n')) {
            if ($line.StartsWith('event:')) { $name = $line.Substring(6).Trim() }
            elseif ($line.StartsWith('data:')) { $data = $line.Substring(5).Trim() }
        }
        if ($name) {
            $parsed = $null
            if ($data) { try { $parsed = $data | ConvertFrom-Json } catch { $parsed = $null } }
            $events.Add([pscustomobject]@{ Name = $name; Data = $parsed })
        }
    }
    $parts = @($events | ForEach-Object { if ($_.Name -eq 'tool_call') { 'tool_call:' + (Get-Prop $_.Data 'name') } else { $_.Name } })
    foreach ($e in @($events | Where-Object { $_.Name -eq 'conversation' })) {
        $cid = [string](Get-Prop $e.Data 'conversationId')
        if ($cid -and -not $script:Conversations.Contains($cid)) { $script:Conversations.Add($cid) }
    }
    $summary = ($parts -join ' ') -replace '(delta )+', 'delta... '
    Write-Host ("  [{0}] HTTP {1} events: {2}" -f $Label, $status, (Short $summary 200)) -ForegroundColor DarkGray
    return [pscustomobject]@{ Status = $status; Raw = $raw; Events = $events }
}

function Get-FirstEventData($Chat, [string]$Name) {
    $e = @($Chat.Events | Where-Object { $_.Name -eq $Name }) | Select-Object -First 1
    return $e
}

function Test-ToolStep($Chat, [string]$Step, [string]$Tool, [bool]$NoEmail = $false) {
    $names = @($Chat.Events | ForEach-Object { $_.Name })
    $tools = @($Chat.Events | Where-Object { $_.Name -eq 'tool_call' } | ForEach-Object { Get-Prop $_.Data 'name' })
    $ok = ($Chat.Status -eq 200) -and ($names -contains 'conversation') -and ($tools -contains $Tool) -and ($names -contains 'done')
    $detail = 'tools: ' + ($tools -join ',')
    if ($NoEmail -and $Chat.Raw -match '[^\s@"]+@[^\s@"]+') { $ok = $false; $detail += '; an email pattern appears in the stream' }
    Add-Result $Step $ok $detail
}

function Invoke-AssistantFlow {
    Write-Host ''
    Write-Host '== Assistant flow ==' -ForegroundColor Cyan
    Write-Host @'
Preconditions: AI_ASSISTANT_ENABLED=true, ai-service DB migrated (pnpm --dir services/ai-service db:migrate),
identity signing RS256 tokens, the AI service enabled as for the ai flow.
COST: about 4 real chats, roughly 8-12 small DeepSeek calls; each chat uses daily AI quota.
Tool-name checks depend on the model's choice, so a FAIL there may be model behaviour, not a bug.
'@
    $answer = Read-Host 'Type yes to run it'
    if ($answer -ne 'yes') { Write-Host '  Assistant flow skipped.' -ForegroundColor Yellow; return }

    try {

        $c1 = Invoke-AssistantChat 'chat 1' @{ workspaceId = $script:Ws; message = 'Which workflows do I have?' }
        $e = Get-FirstEventData $c1 'conversation'
        $conv1 = if ($null -ne $e) { [string](Get-Prop $e.Data 'conversationId') } else { '' }
        if (-not $conv1) { Add-Result 'chat: list workflows' $false ('HTTP ' + $c1.Status + ', no conversation event'); throw 'First chat failed (is AI_ASSISTANT_ENABLED=true?).' }
        Test-ToolStep $c1 'chat: list workflows' 'list_workflows'

        $c2 = Invoke-AssistantChat 'chat 2' @{ workspaceId = $script:Ws; conversationId = $conv1; message = 'Which of them failed today?' }
        Test-ToolStep $c2 'chat: failed runs today' 'list_failed_runs_today'

        $c3 = Invoke-AssistantChat 'chat 3' @{ workspaceId = $script:Ws; conversationId = $conv1; message = 'Who is in this workspace?' }
        Test-ToolStep $c3 'chat: members, no email leaked' 'list_members' $true

        $prompt = 'Make a workflow that runs manually, fetches https://example.com with an HTTP GET and then branches with a switch on the status code: 200 or default.'
        $c4 = Invoke-AssistantChat 'chat 4' @{ workspaceId = $script:Ws; message = $prompt }
        $e = Get-FirstEventData $c4 'conversation'
        $conv2 = if ($null -ne $e) { [string](Get-Prop $e.Data 'conversationId') } else { '' }
        $draft = Get-FirstEventData $c4 'draft'
        if ($null -ne $draft) {
            $json = ConvertTo-Json -InputObject (Get-Prop $draft.Data 'definition') -Depth 20 -Compress
            Add-Result 'chat: draft contains logic.switch' ($json -match '"type":"logic\.switch"') ('draft name: ' + (Short (Get-Prop $draft.Data 'name') 60))
        } else {
            $text = (@($c4.Events | Where-Object { $_.Name -eq 'delta' } | ForEach-Object { Get-Prop $_.Data 'text' }) -join '')
            Add-Warn 'chat: no draft event (needs_input or unsupported?)' (Short $text 200)
        }

        $r = Invoke-Api 'list conversations' 'GET' "/api/v1/assistant/conversations?workspaceId=$script:Ws&limit=50"
        $ids = @(@(Get-Prop $r.Data 'items') | ForEach-Object { $_.conversationId })
        $both = $r.Ok -and ($ids -contains $conv1) -and ((-not $conv2) -or ($ids -contains $conv2))
        Add-Result 'history: conversations list both' $both ('listed ' + $ids.Count)

        $r = Invoke-Api 'get messages' 'GET' "/api/v1/assistant/conversations/$conv1/messages"
        $msgs = @(Get-Prop $r.Data 'messages')
        $users = @($msgs | Where-Object { $_.role -eq 'user' }).Count
        $assistants = @($msgs | Where-Object { $_.role -eq 'assistant' }).Count
        Add-Result 'history: first conversation has 6 messages (3 user + 3 assistant)' ($r.Ok -and $msgs.Count -eq 6 -and $users -eq 3 -and $assistants -eq 3) ("user $users, assistant $assistants")

        $c5 = Invoke-AssistantChat 'chat random workspace' @{ workspaceId = [guid]::NewGuid().ToString(); message = 'Which workflows do I have?' }
        Add-Result 'chat: random workspace id -> 404' ($c5.Status -eq 404) ('HTTP ' + $c5.Status)

    } finally {
        if ($Cleanup) {
            foreach ($id in @($script:Conversations)) {
                $r = Invoke-Api 'delete conversation' 'DELETE' "/api/v1/assistant/conversations/$id"
                Add-Result ('delete conversation ' + $id.Substring(0, 8) + ' -> 204') ($r.Status -eq 204) ('HTTP ' + $r.Status)
                $r = Invoke-Api 'get messages after delete' 'GET' "/api/v1/assistant/conversations/$id/messages"
                Add-Result ('messages after delete ' + $id.Substring(0, 8) + ' -> 404') ($r.Status -eq 404) ('HTTP ' + $r.Status)
            }
        }
    }
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
    if ($Flow -in @('logic', 'all')) {
        try { Invoke-LogicFlow } catch { Write-Host ('  Logic flow stopped: ' + $_.Exception.Message) -ForegroundColor Red }
    }
    if ($Flow -in @('ai', 'all')) {
        try { Invoke-AiFlow } catch { Write-Host ('  AI flow stopped: ' + $_.Exception.Message) -ForegroundColor Red }
    }
    if ($Flow -in @('gmail', 'all')) {
        try { Invoke-GmailFlow } catch { Write-Host ('  Gmail flow stopped: ' + $_.Exception.Message) -ForegroundColor Red }
    }
    if ($Flow -in @('attachments', 'all')) {
        try { Invoke-AttachmentsFlow } catch { Write-Host ('  Attachments flow stopped: ' + $_.Exception.Message) -ForegroundColor Red }
    }
    if ($Flow -in @('assistant', 'all')) {
        try { Invoke-AssistantFlow } catch { Write-Host ('  Assistant flow stopped: ' + $_.Exception.Message) -ForegroundColor Red }
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
Write-Host '  [ ] Gmail: the consent screen listed gmail.readonly and gmail.send; the email you sent started exactly one run'
Write-Host '  [ ] Attachments: the inbox holds the HTML email (sender name, cc, weav-live-test.pdf) and one threaded reply with the PDF'
Write-Host '  [ ] Telegram (HTML node): bold "Weav" text arrived silently as a reply to your message'
Write-Host '  [ ] Assistant: any WARN above (no draft) is worth a look at the answer text'
Write-Host '  [ ] Consent screens listed only calendar.events (Calendar) / drive.file (Drive) plus openid and email'

$failed = @($script:Results | Where-Object { $_.Result -eq 'FAIL' }).Count
if ($failed -gt 0) { exit 1 }
exit 0
