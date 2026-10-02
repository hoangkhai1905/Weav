$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$expectedBranch = 'codex/notification-expansion'
$expectedHead = 'b0cf1b5bd49f64d476851ffe2013131ca6135212'
$branch = (& git -C $repoRoot branch --show-current).Trim()
$head = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($branch -ne $expectedBranch -or $head -ne $expectedHead) {
    throw 'Task10 stopped: the configured repository branch/base does not match the authorized worktree.'
}

$dockerCommand = (Get-Command docker.exe -CommandType Application -ErrorAction Stop).Source
$nodeCommand = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$composeFile = Join-Path $repoRoot 'apps/web/e2e/docker/task10-runtime.compose.yml'
$expoServerFile = Join-Path $repoRoot 'apps/mobile/e2e/task10-static-server.cjs'
$expoOriginPreflightFile = Join-Path $repoRoot 'apps/mobile/e2e/task10-export-origin.cjs'
$viteEntry = Join-Path $repoRoot 'apps/web/node_modules/vite/bin/vite.js'
$projectName = "weav-task10-$([Guid]::NewGuid().ToString('N').Substring(0, 12))"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) $projectName
$emptyEnvFile = Join-Path $tempRoot 'empty-compose.env'
$webEnvDirectory = Join-Path $tempRoot 'empty-web-env'
$mobileDist = Join-Path $tempRoot 'expo-web-dist'
$runnerOutput = Join-Path $tempRoot 'playwright-output'
$composeLog = Join-Path $tempRoot 'compose-build.log'
$expoLog = Join-Path $tempRoot 'expo-export.log'
$viteStdout = Join-Path $tempRoot 'vite.stdout.log'
$viteStderr = Join-Path $tempRoot 'vite.stderr.log'
$mobileStdout = Join-Path $tempRoot 'expo-static.stdout.log'
$mobileStderr = Join-Path $tempRoot 'expo-static.stderr.log'
$composeStarted = $false
$viteProcess = $null
$mobileProcess = $null
$testExitCode = 1
$stage = 'preflight'
$oldEnvironment = @{}

function Get-RandomHex([int]$ByteCount = 32) {
    $bytes = [byte[]]::new($ByteCount)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToHexString($bytes).ToLowerInvariant()
}

function Get-FreeLoopbackPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return $listener.LocalEndpoint.Port
    }
    finally {
        $listener.Stop()
    }
}

function Set-Task10Environment([string]$Name, [AllowNull()][string]$Value) {
    if (-not $oldEnvironment.ContainsKey($Name)) {
        $oldEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
    }
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Protect-Task10Text([string]$Value) {
    $safe = $Value
    foreach ($name in @(
        'TASK10_IDENTITY_DB_PASSWORD', 'TASK10_WORKSPACE_DB_PASSWORD',
        'TASK10_WORKFLOW_DB_PASSWORD', 'TASK10_NOTIFICATION_DB_PASSWORD',
        'TASK10_RABBITMQ_PASSWORD', 'TASK10_JWT_ACCESS_SECRET',
        'TASK10_JWT_REFRESH_SECRET', 'TASK10_CREDENTIAL_ENCRYPTION_KEY',
        'TASK10_IDENTITY_INTERNAL_SERVICE_KEY', 'TASK10_WEAV_INTERNAL_SERVICE_KEY',
        'TASK10_WORKFLOW_INTERNAL_SERVICE_KEY'
    )) {
        $secret = [Environment]::GetEnvironmentVariable($name, 'Process')
        if (-not [string]::IsNullOrEmpty($secret)) { $safe = $safe.Replace($secret, '[redacted]') }
    }
    return $safe
}

function Invoke-Task10Compose([string[]]$ComposeArguments, [switch]$Capture) {
    $arguments = @(
        'compose', '--project-name', $projectName,
        '--env-file', $emptyEnvFile,
        '--file', $composeFile
    ) + $ComposeArguments
    if ($Capture) {
        $output = & $dockerCommand @arguments 2>&1
        $exit = $LASTEXITCODE
        $output | Out-File -LiteralPath $composeLog -Encoding utf8 -Append
        if ($exit -ne 0) {
            $diagnostic = @($output | ForEach-Object { Protect-Task10Text ([string]$_) } | Where-Object {
                $_ -match '(?i)(\[ERROR\]|error|failed|failure|not found|unable|cannot|could not|Caused by)'
            } | Select-Object -Last 24)
            if ($diagnostic.Count) { Write-Host ($diagnostic -join [Environment]::NewLine) }
            throw "Task10 disposable Compose command failed with exit code $exit."
        }
        return $output
    }
    & $dockerCommand @arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Task10 disposable Compose command failed with exit code $LASTEXITCODE." }
}

$httpHandler = [Net.Http.HttpClientHandler]::new()
$httpHandler.UseProxy = $false
$httpClient = [Net.Http.HttpClient]::new($httpHandler)
$httpClient.Timeout = [TimeSpan]::FromSeconds(3)
function Test-Task10HttpStatus([string]$Uri, [int[]]$ExpectedStatus) {
    try {
        $response = $httpClient.GetAsync($Uri).GetAwaiter().GetResult()
        try { return $ExpectedStatus -contains [int]$response.StatusCode }
        finally { $response.Dispose() }
    }
    catch { return $false }
}

function Wait-Task10HttpStatus([string]$Uri, [int[]]$ExpectedStatus, [int]$TimeoutSeconds, [string]$Label) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        if (Test-Task10HttpStatus $Uri $ExpectedStatus) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "Task10 bounded readiness wait expired for $Label."
}

