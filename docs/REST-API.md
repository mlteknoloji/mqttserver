# NetRelay REST API v1

[English](REST-API.en.md)

Yönetici panelinde **Sistem → REST API** sayfasından bir API anahtarı oluşturun. Token yalnızca bir kez gösterilir ve sunucuda SHA-256 özeti tutulur.

```http
Authorization: Bearer nr_...
```

`X-API-Key` başlığı da desteklenir. Her anahtar dakikada 120 istekle sınırlıdır. `read` cihaz ve geçmiş okuma; `control` hem okuma hem komut yetkisi verir. Anahtar oluşturulurken en az bir cihaz grubu seçilir ve anahtar yalnızca bu gruplar ile üyelerine erişebilir.

| Yöntem | Endpoint | Yetki | Açıklama |
|---|---|---|---|
| GET | `/api/v1/health` | Yok | Sunucu sağlık kontrolü |
| GET | `/api/v1/devices` | read | Çevrimiçi cihazlar |
| GET | `/api/v1/devices/:username` | read | Tek cihazın canlı durumu |
| GET | `/api/v1/history?username=cihaz1&limit=100` | read | Değişiklik geçmişi |
| GET | `/api/v1/device-groups` | read | Cihaz gruplarını listeler |
| GET | `/api/v1/device-groups/:id` | read | Tek cihaz grubunu getirir |
| POST | `/api/v1/device-groups` | control | Yeni cihaz grubu oluşturur |
| PUT | `/api/v1/device-groups/:id` | control | Cihaz grubunu günceller |
| DELETE | `/api/v1/device-groups/:id` | control | Cihaz grubunu siler |
| POST | `/api/v1/device-groups/:id/relays` | control | Gruba röle komutu gönderir |
| POST | `/api/v1/devices/:username/relays` | control | Röle / outlet komutu (NetRelay ve NetRelayMP) |
| POST | `/api/v1/devices/:username/mpower` | control | NetRelayMP native mPower komutu |
| POST | `/api/v1/devices/:username/restart` | control | Cihazı yeniden başlatır |
| POST | `/api/v1/devices/:username/sync` | control | Cihaz durumunu yeniler |

Röle isteği:

```json
{"relays":[1,2],"position":1,"delay":0}
```

NetRelayMP native komut örneği (`POST /devices/:username/mpower`):

```json
{"action":"on","port":1}
```

```json
{"action":"pulse","port":1,"delay":10,"to":1}
```

```json
{"action":"cycle","port":"all","delay":10}
```

Başarılı komut `202 Accepted` döndürür. Yaygın hata kodları: `INVALID_API_KEY`, `INSUFFICIENT_SCOPE`, `RATE_LIMITED`, `DEVICE_OFFLINE`, `INVALID_COMMAND`, `INVALID_DEVICE_TYPE`, `UNSUPPORTED` ve `COMMAND_FAILED`.

## Mobil uygulama entegrasyonu

Mobil uygulamada temel adresi `https://sunucu-adresi/api/v1` olarak saklayın. İlk bağlantıda `GET /health`, ardından Bearer token ile `GET /devices` çağrısı yaparak sunucuyu ve anahtarı doğrulayın. Cihaz listesini yalnızca API yanıtından oluşturun; sunucu, anahtarın atanmış grupları dışındaki kartları listelemez ve bu cihazlara yönelik doğrudan istekleri `404 Not Found` ile reddeder.

Önerilen ekran akışı:

1. Sunucu adresi ve API tokenı ayarı
2. Yetkili çevrimiçi cihazların listesi
3. Tek cihazın röle, input, voltaj, sıcaklık ve uptime ayrıntısı
4. Kullanıcı onaylı röle, sync ve restart işlemleri
5. Cihaz bazlı olay geçmişi

Tokenı kaynak koda, uygulama paketine, düz metin ayar dosyasına veya loglara yazmayın. Android'de Keystore destekli şifreli saklama, iOS'ta Keychain kullanın. Her müşteri/kurulum için ayrı ve en dar cihaz grubuna bağlı anahtar üretin. Herkese açık bir mağaza uygulamasına ortak API anahtarı gömmek güvenli değildir; bu durumda mobil kullanıcı oturumlarını doğrulayan bir ara servis kullanın.

Röle komutu için JavaScript örneği:

```js
const response = await fetch(`${baseUrl}/devices/biga_sube/relays`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ relays: [1], position: 1, delay: 0 })
});
if (response.status === 202) {
  // Komut kabul edildi; güncel durumu yeniden sorgulayın.
}
```

Mobil istemci `401` yanıtında tokenı yeniden istemeli, `403` yanıtında kontrol arayüzünü kapatmalı, `409` yanıtında cihazı çevrimdışı göstermeli ve `429` yanıtında `X-RateLimit-*` başlıklarını dikkate alarak beklemelidir. REST API sürekli bağlantı gerektirmez; ekran görünürken ölçülü durum yenilemesi kullanın ve arka planda gereksiz sorgu yapmayın.

## Cihaz grupları

Grup oluşturma veya güncelleme gövdesi:

```json
{"name":"Biga Şubeleri","members":["biga_sube","biga_depo"]}
```

Gruba röle komutu:

```json
{"relays":[1,2],"position":1,"delay":0,"queueOffline":true}
```

`queueOffline: true` olduğunda çevrimdışı üyelerin komutları kuyruğa alınır. Yanıt her üye için `sent`, `queued` veya `offline` durumunu ve özet sayaçlarını içerir.

`GET /api/v1/devices` yalnızca anahtarın seçili gruplarındaki cihaz kartlarını döndürür. Tekil durum, geçmiş, röle, restart ve sync işlemleri de aynı üye kümesiyle sınırlandırılır. Kapsam dışındaki cihaz veya gruplar, varlık bilgisi sızdırmamak için `404 Not Found` olarak cevaplanır.

Grup kapsamlı API anahtarları grup üyeliğini oluşturamaz, değiştiremez veya silemez; böylece kendi cihaz erişimini genişletemez. Grup tanımları web panelindeki `/device-groups` sayfasından yönetilir. Önceki sürümde oluşturulmuş grup kapsamı olmayan anahtarlar geriye uyumluluk nedeniyle tüm gruplara erişir; bunların silinip sınırlı anahtarlarla değiştirilmesi önerilir.

## Home Assistant

REST API sayfasından MQTT Discovery etkinleştirildiğinde sunucu `homeassistant` prefix'i altında her cihazın dört rölesini `switch`, dört dijital inputunu `binary_sensor` olarak retained yapılandırmayla yayınlar. Input sensörleri hem anlık input event mesajlarını hem periyodik cihaz durumunu işler. Önce MQTT Kullanıcıları ekranında güçlü parolalı `homeassistant` hesabı oluşturun ve Home Assistant'ı bu hesapla aynı broker'a bağlayın. Bu hesaba yalnızca discovery, cihaz event aboneliği ve cihaz command yayını için entegrasyon topic yetkileri verilir. Prefix panelden değiştirilebilir.
