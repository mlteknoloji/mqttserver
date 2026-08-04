# NetRelay MQTT Server

[English documentation](README.en.md)

[NetRelay](https://netrelay.tr/) kartı için MQTT server olarak hazırlanmıştır.

MQTT kullanım ayrıntıları için [NetRelay MQTT Kullanım Kılavuzu](https://netrelay.tr/dokumantasyon/mqtt-kullanim-kilavuzu) sayfasını inceleyebilirsiniz.

NetRelay cihazları için hazırlanmış Node.js tabanlı bir MQTT broker, web yönetim paneli ve test istemcisidir. Bağlanan cihazları anlık gösterir, cihaz olaylarını işler ve web panelinden röle açma/kapatma komutları gönderir.

## Nereden satın alabilirim?

NetRelay ürünlerini resmi satış sayfasından satın alabilirsiniz: **[NetRelay Satın Al](https://netrelay.tr/satin-al)**

## Özellikler

- Kullanıcı adı ve parola doğrulamalı MQTT broker
- Bağlı cihazları canlı gösteren web paneli
- WebSocket ile anlık cihaz, durum ve log güncellemeleri
- Panelden 1–4 numaralı röleleri tek tek veya birlikte kontrol etme
- NetRelay input, röle ve cihaz durum mesajlarını JSON olarak işleme
- MQTT bağlantısını sınamak için test istemcisi
- Tek komutla sürüm artırma ve GitHub'a gönderme
- Başarısız MQTT girişlerini IP bazında izleyen Fail2Ban benzeri koruma
- SQLite üzerinde kalıcı blacklist yönetimi ve web panelinden kayıt ekleme/kaldırma

## MQTT giriş koruması

Sunucu, MQTT kullanıcı adı/parola denemelerini IP adresine göre takip eden Fail2Ban benzeri bir uygulama korumasına sahiptir. Varsayılan olarak aynı IP adresinden 10 dakika içinde 5 başarısız giriş algılandığında IP adresi 60 dakika boyunca engellenir. Engellenmiş bir IP doğru kullanıcı bilgilerini gönderse bile engel kaldırılana veya süresi dolana kadar MQTT broker'a bağlanamaz.

Başarılı bir giriş yapıldığında o IP için birikmiş başarısız denemeler temizlenir. IPv4, IPv6 ve `::ffff:192.168.1.10` biçimindeki IPv4-mapped IPv6 adresleri desteklenir.

### Blacklist yönetimi

Web panelindeki **MQTT Blacklist** bölümünde şu bilgiler gösterilir:

- Engellenen IP adresi
- Otomatik veya manuel engelleme nedeni
- Engellemeye neden olan başarısız giriş sayısı
- Engellenme zamanı
- Otomatik engelin sona ereceği zaman veya süresiz bilgisi

Panelden geçerli bir IPv4 ya da IPv6 adresi manuel olarak blacklist listesine eklenebilir. Manuel eklenen kayıtlar süresizdir. IP adresi o anda MQTT broker'a bağlıysa bağlantısı kapatılır. **Kaldır** düğmesiyle otomatik veya manuel kayıt hemen temizlenebilir.

### SQLite veritabanı

Blacklist ve başarısız giriş sayaçları varsayılan olarak proje klasöründeki `security.sqlite3` dosyasında saklanır. Sunucu yeniden başlatıldığında aktif engeller korunur. SQLite çalışma sırasında `security.sqlite3-wal` ve `security.sqlite3-shm` yardımcı dosyalarını oluşturabilir. Bu dosyalar `.gitignore` kapsamındadır ve Git deposuna gönderilmez.

Veritabanı iki tablo içerir:

- `blacklist`: Aktif otomatik ve manuel IP engelleri
- `login_failures`: Henüz engel sınırına ulaşmamış başarısız giriş sayaçları

Süresi dolan otomatik blacklist kayıtları periyodik olarak temizlenir.

### Koruma ayarları

Koruma değerleri `.env` dosyasından değiştirilebilir:

```env
FAIL2BAN_MAX_ATTEMPTS=5
FAIL2BAN_FIND_TIME_MINUTES=10
FAIL2BAN_BAN_TIME_MINUTES=60
SECURITY_DB_PATH=security.sqlite3
```

| Ayar | Açıklama |
|---|---|
| `FAIL2BAN_MAX_ATTEMPTS` | IP engellenmeden önce izin verilen başarısız MQTT giriş sayısı. |
| `FAIL2BAN_FIND_TIME_MINUTES` | Başarısız girişlerin birlikte sayılacağı zaman aralığı. |
| `FAIL2BAN_BAN_TIME_MINUTES` | Otomatik blacklist kaydının geçerli kalacağı süre. |
| `SECURITY_DB_PATH` | SQLite veritabanı yolu. Göreli yollar proje klasörüne göre çözülür. |

Değerleri değiştirdikten sonra sunucuyu yeniden başlatın. Web yönetim panelini yalnızca güvenilir ağlarda erişilebilir tutun; blacklist ekleme ve kaldırma işlemleri panel üzerinden gerçekleştirildiği için panel portu internete doğrudan açılmamalıdır.

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

## Docker ile kurulum

Hazır imaj GitHub Container Registry üzerinde `ghcr.io/mlteknoloji/mqttserver:latest` adıyla yayımlanır. Kurulum yapılacak makinede Docker Engine veya Docker Desktop ile Docker Compose bulunmalıdır.

Depoyu indirin ve çalışma ayarlarını oluşturun:

```powershell
git clone https://github.com/mlteknoloji/mqttserver.git
cd mqttserver
Copy-Item .env.example .env
Copy-Item users.example.json users.json
```

`.env` ve `users.json` içindeki örnek kullanıcı adlarını ve parolaları üretim ortamında kullanmadan önce değiştirin. GHCR paketi private ise GitHub kullanıcı adınız ve `read:packages` yetkili bir Personal Access Token ile giriş yapın:

```powershell
docker login ghcr.io
```

İmajı indirin ve sunucuyu arka planda başlatın:

```powershell
docker compose pull
docker compose up -d
```

Konteyner durumunu, uygulama loglarını ve PM2 durumunu kontrol edin:

```powershell
docker compose ps
docker compose logs -f
docker exec netrelay-mqtt-server pm2 status
```

Web paneli varsayılan olarak `http://localhost:3000`, MQTT broker ise `mqtt://localhost:1883` adresinde çalışır. `compose.yml` içindeki `restart: unless-stopped` ayarı konteyneri makine yeniden başladığında otomatik başlatır; konteyner içinde çalışan `pm2-runtime` uygulama beklenmedik şekilde kapanırsa yeniden çalıştırır.

Docker kurulumunda portları değiştirmek için `.env` içindeki `MQTT_PORT`, `WEB_PORT`, `MQTT_TLS_PORT` veya `WEB_HTTPS_PORT` değerini düzenleyin. `compose.yml` hem host hem konteyner portunu bu değerlerden alır. Değişikliğin uygulanması için konteyneri yeniden oluşturun:

```powershell
docker compose up -d --force-recreate
docker compose ps
```

Bu kurulumda standart portlar yerine aşağıdaki özelleştirilmiş portlar kullanılmaktadır:

```env
MQTT_PORT=31883
WEB_PORT=8082
MQTT_TLS_PORT=38883
```

Bu ayarlarla web paneli `http://SUNUCU_IP:8082`, normal MQTT broker `mqtt://SUNUCU_IP:31883` ve TLS etkinse MQTT broker `mqtts://SUNUCU_IP:38883` adresinden erişilebilir. Port değişikliğinden sonra güvenlik duvarındaki izinleri ve NetRelay cihazındaki MQTT/MQTT TLS portlarını aynı değerlere göre güncelleyin. Artık kullanılmayan `1883`, `3000` ve `8883` portlarını internete açık bırakmayın.

Standart dışı port kullanımı otomatik internet taramalarını azaltabilir ancak tek başına bir güvenlik önlemi değildir. Güçlü ve benzersiz parolalar, MQTT TLS, giriş engelleme koruması, güvenlik duvarı IP kısıtlaması veya VPN kullanılması önerilir.

Yeni imaj yayımlandığında kurulumu güncelleyin:

```powershell
docker compose pull
docker compose up -d
```

Sunucuyu durdurmak veya tekrar başlatmak için:

```powershell
docker compose stop
docker compose restart
```

Docker imajını GitHub üzerinde oluşturmak için `githuba_gonder.bat` dosyasını çalıştırın. GitHub gönderimi tamamlandıktan sonra gelen Docker sorusunda `E` yazın veya varsayılan `E` seçeneğini kabul etmek için yalnızca Enter'a basın. İşlemin tamamlanması GitHub deposundaki **Actions → Docker imaji** sayfasından izlenebilir.

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

MQTT_TLS_ENABLED=0
MQTT_TLS_PORT=8883
MQTT_TLS_KEY=certs/server-key.pem
MQTT_TLS_CERT=certs/server-cert.pem
MQTT_TLS_CA=certs/ca-cert.pem
MQTT_TLS_REQUEST_CLIENT_CERT=0
MQTT_TLS_CLIENT_CERT=certs/client-cert.pem
MQTT_TLS_CLIENT_KEY=certs/client-key.pem

FAIL2BAN_MAX_ATTEMPTS=5
FAIL2BAN_FIND_TIME_MINUTES=10
FAIL2BAN_BAN_TIME_MINUTES=60
SECURITY_DB_PATH=security.sqlite3
```

| Ayar | Açıklama |
|---|---|
| `HOST` | Sunucunun dinleyeceği adres. `0.0.0.0`, tüm ağ bağlantılarını dinler. |
| `MQTT_PORT` | NetRelay cihazlarının bağlanacağı MQTT portu. Varsayılan `1883`. |
| `WEB_PORT` | Web panelinin portu. Varsayılan `3000`. |
| `MQTT_HOST` | Yalnızca `npm run client` test istemcisinin bağlanacağı sunucu IP'si. |
| `MQTT_USERNAME` | Test istemcisinin kullanıcı adı. `users.json` içinde bulunmalıdır. |
| `MQTT_PASSWORD` | Test istemcisinin parolası. `users.json` ile aynı olmalıdır. |
| `MQTT_TLS_ENABLED` | `1` olduğunda TLS MQTT sunucusunu ve test istemcisinde `mqtts://` bağlantısını etkinleştirir. |
| `MQTT_TLS_PORT` | TLS MQTT portu. Varsayılan `8883`. |
| `MQTT_TLS_KEY` | MQTT sunucusunun PEM biçimindeki private key dosyası. |
| `MQTT_TLS_CERT` | MQTT sunucusunun PEM biçimindeki sertifika dosyası. |
| `MQTT_TLS_CA` | Sunucu veya karşılıklı TLS doğrulamasında kullanılacak CA sertifikası. |
| `MQTT_TLS_REQUEST_CLIENT_CERT` | `1` olduğunda bağlanan cihazdan geçerli istemci sertifikası ister. |
| `MQTT_TLS_CLIENT_CERT` | `npm run client` için isteğe bağlı istemci sertifikası. |
| `MQTT_TLS_CLIENT_KEY` | Test istemcisi sertifikasına ait private key. |
| `FAIL2BAN_MAX_ATTEMPTS` | Bir IP engellenmeden önce izin verilen başarısız giriş sayısı. |
| `FAIL2BAN_FIND_TIME_MINUTES` | Başarısız girişlerin sayılacağı zaman aralığı. |
| `FAIL2BAN_BAN_TIME_MINUTES` | Otomatik IP engelinin dakika cinsinden süresi. |
| `SECURITY_DB_PATH` | Blacklist bilgilerinin saklanacağı SQLite dosyasının yolu. |

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

> **Güvenlik uyarısı:** `.env` ve `users.json` dosyaları `.gitignore` kapsamındadır ve depoya gönderilmez. Yine de parolaları düzenli olarak değiştirin ve özel (private) olmayan depolarda paylaşmayın.

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
- TLS MQTT broker etkinse: `mqtts://SUNUCU_IP:8883`

Programı durdurmak için terminalde `Ctrl+C` tuşlarına basın.

### Windows Güvenlik Duvarı

Diğer cihazlar bağlanamıyorsa PowerShell'i **Yönetici olarak** açıp gerekli portlara izin verin:

```powershell
New-NetFirewallRule -DisplayName "NetRelay MQTT 1883" -Direction Inbound -Protocol TCP -LocalPort 1883 -Action Allow
New-NetFirewallRule -DisplayName "NetRelay MQTT TLS 8883" -Direction Inbound -Protocol TCP -LocalPort 8883 -Action Allow
New-NetFirewallRule -DisplayName "NetRelay Web 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

Yalnızca güvendiğiniz yerel ağlarda bu izinleri açın.

## NetRelay cihazını bağlama

NetRelay cihazının `/mqtt` ayar sayfasını açın ve şu değerleri girin:

| Cihaz ayarı | Girilecek değer |
|---|---|
| MQTT Server | Bu programın çalıştığı bilgisayarın IP adresi |
| MQTT Port | `1883` veya `.env` içindeki `MQTT_PORT` |
| MQTT TLS | TLS bağlantısı kullanılacaksa açık |
| MQTT TLS Port | `8883` veya `.env` içindeki `MQTT_TLS_PORT` |
| Sunucu CA Sertifikası | Sunucu sertifikasını imzalayan CA'nın PEM içeriği |
| İstemci Sertifikası | Karşılıklı TLS etkinse cihaza ait PEM sertifika |
| İstemci Private Key | İstemci sertifikasına ait PEM private key |
| MQTT Kullanıcı | `users.json` içindeki bir kullanıcı adı |
| MQTT Şifre | Aynı kullanıcıya ait parola |
| MQTT İstemci Modu | Açık |
| Client ID | Her cihaz için benzersiz kimlik; örneğin `1012` |

Ayarları kaydettikten sonra gerekirse cihazı yeniden başlatın. Bağlantı kurulduğunda cihaz web panelindeki çevrimiçi cihazlar bölümünde görünür.

## MQTT TLS yapılandırması

TLS sunucusunu etkinleştirmek için sunucu sertifikası ve private key dosyalarını `certs` klasörüne yerleştirip `.env` içinde `MQTT_TLS_ENABLED=1` yapın. Sunucu normal MQTT portu `1883` ile TLS portu `8883` üzerinde aynı anda çalışır. Tüm cihazlar TLS'e geçirildikten sonra `1883` portunu güvenlik duvarından kapatabilirsiniz.

NetRelay cihazında **MQTT TLS** açıldığında **Sunucu CA Sertifikası** zorunludur. Cihaz sertifikadaki alan adı veya IP adresiyle MQTT sunucusuna bağlanmalıdır. Örneğin MQTT sunucusu `192.168.1.4` adresindeyse sunucu sertifikasının Subject Alternative Name alanında bu adres bulunmalıdır.

Yalnızca sunucu doğrulaması için:

```env
MQTT_TLS_ENABLED=1
MQTT_TLS_REQUEST_CLIENT_CERT=0
```

Bu kullanımda NetRelay tarafında CA sertifikası girilir; istemci sertifikası ve private key boş bırakılır.

Karşılıklı TLS için:

```env
MQTT_TLS_ENABLED=1
MQTT_TLS_REQUEST_CLIENT_CERT=1
MQTT_TLS_CA=certs/ca-cert.pem
```

Karşılıklı TLS kullanılırken her NetRelay cihazına istemci sertifikası ve ona ait private key birlikte girilmelidir. Alanlardan yalnızca biri girilirse cihaz ayarı kabul edilmez. Private key dosyalarını Git deposuna göndermeyin ve yetkisiz kişilerle paylaşmayın.

> TLS sertifika doğrulaması için NetRelay cihazının tarih ve saati doğru olmalıdır. MQTT bağlantısını kurmadan önce RTC/NTP zamanının güncel olduğundan emin olun.

### Yerel IP, yerel DNS ve internet domain kullanımı

Firmware kodu her üç kullanım şeklini de destekler. NetRelay cihazındaki **MQTT Server** alanına yalnızca IP adresi veya DNS adı yazılır; `mqtt://`, `mqtts://`, port veya `/` ile başlayan bir yol eklenmez.

#### Senaryo 1: Yerel ağda doğrudan IP kullanımı

MQTT sunucusu ve NetRelay cihazları aynı yerel ağdaysa en basit yöntem sunucunun sabit IP adresini kullanmaktır.

Örnek ağ:

```text
MQTT sunucusu: 192.168.1.4
NetRelay cihazı: 192.168.1.50
TLS MQTT portu: 8883
```

Sunucu sertifikasının SAN ayarı ESP32 uyumluluğu için IP adresini hem `DNS:` hem `IP:` türünde içermelidir:

```ini
subjectAltName=DNS:192.168.1.4,IP:192.168.1.4
```

NetRelay `/mqtt` ayarı:

```text
MQTT Server: 192.168.1.4
MQTT TLS: Açık
MQTT TLS Port: 8883
```

Bu yöntemde DNS kaydı ve modem port yönlendirmesi gerekmez. Sunucu bilgisayarının yerel IP adresi değişmemelidir; DHCP rezervasyonu veya statik IP kullanın. Güvenlik duvarında TCP `8883` portuna yalnızca yerel ağdan erişim verin.

#### Senaryo 2: Yerel ağda DNS adı kullanımı

IP adresi yerine okunabilir bir ad kullanmak için modem, yönlendirici, Windows DNS, Pi-hole veya AdGuard Home üzerinde yerel DNS kaydı oluşturun.

Örnek DNS kaydı:

```text
mqtt.lan.example.com → 192.168.1.4
```

Sunucu sertifikası:

```ini
subjectAltName=DNS:mqtt.lan.example.com,IP:192.168.1.4
```

NetRelay `/mqtt` ayarı:

```text
MQTT Server: mqtt.lan.example.com
MQTT TLS: Açık
MQTT TLS Port: 8883
```

NetRelay cihazının ağ ayarlarındaki DNS sunucusu, bu yerel kaydı çözebilen DNS sunucusunu göstermelidir. Örneğin kayıt Pi-hole üzerinde tanımlıysa cihazın DNS adresi Pi-hole IP adresi olmalıdır.

`.local` uzantısı çoğunlukla mDNS için ayrılmıştır ve her W5500/DNS yapılandırmasında normal DNS sorgusuyla çözülmeyebilir. Daha öngörülebilir kullanım için kontrolünüzdeki bir domain altında `mqtt.lan.example.com` benzeri yerel bir ad ve yerel DNS kaydı kullanın.

Yerel DNS kullanılırken internet DNS kaydı veya modem port yönlendirmesi gerekmez. Aynı CA ile yalnızca yeni sunucu sertifikası oluşturulursa NetRelay cihazındaki CA sertifikası değişmez.

#### Senaryo 3: İnternet üzerinden gerçek domain kullanımı

MQTT sunucusuna farklı ağlardan erişilecekse sahip olduğunuz domain altında bir DNS kaydı oluşturun:

```text
mqtt.example.com → SUNUCUNUN_PUBLIC_IP_ADRESİ
```

Sunucu sertifikasının SAN alanı:

```ini
subjectAltName=DNS:mqtt.example.com
```

NetRelay `/mqtt` ayarı:

```text
MQTT Server: mqtt.example.com
MQTT TLS: Açık
MQTT TLS Port: 8883
```

İnternet erişimi için ayrıca:

- Modem veya güvenlik duvarında TCP `8883` portunu MQTT sunucusuna yönlendirin.
- Public IP değişiyorsa dinamik DNS kullanın veya DNS kaydını otomatik güncelleyin.
- CGNAT kullanılıyorsa doğrudan port yönlendirme çalışmayabilir; VPN veya sabit public IP gerekir.
- Yerel cihazlar da public domain kullanacaksa modem hairpin NAT desteklemeli veya aynı domain için yerel DNS kaydı tanımlanmalıdır.
- `1883` şifresiz MQTT portunu internete açmayın.
- Güçlü ve her cihaz için farklı MQTT parolaları kullanın.
- Mümkünse `MQTT_TLS_REQUEST_CLIENT_CERT=1` ile karşılıklı TLS kullanın.
- Yönetim paneli portu `3000` doğrudan internete açılmamalıdır; VPN veya kimlik doğrulamalı HTTPS reverse proxy arkasında tutulmalıdır.

Kendi CA'nızla domain sertifikası oluşturursanız NetRelay cihazına `ca-cert.pem` yüklenir. Let's Encrypt gibi public bir CA kullanılırsa sunucu `fullchain.pem` sunmalı ve NetRelay cihazına sertifikayı doğrulayan uygun kök CA yüklenmelidir. Sunucu sertifikasını yenilemek, imzalayan kök CA değişmediği sürece cihazdaki CA alanını güncellemeyi gerektirmez.

#### Hızlı karşılaştırma

| Kullanım | NetRelay MQTT Server | Sertifika SAN | DNS kaydı | Port yönlendirme |
|---|---|---|---|---|
| Yerel IP | `192.168.1.4` | `DNS:192.168.1.4,IP:192.168.1.4` | Gerekmez | Gerekmez |
| Yerel DNS | `mqtt.lan.example.com` | `DNS:mqtt.lan.example.com` | Yerel DNS → `192.168.1.4` | Gerekmez |
| İnternet domain | `mqtt.example.com` | `DNS:mqtt.example.com` | Public DNS → public IP | TCP `8883` |

DNS adı veya IP değiştirildiğinde firmware kodunu değiştirmek gerekmez. Yeni adres sertifikanın SAN alanına eklenir, sertifika yeniden imzalanır, `.env` içindeki `MQTT_TLS_CERT` yolu gerekiyorsa güncellenir ve MQTT sunucusu yeniden başlatılır.

### CA, sunucu ve istemci sertifikalarını oluşturma

Aşağıdaki örnek OpenSSL komutları kendi yerel sertifika otoritenizi (CA), MQTT sunucu sertifikanızı ve bir NetRelay cihazına ait istemci sertifikasını oluşturur. Komutları proje klasöründe PowerShell veya OpenSSL çalıştırabilen başka bir terminalde uygulayın.

> Örneklerdeki `192.168.1.100` değerini MQTT sunucusunun gerçek IP adresiyle değiştirin. NetRelay cihazının **MQTT Server** alanına hangi IP veya alan adı yazılacaksa sunucu sertifikasının SAN alanında aynı değer bulunmalıdır.

#### 1. Sertifika klasörünü oluşturun

```powershell
New-Item -ItemType Directory -Force certs
Set-Location certs
```

`certs` altındaki private key ve PEM dosyaları `.gitignore` kapsamındadır.

#### 2. Kök CA oluşturun

```powershell
openssl genrsa -out ca-key.pem 4096

openssl req -x509 -new -nodes `
  -key ca-key.pem `
  -sha256 `
  -days 3650 `
  -out ca-cert.pem `
  -subj "/C=TR/O=NetRelay/CN=NetRelay Root CA"
```

Oluşan dosyalar:

- `ca-key.pem`: Yeni sertifikaları imzalayan CA private key. Çok gizli tutulmalı ve hiçbir NetRelay cihazına kopyalanmamalıdır.
- `ca-cert.pem`: Sunucu ve cihazlarda güvenilen kök sertifika olarak kullanılabilir.

#### 3. MQTT sunucu sertifikasını oluşturun

Sunucu private key ve sertifika isteğini oluşturun:

```powershell
openssl genrsa -out server-key.pem 2048

openssl req -new `
  -key server-key.pem `
  -out server.csr `
  -subj "/C=TR/O=NetRelay/CN=mqtt.netrelay.local"
```

`server-ext.cnf` adında bir dosya oluşturun:

```ini
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:mqtt.netrelay.local,DNS:192.168.1.100,IP:192.168.1.100
```

Yalnızca IP adresi kullanılacaksa `DNS:` bölümü kaldırılabilir. Birden fazla sunucu adresi virgülle eklenebilir:

```ini
subjectAltName=DNS:mqtt.netrelay.local,DNS:192.168.1.100,IP:192.168.1.100,DNS:10.0.0.20,IP:10.0.0.20
```

ESP32 firmware'de kullanılan bazı Mbed TLS sürümleri IP biçimindeki bağlantı adını yalnızca `dNSName` SAN kaydı üzerinden karşılaştırır. Bu nedenle IP adresini hem `DNS:` hem `IP:` olarak ekleyin. Modern istemciler `IP:` kaydını, eski ESP32 istemcileri ise `DNS:` kaydını kullanabilir.

Sunucu sertifikasını CA ile imzalayın:

```powershell
openssl x509 -req `
  -in server.csr `
  -CA ca-cert.pem `
  -CAkey ca-key.pem `
  -CAcreateserial `
  -out server-cert.pem `
  -days 825 `
  -sha256 `
  -extfile server-ext.cnf
```

#### 4. NetRelay istemci sertifikası oluşturun

Karşılıklı TLS kullanılmayacaksa bu adım atlanabilir. Karşılıklı TLS için her cihaza ayrı private key ve sertifika oluşturulması önerilir. Aşağıdaki örnekte cihaz kimliği `netrelay-device-1000` olarak kullanılmıştır:

```powershell
openssl genrsa -out client-1000-key.pem 2048

openssl req -new `
  -key client-1000-key.pem `
  -out client-1000.csr `
  -subj "/C=TR/O=NetRelay/CN=netrelay-device-1000"
```

`client-ext.cnf` dosyasını oluşturun:

```ini
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
```

İstemci sertifikasını CA ile imzalayın:

```powershell
openssl x509 -req `
  -in client-1000.csr `
  -CA ca-cert.pem `
  -CAkey ca-key.pem `
  -CAserial ca-cert.srl `
  -out client-1000-cert.pem `
  -days 825 `
  -sha256 `
  -extfile client-ext.cnf
```

Her yeni cihaz için `1000` ve `netrelay-device-1000` değerlerini değiştirerek bu adımı tekrarlayın. Cihazların aynı private key'i paylaşması önerilmez.

#### 5. Sertifikaları doğrulayın

```powershell
openssl verify -CAfile ca-cert.pem server-cert.pem
openssl verify -CAfile ca-cert.pem client-1000-cert.pem
openssl x509 -in server-cert.pem -noout -subject -issuer -dates -ext subjectAltName
```

İlk iki komutun sonucu `OK` olmalıdır. Son komutta NetRelay cihazının bağlanacağı IP veya alan adının SAN listesinde bulunduğunu kontrol edin.

#### 6. MQTT sunucusunu yapılandırın

Proje kök dizinine dönüp `.env` dosyasını düzenleyin:

```env
MQTT_TLS_ENABLED=1
MQTT_TLS_PORT=8883
MQTT_TLS_KEY=certs/server-key.pem
MQTT_TLS_CERT=certs/server-cert.pem
MQTT_TLS_CA=certs/ca-cert.pem
MQTT_TLS_REQUEST_CLIENT_CERT=1
```

Yalnızca sunucu sertifikası doğrulanacaksa:

```env
MQTT_TLS_REQUEST_CLIENT_CERT=0
```

Sunucuyu yeniden başlatın:

```powershell
npm start
```

Başlangıç logunda `MQTT TLS server çalışıyor: 0.0.0.0:8883` mesajı görülmelidir.

#### 7. NetRelay cihazını yapılandırın

NetRelay cihazında `http://CIHAZ_IP/mqtt` sayfasını açın ve şu değerleri girin:

| NetRelay alanı | Girilecek içerik |
|---|---|
| MQTT Server | Sunucu sertifikasının SAN alanındaki IP veya alan adı |
| MQTT TLS | Açık |
| MQTT TLS Port | `8883` |
| Sunucu CA Sertifikası | `ca-cert.pem` dosyasının başlangıç ve bitiş satırları dahil tam içeriği |
| İstemci Sertifikası | Karşılıklı TLS için `client-1000-cert.pem` dosyasının tam içeriği |
| İstemci Private Key | Karşılıklı TLS için `client-1000-key.pem` dosyasının tam içeriği |
| MQTT İstemci Modu | Açık |

PEM alanlarına aşağıdaki başlangıç ve bitiş satırları dahil edilmelidir:

```text
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
```

Private key için:

```text
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

OpenSSL bazı durumlarda `-----BEGIN RSA PRIVATE KEY-----` biçimi oluşturabilir; firmware bu PEM biçimini de kabul eder.

### Hangi dosya nereye konulacak?

| Dosya | MQTT sunucusu | NetRelay cihazı | Gizli mi? |
|---|---:|---:|---:|
| `ca-key.pem` | Yalnızca yeni sertifika imzalarken | Hayır | Evet, en kritik anahtar |
| `ca-cert.pem` | `MQTT_TLS_CA` | Sunucu CA Sertifikası | Hayır |
| `server-key.pem` | `MQTT_TLS_KEY` | Hayır | Evet |
| `server-cert.pem` | `MQTT_TLS_CERT` | Hayır | Hayır |
| `client-1000-key.pem` | Yalnızca test istemcisinde gerekebilir | İstemci Private Key | Evet |
| `client-1000-cert.pem` | Doğrudan gerekmez; CA ile doğrulanır | İstemci Sertifikası | Hayır |

CSR ve uzantı dosyaları sertifikalar üretildikten sonra çalışma sırasında gerekli değildir. `ca-key.pem`, `server-key.pem` ve istemci private key dosyalarının erişim izinlerini sınırlandırın ve güvenli bir yedeğini alın.

## Web panelinin kullanımı

1. Tarayıcıdan `http://SUNUCU_IP:3000` adresini açın.
2. Çevrimiçi cihazlar listesinden kontrol edilecek cihazı seçin.
3. Açmak veya kapatmak istediğiniz 1–4 numaralı röleleri seçin.
4. Röle konumunu Açık (`1`) veya Kapalı (`0`) olarak belirleyin.
5. Komutu gönderin.
6. İşlem ve cihaz mesajlarını paneldeki log bölümünden izleyin.

Panel, seçilen cihazın kullanıcı adına ait `command` topic'ine JSON komutu yollar. Cihaz bağlantısı kesilirse listeden otomatik kaldırılır.

### TLS ve MQTT debug logları

Web panelinde **Sunucu Logları** menüsünü açıp **Debug Log** anahtarını etkinleştirdiğinizde ayrıntılı bağlantı kayıtları hem web panelinde hem `npm start` terminalinde gösterilir. Debug modu aşağıdaki bilgileri kaydeder:

- TLS el sıkışmasının başarılı veya başarısız olması
- Uzak istemci IP adresi
- TLS hata kodu ve hata mesajı
- Kullanılan TLS protokolü ve şifre paketi
- Sunulan istemci sertifikasının CN değeri
- İstemci sertifikasının yetkili olup olmadığı
- MQTT kimlik doğrulamasının başlangıcı ve sonucu
- Aedes MQTT istemci ve bağlantı hataları

Parolalar, CA private key, sunucu private key ve istemci private key içerikleri debug loglarına yazılmaz. Debug modu yalnızca sorun giderirken açılmalı; üretilen log miktarını azaltmak için işlem tamamlandığında kapatılmalıdır. Ayar bellekte tutulur ve sunucu yeniden başlatıldığında kapalı duruma döner.

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

## Testler ve canlı güncellemeler

Saf ayrıştırma, cron, giriş engelleme ve WebSocket delta davranışı Node.js'in yerleşik test çatısıyla sınanır:

```powershell
npm test
```

WebSocket istemcileri bağlantı başında tam durum alır; sonraki güncellemelerde yalnızca değişen alanlar gönderilir. Röle, yeniden başlatma, senkronizasyon ve kuyruk komutları MQTT QoS 1 kullanır. QoS 1 teslimatı en az bir kez garanti ettiğinden cihaz firmware'i aynı komutun tekrar gelmesini güvenli biçimde karşılamalıdır.

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
# Web paneli varsayılan yönetici hesabı

Web paneli ilk kurulumda aşağıdaki yönetici hesabını otomatik oluşturur:

- Kullanıcı adı: `admin@mlteknoloji.com`
- İlk parola: Sunucu konsolunda yalnızca bir kez gösterilen güvenli rastgele parola

Bu parola yalnızca ilk giriş içindir. İlk başarılı girişten sonra panel, güvenlik kurallarına uygun yeni bir parola belirlenmeden yönetim ekranına erişilmesine izin vermez. Parola değiştirildikten sonra yeniden giriş yapılır. İlk parola kaybedilirse varsayılan/sabit bir parola denenmemeli; güvenli yönetici kurtarma süreci uygulanmalıdır.

Yönetici, paneldeki **Kullanıcı Yönetimi** menüsünden yeni hesap oluşturabilir; kullanıcı adı, görünen ad, parola, hesap durumu ve bölüm yetkilerini düzenleyebilir. Verilebilen yetkiler genel bakış, röle komutu, zamanlanmış görevler, e-posta ayarları, MQTT blacklist, sunucu logları ve kullanıcı yönetimidir. Yetki kontrolleri hem arayüzde hem sunucu/WebSocket tarafında uygulanır. Sistemde daima en az bir aktif yönetici kalır; son aktif yönetici silinemez, pasifleştirilemez veya kullanıcı rolüne düşürülemez.

## MQTT üzerinden firmware güncelleme

**Firmware Güncelleme** menüsünde ESP32 `.bin` dosyası, sürüm ve donanım modeliyle kaydedilir. Panel dosyanın ESP32 imaj başlığını, OTA bölümüne uygun azami boyutunu ve SHA-256 özetini kontrol eder. Güncelleme başlatıldığında seçilen cihaza MQTT ile süreli HTTP/HTTPS indirme adresi gönderilir. Cihaz indirme ve flash yazma yüzdesini MQTT ile bildirir; dosya boyutu ve SHA-256 doğrulandıktan sonra yeni OTA bölümünden yeniden başlar.

Mevcut `S-3.3.4` cihazlarında MQTT OTA komutu bulunmadığından OTA destekli ilk `S-3.3.5` firmware'i cihazın mevcut `/system` web güncelleme ekranından bir kez elle yüklenmelidir. Bundan sonraki sürümler merkez panelden gönderilebilir. Güncelleme sırasında cihazın enerjisi ve ağ bağlantısı kesilmemelidir.

## Günlük cihaz durum logları

MQTT cihazlarının bağlantı geçmişi `logs/device-status-YYYY-MM-DD.log` dosyalarına JSON Lines biçiminde yazılır. `DEVICE_UP` cihaz bağlantısını, `DEVICE_DOWN` bağlantı kopmasını, `SERVER_UP` uygulamanın açılışını ve `SERVER_DOWN` kontrollü kapanışı belirtir. Her satır UTC zamanını, Türkiye yerel saatini, MQTT kullanıcı adını, Client ID'yi ve uzak IP adresini içerir.

Yöneticiler **Sistem → Log Rotasyonu** sayfasından eski günlüklerin kaç gün sonra `.gz` olarak arşivleneceğini ve kaç gün sonra silineceğini ayarlayabilir. Rotasyon başlangıçta ve altı saatte bir çalışır; aynı sayfadan elle de başlatılabilir.

## Windows servisi

Sunucuyu terminal açık kalmadan ve Windows başlangıcında otomatik çalıştırmak için NSSM kurulum betikleri sağlanır. Ayrıntılı kurulum ve PM2 alternatifi için [Windows servis rehberine](docs/WINDOWS-SERVICE.md) bakın.
