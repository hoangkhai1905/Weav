[CmdletBinding()]
param(
    [switch]$ValidateOnly,
    [ValidatePattern('^20[0-9]{6}_[0-9a-f]{12}$')][string]$TestSchemaSuffix
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot 'compose.workflow-smoke.yml'
$dockerPath = 'C:\Users\nhoan\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe'
$stage = 'preflight'
$script:exitCode = 0
$projectName = $null
$composeStartAttempted = $false
$composeResourcesAttempted = $false
$accepted = $false
$cleanupState = 'not-started'
$script:validationCheck = 'not-started'
$script:failureClass = 'none'
$schemaAttempts = [System.Collections.Generic.List[string]]::new()
$createdSchemas = [System.Collections.Generic.List[string]]::new()
$secretNames = @(
    'IDENTITY_DB_HOST', 'IDENTITY_DB_PORT', 'IDENTITY_DB_NAME', 'IDENTITY_DB_USERNAME', 'IDENTITY_DB_PASSWORD', 'IDENTITY_DB_SSL_MODE',
    'WORKSPACE_DB_HOST', 'WORKSPACE_DB_PORT', 'WORKSPACE_DB_NAME', 'WORKSPACE_DB_USERNAME', 'WORKSPACE_DB_PASSWORD', 'WORKSPACE_DB_SSL_MODE',
    'WORKFLOW_DB_HOST', 'WORKFLOW_DB_PORT', 'WORKFLOW_DB_NAME', 'WORKFLOW_DB_USERNAME', 'WORKFLOW_DB_PASSWORD', 'WORKFLOW_DB_SSL_MODE',
    'WORKFLOW_TEST_IDENTITY_SCHEMA', 'WORKFLOW_TEST_WORKSPACE_SCHEMA', 'WORKFLOW_TEST_WORKFLOW_SCHEMA',
    'WORKFLOW_SMOKE_IDENTITY_PORT', 'WORKFLOW_SMOKE_WORKSPACE_PORT', 'WORKFLOW_SMOKE_WORKFLOW_PORT', 'WORKFLOW_SMOKE_MAILPIT_PORT',
    'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JWT_ISSUER', 'JWT_AUDIENCE',
    'IDENTITY_INTERNAL_SERVICE_KEY', 'WEAV_INTERNAL_SERVICE_KEY', 'WORKFLOW_INTERNAL_SERVICE_KEY',
    'OTP_HMAC_SECRET', 'CREDENTIAL_ENCRYPTION_KEY', 'CREDENTIAL_ENCRYPTION_KEY_VERSION',
    'RABBITMQ_USERNAME', 'RABBITMQ_PASSWORD', 'WORKFLOW_TEST_ACCESS_TOKEN'
)
$originalEnvironment = @{}
foreach ($name in $secretNames) {
    $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Set-ProcessValue([string]$Name, [AllowNull()][string]$Value) {
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function New-RandomBase64([int]$ByteCount) {
    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
        return [Convert]::ToBase64String($bytes)
    } finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
        $generator.Dispose()
    }
}

function Get-FreeLoopbackPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return [int]$listener.LocalEndpoint.Port
    } finally {
        $listener.Stop()
    }
}

