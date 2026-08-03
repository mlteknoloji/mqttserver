# NetRelay MQTT Server

[NetRelay](https://netrelay.tr/) kartı için MQTT server olarak hazırlanmıştır.

MQTT kullanım ayrıntıları için [NetRelay MQTT Kullanım Kılavuzu](https://netrelay.tr/dokumantasyon/mqtt-kullanim-kilavuzu) sayfasını inceleyebilirsiniz.

NetRelay cihazları için hazırlanmış Node.js tabanlı bir MQTT broker, web yönetim paneli ve test istemcisidir. Bağlanan cihazları anlık gösterir, cihaz olaylarını işler ve web panelinden röle açma/kapatma komutları gönderir.

## Özellikler

- Kullanıcı adı ve parola doğrulamalı MQTT broker
- Bağlı cihazları canlı gösteren web paneli
- WebSocket ile anlık cihaz, durum ve log güncellemeleri
- Panelden 1–4 numaralı röleleri tek tek veya birlikte kontrol etme
- NetRelay input, röle ve cihaz durum mesajlarını JSON olarak işleme
- MQTT bağlantısını sınamak için test istemcisi
- Tek komutla sürüm artırma ve GitHub'a gönderme

## Gereksinimler

- Windows 10/11 veya Node.js çalıştırabilen Linux/macOS
- [Node.js](https://nodejs.org/) 18 veya daha yeni sürüm
- Git (projeyi GitHub'dan indirecek veya GitHub'a gönderecekseniz)
- Yerel ağ erişimi için açık TCP portları:
  - `1883`: MQTT bağlantıları
  - `3000`: Web yönetim paneli

Kurulumları doğrulamak için terminalde şunları çalıştırabilirsiniz:

```powershell
node --version
npm --version
git --version
```

## Kurulum

### GitHub'dan kurulum

PowerShell veya Komut İstemi'ni açın:

```powershell
git clone https://github.com/mlteknoloji/mqttserver.git
cd mqttserver
npm install
```

### ZIP/RAR dosyasından kurulum

Arşivi bir klasöre çıkartın, terminali bu klasörde açın ve çalıştırın:

```powershell
npm install
```

`npm install`, programın ihtiyaç duyduğu paketleri `node_modules` klasörüne yükler. İlk kurulumdan sonra, bağımlılıklar değişmediği sürece tekrar çalıştırmanız gerekmez.

## Yapılandırma

Programın çalışması için proje ana klasöründe `.env` ve `users.json` dosyaları bulunmalıdır. Dosyalar yoksa örneklerden oluşturun:

```powershell
Copy-Item .env.example .env
Copy-Item users.example.json users.json
```

### `.env` ayarları

```env
HOST=0.0.0.0
MQTT_PORT=1883
WEB_PORT=3000
MQTT_HOST=192.168.1.100

MQTT_USERNAME=admin
MQTT_PASSWORD=guclu-bir-parola
```

| Ayar | Açıklama |
|---|---|
| `HOST` | Sunucunun dinleyeceği adres. `0.0.0.0`, tüm ağ bağlantılarını dinler. |
| `MQTT_PORT` | NetRelay cihazlarının bağlanacağı MQTT portu. Varsayılan `1883`. |
| `WEB_PORT` | Web panelinin portu. Varsayılan `3000`. |
| `MQTT_HOST` | Yalnızca `npm run client` test istemcisinin bağlanacağı sunucu IP'si. |
| `MQTT_USERNAME` | Test istemcisinin kullanıcı adı. `users.json` içinde bulunmalıdır. |
| `MQTT_PASSWORD` | Test istemcisinin parolası. `users.json` ile aynı olmalıdır. |

Sunucu bilgisayarın IP adresini Windows'ta `ipconfig` komutuyla öğrenebilirsiniz. Örneğin sunucu IP adresi `192.168.1.100` ise `MQTT_HOST=192.168.1.100` kullanın.

### `users.json` ayarları

Broker'a bağlanmasına izin verilen kullanıcılar burada tanımlanır:

```json
{
  "users": [
    {
      "username": "admin",
      "password": "guclu-bir-parola"
    },
    {
      "username": "cihaz1",
      "password": "farkli-bir-parola"
    }
  ]
}
```

- Her kullanıcı adı benzersiz olmalıdır.
- Kullanıcı adı veya parola değiştirildiğinde sunucuyu kapatıp yeniden başlatın.
- NetRelay cihazına girdiğiniz bilgiler burada yazan bilgilerle tamamen aynı olmalıdır.

> **Güvenlik uyarısı:** Bu projede `.env` ve `users.json` GitHub'a gönderilebilecek şekilde ayarlanmıştır. Depo herkese açıksa parolalar da görünür. Gerçek sistemlerde özel (private) depo kullanın ve parolaları düzenli olarak değiştirin.

## Programı çalıştırma

Proje klasöründe şu komutu çalıştırın:

```powershell
npm start
```

Başarılı açılışta terminalde MQTT ve web paneli adresleri gösterilir. Terminal penceresini açık bırakın.

Varsayılan erişim adresleri:

- Aynı bilgisayardan panel: `http://localhost:3000`
- Ağdaki başka bir bilgisayardan panel: `http://SUNUCU_IP:3000`
- MQTT broker: `mqtt://SUNUCU_IP:1883`

Programı durdurmak için terminalde `Ctrl+C` tuşlarına basın.

### Windows Güvenlik Duvarı

Diğer cihazlar bağlanamıyorsa PowerShell'i **Yönetici olarak** açıp gerekli portlara izin verin:

```powershell
New-NetFirewallRule -DisplayName "NetRelay MQTT 1883" -Direction Inbound -Protocol TCP -LocalPort 1883 -Action Allow
New-NetFirewallRule -DisplayName "NetRelay Web 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

Yalnızca güvendiğiniz yerel ağlarda bu izinleri açın.

## NetRelay cihazını bağlama

NetRelay cihazının `/mqtt` ayar sayfasını açın ve şu değerleri girin:

| Cihaz ayarı | Girilecek değer |
|---|---|
| MQTT Server | Bu programın çalıştığı bilgisayarın IP adresi |
| MQTT Port | `1883` veya `.env` içindeki `MQTT_PORT` |
| MQTT Kullanıcı | `users.json` içindeki bir kullanıcı adı |
| MQTT Şifre | Aynı kullanıcıya ait parola |
| MQTT İstemci Modu | Açık |
| Client ID | Her cihaz için benzersiz kimlik; örneğin `1012` |

Ayarları kaydettikten sonra gerekirse cihazı yeniden başlatın. Bağlantı kurulduğunda cihaz web panelindeki çevrimiçi cihazlar bölümünde görünür.

## Web panelinin kullanımı

1. Tarayıcıdan `http://SUNUCU_IP:3000` adresini açın.
2. Çevrimiçi cihazlar listesinden kontrol edilecek cihazı seçin.
3. Açmak veya kapatmak istediğiniz 1–4 numaralı röleleri seçin.
4. Röle konumunu Açık (`1`) veya Kapalı (`0`) olarak belirleyin.
5. Komutu gönderin.
6. İşlem ve cihaz mesajlarını paneldeki log bölümünden izleyin.

Panel, seçilen cihazın kullanıcı adına ait `command` topic'ine JSON komutu yollar. Cihaz bağlantısı kesilirse listeden otomatik kaldırılır.

## MQTT topic yapısı

Her kullanıcı için iki temel topic bulunur:

```text
netrelay/<kullanici>/events
netrelay/<kullanici>/command
```

- `events`: Cihazın input, röle ve periyodik durum mesajlarını yayınladığı topic.
- `command`: Cihazın web panelinden gelen röle komutlarını dinlediği topic.

Örnek röle komutu:

```json
{
  "type": "netrelay",
  "command": "set",
  "targetUsername": "cihaz1",
  "relays": [1, 2],
  "position": 1,
  "delay": 3
}
```

`position: 1` röleyi açar, `position: 0` röleyi kapatır.
`delay: 0` durumunda röle yeni konumunda kalır. Pozitif bir `delay` değerinde röle, belirtilen saniye sonunda komut öncesindeki konumuna döner.

## Test istemcisi

Sunucu çalışırken ikinci bir terminal açıp proje klasöründe çalıştırın:

```powershell
npm run client
```

Test istemcisi `.env` içindeki `MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME` ve `MQTT_PASSWORD` bilgilerini kullanır. Bağlanır, `test/mesaj` topic'ine bir mesaj gönderir ve kendi `netrelay/<kullanici>/command` topic'ini dinler. Kapatmak için `Ctrl+C` kullanın.

## Sorun giderme

### `REDDEDİLDİ` mesajı

- Cihazdaki kullanıcı adı ve parolayı `users.json` ile karşılaştırın.
- Başında/sonunda boşluk olmadığını kontrol edin.
- `users.json` değiştiyse sunucuyu yeniden başlatın.

### MQTT bağlantısı kurulamıyor

- Sunucu bilgisayarın IP adresinin doğru olduğunu kontrol edin.
- Sunucunun `npm start` ile çalıştığını doğrulayın.
- Cihaz ile sunucunun aynı ağa erişebildiğinden emin olun.
- Güvenlik duvarında TCP `1883` portunu kontrol edin.
- Aynı portu başka bir programın kullanmadığını doğrulayın.

### Web paneli açılmıyor

- `http://localhost:3000` adresini sunucu bilgisayarda deneyin.
- Başka bilgisayardan erişiyorsanız `localhost` yerine sunucu IP'sini kullanın.
- Güvenlik duvarında TCP `3000` portunu kontrol edin.

### Cihaz bağlı ama panelde görünmüyor

- MQTT istemci modunun açık olduğunu kontrol edin.
- Her cihaz için benzersiz Client ID kullanın.
- Terminalde bağlantı ve hata mesajlarını inceleyin.

### `EADDRINUSE` hatası

`1883` veya `3000` portu başka bir uygulama tarafından kullanılıyordur. Diğer uygulamayı kapatın veya `.env` içindeki portu değiştirip sunucuyu yeniden başlatın.

## Proje yapısı

```text
server.js            MQTT broker, web paneli ve WebSocket sunucusu
client.js            MQTT test istemcisi
views/index.ejs      Web paneli görünümü
public/              Panel CSS ve tarayıcı kodları
.env                 Çalışma ve test istemcisi ayarları
users.json           Broker kullanıcıları ve parolaları
.env.example         Örnek ortam ayarları
users.example.json   Örnek kullanıcılar
docs/                Ayrıntılı NetRelay dokümanları ve görseller
```

## Güvenlik

Bu program varsayılan olarak şifresiz TCP MQTT ve HTTP kullanır. `1883` ve `3000` portlarını doğrudan internete açmayın. Uzak erişim gerekiyorsa VPN, güvenlik duvarı ve tercihen TLS/HTTPS sağlayan bir ters proxy kullanın. Her cihaz için farklı ve güçlü parola belirleyin.

## Lisans

Bu depoda henüz ayrı bir lisans dosyası bulunmamaktadır.
