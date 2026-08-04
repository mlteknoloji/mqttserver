param([string]$ServiceName = 'NetRelayMQTT')
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$nssmPath = (Get-Command nssm -ErrorAction Stop).Source
$serverPath = Join-Path $projectPath 'server.js'
$serviceLogPath = Join-Path $projectPath 'logs\service-output.log'

if (-not (Test-Path (Join-Path $projectPath 'node_modules'))) { throw 'node_modules bulunamadı. Önce npm ci çalıştırın.' }
& $nssmPath install $ServiceName $nodePath $serverPath
& $nssmPath set $ServiceName AppDirectory $projectPath
& $nssmPath set $ServiceName DisplayName 'NetRelay MQTT Server'
& $nssmPath set $ServiceName Description 'NetRelay MQTT broker ve web yönetim paneli'
& $nssmPath set $ServiceName Start SERVICE_AUTO_START
& $nssmPath set $ServiceName AppExit Default Restart
& $nssmPath set $ServiceName AppRestartDelay 5000
& $nssmPath set $ServiceName AppStdout $serviceLogPath
& $nssmPath set $ServiceName AppStderr $serviceLogPath
& $nssmPath set $ServiceName AppRotateFiles 1
& $nssmPath set $ServiceName AppRotateOnline 1
& $nssmPath set $ServiceName AppRotateBytes 10485760
& $nssmPath start $ServiceName
Write-Host "$ServiceName kuruldu ve başlatıldı."
