require('dotenv').config({ quiet: true });

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { Aedes } = require('aedes');

const MQTT_PORT = Number(process.env.MQTT_PORT) || 1883;
const WEB_PORT = Number(process.env.WEB_PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const USERS_FILE = path.join(__dirname, 'users.json');
const MAX_LOGS = 200;

const onlineClients = new Map();
const logs = [];
let wss;

function getLocalIpAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address?.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
}

function parseNetRelayEvent(message, client, topic) {
  try {
    const event = JSON.parse(message);
    const isRelayEvent =
      event.type === 'netrelay_relay_event' &&
      Number.isInteger(event.relay) &&
      event.relay >= 1 &&
      event.relay <= 4 &&
      (event.position === 0 || event.position === 1);

    if (isRelayEvent) {
      return {
        type: 'netrelay_relay_event',
        username: client.authenticatedUsername,
        clientId: client.id,
        topic,
        ipAddress: String(event.ipAddress || ''),
        hostname: String(event.hostname || ''),
        relay: event.relay,
        position: event.position,
        deviceUptimeMs: Number(event.deviceUptimeMs) || 0,
        serverReceivedAt: new Date().toISOString()
      };
    }

    const isInputEvent =
      event.type === 'netrelay_input_event' &&
      Number.isInteger(event.input) &&
      event.input >= 1 &&
      event.input <= 4 &&
      (event.io === 0 || event.io === 1);

    if (isInputEvent) {
      return {
        type: 'netrelay_input_event',
        mqttUsername: client.authenticatedUsername,
        deviceId: client.id,
        mqttEventTopic: topic,
        ipAddress: String(event.ipAddress || ''),
        hostname: String(event.hostname || ''),
        topic: String(event.topic || ''),
        subtopic: String(event.subtopic || ''),
        input: event.input,
        inputName: String(event.inputName || `input${event.input}`),
        io: event.io,
        voltage: Number(event.voltage) || 0,
        deviceUptimeMs: Number(event.deviceUptimeMs) || 0,
        serverReceivedAt: new Date().toISOString()
      };
    }

    const validStates = (states) =>
      Array.isArray(states) &&
      states.length === 4 &&
      states.every((state) => state === 0 || state === 1);
    const validInputs =
      Array.isArray(event.inputs) &&
      event.inputs.length === 4 &&
      event.inputs.every(
        (input, index) =>
          input.input === index + 1 &&
          (input.io === 0 || input.io === 1)
      );

    if (event.type === 'netrelay_device_status' && validStates(event.relays) && validInputs) {
      return {
        type: 'netrelay_device_status',
        mqttUsername: client.authenticatedUsername,
        deviceId: client.id,
        mqttEventTopic: topic,
        ipAddress: String(event.ipAddress || ''),
        hostname: String(event.hostname || ''),
        topic: String(event.topic || ''),
        subtopic: String(event.subtopic || ''),
        deviceUptimeMs: Number(event.deviceUptimeMs) || 0,
        relays: event.relays,
        inputs: event.inputs.map((input) => ({
          input: input.input,
          name: String(input.name || `input${input.input}`),
          io: input.io
        })),
        serverReceivedAt: new Date().toISOString()
      };
    }
  } catch {
    // Eski metin formatını aşağıda ayrıştırmaya devam et.
  }

  const match = message.match(
    /NetRelay olay bilgisidir\.\s*Olay\s+(\d+)\s*-\s*(input\d+)\s*,?\s*=\s*([01])\s+oldu\.?/i
  );

  if (!match) return null;

  return {
    type: 'netrelay_event',
    username: client.authenticatedUsername,
    clientId: client.id,
    topic,
    eventId: Number(match[1]),
    input: match[2].toLowerCase(),
    value: Number(match[3]),
    timestamp: new Date().toISOString()
  };
}

function loadUsers() {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));

  if (!Array.isArray(data.users) || data.users.length === 0) {
    throw new Error('users.json içinde en az bir kullanıcı bulunmalıdır.');
  }

  const users = new Map();

  for (const user of data.users) {
    if (!user.username || !user.password) {
      throw new Error('Her kullanıcı için username ve password zorunludur.');
    }

    if (users.has(user.username)) {
      throw new Error(`Aynı kullanıcı adı birden fazla kullanılamaz: ${user.username}`);
    }

    users.set(user.username, user.password);
  }

  return users;
}

function getState() {
  return {
    type: 'state',
    onlineClients: Array.from(onlineClients.values()),
    logs
  };
}

