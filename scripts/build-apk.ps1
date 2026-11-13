# Builds the Android APK and puts it where the server serves it (/download).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }
# Bake the private link topic into the app so it can find the PC's current public link.
$cfg = Get-Content "$root\server\data\config.json" -Raw | ConvertFrom-Json
$env:VITE_LINK_TOPIC = $cfg.linkTopic
Set-Location "$root\web"
npm run build
if ($LASTEXITCODE) { throw 'web build failed' }
npx cap sync android
if ($LASTEXITCODE) { throw 'cap sync failed' }
Set-Location "$root\web\android"
.\gradlew.bat assembleDebug --console=plain
if ($LASTEXITCODE) { throw 'gradle build failed' }
New-Item -ItemType Directory -Force "$root\server\data" | Out-Null
Copy-Item "$root\web\android\app\build\outputs\apk\debug\app-debug.apk" "$root\server\data\gibstaapp.apk" -Force
# Rebuild the normal web bundle (served by the PC) without the topic.
Remove-Item Env:VITE_LINK_TOPIC
Set-Location "$root\web"; npm run build | Out-Null
Write-Host "APK ready: $root\server\data\gibstaapp.apk  (phone: http://<your-pc>:8787/download)"
