param(
    [Parameter(Mandatory)][string]$WorkflowUrl,
    [Parameter(Mandatory)][guid]$WorkspaceId,
    [Parameter(Mandatory)][string]$FixturePath,
    [switch]$ConfirmDisposableWorkspace
)

$ErrorActionPreference = 'Stop'
$stage = 'preflight'
$headers = @{}
$createdWorkflowId = $null
$published = $null
$nodeTimeline = [System.Collections.Generic.List[string]]::new()
$lastNodeStates = @{}
$script:httpFailureStatus = 'none'
$script:httpFailureKind = 'none'
$script:failureReason = 'other'

function Set-HttpFailureStatus([object]$ErrorRecord) {
    $exception = $ErrorRecord.Exception
    $script:httpFailureKind = [string]$exception.GetType().Name
    if ($exception -is [System.Net.ProtocolViolationException]) {
        $script:httpFailureKind = switch -Regex ($exception.Message) {
            'content.body.*verb.type' { 'ProtocolViolationBodyOnVerb'; break }
            'ContentLength|Content-Length' { 'ProtocolViolationContentLength'; break }
            'ResponseStatusLine' { 'ProtocolViolationResponseStatusLine'; break }
            'ResponseHeader' { 'ProtocolViolationResponseHeader'; break }
            default { 'ProtocolViolationOther' }
        }
    }
    $response = $exception.Response
    if ($null -ne $response) {
        $script:httpFailureStatus = [string][int]$response.StatusCode
    }
}

function Get-HttpResponseText([object]$Response) {
    if ($null -eq $Response.Content) { return '' }
    if ($Response.Content -is [byte[]]) {
        return [System.Text.Encoding]::UTF8.GetString($Response.Content)
    }
    return [string]$Response.Content
}