function broadcastState() {
  if (!wss) return;

  const message = JSON.stringify(getState());
  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

function addLog(type, message) {
  const entry = {
    type,
    message,
    timestamp: new Date().toLocaleString('tr-TR')
  };

  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.pop();

  console.log(`[${type}] ${message}`);
  broadcastState();
}

async function startServer() {
  const users = loadUsers();
  const broker = await Aedes.createBroker({
    authenticate(client, username, password, callback) {
      const enteredUsername = username?.toString();
      const enteredPassword = password?.toString();
      const isValid = users.get(enteredUsername) === enteredPassword;

      if (isValid) {
        client.authenticatedUsername = enteredUsername;
      } else {
        addLog('REDDEDİLDİ', `Client ID: ${client.id || 'bilinmiyor'}`);
      }

      callback(null, isValid);
    }
  });

  const mqttServer = net.createServer(broker.handle);
  const app = express();
  const webServer = http.createServer(app);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/', (request, response) => {
    response.render('index', {
      onlineClients: Array.from(onlineClients.values()),
      logs,
      mqttAddresses: getLocalIpAddresses().map((ip) => `${ip}:${MQTT_PORT}`)
    });
  });

  wss = new WebSocketServer({ server: webServer });
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify(getState()));

    socket.on('message', (rawMessage) => {
      try {
        const request = JSON.parse(rawMessage.toString());
        if (request.type !== 'publish') return;

        const target = onlineClients.get(String(request.targetClientId || ''));
        if (!target) throw new Error('Seçilen kullanıcı artık çevrimiçi değil.');

        const payload = JSON.parse(request.payload);
        const validRelays =
          Array.isArray(payload.relays) &&
          payload.relays.length > 0 &&
          payload.relays.every((relay) => Number.isInteger(relay) && relay >= 1 && relay <= 4);
        const validPosition = payload.position === 0 || payload.position === 1;
        const delay = payload.delay === undefined ? 0 : payload.delay;
        const validDelay = Number.isInteger(delay) && delay >= 0 && delay <= 4294967;

        if (
          payload.type !== 'netrelay' ||
          payload.command !== 'set' ||
          payload.targetUsername !== target.username ||
          !validRelays ||
          !validPosition ||
          !validDelay
        ) {
          throw new Error('NetRelay JSON formatı geçersiz.');
        }

        payload.relays = [...new Set(payload.relays)];
        payload.delay = delay;
        const jsonPayload = JSON.stringify(payload);
        const topic = target.commandTopic;

        broker.publish(
          {
            cmd: 'publish',
            topic,
            payload: Buffer.from(jsonPayload),
            qos: 0,
            retain: false,
            dup: false
          },
          (error) => {
            if (error) {
              addLog('HATA', `Web komutu gönderilemedi: ${error.message}`);
              return;
            }

            addLog('KOMUT', `Topic: ${topic} | Mesaj: ${jsonPayload}`);
          }
        );
      } catch (error) {
        socket.send(JSON.stringify({ type: 'publishError', message: error.message }));
      }
    });
  });

  broker.on('clientReady', (client) => {
    onlineClients.set(client.id, {
      clientId: client.id,
      username: client.authenticatedUsername,
      commandTopic: `netrelay/${client.authenticatedUsername}/command`,
      status: 'UP',
      deviceUptimeMs: 0,
      hostname: '',
      ipAddress: '',
      lastSeenAt: new Date().toLocaleString('tr-TR'),
      connectedAt: new Date().toLocaleString('tr-TR')
    });
    addLog(
      'BAĞLANDI',
      `Kullanıcı: ${client.authenticatedUsername} | Client ID: ${client.id}`
    );
  });

  broker.on('clientDisconnect', (client) => {
    onlineClients.delete(client.id);
    addLog(
      'KOPTU',
      `Kullanıcı: ${client.authenticatedUsername || 'bilinmiyor'} | Client ID: ${client.id}`
    );
  });

  broker.on('publish', (packet, client) => {
    if (!client) return;

    const message = packet.payload.toString();
    const netRelayEvent = parseNetRelayEvent(message, client, packet.topic);

    if (netRelayEvent?.type === 'netrelay_device_status') {
      const currentClient = onlineClients.get(client.id);
      if (currentClient) {
        onlineClients.set(client.id, {
          ...currentClient,
          status: 'UP',
          deviceUptimeMs: netRelayEvent.deviceUptimeMs,
          hostname: netRelayEvent.hostname,
          ipAddress: netRelayEvent.ipAddress,
          lastSeenAt: new Date().toLocaleString('tr-TR'),
          relays: netRelayEvent.relays,
          inputs: netRelayEvent.inputs
        });
        broadcastState();
      }
      console.log(
        `[DEVICE_STATUS] Kullanıcı: ${client.authenticatedUsername} | Client ID: ${client.id} | Uptime: ${netRelayEvent.deviceUptimeMs} ms`
      );
      return;
    }

    addLog(
      'MESAJ',
      `Kullanıcı: ${client.authenticatedUsername} | Topic: ${packet.topic} | Mesaj: ${message}`
    );

    if (netRelayEvent) {
      console.log(`[NETRELAY_JSON] ${JSON.stringify(netRelayEvent)}`);
    }
  });

  mqttServer.on('error', (error) => addLog('HATA', `MQTT: ${error.message}`));
  webServer.on('error', (error) => addLog('HATA', `Web: ${error.message}`));

  mqttServer.listen(MQTT_PORT, HOST, () => {
    addLog('SİSTEM', `MQTT server tüm ağlarda çalışıyor: ${HOST}:${MQTT_PORT}`);
    addLog('SİSTEM', `${users.size} kullanıcı users.json dosyasından yüklendi.`);
    for (const ip of getLocalIpAddresses()) {
      addLog('SİSTEM', `MQTT bağlantı adresi: mqtt://${ip}:${MQTT_PORT}`);
    }
  });

  webServer.listen(WEB_PORT, HOST, () => {
    addLog('SİSTEM', `Web paneli tüm ağlarda çalışıyor: ${HOST}:${WEB_PORT}`);
    for (const ip of getLocalIpAddresses()) {
      addLog('SİSTEM', `Web paneli adresi: http://${ip}:${WEB_PORT}`);
    }
  });
}

startServer().catch((error) => {
  console.error('Sunucu başlatılamadı:', error.message);
  process.exitCode = 1;
});