function Stop-Task10Process($Process) {
    if ($null -eq $Process) { return }
    try {
        $current = Get-Process -Id $Process.Id -ErrorAction Stop
        if ($current.StartTime -eq $Process.StartTime) { Stop-Process -Id $Process.Id -Force -ErrorAction Stop }
    }
    catch { }
}

try {
    if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) { throw 'Task10 Compose file is missing.' }
    if (-not (Test-Path -LiteralPath $viteEntry -PathType Leaf)) { throw 'The installed web Vite entry point is missing.' }
    if (-not (Test-Path -LiteralPath $expoServerFile -PathType Leaf)) { throw 'The Task10 Expo Web static server is missing.' }
    if (-not (Test-Path -LiteralPath $expoOriginPreflightFile -PathType Leaf)) { throw 'The Task10 Expo origin preflight is missing.' }

    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $webEnvDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path $mobileDist -Force | Out-Null
    New-Item -ItemType Directory -Path $runnerOutput -Force | Out-Null
    New-Item -ItemType File -Path $emptyEnvFile -Force | Out-Null

    $webPort = Get-FreeLoopbackPort
    $mobilePort = Get-FreeLoopbackPort
    while ($mobilePort -eq $webPort) { $mobilePort = Get-FreeLoopbackPort }
    $gatewayPort = Get-FreeLoopbackPort
    $rabbitPort = Get-FreeLoopbackPort
    $corsOrigins = "http://127.0.0.1:$webPort,http://127.0.0.1:$mobilePort"
    $gatewayOrigin = 'http://placeholder'

    foreach ($name in @(
        'TASK10_IDENTITY_DB_PASSWORD', 'TASK10_WORKSPACE_DB_PASSWORD',
        'TASK10_WORKFLOW_DB_PASSWORD', 'TASK10_NOTIFICATION_DB_PASSWORD',
        'TASK10_RABBITMQ_PASSWORD', 'TASK10_JWT_ACCESS_SECRET',
        'TASK10_JWT_REFRESH_SECRET', 'TASK10_IDENTITY_INTERNAL_SERVICE_KEY',
        'TASK10_WEAV_INTERNAL_SERVICE_KEY', 'TASK10_WORKFLOW_INTERNAL_SERVICE_KEY'
    )) { Set-Task10Environment $name (Get-RandomHex) }

    $credentialBytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($credentialBytes)
    Set-Task10Environment 'TASK10_CREDENTIAL_ENCRYPTION_KEY' ([Convert]::ToBase64String($credentialBytes))
    Set-Task10Environment 'TASK10_CORS_ALLOWED_ORIGINS' $corsOrigins
    Set-Task10Environment 'TASK10_API_GATEWAY_HOST_PORT' ([string]$gatewayPort)
    Set-Task10Environment 'TASK10_RABBITMQ_MANAGEMENT_HOST_PORT' ([string]$rabbitPort)
    Set-Task10Environment 'WEAV_TASK10_NOTIFICATION_QUEUE' 'task10.notification.v2'
    Set-Task10Environment 'WEAV_TASK10_PROJECT_NAME' $projectName
    Set-Task10Environment 'WEAV_TASK10_COMPOSE_FILE' $composeFile
    Set-Task10Environment 'WEAV_TASK10_COMPOSE_ENV_FILE' $emptyEnvFile
    Set-Task10Environment 'WEAV_TASK10_DOCKER_CLI' $dockerCommand
    Set-Task10Environment 'WEAV_TASK10_REPO_ROOT' $repoRoot
    Set-Task10Environment 'WEAV_TASK10_MOBILE_DIST' $mobileDist
    Set-Task10Environment 'WEAV_TASK10_METRO_CACHE_DIR' (Join-Path $tempRoot 'expo-metro-transform-cache')
    Set-Task10Environment 'WEAV_TASK10_MOBILE_PORT' ([string]$mobilePort)
    Set-Task10Environment 'WEAV_TASK10_OUTPUT_DIR' $runnerOutput
    Set-Task10Environment 'WEAV_E2E_ENV_DIR' $webEnvDirectory
    Set-Task10Environment 'EXPO_NO_DOTENV' '1'
    Set-Task10Environment 'EXPO_PUBLIC_API_MODE' 'http'
    Set-Task10Environment 'VITE_API_MODE' 'http'

    $stage = 'compose-validation'
    & $dockerCommand compose --project-name $projectName --env-file $emptyEnvFile --file $composeFile config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Task10 disposable Compose configuration is invalid.' }

    $stage = 'compose-startup'
    Write-Host "Task10: starting isolated Compose project $projectName (no .env file; loopback ports only)."
    $composeStarted = $true
    Invoke-Task10Compose -ComposeArguments @('up', '--detach', '--build') -Capture | Out-Null

    $gatewayOrigin = "http://127.0.0.1:$gatewayPort"
    Set-Task10Environment 'WEAV_TASK10_GATEWAY_URL' $gatewayOrigin
    Set-Task10Environment 'WEAV_TASK10_RABBITMQ_URL' "http://127.0.0.1:$rabbitPort"
    Set-Task10Environment 'WEAV_TASK10_RABBITMQ_PASSWORD' $env:TASK10_RABBITMQ_PASSWORD
    Set-Task10Environment 'WEAV_TASK10_WEB_URL' "http://127.0.0.1:$webPort"
    Set-Task10Environment 'WEAV_TASK10_MOBILE_URL' "http://127.0.0.1:$mobilePort"
    Set-Task10Environment 'VITE_API_GATEWAY_URL' $gatewayOrigin
    Set-Task10Environment 'VITE_API_BASE_URL' $gatewayOrigin
    Set-Task10Environment 'EXPO_PUBLIC_API_BASE_URL' $gatewayOrigin

    $stage = 'gateway-readiness'
    Wait-Task10HttpStatus "$gatewayOrigin/api/v2/notifications" @(401) 90 'Gateway authenticated notification route'
    Wait-Task10HttpStatus "http://127.0.0.1:$rabbitPort/api/overview" @(401) 90 'RabbitMQ management endpoint'
    Write-Host 'Task10: loopback Gateway and RabbitMQ endpoints are ready; service APIs are exercised through Gateway.'

    $stage = 'expo-web-export'
    Write-Host 'Task10: exporting the installed Expo app in HTTP mode to a disposable directory.'
    Push-Location $repoRoot
    try {
        $expoOutput = & pnpm --dir apps/mobile exec expo export --platform web --output-dir $mobileDist 2>&1
        $expoExit = $LASTEXITCODE
        $expoOutput | Out-File -LiteralPath $expoLog -Encoding utf8
        if ($expoExit -ne 0) {
            $safeLines = @($expoOutput | ForEach-Object { Protect-Task10Text ([string]$_) } | Where-Object { $_ -match '(?i)error|failed|cannot|could not' } | Select-Object -Last 10)
            if ($safeLines.Count) { Write-Host ($safeLines -join [Environment]::NewLine) }
            throw "Expo Web static export failed with exit code $expoExit."
        }
    }
    finally { Pop-Location }
    if (-not (Test-Path -LiteralPath (Join-Path $mobileDist 'index.html') -PathType Leaf)) {
        throw 'Expo Web export completed without the expected index.html.'
    }
    $stage = 'expo-web-origin-preflight'
    & $nodeCommand $expoOriginPreflightFile
    if ($LASTEXITCODE -ne 0) { throw 'Expo Web export does not use the configured Gateway origin for this run.' }

    $stage = 'frontend-startup'
    $webArgs = @($viteEntry, '--host', '127.0.0.1', '--port', [string]$webPort, '--strictPort')
    $viteProcess = Start-Process -FilePath $nodeCommand -ArgumentList $webArgs -WorkingDirectory (Join-Path $repoRoot 'apps/web') -PassThru -WindowStyle Hidden -RedirectStandardOutput $viteStdout -RedirectStandardError $viteStderr
    $mobileArgs = @($expoServerFile)
    $mobileProcess = Start-Process -FilePath $nodeCommand -ArgumentList $mobileArgs -WorkingDirectory $repoRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $mobileStdout -RedirectStandardError $mobileStderr
    Wait-Task10HttpStatus "http://127.0.0.1:$webPort/" @(200) 60 'Vite test app'
    Wait-Task10HttpStatus "http://127.0.0.1:$mobilePort/" @(200) 60 'Expo Web test app'

    $stage = 'playwright-live-flow'
    Write-Host 'Task10: running one Chromium flow against real Gateway APIs and both HTTP clients.'
    Push-Location $repoRoot
    try {
        & pnpm --dir apps/web exec playwright test --config=e2e/task10-live.playwright.config.cjs
        $testExitCode = $LASTEXITCODE
    }
    finally { Pop-Location }
    if ($testExitCode -ne 0) { throw "Task10 live Playwright flow failed with exit code $testExitCode." }
    $stage = 'complete'
    Write-Host 'Task10 live Playwright flow passed.'
}
catch {
    $failureMessage = Protect-Task10Text $_.Exception.Message
    Write-Host "Task10 stopped during ${stage}: $failureMessage"
    if ($stage -eq 'gateway-readiness' -and $composeStarted) {
        $gatewayResponse = $null
        try {
            $gatewayResponse = $httpClient.GetAsync("$gatewayOrigin/api/v2/notifications").GetAwaiter().GetResult()
            Write-Host "Task10 Gateway readiness final HTTP status: $([int]$gatewayResponse.StatusCode)."
        }
        catch {
            $probeErrorType = $_.Exception.GetType().Name
            if ($null -ne $_.Exception.InnerException) { $probeErrorType += '/' + $_.Exception.InnerException.GetType().Name }
            Write-Host "Task10 Gateway readiness final probe failed: $probeErrorType."
        }
        finally {
            if ($null -ne $gatewayResponse) { $gatewayResponse.Dispose() }
        }

        $gatewayState = & $dockerCommand inspect --format '{{.State.Status}} exit={{.State.ExitCode}} restarting={{.State.Restarting}}' "${projectName}-api-gateway-1" 2>$null | Select-Object -First 1
        if ($gatewayState) { Write-Host "Task10 Gateway container state: $gatewayState." }
        $gatewayLogs = & $dockerCommand compose --project-name $projectName --env-file $emptyEnvFile --file $composeFile logs --no-color --tail 80 api-gateway 2>$null
        $gatewayTail = @($gatewayLogs | ForEach-Object { Protect-Task10Text ([string]$_) } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Last 35)
        if ($gatewayTail.Count) { Write-Host "Task10 redacted Gateway startup tail:`n$($gatewayTail -join [Environment]::NewLine)" }
    }
    if ($stage -eq 'compose-startup' -and $composeStarted) {
        $rabbitLogs = & $dockerCommand compose --project-name $projectName --env-file $emptyEnvFile --file $composeFile logs --no-color --tail 60 rabbitmq 2>$null
        $rabbitErrors = @($rabbitLogs | ForEach-Object { Protect-Task10Text ([string]$_) } | Where-Object {
            $_ -match '(?i)(error|fatal|fail|exception|permission|invalid|not found|cannot|could not)'
        } | Select-Object -Last 20)
        if ($rabbitErrors.Count) { Write-Host "Task10 sanitized RabbitMQ diagnostics:`n$($rabbitErrors -join [Environment]::NewLine)" }
    }
    $testExitCode = 1
}
finally {
    Stop-Task10Process $viteProcess
    Stop-Task10Process $mobileProcess

    if ($composeStarted) {
        $containerIds = @(& $dockerCommand compose --project-name $projectName --env-file $emptyEnvFile --file $composeFile ps --all --quiet 2>$null | Where-Object { $_ -match '^[0-9a-f]{12,64}$' })
        $ownershipVerified = $true
        foreach ($containerId in $containerIds) {
            $label = (& $dockerCommand inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' $containerId 2>$null | Select-Object -First 1).Trim()
            if ($label -ne $projectName) { $ownershipVerified = $false }
        }
        $volumeNames = @(& $dockerCommand volume ls --filter "label=com.docker.compose.project=$projectName" --quiet 2>$null | Where-Object { $_ })
        foreach ($volumeName in $volumeNames) {
            $label = (& $dockerCommand volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' $volumeName 2>$null | Select-Object -First 1).Trim()
            if ($label -ne $projectName) { $ownershipVerified = $false }
        }
        if ($ownershipVerified) {
            try {
                Invoke-Task10Compose -ComposeArguments @('down', '--volumes', '--remove-orphans', '--timeout', '10')
                Write-Host 'Task10: removed only containers, network and volumes labeled for the disposable project.'
            }
            catch { Write-Host 'Task10 cleanup concern: exact-project Compose teardown did not complete; inspect only this project label.' }
        }
        else {
            Write-Host 'Task10 cleanup stopped because a resource did not match the generated Compose project label.'
        }
    }

    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    if ($resolvedTemp.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTemp) -eq $projectName -and (Test-Path -LiteralPath $resolvedTemp)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
    }

    foreach ($name in @($oldEnvironment.Keys)) {
        [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], 'Process')
    }
    $httpClient.Dispose()
}

exit $testExitCode
