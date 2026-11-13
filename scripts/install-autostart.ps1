# Registers a Windows scheduled task that starts the Gibstaapp server (hidden) when you log in.
# Remove later with: Unregister-ScheduledTask -TaskName Gibstaapp -Confirm:$false
$script = Join-Path $PSScriptRoot 'start-server.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Gibstaapp' -Action $action -Trigger $trigger -Settings $settings -Description 'Gibstaapp deal finder server' -Force | Out-Null
Write-Host 'Gibstaapp will start automatically at login.'
