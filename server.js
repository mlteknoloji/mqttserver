require('dotenv').config({ quiet: true });

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const tls = require('node:tls');
const os = require('node:os');
const express = require('express');
const multer = require('multer');
const { WebSocketServer, WebSocket } = require('ws');
const { Aedes } = require('aedes');
const { createSecurityStore } = require('./security');
const { createScheduledTaskStore } = require('./scheduled-tasks');
const { createEmailNotificationStore } = require('./email-notifications');
const { createWebAuthStore } = require('./web-auth');
const { createFirmwareManager, MAX_FIRMWARE_SIZE } = require('./firmware-manager');

const MQTT_PORT = Number(process.env.MQTT_PORT) || 1883;
const WEB_PORT = Number(process.env.WEB_PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MQTT_TLS_ENABLED = process.env.MQTT_TLS_ENABLED === '1';
const MQTT_TLS_PORT = Number(process.env.MQTT_TLS_PORT) || 8883;
const MQTT_TLS_REQUEST_CLIENT_CERT = process.env.MQTT_TLS_REQUEST_CLIENT_CERT === '1';
const FIRMWARE_PUBLIC_BASE_URL = String(process.env.FIRMWARE_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const USERS_FILE = path.join(__dirname, 'users.json');
const STATUS_LOG_DIRECTORY = path.join(__dirname, 'logs');
const MAX_LOGS = 200;
const FAIL2BAN_MAX_ATTEMPTS = Number(process.env.FAIL2BAN_MAX_ATTEMPTS) || 5;
const FAIL2BAN_FIND_TIME_MINUTES = Number(process.env.FAIL2BAN_FIND_TIME_MINUTES) || 10;
const FAIL2BAN_BAN_TIME_MINUTES = Number(process.env.FAIL2BAN_BAN_TIME_MINUTES) || 60;
const configuredSecurityDbPath = process.env.SECURITY_DB_PATH || 'security.sqlite3';
const SECURITY_DB_PATH = configuredSecurityDbPath === ':memory:'
  ? ':memory:'
  : path.resolve(__dirname, configuredSecurityDbPath);
const security = createSecurityStore({
  databasePath: SECURITY_DB_PATH,
  maxAttempts: FAIL2BAN_MAX_ATTEMPTS,
  findTimeMs: FAIL2BAN_FIND_TIME_MINUTES * 60 * 1000,
  banTimeMs: FAIL2BAN_BAN_TIME_MINUTES * 60 * 1000
});
const scheduledTasks = createScheduledTaskStore({ databasePath: SECURITY_DB_PATH });
const emailNotifications = createEmailNotificationStore({ databasePath: SECURITY_DB_PATH });
const webAuth = createWebAuthStore({ databasePath: SECURITY_DB_PATH });
const firmwareManager = createFirmwareManager({ databasePath: SECURITY_DB_PATH, storageDirectory: path.join(__dirname, 'firmware-files') });
const firmwareUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FIRMWARE_SIZE } });

const onlineClients = new Map();
const logs = [];
let wss;
let debugLoggingEnabled = false;

fs.mkdirSync(STATUS_LOG_DIRECTORY, { recursive: true });