function Get-MapValue([object]$Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-ComposeService([object]$Config, [string]$Name) {
    return Get-MapValue -Object $Config.services -Name $Name
}

function Get-ServiceEnvironmentValue([object]$Service, [string]$Name) {
    return Get-MapValue -Object $Service.environment -Name $Name
}

function Invoke-ComposeSafe([string[]]$ComposeArguments, [string]$FailureStage) {
    $arguments = @(
        'compose', '--project-name', $script:projectName,
        '--env-file', '.env', '--file', 'compose.workflow-smoke.yml'
    ) + $ComposeArguments
    $process = $null
    try {
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $script:dockerPath
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $startInfo.Arguments = (($arguments | ForEach-Object {
            $argument = [string]$_
            if ($argument.Contains('"')) { throw 'compose-argument-contains-quote' }
            if ($argument -match '\s') { '"' + $argument + '"' } else { $argument }
        }) -join ' ')
        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        if (-not $process.Start()) { throw 'compose-process-did-not-start' }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdoutTask.Wait()
        $stderrTask.Wait()
        $output = $stdoutTask.Result
        $diagnostic = $stderrTask.Result
        $exitCode = $process.ExitCode
    } catch {
        $script:failureClass = 'compose-process-start'
        throw $FailureStage
    } finally {
        if ($null -ne $process) { $process.Dispose() }
    }
    if ($exitCode -ne 0) {
        $diagnostic = $diagnostic + "`n" + $output
        $script:failureClass = 'compose-command-failed'
        if ($diagnostic -match '(?i)permission denied for database|permission denied to create schema') {
            $script:failureClass = 'database-schema-permission'
        } elseif ($diagnostic -match '(?i)password authentication failed|no password supplied|authentication failed') {
            $script:failureClass = 'database-authentication'
        } elseif ($diagnostic -match '(?i)could not translate host name|name or service not known|temporary failure in name resolution') {
            $script:failureClass = 'database-name-resolution'
        } elseif ($diagnostic -match '(?i)connection timed out|timeout expired|could not connect to server|connection refused') {
            $script:failureClass = 'database-connectivity'
        } elseif ($diagnostic -match '(?i)already exists') {
            $script:failureClass = 'schema-name-collision'
        } elseif ($diagnostic -match '(?i)pull access denied|manifest unknown|failed to resolve reference|error pulling image|failed to pull') {
            $script:failureClass = 'container-image-pull'
        } elseif ($exitCode -eq 2 -and $diagnostic -match '(?i)psql: error:') {
            $script:failureClass = 'database-connection-attempt-failed'
        } elseif ($diagnostic -match '(?i)psql: error:|FATAL:|ERROR:') {
            $script:failureClass = 'database-client-or-server-error'
        }
        $diagnostic = $null
        $output = $null
        throw $FailureStage
    }
    $diagnostic = $null
    return [string]$output
}

function Assert-ResolvedSmokeConfig([object]$Config) {
    $script:validationCheck = 'service-list'
    foreach ($name in @('identity-service', 'workspace-service', 'workflow-service', 'valkey', 'rabbitmq', 'mailpit')) {
        if ($null -eq (Get-ComposeService -Config $Config -Name $name)) { throw 'compose-config-services' }
    }

    $identity = Get-ComposeService -Config $Config -Name 'identity-service'
    $workspace = Get-ComposeService -Config $Config -Name 'workspace-service'
    $workflow = Get-ComposeService -Config $Config -Name 'workflow-service'

    $script:validationCheck = 'schema-uniqueness'
    $schemaChecks = @(
        [pscustomobject]@{ Service = $identity; Schema = [string]$env:WORKFLOW_TEST_IDENTITY_SCHEMA },
        [pscustomobject]@{ Service = $workspace; Schema = [string]$env:WORKFLOW_TEST_WORKSPACE_SCHEMA },
        [pscustomobject]@{ Service = $workflow; Schema = [string]$env:WORKFLOW_TEST_WORKFLOW_SCHEMA }
    )
    if (@($schemaChecks | Select-Object -ExpandProperty Schema -Unique).Count -ne 3) { throw 'compose-config-schema-uniqueness' }
    foreach ($check in $schemaChecks) {
        $script:validationCheck = 'service-schema'
        if ([string](Get-ServiceEnvironmentValue -Service $check.Service -Name 'DB_SCHEMA') -ne $check.Schema) { throw 'compose-config-schema' }
        $script:validationCheck = 'jdbc-current-schema'
        $jdbcUrl = [string](Get-ServiceEnvironmentValue -Service $check.Service -Name 'SPRING_DATASOURCE_URL')
        if ($jdbcUrl -notmatch ('(?:\?|&)currentSchema=' + [regex]::Escape($check.Schema) + '(?:&|$)')) { throw 'compose-config-jdbc-schema' }
    }

    $script:validationCheck = 'local-smtp'
    if ([string](Get-ServiceEnvironmentValue -Service $identity -Name 'SMTP_HOST') -ne 'mailpit' -or
        [string](Get-ServiceEnvironmentValue -Service $identity -Name 'SMTP_PORT') -ne '1025') { throw 'compose-config-local-smtp' }
    $script:validationCheck = 'local-dependencies'
    if ([string](Get-ServiceEnvironmentValue -Service $identity -Name 'VALKEY_URL') -ne 'redis://valkey:6379' -or
        [string](Get-ServiceEnvironmentValue -Service $workspace -Name 'REDIS_URL') -ne 'redis://valkey:6379' -or
        [string](Get-ServiceEnvironmentValue -Service $workflow -Name 'RABBITMQ_HOST') -ne 'rabbitmq') { throw 'compose-config-local-dependencies' }
    $script:validationCheck = 'worker-scanner'
    if ([string](Get-ServiceEnvironmentValue -Service $workflow -Name 'WORKFLOW_EXECUTION_WORKER_ENABLED') -ne 'true' -or
        [string](Get-ServiceEnvironmentValue -Service $workflow -Name 'WORKFLOW_SCHEDULE_SCANNER_ENABLED') -ne 'true') { throw 'compose-config-worker' }
    foreach ($name in @(
        'WORKFLOW_OCR_ENABLED', 'WORKFLOW_OCR_URL_SOURCE_ENABLED', 'WORKFLOW_OCR_ARTIFACT_SOURCE_ENABLED',
        'WORKFLOW_OCR_SERVICE_CLAIMS_VERIFIED', 'WORKFLOW_OCR_URL_ALLOWLIST_VERIFIED', 'WORKFLOW_OCR_ARTIFACT_RESOLVER_VERIFIED'
    )) {
        $script:validationCheck = 'ocr-gates'
        if ([string](Get-ServiceEnvironmentValue -Service $workflow -Name $name) -ne 'false') { throw 'compose-config-ocr-gates' }
    }
    $routingChecks = @(
        [pscustomobject]@{ Service = $workspace; Name = 'IDENTITY_SERVICE_URL'; Expected = 'http://identity-service:8080' },
        [pscustomobject]@{ Service = $workspace; Name = 'WORKFLOW_SERVICE_URL'; Expected = 'http://workflow-service:8080' },
        [pscustomobject]@{ Service = $workflow; Name = 'WORKSPACE_SERVICE_URL'; Expected = 'http://workspace-service:8080' }
    )
    foreach ($check in $routingChecks) {
        $script:validationCheck = 'service-routing'
        if ([string](Get-ServiceEnvironmentValue -Service $check.Service -Name $check.Name) -ne $check.Expected) {
            throw 'compose-config-service-routing'
        }
    }

    $script:validationCheck = 'internal-key-pairs'
    $identityKey = Get-ServiceEnvironmentValue -Service $identity -Name 'IDENTITY_INTERNAL_SERVICE_KEY'
    if ($identityKey -ne (Get-ServiceEnvironmentValue -Service $workspace -Name 'IDENTITY_INTERNAL_SERVICE_KEY') -or
        (Get-ServiceEnvironmentValue -Service $workspace -Name 'WEAV_INTERNAL_SERVICE_KEY') -ne
            (Get-ServiceEnvironmentValue -Service $workflow -Name 'WEAV_INTERNAL_SERVICE_KEY') -or
        (Get-ServiceEnvironmentValue -Service $workspace -Name 'WORKFLOW_INTERNAL_SERVICE_KEY') -ne
            (Get-ServiceEnvironmentValue -Service $workflow -Name 'WORKFLOW_INTERNAL_SERVICE_KEY')) { throw 'compose-config-internal-key-pairs' }

    $jwtServices = @($identity, $workspace, $workflow)
    foreach ($service in $jwtServices) {
        $script:validationCheck = 'jwt-pairing'
        foreach ($name in @('JWT_ACCESS_SECRET', 'JWT_ISSUER', 'JWT_AUDIENCE')) {
            if ((Get-ServiceEnvironmentValue -Service $service -Name $name) -ne
                (Get-ServiceEnvironmentValue -Service $identity -Name $name)) { throw 'compose-config-jwt-pairing' }
        }
    }

    foreach ($serviceProperty in $Config.services.PSObject.Properties) {
        $script:validationCheck = 'resource-isolation'
        $service = $serviceProperty.Value
        if ($null -ne $service.container_name) { throw 'compose-config-resource-isolation' }
        if ($serviceProperty.Name -eq 'rabbitmq') {
            $rabbitVolumes = @($service.volumes)
            if ($rabbitVolumes.Count -ne 1 -or [string]$rabbitVolumes[0].source -ne 'rabbitmq_smoke_data' -or
                [string]$rabbitVolumes[0].target -ne '/var/lib/rabbitmq') { throw 'compose-config-rabbit-volume' }
        } elseif ($null -ne $service.volumes -and @($service.volumes).Count -gt 0) {
            throw 'compose-config-resource-isolation'
        }
        foreach ($port in @($service.ports)) {
            $script:validationCheck = 'loopback-port-binding'
            if ($null -ne $port -and [string]$port.host_ip -ne '127.0.0.1') { throw 'compose-config-port-binding' }
        }
    }
    $script:validationCheck = 'volume-isolation'
    if (@($Config.volumes.PSObject.Properties).Count -ne 1 -or
        ($null -ne $Config.volumes.PSObject.Properties['rabbitmq_smoke_data'].Value.external -and
            $Config.volumes.PSObject.Properties['rabbitmq_smoke_data'].Value.external)) { throw 'compose-config-volume-isolation' }

    $serviceNames = @($Config.services.PSObject.Properties | ForEach-Object { $_.Name })
    foreach ($unrelated in @('ai-service', 'bot-service', 'notification-service', 'ocr-service')) {
        $script:validationCheck = 'service-scope'
        if ($serviceNames -contains $unrelated) { throw 'compose-config-unrelated-service' }
    }
}

function Get-HttpResponseText([object]$Response) {
    if ($null -eq $Response.Content) { return '' }
    if ($Response.Content -is [byte[]]) {
        return [System.Text.Encoding]::UTF8.GetString($Response.Content)
    }
    return [string]$Response.Content
}

function Wait-HttpReady([string]$Uri, [int]$TimeoutSeconds, [switch]$HealthPayload) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Method Get -Uri $Uri
            if ($response.StatusCode -eq 200) {
                if (-not $HealthPayload) { return }
                $payload = (Get-HttpResponseText -Response $response) | ConvertFrom-Json
                if ($payload.status -eq 'UP') { return }
            }
        } catch { }
        Start-Sleep -Seconds 2
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw 'readiness-timeout'
}

