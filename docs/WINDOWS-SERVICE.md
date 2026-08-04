# NetRelay'i Windows servisi olarak çalıştırma

[English](WINDOWS-SERVICE.en.md)

Önerilen yöntem NSSM'dir. Uygulamayı kullanıcı oturumu kapalıyken çalıştırır, hata halinde yeniden başlatır ve Node çıktısını `logs/service-output.log` dosyasına yazar.

## NSSM kurulumu

1. Node.js LTS ve NSSM'yi kurun. `node.exe` ile `nssm.exe` komutlarının PATH içinde olduğunu doğrulayın.
2. Yönetici PowerShell açıp proje klasörüne geçin.
3. Bağımlılıkları ve servisi kurun:

```powershell
npm ci --omit=dev
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-windows-service.ps1
```

Servis adı varsayılan olarak `NetRelayMQTT` olur. Farklı ad için `-ServiceName NetRelayTest` kullanabilirsiniz.

```powershell
Get-Service NetRelayMQTT
Restart-Service NetRelayMQTT
Stop-Service NetRelayMQTT
Start-Service NetRelayMQTT
```

Güncellemeden önce servisi durdurun, dosyaları ve bağımlılıkları güncelleyin, sonra yeniden başlatın. `.env` ve `security.sqlite3` dosyalarını koruyun.

```powershell
Stop-Service NetRelayMQTT
npm ci --omit=dev
Start-Service NetRelayMQTT
```

Kaldırmak için yönetici PowerShell'de:

```powershell
.\scripts\uninstall-windows-service.ps1
```

Bu işlem yalnızca Windows servis kaydını kaldırır; veritabanını, ayarları ve logları silmez.

## PM2 alternatifi

PM2 uygulamayı izlemek için kullanılabilir. Windows açılışında güvenilir otomatik başlatma için ayrıca bir başlangıç yöneticisi veya Görev Zamanlayıcı yapılandırması gerekir; bu nedenle üretim kurulumunda NSSM daha sade bir seçenektir.

```powershell
npm install --global pm2
pm2 start server.js --name netrelay-mqtt --cwd "D:\role_kart_tasarim\mqttserver"
pm2 save
pm2 status
pm2 logs netrelay-mqtt
```

Portlar kullanımda kalırsa aynı anda hem terminal kopyasının hem servisin çalışmadığını kontrol edin.
