# NetRelay MQTT Server

NetRelay cihazları için hazırlanmış hafif bir MQTT broker, web yönetim paneli ve test istemcisidir. Node.js üzerinde çalışır; MQTT bağlantılarını kullanıcı adı/parola ile doğrular, çevrimiçi cihazları izler, cihaz olaylarını JSON olarak işler ve web panelinden röle komutu gönderebilir.

## Özellikler

- Aedes tabanlı MQTT broker
- `users.json` üzerinden kullanıcı doğrulama
- Bağlı NetRelay cihazlarını canlı gösteren web paneli
- WebSocket ile anlık bağlantı, durum ve log güncellemeleri
- Web panelinden bir veya birden fazla röleyi açma/kapatma
- Input, röle ve cihaz durum JSON paketlerini ayrıştırma
- Ayrı bir MQTT test istemcisi

## Gereksinimler

- Node.js 18 veya daha yeni bir sürüm
- Aynı ağdaki cihazlar için açık TCP portları:
  - `1883`: MQTT
  - `3000`: Web paneli

## Kurulum

```bash
git clone https://github.com/mlteknoloji/mqttserver.git
cd mqttserver
npm install
```

Örnek yapılandırmaları kopyalayın:

Windows PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item users.example.json users.json
```

Linux/macOS:

```bash
cp .env.example .env
cp users.example.json users.json
```

## Yapılandırma

### `.env`

```env
HOST=0.0.0.0
MQTT_PORT=1883
WEB_PORT=3000
MQTT_HOST=192.168.1.100

MQTT_USERNAME=admin
MQTT_PASSWORD=guclu-bir-parola
```

- `HOST`: Sunucunun dinleyeceği ağ adresidir. `0.0.0.0`, tüm ağ arayüzlerinden erişime izin verir.
- `MQTT_PORT`: MQTT broker portudur.
- `WEB_PORT`: Yönetim panelinin HTTP portudur.
- `MQTT_HOST`: Yalnızca `npm run client` test istemcisinin bağlanacağı broker adresidir.
- `MQTT_USERNAME` ve `MQTT_PASSWORD`: Yalnızca test istemcisi tarafından kullanılır.

Broker kullanıcıları `.env` dosyasından değil, `users.json` dosyasından okunur.

### `users.json`

```json
{
  "users": [
    {
      "username": "biga_sube",
      "password": "guclu-bir-parola"
    }
  ]
}
```

Her kullanıcı adı benzersiz olmalıdır. Dosyada değişiklik yaptıktan sonra sunucuyu yeniden başlatın. `.env` ve `users.json` Git tarafından dışlanmıştır; gerçek parolaları repoya eklemeyin.

## Çalıştırma

```bash
npm start
```

Varsayılan adresler:

- MQTT: `mqtt://SUNUCU_IP:1883`
- Web paneli: `http://SUNUCU_IP:3000`

Test istemcisini ayrı bir terminalde çalıştırmak için:

```bash
npm run client
```

## NetRelay cihaz ayarları

Cihazın `/mqtt` sayfasında aşağıdaki değerleri girin:

- MQTT Server: Sunucunun yerel IP adresi
- MQTT Port: `1883`
- MQTT Kullanıcı: `users.json` içindeki kullanıcı adı
- MQTT Şifre: Aynı kullanıcıya ait parola
- MQTT İstemci Modu: Açık

Client ID cihaz kimliğidir; örneğin `1012`. `REDDEDİLDİ` kaydı görülürse Client ID değil, kullanıcı adı veya parola eşleşmesi kontrol edilmelidir.

## Topic yapısı

Her kullanıcı için iki temel topic kullanılır:

```text
netrelay/<kullanici>/events
netrelay/<kullanici>/command
```

- `events`: Cihazın input, röle ve periyodik durum mesajlarını yayınladığı topic.
- `command`: Cihazın web panelinden gelen röle komutlarını dinlediği topic.

Örnek komut:

```json
{
  "type": "netrelay",
  "command": "set",
  "targetUsername": "biga_sube",
  "relays": [1, 2],
  "position": 1
}
```

## Olay JSON örneği

```json
{
  "type": "netrelay_input_event",
  "mqttUsername": "biga_sube",
  "deviceId": "1012",
  "mqttEventTopic": "netrelay/biga_sube/events",
  "ipAddress": "192.168.1.50",
  "hostname": "NetRelay",
  "topic": "biga_sube",
  "subtopic": "fromServer",
  "input": 4,
  "inputName": "inp4",
  "io": 0,
  "voltage": 12.0,
  "deviceUptimeMs": 7748
}
```

Sunucu doğrulanmış kullanıcı adı ve Client ID bilgilerini MQTT bağlantısından alır. Cihazdan gelen input/röle olayları konsolda `[NETRELAY_JSON]` etiketiyle gösterilir.

## Proje yapısı

```text
server.js           MQTT broker, HTTP paneli ve WebSocket sunucusu
client.js           MQTT bağlantı test istemcisi
views/index.ejs     Web paneli
public/             Panelin CSS ve istemci dosyaları
users.example.json  Örnek broker kullanıcıları
.env.example        Örnek port ve test istemcisi ayarları
docs/               Ayrıntılı NetRelay kullanım kılavuzu
```

## Güvenlik

Bu proje varsayılan olarak şifresiz TCP MQTT ve HTTP kullanır. İnternet üzerinden doğrudan yayınlamayın. Uzak erişim gerekiyorsa güvenlik duvarı/VPN kullanın veya TLS ve HTTPS sağlayan bir reverse proxy arkasında çalıştırın. Güçlü ve her cihaz için farklı parolalar tercih edin.

## Sorun giderme

- `REDDEDİLDİ`: `/mqtt` kullanıcı adı/parolası `users.json` ile aynı değil veya sunucu kullanıcı dosyası değiştikten sonra yeniden başlatılmadı.
- Bağlantı kurulamıyor: Sunucu IP adresini, `1883` portunu ve güvenlik duvarını kontrol edin.
- Web paneli açılmıyor: `3000` portunun kullanılabilir ve erişilebilir olduğunu doğrulayın.
- Cihaz bağlı fakat görünmüyor: MQTT istemci modunun açık ve cihaz Client ID değerinin benzersiz olduğundan emin olun.

## Lisans

Bu depoda henüz ayrı bir lisans dosyası bulunmamaktadır.
