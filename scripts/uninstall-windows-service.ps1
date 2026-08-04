param([string]$ServiceName = 'NetRelayMQTT')
$ErrorActionPreference = 'Stop'
$nssmPath = (Get-Command nssm -ErrorAction Stop).Source
& $nssmPath stop $ServiceName
& $nssmPath remove $ServiceName confirm
Write-Host "$ServiceName kaldırıldı; proje dosyaları korunuyor."
