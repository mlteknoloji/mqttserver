require('dotenv').config({ quiet: true });

const mqtt = require('mqtt');

const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_HOST = process.env.MQTT_HOST || 'localhost';
const MQTT_PORT = Number(process.env.MQTT_PORT) || 1883;

if (!MQTT_USERNAME || !MQTT_PASSWORD) {
  console.error('MQTT_USERNAME ve MQTT_PASSWORD tanımlanmalıdır.');
  process.exit(1);
}

const client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
  clientId: `test-client-${Date.now()}`,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD
});

client.on('connect', () => {
  console.log('Servera bağlandı.');

  const commandTopic = `netrelay/${MQTT_USERNAME}/command`;
  client.subscribe(commandTopic, (error) => {
    if (error) {
      console.error('Komut topic aboneliği başarısız:', error.message);
      return;
    }

    console.log(`Komutlar dinleniyor: ${commandTopic}`);
  });

  client.publish('test/mesaj', 'Merhaba MQTT!', () => {
    console.log('Mesaj gönderildi.');
    console.log('Bağlantıyı kapatmak için Ctrl+C tuşlarına basın.');
  });
});

client.on('message', (topic, payload) => {
  try {
    console.log(`[KOMUT ALINDI] Topic: ${topic}`);
    console.log(JSON.parse(payload.toString()));
  } catch {
    console.log(`[KOMUT ALINDI] Topic: ${topic} | Mesaj: ${payload.toString()}`);
  }
});

client.on('error', (error) => {
  console.error('Client hatası:', error.message);
  client.end();
});

client.on('close', () => {
  console.log('Bağlantı kapandı.');
});

process.on('SIGINT', () => {
  console.log('\nBağlantı kapatılıyor...');
  client.end();
});
