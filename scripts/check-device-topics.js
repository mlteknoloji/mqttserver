const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const mqtt = require('mqtt');
const { createMqttUserStore } = require('../mqtt-users');

const ROOT = path.join(__dirname, '..');
const TMP_DB = path.join(ROOT, 'tmp-topic-check.sqlite3');
const MQTT_PORT = 31999;
const WEB_PORT = 18099;
const PASSWORD = 'TestParola123!';

for (const suffix of ['', '-shm', '-wal']) {
  try { fs.unlinkSync(TMP_DB + suffix); } catch {}
}

const store = createMqttUserStore({ databasePath: TMP_DB });
store.save({ username: 'atakoy_sube', password: PASSWORD, enabled: true, deviceType: 'netrelay' });
store.close();

const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    SECURITY_DB_PATH: TMP_DB,
    MQTT_PORT: String(MQTT_PORT),
    WEB_PORT: String(WEB_PORT),
    WEB_HTTPS_ENABLED: '0',
    MQTT_TLS_ENABLED: '0',
    MQTT_TOPIC_ENFORCEMENT: '1',
    HOST: '127.0.0.1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

function waitForPort(port, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => { socket.end(); resolve(); });
      socket.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error(`Port ${port} açılmadı`));
        else setTimeout(tryConnect, 250);
      });
    };
    tryConnect();
  });
}

(async () => {
  let exitCode = 0;
  try {
    await waitForPort(MQTT_PORT);
    const client = mqtt.connect(`mqtt://127.0.0.1:${MQTT_PORT}`, {
      username: 'atakoy_sube',
      password: PASSWORD,
      clientId: '1000',
      reconnectPeriod: 0
    });

    await new Promise((resolve, reject) => {
      client.on('connect', resolve);
      client.on('error', reject);
      setTimeout(() => reject(new Error('MQTT bağlanamadı')), 8000);
    });
    console.log('BAGLANDI');

    for (const topic of ['/netrelay/atakoy_sube', 'netrelay/atakoy_sube/command', 'fromServer', 'atakoy_sube']) {
      await new Promise((resolve, reject) => {
        client.subscribe(topic, { qos: 0 }, (error, grants) => {
          if (error) return reject(error);
          const grant = grants?.[0];
          console.log(`SUBSCRIBE ${JSON.stringify(topic)} => qos=${grant?.qos}`);
          if (grant && grant.qos === 128) reject(new Error(`Abonelik reddedildi: ${topic}`));
          else resolve();
        });
      });
    }

    await new Promise((resolve, reject) => {
      client.subscribe('netrelay/ atakoy_sube/command', { qos: 0 }, (error, grants) => {
        if (error) return reject(error);
        const grant = grants?.[0];
        console.log(`SUBSCRIBE spaced => qos=${grant?.qos}`);
        if (!grant || grant.qos !== 128) reject(new Error('Boşluklu topic reddedilmeliydi'));
        else resolve();
      });
    });

    await new Promise((resolve, reject) => {
      client.publish('netrelay/atakoy_sube/events', JSON.stringify({ type: 'heartbeat', test: true }), { qos: 0 }, (error) => {
        if (error) reject(error);
        else { console.log('PUBLISH netrelay/atakoy_sube/events => OK'); resolve(); }
      });
    });

    await new Promise((resolve) => {
      client.publish('netrelay/ atakoy_sube/events', JSON.stringify({ type: 'heartbeat', test: true }), { qos: 0 }, (error) => {
        console.log(`PUBLISH spaced => ${error ? 'REDDEDILDI' : 'HATA: kabul edildi'}`);
        if (!error) resolve(new Error('Boşluklu yayın reddedilmeliydi'));
        else resolve();
      });
    }).then((err) => { if (err) throw err; });

    client.end(true);
    console.log('SONUC: cihaz topicleri kabul edildi');
  } catch (error) {
    console.error('SONUC HATA:', error.message);
    exitCode = 1;
  } finally {
    child.kill('SIGTERM');
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      for (const suffix of ['', '-shm', '-wal']) {
        try { fs.unlinkSync(TMP_DB + suffix); } catch {}
      }
      process.exit(exitCode);
    }, 800);
  }
})();