function localDateKey(date = new Date()) {
  const number = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${number(date.getMonth() + 1)}-${number(date.getDate())}`;
}

function writeDailyStatusLog(event, details = {}) {
  const now = new Date();
  const entry = JSON.stringify({ timestamp: now.toISOString(), localTime: now.toLocaleString('tr-TR'), event, ...details });
  try {
    fs.appendFileSync(path.join(STATUS_LOG_DIRECTORY, `device-status-${localDateKey(now)}.log`), `${entry}\n`, 'utf8');
  } catch (error) {
    console.error('[DURUM LOG HATASI]', error.message);
  }
}

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
        voltage: Number.isFinite(Number(event.voltage)) ? Number(event.voltage) : null,
        temperature: Number.isFinite(Number(event.temperature)) ? Number(event.temperature) : null,
        relays: event.relays,
        inputs: event.inputs.map((input) => ({
          input: input.input,
          name: String(input.name || `input${input.input}`),
          io: input.io,
          voltage: Number(input.voltage) || 0
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

function getState(user) {
  const can = (permission) => webAuth.hasPermission(user, permission);
  return {
    type: 'state',
    onlineClients: can('dashboard') || can('relay') || can('schedules') || can('email') ? Array.from(onlineClients.values()) : [],
    blacklist: can('blacklist') ? security.listBlacklist() : [],
    scheduledTasks: can('schedules') ? scheduledTasks.list() : [],
    emailNotifications: can('email') ? emailNotifications.getState() : { settings: {}, monitors: [] },
    firmwareManagement: can('firmware') ? firmwareManager.getState() : { firmwares: [], jobs: [], maxFirmwareSize: MAX_FIRMWARE_SIZE },
    debugLoggingEnabled: can('logs') ? debugLoggingEnabled : false,
    logs: can('logs') ? logs : [],
    currentUser: user || null,
    webUsers: user?.role === 'admin' ? webAuth.listUsers() : [],
    permissionDefinitions: webAuth.permissions
  };
}

function broadcastState() {
  if (!wss) return;

  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(getState(socket.authUser)));
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

function addDebugLog(message) {
  if (debugLoggingEnabled) addLog('DEBUG', message);
}

async function startServer() {
  const users = loadUsers();
  const broker = await Aedes.createBroker({
    authenticate(client, username, password, callback) {
      const remoteIp = security.normalizeIp(client.conn?.remoteAddress);
      addDebugLog(
        `MQTT doğrulama başladı | IP: ${remoteIp || 'bilinmiyor'} | Client ID: ${client.id || 'bilinmiyor'} | TLS: ${client.conn?.encrypted ? 'evet' : 'hayır'}`
      );
      if (security.isBlacklisted(remoteIp)) {
        addLog('ENGELLENDİ', `Blacklisted IP MQTT bağlantısı reddedildi: ${remoteIp}`);
        callback(null, false);
        return;
      }

      const enteredUsername = username?.toString();
      const enteredPassword = password?.toString();
      const isValid = users.get(enteredUsername) === enteredPassword;

      if (isValid) {
        client.authenticatedUsername = enteredUsername;
        security.clearFailures(remoteIp);
        addDebugLog(`MQTT doğrulama başarılı | IP: ${remoteIp} | Kullanıcı: ${enteredUsername}`);
      } else {
        addDebugLog(`MQTT doğrulama başarısız | IP: ${remoteIp} | Kullanıcı: ${enteredUsername || 'boş'}`);
        const result = security.recordFailure(remoteIp);
        if (result.banned) {
          addLog(
            'BLACKLIST',
            `IP ${result.ip}, ${result.attempts} başarısız girişten sonra ${FAIL2BAN_BAN_TIME_MINUTES} dakika engellendi.`
          );
        }
        addLog('REDDEDİLDİ', `Client ID: ${client.id || 'bilinmiyor'}`);
      }

      callback(null, isValid);
    }
  });

  function publishRelayCommand(target, relays, position) {
    const payload = JSON.stringify({
      type: 'netrelay', command: 'set', targetUsername: target.username,
      relays, position, delay: 0
    });
    return new Promise((resolve, reject) => broker.publish({
      cmd: 'publish', topic: target.commandTopic, payload: Buffer.from(payload),
      qos: 0, retain: false, dup: false
    }, (error) => error ? reject(error) : resolve(payload)));
  }

  scheduledTasks.start(async (task) => {
    const target = [...onlineClients.values()].find((client) => client.username === task.targetUsername);
    if (!target) {
      addLog('ZAMANLAYICI', `“${task.name}” çalışmadı: ${task.targetUsername} çevrimdışı.`);
      setImmediate(broadcastState);
      return 'Hedef cihaz çevrimdışı';
    }
    const oldPositions = task.relays.map((relay) => ({ relay, position: target.relays?.[relay - 1] }));
    const restorable = oldPositions.filter((item) => item.position === 0 || item.position === 1);
    await publishRelayCommand(target, task.relays, task.position);
    addLog('ZAMANLAYICI', `“${task.name}” çalıştı | ${task.targetUsername} | Röle: ${task.relays.join(',')} | Konum: ${task.position}`);
    if (task.restoreSeconds > 0 && restorable.length > 0) {
      setTimeout(() => {
        const currentTarget = [...onlineClients.values()].find((client) => client.username === task.targetUsername);
        if (!currentTarget) return addLog('ZAMANLAYICI', `“${task.name}” geri alma yapılamadı: cihaz çevrimdışı.`);
        for (const position of [0, 1]) {
          const relays = restorable.filter((item) => item.position === position).map((item) => item.relay);
          if (relays.length) publishRelayCommand(currentTarget, relays, position).catch((error) => addLog('HATA', `Zamanlayıcı geri alma: ${error.message}`));
        }
        addLog('ZAMANLAYICI', `“${task.name}” röleleri eski konumuna getirildi.`);
      }, task.restoreSeconds * 1000).unref();
    }
    setImmediate(broadcastState);
    return task.restoreSeconds > 0 && oldPositions.every((item) => item.position !== 0 && item.position !== 1)
      ? 'Çalıştırıldı; eski röle durumu bilinmediği için geri alma atlandı'
      : 'Çalıştırıldı';
  });

  const mqttServer = net.createServer(broker.handle);
  let mqttTlsServer;
  if (MQTT_TLS_ENABLED) {
    if (!process.env.MQTT_TLS_KEY || !process.env.MQTT_TLS_CERT) {
      throw new Error('MQTT TLS için MQTT_TLS_KEY ve MQTT_TLS_CERT zorunludur.');
    }
    if (MQTT_TLS_REQUEST_CLIENT_CERT && !process.env.MQTT_TLS_CA) {
      throw new Error('Karşılıklı TLS için MQTT_TLS_CA zorunludur.');
    }

    const tlsOptions = {
      key: fs.readFileSync(path.resolve(__dirname, process.env.MQTT_TLS_KEY)),
      cert: fs.readFileSync(path.resolve(__dirname, process.env.MQTT_TLS_CERT)),
      minVersion: 'TLSv1.2',
      requestCert: MQTT_TLS_REQUEST_CLIENT_CERT,
      rejectUnauthorized: MQTT_TLS_REQUEST_CLIENT_CERT
    };
    if (process.env.MQTT_TLS_CA) {
      tlsOptions.ca = fs.readFileSync(path.resolve(__dirname, process.env.MQTT_TLS_CA));
    }
    mqttTlsServer = tls.createServer(tlsOptions, broker.handle);
  }
  const app = express();
  const webServer = http.createServer(app);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/login', (request, response) => {
    const user = webAuth.fromRequest(request);
    if (user) return response.redirect(user.mustChangePassword ? '/change-password' : '/');
    response.render('login', { error: '' });
  });
  app.post('/login', (request, response) => {
    const result = webAuth.login(request.body.username, request.body.password);
    if (!result) return response.status(401).render('login', { error: 'Kullanıcı adı veya parola yanlış.' });
    response.setHeader('Set-Cookie', webAuth.cookie(result.token));
    response.redirect(result.user.mustChangePassword ? '/change-password' : '/');
  });
  app.get('/change-password', (request, response) => {
    const user = webAuth.fromRequest(request); if (!user) return response.redirect('/login');
    response.render('change-password', { error: '', user });
  });
  app.post('/change-password', (request, response) => {
    const user = webAuth.fromRequest(request); if (!user) return response.redirect('/login');
    try {
      if (request.body.newPassword !== request.body.confirmPassword) throw new Error('Yeni parola tekrarı eşleşmiyor.');
      webAuth.changePassword(user.id, request.body.currentPassword, request.body.newPassword);
      response.setHeader('Set-Cookie', webAuth.clearCookie); response.redirect('/login?changed=1');
    } catch (error) { response.status(400).render('change-password', { error: error.message, user }); }
  });
  app.post('/logout', (request, response) => {
    webAuth.logout(request); response.setHeader('Set-Cookie', webAuth.clearCookie); response.redirect('/login');
  });
  app.get('/firmware/download/:token', (request, response) => {
    const download = firmwareManager.resolveDownload(request.params.token);
    if (!download) return response.status(404).send('Firmware bağlantısı geçersiz veya süresi dolmuş.');
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', download.size);
    response.setHeader('X-Firmware-SHA256', download.sha256);
    response.sendFile(download.path);
  });
  app.post('/api/firmwares', firmwareUpload.single('firmware'), (request, response) => {
    const user = webAuth.fromRequest(request);
    if (!user || user.mustChangePassword) return response.status(401).json({ error: 'Oturum gerekli.' });
    if (!webAuth.hasPermission(user, 'firmware')) return response.status(403).json({ error: 'Firmware yetkisi gerekli.' });
    try { const id = firmwareManager.addFirmware(request.file, request.body); broadcastState(); response.json({ id, message: 'Firmware yüklendi.' }); }
    catch (error) { response.status(400).json({ error: error.message }); }
  });

  app.get('/', (request, response) => {
    const user = webAuth.fromRequest(request); if (!user) return response.redirect('/login');
    if (user.mustChangePassword) return response.redirect('/change-password');
    response.render('index', {
      onlineClients: Array.from(onlineClients.values()),
      logs,
      mqttAddresses: getLocalIpAddresses().flatMap((ip) => [
        `mqtt://${ip}:${MQTT_PORT}`,
        ...(MQTT_TLS_ENABLED ? [`mqtts://${ip}:${MQTT_TLS_PORT}`] : [])
      ]),
      currentUser: user
    });
  });
  function renderProtectedPage(view, permission) {
    return (request, response) => {
      const user = webAuth.fromRequest(request); if (!user) return response.redirect('/login');
      if (user.mustChangePassword) return response.redirect('/change-password');
      if (!webAuth.hasPermission(user, permission)) return response.status(403).send('Bu sayfaya erişim yetkiniz yok.');
      response.render(view, { currentUser: user });
    };
  }
  app.get('/scheduled-tasks', renderProtectedPage('scheduled-tasks', 'schedules'));
  app.get('/device-io', renderProtectedPage('device-io', 'dashboard'));
  app.get('/firmware-management', renderProtectedPage('firmware-management', 'firmware'));
  app.get('/mqtt-blacklist', renderProtectedPage('mqtt-blacklist', 'blacklist'));
  app.get('/email-notifications', renderProtectedPage('email-notifications', 'email'));
  app.get('/web-users', (request, response) => {
    const user = webAuth.fromRequest(request); if (!user) return response.redirect('/login');
    if (user.mustChangePassword) return response.redirect('/change-password');
    if (user.role !== 'admin') return response.status(403).send('Bu sayfa yalnızca yöneticilere açıktır.');
    response.render('web-users', { currentUser: user });
  });

  wss = new WebSocketServer({ server: webServer, verifyClient(info, done) {
    const user = webAuth.fromRequest(info.req);
    if (!user || user.mustChangePassword) return done(false, 401, 'Oturum gerekli');
    info.req.authUser = user; done(true);
  }});
  wss.on('connection', (socket, request) => {
    socket.authUser = request.authUser;
    socket.publicBaseUrl = `${request.headers['x-forwarded-proto'] || 'http'}://${request.headers.host}`;
    socket.send(JSON.stringify(getState(socket.authUser)));

    socket.on('message', async (rawMessage) => {
      let request;
      try {
        request = JSON.parse(rawMessage.toString());
        const requiredPermissions = {
          publish: 'relay', scheduledTaskSave: 'schedules', scheduledTaskEnabled: 'schedules', scheduledTaskRemove: 'schedules',
          firmwareUpdateStart: 'firmware', firmwareRemove: 'firmware',
          emailSettingsSave: 'email', emailMonitorSave: 'email', emailMonitorEnabled: 'email', emailMonitorRemove: 'email', emailSendTest: 'email',
          blacklistAdd: 'blacklist', blacklistRemove: 'blacklist', debugLoggingSet: 'logs', webUserSave: 'users', webUserRemove: 'users'
        };
        const requiredPermission = requiredPermissions[request.type];
        if (requiredPermission && !webAuth.hasPermission(socket.authUser, requiredPermission)) throw new Error('Bu işlem için yetkiniz yok.');

        if (request.type === 'webUserSave') {
          const id = webAuth.saveUser(request.user || {}, socket.authUser);
          socket.send(JSON.stringify({ type: 'webUserSuccess', message: `Kullanıcı kaydedildi (#${id}).` }));
          broadcastState(); return;
        }
        if (request.type === 'webUserRemove') {
          webAuth.removeUser(request.id, socket.authUser);
          socket.send(JSON.stringify({ type: 'webUserSuccess', message: 'Kullanıcı silindi.' }));
          broadcastState(); return;
        }
        if (request.type === 'firmwareRemove') {
          firmwareManager.removeFirmware(request.id); broadcastState(); return;
        }
        if (request.type === 'firmwareUpdateStart') {
          const ids = [...new Set(Array.isArray(request.targetClientIds) ? request.targetClientIds.map(String) : [String(request.targetClientId || '')])].filter(Boolean);
          if (!ids.length) throw new Error('En az bir hedef cihaz seçin.');
          const targets = ids.map((id) => onlineClients.get(id));
          if (targets.some((target) => !target)) throw new Error('Seçilen cihazlardan biri çevrimdışı.');
          if (new Set(targets.map((target) => target.username)).size !== targets.length) throw new Error('Aynı MQTT kullanıcısına ait birden fazla bağlantı birlikte seçilemez.');
          for (const target of targets) {
            const created = firmwareManager.createJob(request.firmwareId, target);
            const command = JSON.stringify({ type: 'netrelay', command: 'firmware_update', targetUsername: target.username,
              jobId: created.job.id, version: created.firmware.version, hardware: created.firmware.hardware,
              url: `${FIRMWARE_PUBLIC_BASE_URL || socket.publicBaseUrl}/firmware/download/${created.token}`, size: created.firmware.size, sha256: created.firmware.sha256 });
            broker.publish({ cmd: 'publish', topic: target.commandTopic, payload: Buffer.from(command), qos: 1, retain: false, dup: false }, (error) => {
              if (error) firmwareManager.failJob(created.job.id, error.message);
              else addLog('FIRMWARE', `${target.username} için ${created.firmware.version} OTA komutu gönderildi.`);
              broadcastState();
            });
          }
          socket.send(JSON.stringify({ type: 'firmwareSuccess', message: `${targets.length} cihaz için OTA işlemi başlatıldı.` }));
          return;
        }

        if (request.type === 'debugLoggingSet') {
          debugLoggingEnabled = request.enabled === true;
          addLog('SİSTEM', `Ayrıntılı bağlantı logları ${debugLoggingEnabled ? 'açıldı' : 'kapatıldı'}.`);
          return;
        }

        if (request.type === 'blacklistAdd') {
          const ip = security.addManualBan(request.ip, request.reason);
          for (const mqttClient of Object.values(broker.clients)) {
            if (security.normalizeIp(mqttClient.conn?.remoteAddress) === ip) mqttClient.conn?.destroy();
          }
          addLog('BLACKLIST', `IP ${ip} web panelinden manuel engellendi.`);
          socket.send(JSON.stringify({ type: 'blacklistSuccess', message: `IP ${ip} engellendi.` }));
          return;
        }

        if (request.type === 'blacklistRemove') {
          const ip = security.normalizeIp(request.ip);
          if (!security.removeBan(ip)) throw new Error('Blacklist kaydı bulunamadı.');
          addLog('BLACKLIST', `IP ${ip} blacklist listesinden kaldırıldı.`);
          socket.send(JSON.stringify({ type: 'blacklistSuccess', message: `IP ${ip} kaldırıldı.` }));
          return;
        }

        if (request.type === 'scheduledTaskSave') {
          const id = scheduledTasks.save(request.task || {});
          addLog('ZAMANLAYICI', `Zamanlanmış görev kaydedildi: #${id}`);
          socket.send(JSON.stringify({ type: 'scheduledTaskSuccess', message: 'Görev kaydedildi.' }));
          broadcastState();
          return;
        }
        if (request.type === 'scheduledTaskEnabled') {
          scheduledTasks.setEnabled(request.id, request.enabled === true);
          addLog('ZAMANLAYICI', `Görev #${Number(request.id)} ${request.enabled ? 'etkinleştirildi' : 'devre dışı bırakıldı'}.`);
          broadcastState();
          return;
        }
        if (request.type === 'scheduledTaskRemove') {
          scheduledTasks.remove(request.id);
          addLog('ZAMANLAYICI', `Görev #${Number(request.id)} silindi.`);
          broadcastState();
          return;
        }

        if (request.type === 'emailSettingsSave') {
          emailNotifications.saveSettings(request.settings || {});
          socket.send(JSON.stringify({ type: 'emailNotificationSuccess', message: 'E-posta ayarları kaydedildi.' }));
          broadcastState();
          return;
        }
        if (request.type === 'emailMonitorSave') {
          emailNotifications.saveMonitor(request.monitor || {});
          socket.send(JSON.stringify({ type: 'emailNotificationSuccess', message: 'Cihaz izleme ayarı kaydedildi.' }));
          broadcastState();
          return;
        }
        if (request.type === 'emailMonitorEnabled') {
          emailNotifications.setMonitorEnabled(request.username, request.enabled === true);
          broadcastState();
          return;
        }
        if (request.type === 'emailMonitorRemove') {
          emailNotifications.removeMonitor(request.username);
          broadcastState();
          return;
        }
        if (request.type === 'emailSendTest') {
          await emailNotifications.sendTest();
          socket.send(JSON.stringify({ type: 'emailNotificationSuccess', message: 'Test e-postası gönderildi.' }));
          return;
        }

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
        const type = request?.type?.startsWith('blacklist') ? 'blacklistError' : request?.type?.startsWith('scheduledTask') ? 'scheduledTaskError' : request?.type?.startsWith('email') ? 'emailNotificationError' : request?.type?.startsWith('webUser') ? 'webUserError' : request?.type?.startsWith('firmware') ? 'firmwareError' : 'publishError';
        socket.send(JSON.stringify({ type, message: error.message }));
      }
    });
  });

  broker.on('clientReady', (client) => {
    const usernameWasOnline = [...onlineClients.values()].some((item) => item.username === client.authenticatedUsername);
    onlineClients.set(client.id, {
      clientId: client.id,
      username: client.authenticatedUsername,
      commandTopic: `netrelay/${client.authenticatedUsername}/command`,
      remoteIp: security.normalizeIp(client.conn?.remoteAddress),
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
    writeDailyStatusLog('DEVICE_UP', {
      username: client.authenticatedUsername, clientId: client.id,
      remoteIp: security.normalizeIp(client.conn?.remoteAddress)
    });
    if (!usernameWasOnline) emailNotifications.notifyDevice(client.authenticatedUsername, true, {
      clientId: client.id, remoteIp: security.normalizeIp(client.conn?.remoteAddress)
    }).then((sent) => { if (sent) addLog('E-POSTA', `${client.authenticatedUsername} aktif bildirimi gönderildi.`); })
      .catch((error) => addLog('HATA', `Aktif cihaz e-postası gönderilemedi: ${error.message}`));
  });

  broker.on('clientDisconnect', (client) => {
    onlineClients.delete(client.id);
    addLog(
      'KOPTU',
      `Kullanıcı: ${client.authenticatedUsername || 'bilinmiyor'} | Client ID: ${client.id}`
    );
    writeDailyStatusLog('DEVICE_DOWN', {
      username: client.authenticatedUsername || 'bilinmiyor', clientId: client.id,
      remoteIp: security.normalizeIp(client.conn?.remoteAddress)
    });
    const usernameStillOnline = [...onlineClients.values()].some((item) => item.username === client.authenticatedUsername);
    if (!usernameStillOnline) emailNotifications.notifyDevice(client.authenticatedUsername, false, {
      clientId: client.id, remoteIp: security.normalizeIp(client.conn?.remoteAddress)
    }).then((sent) => { if (sent) addLog('E-POSTA', `${client.authenticatedUsername} pasif bildirimi gönderildi.`); })
      .catch((error) => addLog('HATA', `Pasif cihaz e-postası gönderilemedi: ${error.message}`));
  });

  broker.on('publish', (packet, client) => {
    if (!client) return;

    const message = packet.payload.toString();
    const netRelayEvent = parseNetRelayEvent(message, client, packet.topic);
    try {
      const rawEvent = JSON.parse(message);
      if (rawEvent.type === 'netrelay_firmware_status' && firmwareManager.updateJob(rawEvent)) {
        addLog('FIRMWARE', `${client.authenticatedUsername}: ${rawEvent.status} %${Number(rawEvent.progress) || 0} ${rawEvent.message || ''}`);
      }
    } catch {}

    if (netRelayEvent?.type === 'netrelay_device_status') {
      const currentClient = onlineClients.get(client.id);
      if (currentClient) {
        onlineClients.set(client.id, {
          ...currentClient,
          status: 'UP',
          deviceUptimeMs: netRelayEvent.deviceUptimeMs,
          voltage: netRelayEvent.voltage,
          temperature: netRelayEvent.temperature,
          hostname: netRelayEvent.hostname,
          ipAddress: netRelayEvent.ipAddress,
          lastSeenAt: new Date().toLocaleString('tr-TR'),
          relays: netRelayEvent.relays,
          inputs: netRelayEvent.inputs,
          lastJson: message,
          lastEventAt: new Date().toISOString()
        });
        broadcastState();
      }
      console.log(
        `[DEVICE_STATUS] Kullanıcı: ${client.authenticatedUsername} | Client ID: ${client.id} | Uptime: ${netRelayEvent.deviceUptimeMs} ms`
      );
      return;
    }

    if (netRelayEvent?.type === 'netrelay_input_event') {
      const currentClient = onlineClients.get(client.id);
      if (currentClient) {
        const inputs = Array.from({ length: 4 }, (_, index) => currentClient.inputs?.[index] || { input: index + 1, name: `input${index + 1}`, io: null, voltage: 0 });
        inputs[netRelayEvent.input - 1] = { input: netRelayEvent.input, name: netRelayEvent.inputName, io: netRelayEvent.io, voltage: netRelayEvent.voltage };
        onlineClients.set(client.id, { ...currentClient, inputs, lastJson: message, lastEventAt: netRelayEvent.serverReceivedAt, lastSeenAt: new Date().toLocaleString('tr-TR') });
        broadcastState();
      }
    }
    if (netRelayEvent?.type === 'netrelay_relay_event') {
      const currentClient = onlineClients.get(client.id);
      if (currentClient) {
        const relays = Array.isArray(currentClient.relays) ? [...currentClient.relays] : [null, null, null, null];
        relays[netRelayEvent.relay - 1] = netRelayEvent.position;
        onlineClients.set(client.id, { ...currentClient, relays, lastJson: message, lastEventAt: netRelayEvent.serverReceivedAt, lastSeenAt: new Date().toLocaleString('tr-TR') });
        broadcastState();
      }
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
  mqttTlsServer?.on('error', (error) => addLog('HATA', `MQTT TLS: ${error.message}`));
  mqttTlsServer?.on('tlsClientError', (error, socket) => {
    addDebugLog(
      `TLS el sıkışma hatası | IP: ${security.normalizeIp(socket.remoteAddress) || 'bilinmiyor'} | Kod: ${error.code || 'yok'} | Mesaj: ${error.message}`
    );
  });
  mqttTlsServer?.on('secureConnection', (socket) => {
    const cipher = socket.getCipher();
    const peer = socket.getPeerCertificate();
    addDebugLog(
      `TLS el sıkışması başarılı | IP: ${security.normalizeIp(socket.remoteAddress)} | Protokol: ${socket.getProtocol()} | Şifre: ${cipher?.name || 'bilinmiyor'} | İstemci sertifikası: ${peer?.subject?.CN || 'yok'} | Yetkili: ${socket.authorized ? 'evet' : `hayır (${socket.authorizationError || 'neden yok'})`}`
    );
  });
  broker.on('clientError', (client, error) => {
    addDebugLog(`MQTT istemci hatası | Client ID: ${client?.id || 'bilinmiyor'} | Mesaj: ${error.message}`);
  });
  broker.on('connectionError', (client, error) => {
    addDebugLog(`MQTT bağlantı hatası | Client ID: ${client?.id || 'bilinmiyor'} | Mesaj: ${error.message}`);
  });
  webServer.on('error', (error) => addLog('HATA', `Web: ${error.message}`));

  mqttServer.listen(MQTT_PORT, HOST, () => {
    addLog(
      'SİSTEM',
      `MQTT koruması aktif: ${FAIL2BAN_FIND_TIME_MINUTES} dakikada ${FAIL2BAN_MAX_ATTEMPTS} hata, ${FAIL2BAN_BAN_TIME_MINUTES} dakika engel.`
    );
    addLog('SİSTEM', `MQTT server tüm ağlarda çalışıyor: ${HOST}:${MQTT_PORT}`);
    addLog('SİSTEM', `${users.size} kullanıcı users.json dosyasından yüklendi.`);
    for (const ip of getLocalIpAddresses()) {
      addLog('SİSTEM', `MQTT bağlantı adresi: mqtt://${ip}:${MQTT_PORT}`);
    }
  });

  if (mqttTlsServer) {
    mqttTlsServer.listen(MQTT_TLS_PORT, HOST, () => {
      addLog('SİSTEM', `MQTT TLS server çalışıyor: ${HOST}:${MQTT_TLS_PORT} (TLS 1.2+)`);
      addLog(
        'SİSTEM',
        MQTT_TLS_REQUEST_CLIENT_CERT
          ? 'MQTT karşılıklı TLS istemci sertifikası doğrulaması aktif.'
          : 'MQTT TLS aktif; istemci sertifikası doğrulaması kapalı.'
      );
    });
  }

  webServer.listen(WEB_PORT, HOST, () => {
    writeDailyStatusLog('SERVER_UP', { webPort: WEB_PORT, mqttPort: MQTT_PORT, mqttTlsPort: MQTT_TLS_ENABLED ? MQTT_TLS_PORT : null });
    addLog('SİSTEM', `Web paneli tüm ağlarda çalışıyor: ${HOST}:${WEB_PORT}`);
    for (const ip of getLocalIpAddresses()) {
      addLog('SİSTEM', `Web paneli adresi: http://${ip}:${WEB_PORT}`);
    }
  });
}

const blacklistCleanupTimer = setInterval(() => {
  if (security.cleanupExpired() > 0) broadcastState();
}, 60 * 1000);
blacklistCleanupTimer.unref();

function shutdown() {
  writeDailyStatusLog('SERVER_DOWN', { reason: 'controlled_shutdown' });
  clearInterval(blacklistCleanupTimer);
  security.close();
  scheduledTasks.close();
  emailNotifications.close();
  webAuth.close();
  firmwareManager.close();
}

process.once('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.once('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

startServer().catch((error) => {
  console.error('Sunucu başlatılamadı:', error.message);
  process.exitCode = 1;
});
