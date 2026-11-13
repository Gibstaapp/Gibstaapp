# Starts the Gibstaapp server (builds the web app first if needed). Logs to server\data\server.log
$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path "$root\web\dist\index.html")) { Set-Location "$root\web"; npm run build }
Set-Location "$root\server"
New-Item -ItemType Directory -Force "$root\server\data" | Out-Null
# cmd redirect keeps the log plain UTF-8 (PowerShell's *>> writes UTF-16)
cmd /c "npx tsx src/index.ts >> `"$root\server\data\server.log`" 2>&1"
