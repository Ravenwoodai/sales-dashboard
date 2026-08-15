param(
  [string]$StartDate,
  [switch]$SendEmail,
  [switch]$DryRun,
  [switch]$NoAcquire
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot "config\weekly-lead-utilisation.local.json"
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw "Local configuration is missing: $configPath"
}

if ([string]::IsNullOrWhiteSpace($StartDate)) {
  $zone = [TimeZoneInfo]::FindSystemTimeZoneById("AUS Eastern Standard Time")
  $today = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $zone).Date
  $daysSinceMonday = (([int]$today.DayOfWeek + 6) % 7)
  $monday = $today.AddDays(-$daysSinceMonday)
  if ([int]$today.DayOfWeek -ge 1 -and [int]$today.DayOfWeek -le 5) {
    $monday = $monday.AddDays(-7)
  }
  $StartDate = $monday.ToString("yyyy-MM-dd")
}

try {
  $monday = [DateTime]::ParseExact($StartDate, "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)
} catch {
  throw "StartDate must be YYYY-MM-DD."
}
if ($monday.DayOfWeek -ne [DayOfWeek]::Monday) {
  throw "StartDate must be a Monday: $StartDate"
}

$friday = $monday.AddDays(4).ToString("yyyy-MM-dd")
$sunday = $monday.AddDays(6).ToString("yyyy-MM-dd")
$runId = "${StartDate}_to_${friday}"
if (-not $DryRun -and -not $NoAcquire) {
  $cdpReady = $false
  try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:9222/json/version" -TimeoutSec 2
    $cdpReady = $true
  } catch {}
  if (-not $cdpReady) {
    $chromeCandidates = @(
      "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    $chrome = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $chrome) { throw "Google Chrome was not found. Start Chrome with remote debugging on port 9222 and open https://cwa.carmacloud.com/." }
    $carmaProfile = Join-Path $env:USERPROFILE "Desktop\Carma Reports\.auth\carma-cdp-profile"
    New-Item -ItemType Directory -Path $carmaProfile -Force | Out-Null
    Start-Process -FilePath $chrome -ArgumentList @("--remote-debugging-port=9222", "--user-data-dir=$carmaProfile", "https://cwa.carmacloud.com/")
    for ($attempt = 0; $attempt -lt 20 -and -not $cdpReady; $attempt += 1) {
      Start-Sleep -Milliseconds 500
      try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:9222/json/version" -TimeoutSec 2
        $cdpReady = $true
      } catch {}
    }
    if (-not $cdpReady) { throw "Carma automation Chrome did not start on port 9222." }
    $null = Read-Host "In the Chrome window, sign in to Carma and complete 2FA if requested. Press Enter when the Carma home page is open"
  }
}

$arguments = @(
  "run", "report:weekly-lead-management", "--",
  "--config", $configPath,
  "--start", $StartDate
)
if (-not $NoAcquire) { $arguments += "--acquire" }
if ($DryRun) { $arguments += "--dry-run" }
if ($SendEmail) { $arguments += "--send-email" }

Write-Host "Weekly Lead Management Report: $StartDate to $friday" -ForegroundColor Cyan
Write-Host "Source envelope: $StartDate to $sunday" -ForegroundColor DarkCyan
& npm.cmd @arguments
if ($LASTEXITCODE -ne 0) { throw "Weekly report failed with exit code $LASTEXITCODE" }
if ($DryRun) {
  Write-Host "Dry run complete. No report files were generated." -ForegroundColor Green
} else {
  Write-Host "Complete. Combined reports are under: $projectRoot\outputs\weekly-lead-management\$runId" -ForegroundColor Green
}
