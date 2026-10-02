<#
.SYNOPSIS
    Downloads and sets up offline PaddleOCR / PaddleX model artifacts for WEAV OCR Service.

.DESCRIPTION
    Downloads verified inference model files and character dictionaries from official
    Hugging Face repositories into the PaddleX cache directory under the host model
    storage root (TargetRoot\paddlex-cache\official_models\<model_name>).
    Validates SHA256 checksums, supports idempotent runs (skips already-valid files),
    and avoids overwrites unless -Force is specified.

    Provisioned models:
      - PP-OCRv5_mobile_det: Detection model for all profiles (vi, vi+en, en)
      - pp-ocrv6-medium-rec-vietnamese: Recognition model for Vietnamese (vi, vi+en)
      - en_PP-OCRv5_mobile_rec: Recognition model for English (en)

.PARAMETER TargetRoot
    The host model storage root directory. Defaults to '.data\ocr-models'.
    Model files are placed under 'TargetRoot\paddlex-cache\official_models\<model_name>'.

.PARAMETER Profile
    Which language profile models to provision: 'all' (default), 'vi', or 'en'.
    'all' provisions detector, Vietnamese recognizer, and English recognizer.
    'vi'  provisions detector and Vietnamese recognizer.
    'en'  provisions detector and English recognizer.

.PARAMETER Force
    Overwrites and re-downloads existing files if specified.
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$TargetRoot = ".data\ocr-models",

    [Parameter()]
    [ValidateSet("all", "vi", "en")]
    [string]$Profile = "all",

    [switch]$Force
)

$ErrorActionPreference = "Stop"

# Model artifact definitions with verified official public URLs and SHA256 checksums
$modelDefinitions = @(
    @{
        Id = "PP-OCRv5_mobile_det"
        Directory = "PP-OCRv5_mobile_det"
        Profiles = @("all", "vi", "en")
        BaseUrl = "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det/resolve/main"
        Files = @(
            @{ Name = "inference.pdiparams"; ExpectedHash = "AFA1820CB16C1FD0DAD589D0F8B389139061C1EF6D68019685FD07BE997DDA5B" },
            @{ Name = "inference.json";      ExpectedHash = "05FEEF1ACB00AA4CD7362B15F7F501FC4F99D7B1FA73C1C871E0C7B1504B0F5C" },
            @{ Name = "inference.yml";       ExpectedHash = "98069072E1B6B37D727FD9D9F11725FAA46D6EA0DE012F2ED26CAEA011C37699" }
        )
    },
    @{
        Id = "pp-ocrv6-medium-rec-vietnamese"
        Directory = "pp-ocrv6-medium-rec-vietnamese"
        Profiles = @("all", "vi")
        BaseUrl = "https://huggingface.co/tieubaoca/pp-ocrv6-medium-rec-vietnamese/resolve/main"
        Files = @(
            @{ Name = "inference.pdiparams"; ExpectedHash = "EBCA3D052B80CFF3C8F8E20ED3DEDA2FC7B41CB39FFFCC30C68FDBD221B92704" },
            @{ Name = "inference.json";      ExpectedHash = "3BD9CB6BD020EA3256D354CEFBB68D38B120255393A2E461D7A107DE306AA5A3" },
            @{ Name = "inference.yml";       ExpectedHash = "E26530FEEF43BBB3E11B8D4D46705EB0F65B149769BB88ACF23A86F73C915FF6" },
            @{ Name = "ppocr_keys.txt";      ExpectedHash = "14D4A90049336CAB150902CC61B41DC44D80E7B42134C0401998652CD28AAF27" }
        )
    },
    @{
        Id = "en_PP-OCRv5_mobile_rec"
        Directory = "en_PP-OCRv5_mobile_rec"
        Profiles = @("all", "en")
        BaseUrl = "https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec/resolve/main"
        Files = @(
            @{ Name = "inference.pdiparams"; ExpectedHash = "3EC8A97ED6CEFE8568D3E2EE90BB193299B566A7661AA4FD52D224B96B59F66B" },
            @{ Name = "inference.json";      ExpectedHash = "FD1B6EC722EA841A72D3BA43E527DF1D1066D5D7808E0503EE3EEC7265188753" },
            @{ Name = "inference.yml";       ExpectedHash = "27E91D0582F40168AA218303C76E184BC78FA7A5D105AAD0CFBAD8458B441067" }
        )
    }
)

if (-not (Test-Path -Path $TargetRoot)) {
    Write-Host "Creating host model storage root directory: $TargetRoot"
    New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null
}

$resolvedTargetRoot = (Resolve-Path -Path $TargetRoot).Path
Write-Host "Target model storage root: $resolvedTargetRoot"
Write-Host "Selected profile: $Profile"

$activeModels = $modelDefinitions | Where-Object { $_.Profiles -contains $Profile }
$totalFiles = ($activeModels | ForEach-Object { $_.Files.Count } | Measure-Object -Sum).Sum
$processedCount = 0

foreach ($model in $activeModels) {
    $modelSubPath = Join-Path -Path "paddlex-cache" -ChildPath (Join-Path -Path "official_models" -ChildPath $model.Directory)
    $modelDir = Join-Path -Path $resolvedTargetRoot -ChildPath $modelSubPath

    if (-not (Test-Path -Path $modelDir)) {
        Write-Host "Creating model directory: $modelDir"
        New-Item -ItemType Directory -Path $modelDir -Force | Out-Null
    }

    $resolvedDir = (Resolve-Path -Path $modelDir).Path
    Write-Host "`n--- Provisioning Model: $($model.Id) ---"
    Write-Host "Destination: $resolvedDir"

    foreach ($file in $model.Files) {
        $processedCount++
        $fileName = $file.Name
        $destination = Join-Path -Path $resolvedDir -ChildPath $fileName
        $partPath = "$destination.part"
        $url = "$($model.BaseUrl)/${fileName}?download=true"

        if (Test-Path -Path $destination) {
            if (-not $Force) {
                if ($file.ExpectedHash) {
                    $existingHash = (Get-FileHash -Path $destination -Algorithm SHA256).Hash
                    if ($existingHash -eq $file.ExpectedHash) {
                        Write-Host "[$processedCount/$totalFiles] Already exists and verified: $fileName"
                        continue
                    }
                    Write-Warning "Existing $fileName has hash mismatch. Re-downloading..."
                } else {
                    Write-Host "[$processedCount/$totalFiles] File already exists, skipping: $fileName (use -Force to re-download)"
                    continue
                }
            }
        }

        if (Test-Path -Path $partPath) {
            Remove-Item -Path $partPath -Force
        }

        Write-Host "[$processedCount/$totalFiles] Downloading $fileName from $url..."
        Invoke-WebRequest -Uri $url -OutFile $partPath

        if ($file.ExpectedHash) {
            Write-Host "Verifying SHA256 for $fileName..."
            $actualHash = (Get-FileHash -Path $partPath -Algorithm SHA256).Hash
            if ($actualHash -ne $file.ExpectedHash) {
                Remove-Item -Path $partPath -Force -ErrorAction SilentlyContinue
                throw "SHA256 mismatch for ${fileName}! Expected: $($file.ExpectedHash), Actual: $actualHash"
            }
            Write-Host "SHA256 verified: $actualHash"
        }

        if (Test-Path -Path $destination) {
            Remove-Item -Path $destination -Force
        }

        Move-Item -Path $partPath -Destination $destination -Force
        Write-Host "Saved: $destination"
    }
}

Write-Host "`nOCR model setup completed successfully ($processedCount/$totalFiles files verified)."