function Assert-WorkflowCondition([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Invoke-WorkflowJson {
    param(
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Uri,
        [Parameter(Mandatory)][int]$ExpectedStatus,
        [AllowNull()][string]$Body,
        [hashtable]$AdditionalHeaders = @{}
    )

    $requestHeaders = @{}
    foreach ($key in $headers.Keys) { $requestHeaders[$key] = $headers[$key] }
    foreach ($key in $AdditionalHeaders.Keys) { $requestHeaders[$key] = $AdditionalHeaders[$key] }

    try {
        if (-not $PSBoundParameters.ContainsKey('Body') -or $null -eq $Body) {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Method $Method -Uri $Uri -Headers $requestHeaders
        } else {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Method $Method -Uri $Uri `
                -Headers $requestHeaders -ContentType 'application/json' -Body $Body
        }
    } catch {
        Set-HttpFailureStatus -ErrorRecord $_
        throw 'HTTP request failed'
    }

    Assert-WorkflowCondition ($response.StatusCode -eq $ExpectedStatus) 'Unexpected HTTP status'
    $responseText = Get-HttpResponseText -Response $response
    if ([string]::IsNullOrWhiteSpace($responseText)) { return $null }
    try {
        return $responseText | ConvertFrom-Json
    } catch {
        throw 'Response was not valid JSON'
    }
}

function Get-WorkflowNode {
    param([object]$Detail, [string]$NodeId)
    foreach ($node in $Detail.nodes) {
        if ($node.nodeId -eq $NodeId) { return $node }
    }
    return $null
}

try {
    Assert-WorkflowCondition $ConfirmDisposableWorkspace 'Pass -ConfirmDisposableWorkspace before creating persistent test resources'
    Assert-WorkflowCondition (-not [string]::IsNullOrWhiteSpace($env:WORKFLOW_TEST_ACCESS_TOKEN)) 'WORKFLOW_TEST_ACCESS_TOKEN is required in the process environment'
    Assert-WorkflowCondition (Test-Path -LiteralPath $FixturePath -PathType Leaf) 'FixturePath must point to a readable workflow fixture'

    $workflowService = [Uri]$WorkflowUrl
    Assert-WorkflowCondition ($workflowService.IsAbsoluteUri -and $workflowService.Scheme -in @('http', 'https') -and
        [string]::IsNullOrEmpty($workflowService.UserInfo) -and [string]::IsNullOrEmpty($workflowService.Query) -and
        [string]::IsNullOrEmpty($workflowService.Fragment)) 'WorkflowUrl must be an absolute HTTP(S) base URL without credentials or query parameters'

    $definition = Get-Content -LiteralPath $FixturePath -Raw | ConvertFrom-Json
    $condition = $definition.nodes | Where-Object { $_.id -eq 'condition' } | Select-Object -First 1
    Assert-WorkflowCondition ($null -ne $condition) 'Fixture must contain the acceptance condition node'
    Assert-WorkflowCondition ($condition.config.operator -eq 'eq' -and $condition.config.left -eq $true -and
        $condition.config.right -eq $false) 'Fixture must retain the safe false branch so the smoke does not call outbound HTTP endpoints'

    $headers.Authorization = 'Bearer ' + $env:WORKFLOW_TEST_ACCESS_TOKEN
    $headers.Accept = 'application/json'
    $collection = $workflowService.ToString().TrimEnd('/') + '/workspaces/' + $WorkspaceId + '/workflows'
    $workflowName = 'Workflow V1 acceptance ' + [Guid]::NewGuid().ToString('N')

    $stage = 'create'
    $created = Invoke-WorkflowJson -Method 'POST' -Uri $collection -ExpectedStatus 201 `
        -Body (@{ name = $workflowName; description = 'Disposable Workflow V1 smoke fixture' } | ConvertTo-Json -Compress)
    Assert-WorkflowCondition ($created.status -eq 'DRAFT' -and $created.workflowId) 'Create response did not describe a draft workflow'
    $createdWorkflowId = [string]$created.workflowId
    $workflowUri = $collection + '/' + $createdWorkflowId

    $stage = 'save-draft-put'
    $draftBody = @{ name = $workflowName; description = 'Disposable Workflow V1 smoke fixture'; definition = $definition; editorState = @{} } |
        ConvertTo-Json -Depth 40 -Compress
    $null = Invoke-WorkflowJson -Method 'PUT' -Uri ($workflowUri + '/draft') -ExpectedStatus 200 -Body $draftBody
    $stage = 'save-draft-get'
    $saved = Invoke-WorkflowJson -Method 'GET' -Uri $workflowUri -ExpectedStatus 200
    Assert-WorkflowCondition ($saved.workflowId -eq $createdWorkflowId -and $saved.status -eq 'DRAFT') 'Saved workflow is not scoped to the created draft'
    $stage = 'save-draft-list'
    $page = Invoke-WorkflowJson -Method 'GET' -Uri $collection -ExpectedStatus 200
    Assert-WorkflowCondition (@($page.items | Where-Object { $_.workflowId -eq $createdWorkflowId }).Count -eq 1) 'Workflow list omitted the created draft'

    $stage = 'publish'
    try {
        $publishResponse = Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Method 'POST' `
            -Uri ($workflowUri + '/publish') -Headers $headers
    } catch {
        Set-HttpFailureStatus -ErrorRecord $_
        throw 'HTTP request failed'
    }
    Assert-WorkflowCondition ($publishResponse.StatusCode -eq 200) 'Unexpected publish status'
    $cacheControl = [string]$publishResponse.Headers['Cache-Control']
    Assert-WorkflowCondition ($cacheControl -match '(^|,)\s*no-store(?:\s|,|$)') 'Publish response must be no-store'
    $published = (Get-HttpResponseText -Response $publishResponse) | ConvertFrom-Json
    Assert-WorkflowCondition ($published.status -eq 'PUBLISHED' -and $published.versionId) 'Publish response did not contain a published version'
    Assert-WorkflowCondition (@($published.webhooks).Count -gt 0) 'Publication did not provision the fixture webhook'
    # Keep one-time publication credentials in process memory only; never display or persist them.

    $stage = 'manual-admission'
    $correlationId = 'workflow-v1-smoke-' + [Guid]::NewGuid().ToString('N')
    $runHeaders = @{}
    foreach ($key in $headers.Keys) { $runHeaders[$key] = $headers[$key] }
    $runHeaders['X-Correlation-Id'] = $correlationId
    try {
        $runResponse = Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Method 'POST' `
            -Uri ($workflowUri + '/executions') -Headers $runHeaders -ContentType 'application/json' `
            -Body '{"input":{"acceptance":true}}'
    } catch {
        Set-HttpFailureStatus -ErrorRecord $_
        throw 'HTTP request failed'
    }
    Assert-WorkflowCondition ($runResponse.StatusCode -eq 202) 'Unexpected execution admission status'
    $run = (Get-HttpResponseText -Response $runResponse) | ConvertFrom-Json
    $responseCorrelationId = [string]$runResponse.Headers['X-Correlation-Id']
    Assert-WorkflowCondition ($run.workflowVersionId -eq $published.versionId -and $run.executionId) 'Execution was not pinned to the published version'
    Assert-WorkflowCondition (-not [string]::IsNullOrWhiteSpace($responseCorrelationId)) 'Workflow response omitted the correlation ID'

    $stage = 'monitor'
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(60)
    $detail = $null
    do {
        $detail = Invoke-WorkflowJson -Method 'GET' -Uri ($workflowUri + '/executions/' + $run.executionId) -ExpectedStatus 200
        foreach ($nodeId in @('manual-root', 'webhook-root', 'schedule-root', 'condition', 'left-http', 'right-http', 'inactive-branch', 'join-http')) {
            $node = Get-WorkflowNode -Detail $detail -NodeId $nodeId
            if ($null -ne $node) {
                $state = [string]$node.status + '/' + [string]$node.attemptCount
                if ($lastNodeStates[$nodeId] -ne $state) {
                    $lastNodeStates[$nodeId] = $state
                    $nodeTimeline.Add([DateTimeOffset]::UtcNow.ToString('O') + ' ' + $nodeId + '=' + $state)
                }
            }
        }
        if ($detail.status -in @('SUCCESS', 'FAILED', 'CANCELLED')) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    Assert-WorkflowCondition ($detail.status -eq 'SUCCESS') 'Execution did not succeed within 60 seconds'
    Assert-WorkflowCondition ($detail.workflowVersionId -eq $published.versionId) 'Execution detail changed its immutable version'

    $expectedNodes = @{
        'condition' = @('SUCCESS', 1)
        'inactive-branch' = @('SUCCESS', 1)
        'left-http' = @('SKIPPED', 0)
        'right-http' = @('SKIPPED', 0)
        'join-http' = @('SKIPPED', 0)
    }
    foreach ($nodeId in $expectedNodes.Keys) {
        $node = Get-WorkflowNode -Detail $detail -NodeId $nodeId
        Assert-WorkflowCondition ($null -ne $node) ('Execution detail omitted node ' + $nodeId)
        Assert-WorkflowCondition ($node.status -eq $expectedNodes[$nodeId][0] -and
            $node.attemptCount -eq $expectedNodes[$nodeId][1] -and
            @($node.attempts).Count -eq $expectedNodes[$nodeId][1]) ('Unexpected state or attempt count for node ' + $nodeId)
    }

    $nodeStates = foreach ($nodeId in @('condition', 'inactive-branch', 'left-http', 'right-http', 'join-http')) {
        $node = Get-WorkflowNode -Detail $detail -NodeId $nodeId
        $nodeId + ':' + $node.status + '/' + $node.attemptCount
    }
    Write-Output ('PASS workflow=' + $createdWorkflowId + ' version=' + $published.versionId +
        ' execution=' + $run.executionId + ' status=' + $detail.status +
        ' httpStatuses=create:201,draft:200,workflowGet:200,list:200,publish:200,admission:202,detail:200' +
        ' correlation=' + $responseCorrelationId + ' nodeStates=' + ($nodeStates -join ',') +
        ' stateTimeline=' + ($nodeTimeline -join '|') + ' outboundHttpCalls=0')
} catch {
    $script:failureReason = switch ($_.Exception.Message) {
        'Unexpected HTTP status' { 'unexpected-http-status' }
        'Response was not valid JSON' { 'invalid-json' }
        'Saved workflow is not scoped to the created draft' { 'saved-draft-mismatch' }
        'Workflow list omitted the created draft' { 'workflow-list-missing' }
        'HTTP request failed' { 'http-request-failed' }
        default { 'other' }
    }
    [Console]::Error.WriteLine("Workflow V1 smoke failed at stage '$stage' status=$script:httpFailureStatus kind=$script:httpFailureKind reason=$script:failureReason.")
    exit 1
} finally {
    $headers.Clear()
    $published = $null
    $definition = $null
    $draftBody = $null
    $run = $null
    $runResponse = $null
    $publishResponse = $null
    $detail = $null
    $nodeTimeline.Clear()
    $lastNodeStates.Clear()
}
