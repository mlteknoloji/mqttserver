require('dotenv').config({ quiet: true });

const mqtt = require('mqtt');
const fs = require('node:fs');
const path = require('node:path');

const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_HOST = process.env.MQTT_HOST || 'localhost';
const MQTT_TLS_ENABLED = process.env.MQTT_TLS_ENABLED === '1';
const MQTT_PORT = MQTT_TLS_ENABLED
  ? Number(process.env.MQTT_TLS_PORT) || 8883
  : Number(process.env.MQTT_PORT) || 1883;

if (!MQTT_USERNAME || !MQTT_PASSWORD) {
  console.error('MQTT_USERNAME ve MQTT_PASSWORD tanımlanmalıdır.');
  process.exit(1);
}

const connectionOptions = {
  clientId: `test-client-${Date.now()}`,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD
};

if (MQTT_TLS_ENABLED) {
  if (!process.env.MQTT_TLS_CA) {
    console.error('TLS test istemcisi için MQTT_TLS_CA tanımlanmalıdır.');
    process.exit(1);
  }
  connectionOptions.ca = fs.readFileSync(path.resolve(__dirname, process.env.MQTT_TLS_CA));
  connectionOptions.rejectUnauthorized = true;
  if (process.env.MQTT_TLS_CLIENT_CERT && process.env.MQTT_TLS_CLIENT_KEY) {
    connectionOptions.cert = fs.readFileSync(path.resolve(__dirname, process.env.MQTT_TLS_CLIENT_CERT));
    connectionOptions.key = fs.readFileSync(path.resolve(__dirname, process.env.MQTT_TLS_CLIENT_KEY));
  }
}

const protocol = MQTT_TLS_ENABLED ? 'mqtts' : 'mqtt';
const client = mqtt.connect(`${protocol}://${MQTT_HOST}:${MQTT_PORT}`, connectionOptions);

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
