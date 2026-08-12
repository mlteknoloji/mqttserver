param(
  [switch]$Docker,
  [switch]$Git,
  [string]$ServiceName = 'NetRelayMQTT',
  [string]$Branch = ''
)

$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $projectPath

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-DockerComposeAvailable {
  try {
    docker compose version *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Test-DockerDeploy {
  if (-not (Test-Path (Join-Path $projectPath 'compose.yml'))) { return $false }
  if (-not (Test-DockerComposeAvailable)) { return $false }
  $names = docker compose ps --format '{{.Name}}' 2>$null
  return [bool]($names -match 'netrelay-mqtt-server|mqttserver')
}

function Assert-ProtectedFiles {
  $protected = @('.env', 'users.json', 'security.sqlite3')
  foreach ($name in $protected) {
    $path = Join-Path $projectPath $name
    if (Test-Path $path) {
      Write-Host "Korunan dosya mevcut: $name"
    }
  }
}

function Update-Docker {
  Write-Step 'Docker kurulumu güncelleniyor (.env ve volume verileri korunur)'
  Assert-ProtectedFiles
  docker compose pull
  if ($LASTEXITCODE -ne 0) { throw 'docker compose pull başarısız.' }
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { throw 'docker compose up -d başarısız.' }
  Write-Host 'Docker güncellemesi tamamlandı.' -ForegroundColor Green
  docker compose ps
}

function Update-Git {
  Write-Step 'Git kurulumu güncelleniyor (.env, users.json, security.sqlite3 korunur)'
  if (-not (Test-Path (Join-Path $projectPath '.git'))) {
    throw 'Bu klasör bir git deposu değil. ZIP kurulumunda dosyaları elle güncelleyin veya git clone kullanın.'
  }

  Assert-ProtectedFiles

  git rev-parse --is-inside-work-tree *> $null
  if ($LASTEXITCODE -ne 0) { throw 'git deposu okunamadı.' }

  $status = git status --porcelain
  if ($status) {
    throw @"
Yerel değişiklikler var; güvenli güncelleme iptal edildi.
Önce değişiklikleri commit edin, stash yapın veya geri alın.
$status
"@
  }

  $currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
  $targetBranch = if ($Branch) { $Branch } else { $currentBranch }
  Write-Host "Dal: $targetBranch"

  git fetch origin
  if ($LASTEXITCODE -ne 0) { throw 'git fetch başarısız.' }
  git pull --ff-only origin $targetBranch
  if ($LASTEXITCODE -ne 0) { throw 'git pull başarısız. Yerel dal remote ile uyumsuz olabilir.' }

  Write-Step 'Bağımlılıklar kuruluyor (npm ci --omit=dev)'
  npm ci --omit=dev
  if ($LASTEXITCODE -ne 0) { throw 'npm ci başarısız.' }

  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($service) {
    Write-Step "Windows servisi yeniden başlatılıyor: $ServiceName"
    if ($service.Status -eq 'Running') {
      Restart-Service -Name $ServiceName -Force
    } else {
      Start-Service -Name $ServiceName
    }
    Get-Service -Name $ServiceName | Format-Table -AutoSize
    Write-Host 'Güncelleme tamamlandı.' -ForegroundColor Green
    return
  }

  $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
  if ($pm2) {
    $pm2List = & pm2 jlist 2>$null
    if ($pm2List -match 'netrelay-mqtt') {
      Write-Step 'PM2 süreci yeniden başlatılıyor'
      foreach ($name in @('netrelay-mqtt', 'netrelay-mqtt-server')) {
        & pm2 describe $name *> $null
        if ($LASTEXITCODE -eq 0) {
          & pm2 restart $name
          Write-Host "PM2 restart: $name"
          Write-Host 'Güncelleme tamamlandı.' -ForegroundColor Green
          return
        }
      }
    }
  }

  Write-Host 'Kod güncellendi. Çalışan süreci elle yeniden başlatın (npm start / servis / PM2).' -ForegroundColor Yellow
}

if ($Docker -and $Git) { throw '-Docker ve -Git birlikte kullanılamaz.' }

$mode = if ($Docker) {
  'docker'
} elseif ($Git) {
  'git'
} elseif (Test-DockerDeploy) {
  'docker'
} else {
  'git'
}

Write-Host "NetRelay MQTT güncelleme | Mod: $mode | Klasör: $projectPath"
if ($mode -eq 'docker') { Update-Docker } else { Update-Git }
