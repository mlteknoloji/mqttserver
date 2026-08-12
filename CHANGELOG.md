# Sürüm Notları

[English](CHANGELOG.en.md)

## v1.0.18

### Yeni
- **NetRelayMP (mPower) cihaz desteği:** Telemetri (`mpower/<id>/state`, `custom`, `outlet/N/json`) ve komut (`mpower/<id>/cmd`) altyapısı eklendi.
- **Cihaz tipi seçimi:** MQTT kullanıcılarında `NetRelay` / `NetRelayMP` seçilebilir; yapı daha sonra yeni tipler için genişletilebilir.
- **Panel ve I/O:** Cihaz tipine göre komut formu, outlet kontrolü, pulse / cycle aksiyonları.
- **REST API:** `POST /api/v1/devices/:username/mpower` native mPower komutları; mevcut `/relays` uç noktası NetRelayMP için de çalışır.
- **Kurulum güncelleme betikleri:** Ayarları koruyarak GitHub/Docker güncellemesi için `scripts/update.ps1` ve `scripts/update.sh`.

### Korunan ayarlar
Güncellemede `.env`, `users.json`, `security.sqlite3` ve Docker volume verileri değişmez. Mevcut NetRelay hesapları varsayılan olarak `netrelay` tipinde kalır.

### Güncelleme
```powershell
# Windows
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\update.ps1
```

```bash
# Linux / macOS
chmod +x scripts/update.sh
./scripts/update.sh
```

Docker:
```powershell
.\scripts\update.ps1 -Docker
```