function Invoke-JsonApi([string]$Method, [string]$Uri, [int]$ExpectedStatus, [AllowNull()][object]$Body, [AllowNull()][string]$AccessToken) {
    $headers = @{ Accept = 'application/json' }
    if (-not [string]::IsNullOrWhiteSpace($AccessToken)) { $headers.Authorization = 'Bearer ' + $AccessToken }
    try {
        if ($null -eq $Body) {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 -Method $Method -Uri $Uri -Headers $headers
        } else {
            $json = $Body | ConvertTo-Json -Depth 12 -Compress
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 -Method $Method -Uri $Uri `
                -Headers $headers -ContentType 'application/json' -Body $json
        }
    } catch {
        $headers.Clear()
        throw 'api-request-failed'
    }
    $headers.Clear()
    if ([int]$response.StatusCode -ne $ExpectedStatus) { throw 'api-status-unexpected' }
    $responseText = Get-HttpResponseText -Response $response
    if ([string]::IsNullOrWhiteSpace($responseText)) { return $null }
    try { return $responseText | ConvertFrom-Json } catch { throw 'api-json-invalid' }
}

try {
    Set-Location -LiteralPath $repoRoot
    if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) { throw 'root-env-missing' }
    if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) { throw 'smoke-compose-missing' }
    if (-not (Test-Path -LiteralPath $dockerPath -PathType Leaf)) { throw 'docker-cli-missing' }

    $requiredEnvironment = @(
        'IDENTITY_DB_HOST', 'IDENTITY_DB_PORT', 'IDENTITY_DB_NAME', 'IDENTITY_DB_USERNAME', 'IDENTITY_DB_PASSWORD',
        'WORKSPACE_DB_HOST', 'WORKSPACE_DB_PORT', 'WORKSPACE_DB_NAME', 'WORKSPACE_DB_USERNAME', 'WORKSPACE_DB_PASSWORD',
        'WORKFLOW_DB_HOST', 'WORKFLOW_DB_PORT', 'WORKFLOW_DB_NAME', 'WORKFLOW_DB_USERNAME', 'WORKFLOW_DB_PASSWORD'
    )
    $envLines = Get-Content -LiteralPath '.env'
    foreach ($name in $requiredEnvironment) {
        $pattern = '^\s*' + [regex]::Escape($name) + '\s*='
        if (-not ($envLines | Where-Object { $_ -match $pattern } | Select-Object -First 1)) { throw 'root-env-database-setting-missing' }
    }

    foreach ($name in $secretNames) { Set-ProcessValue -Name $name -Value $null }

    # Neon's pooled endpoint rejects the search_path startup parameter used to
    # keep each smoke service inside its own test schema.
    foreach ($service in @('IDENTITY', 'WORKSPACE', 'WORKFLOW')) {
        $hostVariable = $service + '_DB_HOST'
        $hostPattern = '^\s*' + [regex]::Escape($hostVariable) + '\s*=\s*(.*)$'
        $hostEntries = @($envLines | Where-Object { $_ -match $hostPattern })
        if ($hostEntries.Count -ne 1) { throw 'root-env-database-host-not-unique' }
        $pooledHost = ([regex]::Match($hostEntries[0], $hostPattern).Groups[1].Value).Trim().Trim('"').Trim("'")
        if ($pooledHost -notmatch '^ep-[a-z0-9-]+-pooler\.[a-z0-9.-]+\.neon\.tech$') {
            throw 'root-env-database-host-not-neon-pooler'
        }
        Set-ProcessValue -Name $hostVariable -Value ($pooledHost -replace '-pooler(?=\.)', '')
        $pooledHost = $null
    }

    $date = Get-Date -Format 'yyyyMMdd'
    $nonce = [Guid]::NewGuid().ToString('N').Substring(0, 12)
    $projectName = 'weav-workflow-smoke-' + $date + '-' + $nonce
    $schemaSuffix = if ($TestSchemaSuffix) { $TestSchemaSuffix } else { $date + '_' + $nonce }
    $identitySchema = 'weav_workflow_smoke_identity_' + $schemaSuffix
    $workspaceSchema = 'weav_workflow_smoke_workspace_' + $schemaSuffix
    $workflowSchema = 'weav_workflow_smoke_workflow_' + $schemaSuffix

    Set-ProcessValue 'WORKFLOW_TEST_IDENTITY_SCHEMA' $identitySchema
    Set-ProcessValue 'WORKFLOW_TEST_WORKSPACE_SCHEMA' $workspaceSchema
    Set-ProcessValue 'WORKFLOW_TEST_WORKFLOW_SCHEMA' $workflowSchema
    Set-ProcessValue 'WORKFLOW_SMOKE_WORKFLOW_PORT' ([string](Get-FreeLoopbackPort))
    Set-ProcessValue 'WORKFLOW_SMOKE_IDENTITY_PORT' ([string](Get-FreeLoopbackPort))
    Set-ProcessValue 'WORKFLOW_SMOKE_WORKSPACE_PORT' ([string](Get-FreeLoopbackPort))
    Set-ProcessValue 'WORKFLOW_SMOKE_MAILPIT_PORT' ([string](Get-FreeLoopbackPort))

    Set-ProcessValue 'JWT_ACCESS_SECRET' (New-RandomBase64 48)
    Set-ProcessValue 'JWT_REFRESH_SECRET' (New-RandomBase64 48)
    Set-ProcessValue 'JWT_ISSUER' 'weav-live-smoke'
    Set-ProcessValue 'JWT_AUDIENCE' 'weav-api'
    Set-ProcessValue 'IDENTITY_INTERNAL_SERVICE_KEY' (New-RandomBase64 32)
    Set-ProcessValue 'WEAV_INTERNAL_SERVICE_KEY' (New-RandomBase64 32)
    Set-ProcessValue 'WORKFLOW_INTERNAL_SERVICE_KEY' (New-RandomBase64 32)
    Set-ProcessValue 'OTP_HMAC_SECRET' (New-RandomBase64 32)
    Set-ProcessValue 'CREDENTIAL_ENCRYPTION_KEY' (New-RandomBase64 32)
    Set-ProcessValue 'CREDENTIAL_ENCRYPTION_KEY_VERSION' 'smoke'
    Set-ProcessValue 'RABBITMQ_USERNAME' 'workflow-smoke'
    Set-ProcessValue 'RABBITMQ_PASSWORD' (New-RandomBase64 32)

    $stage = 'compose-config-standalone'
    $null = Invoke-ComposeSafe -ComposeArguments @('config', '--quiet') -FailureStage 'compose-config-invalid'
    $stage = 'compose-config-bootstrap-profile'
    $null = Invoke-ComposeSafe -ComposeArguments @('--profile', 'schema-bootstrap', 'config', '--quiet') -FailureStage 'compose-bootstrap-config-invalid'
    $stage = 'compose-config-resolved-json'
    $resolvedJson = Invoke-ComposeSafe -ComposeArguments @('config', '--format', 'json') -FailureStage 'compose-config-json-invalid'
    $resolvedConfig = $resolvedJson | ConvertFrom-Json
    $stage = 'compose-config-isolation-check'
    Assert-ResolvedSmokeConfig -Config $resolvedConfig
    $resolvedConfig = $null
    $resolvedJson = $null

    if ($ValidateOnly) {
        Write-Output ('PASS compose-config project=' + $projectName + ' no database schemas or containers created')
        return
    }

    $stage = 'schema-bootstrap-identity'
    $script:validationCheck = $stage
    $composeResourcesAttempted = $true
    $schemaAttempts.Add($identitySchema)
    $schemaOutput = [string](Invoke-ComposeSafe -ComposeArguments @('--profile', 'schema-bootstrap', 'run', '--rm', '--no-deps', '-T', 'schema-bootstrap-identity') -FailureStage 'schema-bootstrap-identity-failed')
    if ($schemaOutput.Trim() -ne $identitySchema) { $script:failureClass = 'schema-bootstrap-output-mismatch'; throw 'schema-bootstrap-identity-verification-failed' }
    $createdSchemas.Add($identitySchema)

    $stage = 'schema-bootstrap-workspace'
    $script:validationCheck = $stage
    $schemaAttempts.Add($workspaceSchema)
    $schemaOutput = [string](Invoke-ComposeSafe -ComposeArguments @('--profile', 'schema-bootstrap', 'run', '--rm', '--no-deps', '-T', 'schema-bootstrap-workspace') -FailureStage 'schema-bootstrap-workspace-failed')
    if ($schemaOutput.Trim() -ne $workspaceSchema) { $script:failureClass = 'schema-bootstrap-output-mismatch'; throw 'schema-bootstrap-workspace-verification-failed' }
    $createdSchemas.Add($workspaceSchema)

    $stage = 'schema-bootstrap-workflow'
    $script:validationCheck = $stage
    $schemaAttempts.Add($workflowSchema)
    $schemaOutput = [string](Invoke-ComposeSafe -ComposeArguments @('--profile', 'schema-bootstrap', 'run', '--rm', '--no-deps', '-T', 'schema-bootstrap-workflow') -FailureStage 'schema-bootstrap-workflow-failed')
    if ($schemaOutput.Trim() -ne $workflowSchema) { $script:failureClass = 'schema-bootstrap-output-mismatch'; throw 'schema-bootstrap-workflow-verification-failed' }
    $createdSchemas.Add($workflowSchema)
    $schemaOutput = $null

    $stage = 'local-services-start'
    $composeStartAttempted = $true
    $null = Invoke-ComposeSafe -ComposeArguments @('up', '--detach', '--build', 'valkey', 'rabbitmq', 'mailpit', 'identity-service', 'workspace-service', 'workflow-service') -FailureStage 'local-services-start-failed'

    $stage = 'local-services-readiness'
    Wait-HttpReady -Uri ('http://127.0.0.1:' + $env:WORKFLOW_SMOKE_MAILPIT_PORT + '/api/v1/info') -TimeoutSeconds 90
    Wait-HttpReady -Uri ('http://127.0.0.1:' + $env:WORKFLOW_SMOKE_IDENTITY_PORT + '/actuator/health/readiness') -TimeoutSeconds 300 -HealthPayload
    Wait-HttpReady -Uri ('http://127.0.0.1:' + $env:WORKFLOW_SMOKE_WORKSPACE_PORT + '/actuator/health/readiness') -TimeoutSeconds 300 -HealthPayload
    Wait-HttpReady -Uri ('http://127.0.0.1:' + $env:WORKFLOW_SMOKE_WORKFLOW_PORT + '/actuator/health/readiness') -TimeoutSeconds 300 -HealthPayload

    $stage = 'identity-register'
    $accountEmail = 'workflow-smoke-' + $nonce + '@example.invalid'
    $accountPassword = New-RandomBase64 36
    $identityBase = 'http://127.0.0.1:' + $env:WORKFLOW_SMOKE_IDENTITY_PORT
    $registration = Invoke-JsonApi -Method 'POST' -Uri ($identityBase + '/auth/register') -ExpectedStatus 201 `
        -Body @{ email = $accountEmail; password = $accountPassword; displayName = 'Workflow V1 live acceptance' } -AccessToken $null
    if ($null -eq $registration) { throw 'identity-register-response-invalid' }

    $stage = 'identity-login-before-verification'
    $credentials = @{ email = $accountEmail; password = $accountPassword }
    $initialLogin = Invoke-JsonApi -Method 'POST' -Uri ($identityBase + '/auth/login') -ExpectedStatus 200 `
        -Body $credentials -AccessToken $null
    $verificationToken = [string]$initialLogin.accessToken
    if ([string]::IsNullOrWhiteSpace($verificationToken)) { throw 'identity-login-response-invalid' }

    $stage = 'identity-otp-request'
    $receipt = Invoke-JsonApi -Method 'POST' -Uri ($identityBase + '/auth/otp/request') -ExpectedStatus 202 `
        -Body @{ purpose = 'EMAIL_VERIFICATION' } -AccessToken $verificationToken
    if ([string]::IsNullOrWhiteSpace([string]$receipt.challengeId)) { throw 'identity-otp-receipt-invalid' }

    $stage = 'identity-otp-mail-read'
    $mailpitTextUri = 'http://127.0.0.1:' + $env:WORKFLOW_SMOKE_MAILPIT_PORT + '/view/latest.txt'
    $otpText = $null
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(45)
    do {
        try {
            $mailResponse = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Method Get -Uri $mailpitTextUri
            if ($mailResponse.StatusCode -eq 200) { $otpText = Get-HttpResponseText -Response $mailResponse; break }
        } catch { }
        Start-Sleep -Milliseconds 500
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    if ([string]::IsNullOrWhiteSpace($otpText)) { throw 'identity-otp-mail-not-received' }
    $codes = [regex]::Matches($otpText, '(?<!\d)\d{6}(?!\d)') | ForEach-Object { $_.Value } | Select-Object -Unique
    if (@($codes).Count -ne 1) { throw 'identity-otp-code-not-unique' }
    $otpCode = [string](@($codes)[0])
    $otpText = $null
    $mailResponse = $null

    $stage = 'identity-otp-verify'
    $verification = Invoke-JsonApi -Method 'POST' -Uri ($identityBase + '/auth/otp/verify') -ExpectedStatus 200 `
        -Body @{ challengeId = [string]$receipt.challengeId; code = $otpCode } -AccessToken $verificationToken
    if ($verification.purpose -ne 'EMAIL_VERIFICATION' -or $verification.verified -ne $true) { throw 'identity-otp-verification-failed' }
    $otpCode = $null
    $verificationToken = $null
    $initialLogin = $null
    $receipt = $null
    $verification = $null

    $stage = 'identity-login-final'
    $finalLogin = Invoke-JsonApi -Method 'POST' -Uri ($identityBase + '/auth/login') -ExpectedStatus 200 `
        -Body $credentials -AccessToken $null
    $accessToken = [string]$finalLogin.accessToken
    if ([string]::IsNullOrWhiteSpace($accessToken)) { throw 'identity-final-login-invalid' }
    $finalLogin = $null
    $credentials = $null

    $stage = 'workspace-create'
    $workspaceBase = 'http://127.0.0.1:' + $env:WORKFLOW_SMOKE_WORKSPACE_PORT
    $workspace = Invoke-JsonApi -Method 'POST' -Uri ($workspaceBase + '/workspaces') -ExpectedStatus 201 `
        -Body @{ name = 'Workflow V1 live acceptance ' + $nonce } -AccessToken $accessToken
    $workspaceId = [guid]::Empty
    if (-not [guid]::TryParse([string]$workspace.id, [ref]$workspaceId)) { throw 'workspace-create-response-invalid' }

    $stage = 'workflow-service-smoke'
    Set-ProcessValue 'WORKFLOW_TEST_ACCESS_TOKEN' $accessToken
    $workflowUrl = 'http://127.0.0.1:' + $env:WORKFLOW_SMOKE_WORKFLOW_PORT
    $originalErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $smokeOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts/test-workflow-v1.ps1') `
            -WorkflowUrl $workflowUrl -WorkspaceId $workspaceId `
            -FixturePath 'packages/contracts/http/workflow/examples/manual-http-condition.json' `
            -ConfirmDisposableWorkspace 2>&1
        $smokeExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $originalErrorAction
    }
    $smokeLine = @($smokeOutput | Where-Object { [string]$_ -like 'PASS workflow=*' } | Select-Object -First 1)
    if ($smokeExitCode -ne 0 -or $smokeLine.Count -ne 1) {
        $failureText = @($smokeOutput | ForEach-Object { [string]$_ } | Where-Object { $_ -match "Workflow V1 smoke failed at stage '([a-z-]+)' status=(none|[0-9]{3}) kind=([A-Za-z]+) reason=([a-z-]+)\." } | Select-Object -First 1)
        if ($failureText.Count -eq 1) {
            $failureMatch = [regex]::Match($failureText[0], "Workflow V1 smoke failed at stage '([a-z-]+)' status=(none|[0-9]{3}) kind=([A-Za-z]+) reason=([a-z-]+)\.")
            $script:failureClass = 'workflow-smoke-' + $failureMatch.Groups[1].Value + '-http-' + $failureMatch.Groups[2].Value + '-' + $failureMatch.Groups[3].Value + '-' + $failureMatch.Groups[4].Value
        } else {
            $script:failureClass = 'workflow-smoke-child-error'
        }
        throw 'workflow-service-smoke-failed'
    }
    $accepted = $true
    $smokeOutput = $null
    $accessToken = $null
    Set-ProcessValue 'WORKFLOW_TEST_ACCESS_TOKEN' $null

    $stage = 'compose-cleanup'
    try {
        $null = Invoke-ComposeSafe -ComposeArguments @('down', '--remove-orphans', '--volumes') -FailureStage 'compose-cleanup-failed'
        $cleanupState = 'removed'
    } catch {
        $cleanupState = 'failed'
    }

    Write-Output ('PASS auth=registered,verified,logged-in workspace=created-via-public-api')
    Write-Output ([string]$smokeLine[0])
    Write-Output ('ComposeProject=' + $projectName + ' cleanup=' + $cleanupState)
    Write-Output ('ComposeVolume=' + $projectName + '_rabbitmq_smoke_data cleanup=' + $cleanupState)
    Write-Output ('LoopbackPorts workflow=' + $env:WORKFLOW_SMOKE_WORKFLOW_PORT + ' identity=' + $env:WORKFLOW_SMOKE_IDENTITY_PORT +
        ' workspace=' + $env:WORKFLOW_SMOKE_WORKSPACE_PORT + ' mailpit-api=' + $env:WORKFLOW_SMOKE_MAILPIT_PORT)
    Write-Output ('TestSchemas retained-for-review identity=' + $identitySchema + ' workspace=' + $workspaceSchema + ' workflow=' + $workflowSchema)
} catch {
    $failureLine = [int]$_.InvocationInfo.ScriptLineNumber
    if ($script:failureClass -eq 'none') {
        $script:failureClass = 'unclassified-helper-exception'
    }
    if (($composeResourcesAttempted -or $composeStartAttempted) -and $cleanupState -eq 'not-started') {
        try {
            $null = Invoke-ComposeSafe -ComposeArguments @('down', '--remove-orphans', '--volumes') -FailureStage 'compose-cleanup-failed'
            $cleanupState = 'removed'
        } catch {
            $cleanupState = 'failed'
        }
    }
    $attempted = if ($schemaAttempts.Count -gt 0) { $schemaAttempts -join ',' } else { 'none' }
    $confirmed = if ($createdSchemas.Count -gt 0) { $createdSchemas -join ',' } else { 'none' }
    $project = if ($projectName) { $projectName } else { 'not-created' }
    $loopbackPorts = 'workflow=' + $(if ($env:WORKFLOW_SMOKE_WORKFLOW_PORT) { $env:WORKFLOW_SMOKE_WORKFLOW_PORT } else { 'unassigned' }) +
        ',identity=' + $(if ($env:WORKFLOW_SMOKE_IDENTITY_PORT) { $env:WORKFLOW_SMOKE_IDENTITY_PORT } else { 'unassigned' }) +
        ',workspace=' + $(if ($env:WORKFLOW_SMOKE_WORKSPACE_PORT) { $env:WORKFLOW_SMOKE_WORKSPACE_PORT } else { 'unassigned' }) +
        ',mailpit-api=' + $(if ($env:WORKFLOW_SMOKE_MAILPIT_PORT) { $env:WORKFLOW_SMOKE_MAILPIT_PORT } else { 'unassigned' })
    [Console]::Error.WriteLine('FAIL stage=' + $stage + ' composeProject=' + $project +
        ' confirmedSchemas=' + $confirmed + ' schemaAttempts=' + $attempted +
        ' composeStartAttempted=' + [string]$composeStartAttempted + ' cleanup=' + $cleanupState +
        ' loopbackPorts=' + $loopbackPorts + ' check=' + $script:validationCheck +
        ' failureClass=' + $script:failureClass + ' failureLine=' + $failureLine +
        '; details and credential material were suppressed.')
    if ($accepted) { [Console]::Error.WriteLine('Live acceptance passed; only the reporting/cleanup stage failed.') }
    $script:exitCode = 1
} finally {
    Set-ProcessValue 'WORKFLOW_TEST_ACCESS_TOKEN' $null
    $accountEmail = $null
    $accountPassword = $null
    $accessToken = $null
    $verificationToken = $null
    $otpCode = $null
    $otpText = $null
    $resolvedJson = $null
    $resolvedConfig = $null
    foreach ($name in $secretNames) {
        Set-ProcessValue -Name $name -Value $originalEnvironment[$name]
    }
}

if ($script:exitCode -eq 1) { exit 1 }
