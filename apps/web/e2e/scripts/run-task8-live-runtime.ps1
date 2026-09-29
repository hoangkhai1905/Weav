param(
  [int]$HealthTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$composeFile = Join-Path $repoRoot 'apps/web/e2e/docker/task8-runtime.compose.yml'
$composeDirectory = Split-Path -Parent $composeFile
$projectSuffix = [Guid]::NewGuid().ToString('N').Substring(0, 10)
$projectName = "weav-task8-$projectSuffix"
$runDirectory = Join-Path ([IO.Path]::GetTempPath()) $projectName
$emptyComposeEnv = Join-Path $runDirectory 'empty-compose-env'
$emptyViteEnv = Join-Path $runDirectory 'empty-vite-env'
$randomBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
$jwtSecret = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$workspaceDbPassword = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$notificationDbPassword = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$rabbitPassword = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$credentialKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$redactValues = @($jwtSecret, $workspaceDbPassword, $notificationDbPassword, $rabbitPassword, $credentialKey)
$createdContainerIds = @()
$composeStarted = $false
$webPort = 0

function Protect-Text([string]$Text) {
  foreach ($value in ($redactValues | Sort-Object Length -Descending -Unique)) {
    if ($value) { $Text = $Text.Replace($value, '[REDACTED]') }
  }
  return [Regex]::Replace($Text, '(?i)eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+', '[REDACTED_JWT]')
}

function Invoke-Captured([string]$Executable, [string[]]$Arguments, [switch]$ShowFailure) {
  $output = @(& $Executable @Arguments 2>&1 | ForEach-Object { "$_" })
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    if ($ShowFailure -and $output.Count -gt 0) {
      $safeOutput = Protect-Text ($output -join [Environment]::NewLine)
      $tail = ($safeOutput -split [Environment]::NewLine | Select-Object -Last 70) -join [Environment]::NewLine
      Write-Output $tail
    }
    throw "$Executable failed with exit code $exitCode; diagnostic output is redacted above."
  }
  return $output
}

function Get-ComposeArguments {
  return @('compose', '--ansi', 'never', '--project-directory', $composeDirectory, '--env-file', $emptyComposeEnv, '-f', $composeFile, '-p', $projectName)
}

function Get-HostPort([string]$Service, [int]$ContainerPort) {
  $lines = Invoke-Captured 'docker' ((Get-ComposeArguments) + @('port', $Service, "$ContainerPort"))
  $binding = ($lines | Select-Object -First 1).Trim()
  if ($binding -notmatch ':(\d+)$') { throw "Could not resolve the owned $Service port binding." }
  return [int]$Matches[1]
}

