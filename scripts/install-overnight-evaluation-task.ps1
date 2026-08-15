param(
    [string]$TaskName = "Sales Dashboard Overnight Evaluations"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$controller = Join-Path $PSScriptRoot "start-overnight-evaluation-controller.ps1"
if (-not (Test-Path -LiteralPath $controller)) {
    throw "Controller not found: $controller"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $controller) -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At 10:00PM
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 9) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -WakeToRun `
    -AllowStartIfOnBatteries:$false `
    -DontStopIfGoingOnBatteries:$false
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Installed '$TaskName' for 22:00 daily. The controller stops at 06:00 Melbourne time and ignores duplicate starts."
