Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $repoRoot "runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

function Test-JsonHealth([string]$Url) {
    try {
        return Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 5
    }
    catch {
        return $null
    }
}

$executionRoot = if ($env:SALES_DASHBOARD_AI_EXECUTION_LAYER_PATH) {
    $env:SALES_DASHBOARD_AI_EXECUTION_LAYER_PATH
} else {
    Join-Path (Split-Path -Parent $repoRoot) "ai-execution-layer"
}
$executionConfig = Join-Path $executionRoot "runtime\config_sales_dashboard_overnight.yaml"
$executionRunner = Join-Path $executionRoot "scripts\run-api-service.ps1"
$executionHealth = Test-JsonHealth "http://127.0.0.1:8080/health"
if (-not $executionHealth) {
    if (-not (Test-Path -LiteralPath $executionConfig) -or -not (Test-Path -LiteralPath $executionRunner)) {
        throw "AI Execution Layer overnight runtime files are unavailable."
    }
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $executionRunner, "-ConfigPath", $executionConfig) `
        -WorkingDirectory $executionRoot `
        -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Seconds 2
        $executionHealth = Test-JsonHealth "http://127.0.0.1:8080/health"
    } while (-not $executionHealth -and (Get-Date) -lt $deadline)
}
if (-not $executionHealth) {
    throw "AI Execution Layer did not answer on port 8080."
}
if (-not $executionHealth.evaluation_studio_admission.enabled) {
    throw "AI Execution Layer is running without the overnight admission gate; refusing to submit evaluations."
}

$dashboardHealth = Test-JsonHealth "http://127.0.0.1:3040/health"
if (-not $dashboardHealth) {
    $csv = Get-ChildItem -LiteralPath (Join-Path $repoRoot "data\source") -File -Filter "*.csv" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $csv) {
        throw "No source CSV is available to start the Sales Dashboard."
    }
    $node = (Get-Command node -ErrorAction Stop).Source
    $dashboardArguments = 'src/main.js --csv "{0}"' -f $csv.FullName
    $env:PORT = "3040"
    Start-Process -FilePath $node `
        -ArgumentList $dashboardArguments `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $runtimeDir "dashboard-3040.stdout.log") `
        -RedirectStandardError (Join-Path $runtimeDir "dashboard-3040.stderr.log")
    $deadline = (Get-Date).AddSeconds(120)
    do {
        Start-Sleep -Seconds 2
        $dashboardHealth = Test-JsonHealth "http://127.0.0.1:3040/health"
    } while (-not $dashboardHealth -and (Get-Date) -lt $deadline)
}
if (-not $dashboardHealth -or -not $dashboardHealth.csv_loaded) {
    throw "Sales Dashboard did not start with a transcript source on port 3040."
}

$node = (Get-Command node -ErrorAction Stop).Source
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SalesDashboardPowerState {
    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint flags);
}
"@
$ES_CONTINUOUS = [uint32]::Parse("80000000", [Globalization.NumberStyles]::HexNumber)
$ES_SYSTEM_REQUIRED = [uint32]0x00000001
[SalesDashboardPowerState]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) | Out-Null
try {
    & $node (Join-Path $PSScriptRoot "run-overnight-evaluations.js")
    $controllerExitCode = $LASTEXITCODE
}
finally {
    [SalesDashboardPowerState]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
}
exit $controllerExitCode