function Wait-Http([string]$Service, [string]$BaseUrl, [string]$Path, [int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $ids = @(Invoke-Captured 'docker' ((Get-ComposeArguments) + @('ps', '-a', '-q', $Service)))
    if ($ids.Count -eq 1) {
      $state = @(& docker inspect --format '{{.State.Status}}|{{.State.ExitCode}}' $ids[0] 2>$null)
      if ($LASTEXITCODE -eq 0 -and $state.Count -eq 1 -and $state[0] -match '^exited\|(\d+)$') {
        throw "$Service container exited with code $($Matches[1]) before its health endpoint became ready."
      }
    }
    try {
      $response = Invoke-WebRequest -Uri "$BaseUrl$Path" -Method Get -TimeoutSec 3 -SkipHttpErrorCheck
      if ($response.StatusCode -eq 200) { return }
    } catch { }
    Start-Sleep -Seconds 1
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Health deadline expired for $Path on the Task8-owned disposable stack."
}

function Get-OwnedContainerIds {
  $ids = @(Invoke-Captured 'docker' ((Get-ComposeArguments) + @('ps', '-a', '-q')))
  return @($ids | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

try {
  if (Test-Path -LiteralPath $runDirectory) { throw 'Generated temporary Task8 directory already exists; refusing reuse or cleanup.' }
  New-Item -ItemType Directory -Path $runDirectory, $emptyViteEnv | Out-Null
  [IO.File]::WriteAllText($emptyComposeEnv, '')

  $existing = @(Invoke-Captured 'docker' @('ps', '-a', '--filter', "label=com.docker.compose.project=$projectName", '--format', '{{.ID}}'))
  if ($existing.Count -gt 0) { throw 'Generated Compose project name is unexpectedly already in use; refusing reuse.' }

  $env:TASK8_WORKSPACE_DB_PASSWORD = $workspaceDbPassword
  $env:TASK8_NOTIFICATION_DB_PASSWORD = $notificationDbPassword
  $env:TASK8_RABBITMQ_PASSWORD = $rabbitPassword
  $env:TASK8_JWT_SECRET = $jwtSecret
  $env:TASK8_CREDENTIAL_ENCRYPTION_KEY = $credentialKey

  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $webPort = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  $env:TASK8_CORS_ALLOWED_ORIGIN = "http://127.0.0.1:$webPort"

  $compose = Get-ComposeArguments
  $composeStarted = $true
  $null = Invoke-Captured 'docker' ($compose + @('up', '-d', '--build')) -ShowFailure
  $createdContainerIds = Get-OwnedContainerIds
  if ($createdContainerIds.Count -lt 7) { throw 'Disposable stack did not create the expected owned containers.' }

  $workspacePort = Get-HostPort 'workspace-service' 8080
  $notificationPort = Get-HostPort 'notification-service' 3000
  $gatewayPort = Get-HostPort 'api-gateway' 3000
  Wait-Http 'workspace-service' "http://127.0.0.1:$workspacePort" '/actuator/health/readiness' $HealthTimeoutSeconds
  Wait-Http 'notification-service' "http://127.0.0.1:$notificationPort" '/ready' $HealthTimeoutSeconds
  Wait-Http 'api-gateway' "http://127.0.0.1:$gatewayPort" '/health' $HealthTimeoutSeconds

  $env:WEAV_E2E_ENV_DIR = $emptyViteEnv
  $env:WEAV_E2E_PORT = "$webPort"
  $env:WEAV_E2E_LIVE_NOTIFICATIONS = '1'
  $env:WEAV_TASK8_JWT_SECRET = $jwtSecret
  $env:WEAV_TASK8_HTTP_EVIDENCE_PATH = Join-Path $runDirectory 'http-evidence.txt'
  $env:VITE_API_MODE = 'http'
  $env:VITE_API_BASE_URL = "http://127.0.0.1:$gatewayPort"

  $testOutput = Invoke-Captured 'pnpm' @('--dir', 'apps/web', 'exec', 'playwright', 'test', 'e2e/notification-live-runtime.spec.ts', '--project=chromium', '--workers=1', '--reporter=line') -ShowFailure
  $safeTestOutput = Protect-Text ($testOutput -join [Environment]::NewLine)
  $summary = $safeTestOutput | Select-String -Pattern '\b1 passed\b|\b1 failed\b|Task8 live HTTP evidence:'
  if (-not ($summary | Select-String -Pattern '\b1 passed\b')) { throw 'Playwright did not report one passing live runtime test.' }
  Write-Output ($summary -join [Environment]::NewLine)
  $evidencePath = $env:WEAV_TASK8_HTTP_EVIDENCE_PATH
  if (-not (Test-Path -LiteralPath $evidencePath)) { throw 'Playwright passed without writing the sanitized HTTP evidence artifact.' }
  Write-Output "Sanitized HTTP statuses: $((Get-Content -LiteralPath $evidencePath -Raw).Trim() -replace '\r?\n', '; ')"
  Write-Output 'Runtime lane: disposable Workspace → outbox/RabbitMQ → Notification → Gateway → Chromium; JWT synthetic and /api/auth/me stubbed, not Identity authentication.'
}
catch {
  Write-Output (Protect-Text $_.Exception.Message)
  if ($composeStarted) {
    if ($createdContainerIds.Count -eq 0) { $createdContainerIds = Get-OwnedContainerIds }
    foreach ($id in $createdContainerIds) {
      $containerEnvironment = @(& docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $id 2>$null)
      foreach ($entry in $containerEnvironment) {
        $pair = $entry -split '=', 2
        if ($pair.Count -eq 2 -and $pair[1].Length -ge 4) { $redactValues += $pair[1] }
      }
    }
    $redactValues = @($redactValues | Sort-Object Length -Descending -Unique)
    $logs = @(& docker @(Get-ComposeArguments) logs --no-color --tail 70 2>&1 | ForEach-Object { "$_" })
    if ($logs.Count -gt 0) { Write-Output (Protect-Text ($logs -join [Environment]::NewLine)) }
  }
  exit 1
}
finally {
  if ($composeStarted) {
    if ($createdContainerIds.Count -eq 0) { $createdContainerIds = Get-OwnedContainerIds }
    $cleanupIds = @(Get-OwnedContainerIds)
    $ownershipValid = $cleanupIds.Count -gt 0 -and @($cleanupIds | Where-Object { $_ -notin $createdContainerIds }).Count -eq 0
    foreach ($id in $cleanupIds) {
      $inspection = @(& docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}|{{json .Mounts}}' $id 2>$null)
      if ($LASTEXITCODE -ne 0 -or $inspection.Count -ne 1) { $ownershipValid = $false; break }
      $parts = $inspection[0] -split '\|', 2
      if ($parts[0] -ne $projectName) { $ownershipValid = $false; break }
      $mounts = @($parts[1] | ConvertFrom-Json)
      foreach ($mount in $mounts) {
        if ($mount.Type -ne 'volume' -or -not $mount.Name.StartsWith("${projectName}_", [StringComparison]::OrdinalIgnoreCase)) {
          $ownershipValid = $false
          break
        }
        $volumeLabels = @(& docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' $mount.Name 2>$null)
        if ($LASTEXITCODE -ne 0 -or $volumeLabels.Count -ne 1 -or $volumeLabels[0] -ne $projectName) {
          $ownershipValid = $false
          break
        }
      }
      if (-not $ownershipValid) { break }
    }
    if ($ownershipValid) {
      $null = Invoke-Captured 'docker' ((Get-ComposeArguments) + @('down', '--volumes', '--remove-orphans'))
      Write-Output "Cleaned owned disposable containers/network for project $projectName after ID, project-label and empty-mount checks."
    } else {
      Write-Output "Cleanup withheld: container ownership or mount verification failed; inspect only generated Task8 project $projectName."
      Write-Output "Owned candidate IDs: $($cleanupIds -join ', ')"
    }
  }

  foreach ($name in @('TASK8_WORKSPACE_DB_PASSWORD','TASK8_NOTIFICATION_DB_PASSWORD','TASK8_RABBITMQ_PASSWORD','TASK8_JWT_SECRET','TASK8_CREDENTIAL_ENCRYPTION_KEY','TASK8_CORS_ALLOWED_ORIGIN','WEAV_E2E_ENV_DIR','WEAV_E2E_PORT','WEAV_E2E_LIVE_NOTIFICATIONS','WEAV_TASK8_JWT_SECRET','WEAV_TASK8_HTTP_EVIDENCE_PATH','VITE_API_MODE','VITE_API_BASE_URL')) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $resolvedRunDirectory = [IO.Path]::GetFullPath($runDirectory)
  if ((Split-Path -Leaf $resolvedRunDirectory) -eq $projectName -and $resolvedRunDirectory.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedRunDirectory)) {
    Remove-Item -LiteralPath $resolvedRunDirectory -Recurse -Force
  } else {
    Write-Output 'Temporary directory cleanup withheld: exact generated path did not validate within the system temp root.'
  }
}
