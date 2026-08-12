const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { applyPendingRestore, createBackup, stageRestore } = require('./backup-manager');
const appliedRestore = applyPendingRestore({ baseDir: __dirname });
require('dotenv').config({ quiet: true });

const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
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
const { createMqttUserStore } = require('./mqtt-users');
const { createHistoryStore } = require('./history-store');
const { createRuleEngine } = require('./rule-engine');
const { createNetgsmStore } = require('./netgsm');
const { createDeviceAutomationStore } = require('./device-automation');
const { createLogRotation } = require('./log-rotation');
const { parseNetRelayEvent } = require('./netrelay-event');
const { parseMpowerEvent, validateMpowerCommand } = require('./mpower-event');
const {
  DEFAULT_DEVICE_TYPE,
  getDeviceType,
  listDeviceTypes,
  commandTopicFor,
  isDeviceTopicAllowed
} = require('./device-types');
const { stateChanges } = require('./state-delta');
const { deviceStateChanges } = require('./device-state-change');
const { createSystemSettings } = require('./system-settings');
const { createApiKeyStore } = require('./api-keys');
const { createHomeAssistantDiscovery } = require('./home-assistant');
const { groupsForKey, usernamesForKey, canAccessUser, canAccessGroup, filterDevices } = require('./api-group-scope');
const { createFirmwareManager, MAX_FIRMWARE_SIZE } = require('./firmware-manager');

const MQTT_PORT = Number(process.env.MQTT_PORT) || 1883;
const WEB_PORT = Number(process.env.WEB_PORT) || 3000;
const WEB_HTTPS_ENABLED = process.env.WEB_HTTPS_ENABLED === '1';
const WEB_HTTPS_PORT = Number(process.env.WEB_HTTPS_PORT) || 3443;
const HOST = process.env.HOST || '0.0.0.0';
const MQTT_TLS_ENABLED = process.env.MQTT_TLS_ENABLED === '1';
const MQTT_TLS_PORT = Number(process.env.MQTT_TLS_PORT) || 8883;
const MQTT_TLS_REQUEST_CLIENT_CERT = process.env.MQTT_TLS_REQUEST_CLIENT_CERT === '1';
// Varsayılan olarak her kullanıcı yalnızca kendi cihaz tipine ait <kök>/<kullanici>/* topic'lerini kullanabilir.
// Mevcut sistemlerde davranışı gevşetmek için MQTT_TOPIC_ENFORCEMENT=0 yapılabilir.
const MQTT_TOPIC_ENFORCEMENT = process.env.MQTT_TOPIC_ENFORCEMENT !== '0';
const FIRMWARE_PUBLIC_BASE_URL = String(process.env.FIRMWARE_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const USERS_FILE = path.join(__dirname, 'users.json');
const STATUS_LOG_DIRECTORY = path.join(__dirname, 'logs');
const MAX_LOGS = 200;
const createCommandId = () => randomUUID();
const DEVICE_STALE_AFTER_MS = (Number(process.env.DEVICE_STALE_AFTER_SECONDS) || 300) * 1000;
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
const mqttUsers = createMqttUserStore({ databasePath: SECURITY_DB_PATH, usersFile: USERS_FILE });
const firmwareManager = createFirmwareManager({ databasePath: SECURITY_DB_PATH, storageDirectory: path.join(__dirname, 'firmware-files') });
const history = createHistoryStore({ databasePath: SECURITY_DB_PATH, retentionDays: Number(process.env.HISTORY_RETENTION_DAYS) || 90 });
const rules = createRuleEngine({ databasePath: SECURITY_DB_PATH });
const netgsm = createNetgsmStore({ databasePath: SECURITY_DB_PATH });
const deviceAutomation = createDeviceAutomationStore({ databasePath: SECURITY_DB_PATH });
const logRotation = createLogRotation({ databasePath: SECURITY_DB_PATH, logDirectory: STATUS_LOG_DIRECTORY });
const systemSettings = createSystemSettings({ databasePath: SECURITY_DB_PATH });
const apiKeys = createApiKeyStore({ databasePath: SECURITY_DB_PATH });
const homeAssistant = createHomeAssistantDiscovery({ databasePath: SECURITY_DB_PATH });
const firmwareUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FIRMWARE_SIZE } });
const backupUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } });

const onlineClients = new Map();
const logs = [];
let wss;
let debugLoggingEnabled = systemSettings.getBoolean('debug_logging_enabled', false);
let consoleLoggingEnabled = systemSettings.getBoolean('console_logging_enabled', true);
let historyStatsCache = { value: history.stats(), updatedAt: Date.now() };

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

function auditSafeDetails(value) {
  const sensitive = /password|parola|secret|token|certificate|privatekey/i;
  if (Array.isArray(value)) return value.map(auditSafeDetails);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? '[GİZLİ]' : auditSafeDetails(item)]));
}

function getLocalIpAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address?.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
}

function legacyParseNetRelayEventRemoved(message, client, topic) {
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

function getState(user) {
  if (Date.now() - historyStatsCache.updatedAt > 30000) historyStatsCache = { value: history.stats(), updatedAt: Date.now() };
  const can = (permission) => webAuth.hasPermission(user, permission);
  return {
    type: 'state',
    onlineClients: can('dashboard') || can('relay') || can('schedules') || can('email') ? Array.from(onlineClients.values()) : [],
    blacklist: can('blacklist') ? security.listBlacklist() : [],
    scheduledTasks: can('schedules') ? scheduledTasks.list() : [],
    scheduledTaskRuns: can('schedules') ? scheduledTasks.listRuns() : [],
    emailNotifications: can('email') ? emailNotifications.getState() : { settings: {}, monitors: [] },
    firmwareManagement: can('firmware') ? firmwareManager.getState() : { firmwares: [], jobs: [], maxFirmwareSize: MAX_FIRMWARE_SIZE },
    debugLoggingEnabled: can('logs') ? debugLoggingEnabled : false,
    consoleLoggingEnabled: can('logs') ? consoleLoggingEnabled : false,
    logs: can('logs') ? logs : [],
    currentUser: user || null,
    webUsers: user?.role === 'admin' ? webAuth.listUsers() : [],
    mqttUsers: user?.role === 'admin' ? mqttUsers.list() : [],
    deviceTypes: listDeviceTypes(),
    permissionDefinitions: webAuth.permissions,
    historyStats: can('dashboard') || can('logs') ? historyStatsCache.value : { events: 0, connections: {}, averageUptimeMs: 0 },
    automationRules: can('schedules') ? rules.list() : [],
    netgsmSettings: can('email') ? netgsm.getState() : {},
    deviceGroups: can('relay') ? deviceAutomation.listGroups() : [],
    commandQueue: can('relay') ? deviceAutomation.listQueue() : [],
    knownMqttUsernames: can('relay') || can('schedules') ? mqttUsers.list().map(x=>x.username) : []
  };
}

function resolveDeviceType(username) {
  return mqttUsers.getByUsername(username)?.deviceType || DEFAULT_DEVICE_TYPE;
}

function broadcastState() {
  if (!wss) return;

  for (const socket of wss.clients) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    const next=getState(socket.authUser),previous=socket.lastStateSnapshot;
    if(!previous){socket.send(JSON.stringify(next));socket.lastStateSnapshot=next;continue;}
    const changes=stateChanges(previous,next);
    if(Object.keys(changes).length)socket.send(JSON.stringify({type:'stateDelta',changes}));
    socket.lastStateSnapshot=next;
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

  if (consoleLoggingEnabled) console.log(`[${type}] ${message}`);
  broadcastState();
}

function addDebugLog(message) {
  if (debugLoggingEnabled) addLog('DEBUG', message);
}

async function startServer() {
  if (appliedRestore) console.log(`[YEDEK] Geri yükleme uygulandı: ${appliedRestore.databaseTarget}`);
  const broker = await Aedes.createBroker({
    authenticate(client, username, password, callback) {
      const remoteIp = security.normalizeIp(client.conn?.remoteAddress) || 'bilinmiyor';
      const clientId = client.id || 'bilinmiyor';
      addDebugLog(
        `MQTT doğrulama başladı | IP: ${remoteIp} | Client ID: ${clientId} | TLS: ${client.conn?.encrypted ? 'evet' : 'hayır'}`
      );
      const ban = security.getBlacklistEntry(remoteIp);
      if (ban) {
        addLog(
          'ENGELLENDİ',
          `MQTT bağlantısı reddedildi | Sebep: blacklist | IP: ${ban.ip} | Blacklist nedeni: ${ban.reason} | Client ID: ${clientId}`
        );
        callback(null, false);
        return;
      }

      const auth = mqttUsers.authenticateResult(username?.toString(), password);
      if (auth.ok) {
        client.authenticatedUsername = auth.username;
        security.clearFailures(remoteIp);
        addDebugLog(`MQTT doğrulama başarılı | IP: ${remoteIp} | Kullanıcı: ${auth.username}`);
      } else {
        const result = security.recordFailure(remoteIp);
        if (result.banned) {
          addLog(
            'BLACKLIST',
            `IP ${result.ip}, ${result.attempts} başarısız girişten sonra ${FAIL2BAN_BAN_TIME_MINUTES} dakika engellendi.`
          );
        }
        addLog(
          'REDDEDİLDİ',
          `MQTT kimlik doğrulama reddedildi | Sebep: ${auth.reason} | Kullanıcı: ${auth.username || username?.toString() || 'boş'} | IP: ${remoteIp} | Client ID: ${clientId} | Deneme: ${result.attempts}/${FAIL2BAN_MAX_ATTEMPTS}`
        );
      }

      callback(null, auth.ok);
    },

    authorizePublish(client, packet, callback) {
      if (packet.topic.startsWith('$SYS/')) {
        addLog(
          'YETKİ',
          `Yayın reddedildi | Sebep: $SYS topic alanı ayrılmıştır | Kullanıcı: ${client?.authenticatedUsername || client?.id || 'bilinmiyor'} | Topic: ${packet.topic}`
        );
        return callback(new Error('$SYS topic alanı ayrılmıştır.'));
      }
      if (client && MQTT_TOPIC_ENFORCEMENT) {
        const username = client.authenticatedUsername;
        const ha=homeAssistant.get(),isHomeAssistant=ha.enabled&&username?.toLowerCase()===ha.mqttUsername.toLowerCase();
        if(isHomeAssistant&&/^netrelay\/[^/]+\/command$/.test(packet.topic))return callback(null);
        const deviceType = username ? resolveDeviceType(username) : null;
        const typeMeta = deviceType ? getDeviceType(deviceType) : null;
        const expected = username && typeMeta ? `${typeMeta.topicRoot}/${username}/#` : 'cihaz tipine özel topic';
        if (!username || !isDeviceTopicAllowed(deviceType, username, packet.topic)) {
          addLog(
            'YETKİ',
            `Yayın reddedildi | Sebep: topic yetkisi yok | Kullanıcı: ${username || client.id || 'bilinmiyor'} | Tip: ${typeMeta?.label || 'bilinmiyor'} | Topic: ${packet.topic} | Beklenen: ${expected}`
          );
          return callback(new Error('Bu topic için yayın yetkiniz yok.'));
        }
      }
      callback(null);
    },

    authorizeSubscribe(client, subscription, callback) {
      if (client && MQTT_TOPIC_ENFORCEMENT) {
        const username = client.authenticatedUsername;
        const ha=homeAssistant.get(),isHomeAssistant=ha.enabled&&username?.toLowerCase()===ha.mqttUsername.toLowerCase();
        if(isHomeAssistant&&(subscription.topic===`${ha.prefix}/#`||subscription.topic==='netrelay/+/events'||subscription.topic==='mpower/+/state'||subscription.topic==='mpower/+/outlet/+/json'))return callback(null,subscription);
        const deviceType = username ? resolveDeviceType(username) : null;
        const typeMeta = deviceType ? getDeviceType(deviceType) : null;
        const expected = username && typeMeta ? `${typeMeta.topicRoot}/${username}/#` : 'cihaz tipine özel topic';
        const allowed = username && isDeviceTopicAllowed(deviceType, username, subscription.topic);
        if (!allowed) {
          addLog(
            'YETKİ',
            `Abonelik reddedildi | Sebep: topic yetkisi yok | Kullanıcı: ${username || client.id || 'bilinmiyor'} | Tip: ${typeMeta?.label || 'bilinmiyor'} | Topic: ${subscription.topic} | Beklenen: ${expected}`
          );
          return callback(null, null);
        }
        return callback(null, subscription);
      }
      callback(null, subscription);
    }
  });

  function disconnectMqttUser(username) {
    for (const client of Object.values(broker.clients)) {
      if (client.authenticatedUsername?.toLowerCase() === String(username).toLowerCase()) client.conn?.destroy();
    }
  }

  function publishMqttJson(topic, payload) {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return new Promise((resolve, reject) => broker.publish({
      cmd: 'publish', topic, payload: Buffer.from(body),
      qos: 1, retain: false, dup: false
    }, (error) => error ? reject(error) : resolve(body)));
  }

  function publishMpowerCommand(target, command) {
    const validated = validateMpowerCommand(command);
    if (!validated.ok) return Promise.reject(new Error(validated.error));
    return publishMqttJson(target.commandTopic, validated.command);
  }

  async function publishRelayCommand(target, relays, position, delay = 0) {
    if (target.deviceType === 'netrelay_mp') {
      const payloads = [];
      for (const port of [...new Set(relays)]) {
        const command = delay > 0
          ? { action: 'pulse', port, delay, to: position }
          : { action: position === 1 ? 'on' : 'off', port };
        payloads.push(await publishMpowerCommand(target, command));
      }
      return payloads[payloads.length - 1];
    }
    const payload = {
      type: 'netrelay', command: 'set', commandId: createCommandId(), targetUsername: target.username,
      relays, position, delay
    };
    return publishMqttJson(target.commandTopic, payload);
  }

  async function publishHomeAssistantDiscovery(username){
    if (resolveDeviceType(username) !== 'netrelay') return;
    for(const item of homeAssistant.messages(username)){
      await new Promise((resolve,reject)=>broker.publish({cmd:'publish',topic:item.topic,payload:Buffer.from(JSON.stringify(item.payload)),qos:1,retain:true,dup:false},error=>error?reject(error):resolve()));
    }
  }

  const ruleMessage = (template, rule, event) => String(template || 'NetRelay kuralı tetiklendi: {{rule}} / {{device}}')
    .replaceAll('{{rule}}', rule.name).replaceAll('{{device}}', event.mqttUsername || event.username || '')
    .replaceAll('{{value}}', String(event.io ?? event.temperature ?? event.voltage ?? ''))
    .replaceAll('{{time}}', new Date().toLocaleString('tr-TR'));
  async function executeMatchingRules(event) {
    for (const rule of rules.matching(event)) {
      rules.mark(rule.id, 'Çalışıyor');
      try {
        const results = [], errors = [];
        for (const action of rule.actions) {
          try {
            if (action.type === 'relay') {
              const target = [...onlineClients.values()].find((item) => item.username.toLowerCase() === action.targetUsername.toLowerCase());
              if (!target) throw new Error(`Hedef cihaz çevrimdışı: ${action.targetUsername}`);
              await publishRelayCommand(target, action.relays, action.position, action.delay); results.push('röle');
            } else if (action.type === 'email') {
              await emailNotifications.sendRule(action.recipients, ruleMessage(action.subject || `NetRelay kuralı: ${rule.name}`, rule, event), ruleMessage(action.message, rule, event)); results.push('e-posta');
            } else if (action.type === 'sms') {
              await netgsm.send(action.recipients, ruleMessage(action.message, rule, event)); results.push('SMS');
            }
          } catch (error) { errors.push(`${action.type}: ${error.message}`); }
        }
        const summary = `${results.length ? `Başarılı: ${results.join(', ')}` : ''}${errors.length ? `${results.length ? ' | ' : ''}Hata: ${errors.join('; ')}` : ''}`;
        rules.mark(rule.id, summary); addLog(errors.length ? 'HATA' : 'KURAL', `${rule.name}: ${summary}`);
      } catch (error) { rules.mark(rule.id, `Hata: ${error.message}`); addLog('HATA', `Kural “${rule.name}”: ${error.message}`); }
      broadcastState();
    }
  }

  async function deliverQueuedCommands(target) {
    for (const queued of deviceAutomation.pending(target.username)) {
      try {
        let queuedPayload={...queued.payload,commandId:queued.payload.commandId||createCommandId()};
        if (target.deviceType === 'netrelay_mp' && queuedPayload.type === 'netrelay' && queuedPayload.command === 'set') {
          const relays = Array.isArray(queuedPayload.relays) ? queuedPayload.relays : [];
          for (const port of relays) {
            const command = queuedPayload.delay > 0
              ? { action: 'pulse', port, delay: queuedPayload.delay, to: queuedPayload.position }
              : { action: queuedPayload.position === 1 ? 'on' : 'off', port };
            await publishMpowerCommand(target, command);
          }
        } else {
          await publishMqttJson(target.commandTopic, queuedPayload);
        }
        deviceAutomation.markDelivered(queued.id); addLog('KUYRUK', `${target.username} için kuyruktaki #${queued.id} komutu gönderildi.`);
      } catch(error){deviceAutomation.markFailed(queued.id,error.message);addLog('HATA',`Kuyruk #${queued.id}: ${error.message}`);break;}
    }
    broadcastState();
  }

  scheduledTasks.start(async (task) => {
    const target = [...onlineClients.values()].find((client) => client.username === task.targetUsername);
    if (!target) {
      if(task.runWhenOnline){const payload={type:'netrelay',command:'set',targetUsername:task.targetUsername,relays:task.relays,position:task.position,delay:task.restoreSeconds};const id=deviceAutomation.enqueue(task.targetUsername,payload,`schedule:${task.id}`);addLog('KUYRUK',`“${task.name}” çevrimdışı cihaz için kuyruğa alındı (#${id}).`);return `Kuyruğa alındı (#${id})`;}
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
  let webServer;
  if (WEB_HTTPS_ENABLED) {
    if (!process.env.WEB_HTTPS_KEY || !process.env.WEB_HTTPS_CERT) {
      throw new Error('WEB_HTTPS_ENABLED=1 için WEB_HTTPS_KEY ve WEB_HTTPS_CERT zorunludur.');
    }
    webServer = https.createServer({
      key: fs.readFileSync(path.resolve(__dirname, process.env.WEB_HTTPS_KEY)),
      cert: fs.readFileSync(path.resolve(__dirname, process.env.WEB_HTTPS_CERT)),
      minVersion: 'TLSv1.2',
      ...(process.env.WEB_HTTPS_CA ? { ca: fs.readFileSync(path.resolve(__dirname, process.env.WEB_HTTPS_CA)) } : {})
    }, app);
  } else {
    webServer = http.createServer(app);
  }

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use('/vendor/sweetalert2',express.static(path.join(__dirname,'node_modules','sweetalert2','dist')));
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/favicon.ico', (request, response) => response.redirect(301, '/favicon.svg'));

  app.get('/login', (request, response) => {
    const user = webAuth.fromRequest(request);
    if (user) return response.redirect(user.mustChangePassword ? '/change-password' : '/');
    response.render('login', { error: '' });
  });
  app.post('/login', (request, response) => {
    const result = webAuth.login(request.body.username, request.body.password, request.socket?.remoteAddress);
    if (!result.ok) {
      addLog(
        'GİRİŞ',
        `Web paneli girişi reddedildi | Sebep: ${result.message || (result.locked ? 'IP kilitli' : 'kullanıcı adı veya parola yanlış')} | Kullanıcı: ${String(request.body.username || '').trim() || 'boş'} | IP: ${security.normalizeIp(request.socket?.remoteAddress) || 'bilinmiyor'}`
      );
      return response.status(result.locked ? 429 : 401)
        .render('login', { error: result.message || 'Kullanıcı adı veya parola yanlış.' });
    }
    addLog('GİRİŞ', `Web paneli girişi | Kullanıcı: ${result.user.username} | IP: ${security.normalizeIp(request.socket?.remoteAddress) || 'bilinmiyor'}`);
    const secureCookie = request.socket.encrypted || String(request.headers['x-forwarded-proto']).split(',')[0].trim() === 'https';
    response.setHeader('Set-Cookie', webAuth.cookie(result.token, secureCookie));
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
  app.get('/history',(request,response)=>{const user=webAuth.fromRequest(request);if(!user)return response.redirect('/login');if(user.mustChangePassword)return response.redirect('/change-password');if(!webAuth.hasPermission(user,'logs'))return response.status(403).send('Bu sayfaya erişim yetkiniz yok.');response.render('history',{currentUser:user,mqttUsernames:mqttUsers.list().map(x=>x.username).sort((a,b)=>a.localeCompare(b,'tr'))});});
  app.get('/automation-rules', renderProtectedPage('automation-rules', 'schedules'));
  app.get('/device-groups', renderProtectedPage('device-groups', 'relay'));
  app.get('/sms-settings', renderProtectedPage('sms-settings', 'email'));
  app.get('/backup-restore', (request,response)=>{const user=webAuth.fromRequest(request);if(!user)return response.redirect('/login');if(user.mustChangePassword)return response.redirect('/change-password');if(user.role!=='admin')return response.status(403).send('Bu sayfa yalnızca yöneticilere açıktır.');response.render('backup-restore',{currentUser:user});});
  const requireAdminApi=(request,response,next)=>{const user=webAuth.fromRequest(request);if(!user||user.mustChangePassword)return response.status(401).json({error:'Oturum gerekli.'});if(user.role!=='admin')return response.status(403).json({error:'Yönetici yetkisi gerekli.'});request.authUser=user;next();};
  app.get('/api-keys',requireAdminApi,(request,response)=>response.render('api-keys',{currentUser:request.authUser}));
  app.get('/api/api-keys',requireAdminApi,(request,response)=>response.json({keys:apiKeys.list(),groups:deviceAutomation.listGroups(),homeAssistant:homeAssistant.get()}));
  app.post('/api/api-keys',requireAdminApi,express.json(),(request,response)=>{try{const allowedGroupIds=[...new Set((request.body.allowedGroupIds||[]).map(Number))];if(!allowedGroupIds.length)throw new Error('En az bir cihaz grubu seçin.');const existingIds=new Set(deviceAutomation.listGroups().map(x=>x.id));if(allowedGroupIds.some(id=>!existingIds.has(id)))throw new Error('Seçilen cihaz gruplarından biri bulunamadı.');const key=apiKeys.create({...request.body,allowedGroupIds});history.addAudit({actor:request.authUser.username,action:'apiKeyCreate',target:key.name,remoteIp:security.normalizeIp(request.socket?.remoteAddress),details:{scopes:key.scopes,allowedGroupIds:key.allowedGroupIds}});response.status(201).json({key,message:'API anahtarı oluşturuldu. Bu değer tekrar gösterilmeyecek.'});}catch(error){response.status(400).json({error:error.message});}});
  app.delete('/api/api-keys/:id',requireAdminApi,(request,response)=>{try{apiKeys.remove(request.params.id);history.addAudit({actor:request.authUser.username,action:'apiKeyRemove',target:String(request.params.id),remoteIp:security.normalizeIp(request.socket?.remoteAddress)});response.json({message:'API anahtarı silindi.'});}catch(error){response.status(404).json({error:error.message});}});
  app.put('/api/home-assistant',requireAdminApi,express.json(),async(request,response)=>{try{const settings=homeAssistant.save(request.body||{});if(settings.enabled)for(const user of mqttUsers.list())await publishHomeAssistantDiscovery(user.username);history.addAudit({actor:request.authUser.username,action:'homeAssistantDiscoverySave',remoteIp:security.normalizeIp(request.socket?.remoteAddress),details:settings});response.json({settings,message:'Home Assistant Discovery ayarları kaydedildi.'});}catch(error){response.status(400).json({error:error.message});}});

  const apiUsage=new Map();
  function requireApiScope(scope){return(request,response,next)=>{
    const authorization=String(request.headers.authorization||''),token=authorization.startsWith('Bearer ')?authorization.slice(7).trim():String(request.headers['x-api-key']||''),key=apiKeys.authenticate(token);
    const remoteIp=security.normalizeIp(request.socket?.remoteAddress)||'bilinmiyor';
    if(!key){
      addLog('API',`REST isteği reddedildi | Sebep: geçersiz API anahtarı | Scope: ${scope} | Yol: ${request.method} ${request.path} | IP: ${remoteIp}`);
      return response.status(401).json({error:'Geçerli Bearer API anahtarı gerekli.',code:'INVALID_API_KEY'});
    }
    if(!key.scopes.includes(scope)&&!(scope==='read'&&key.scopes.includes('control'))){
      addLog('API',`REST isteği reddedildi | Sebep: yetersiz yetki (${scope}) | Anahtar: ${key.name} | Yol: ${request.method} ${request.path} | IP: ${remoteIp}`);
      return response.status(403).json({error:`${scope} API yetkisi gerekli.`,code:'INSUFFICIENT_SCOPE'});
    }
    const now=Date.now(),usage=apiUsage.get(key.id)||{start:now,count:0};if(now-usage.start>=60000){usage.start=now;usage.count=0;}usage.count++;apiUsage.set(key.id,usage);response.setHeader('X-RateLimit-Limit','120');response.setHeader('X-RateLimit-Remaining',String(Math.max(0,120-usage.count)));if(usage.count>120){
      addLog('API',`REST isteği reddedildi | Sebep: rate limit | Anahtar: ${key.name} | Yol: ${request.method} ${request.path} | IP: ${remoteIp}`);
      return response.status(429).json({error:'Dakikalık API istek sınırı aşıldı.',code:'RATE_LIMITED'});
    }
    request.apiKey=key;
    if(request.params.username&&!apiCanAccessUser(key,request.params.username)){
      addLog('API',`REST isteği reddedildi | Sebep: cihaz grubu kapsamı dışı | Anahtar: ${key.name} | Cihaz: ${request.params.username} | Yol: ${request.method} ${request.path} | IP: ${remoteIp}`);
      return response.status(404).json({error:'Cihaz bulunamadı.',code:'DEVICE_NOT_FOUND'});
    }
    if(request.params.id&&request.path.startsWith('/api/v1/device-groups/')&&!apiCanAccessGroup(key,request.params.id)){
      addLog('API',`REST isteği reddedildi | Sebep: grup kapsamı dışı | Anahtar: ${key.name} | Grup: ${request.params.id} | Yol: ${request.method} ${request.path} | IP: ${remoteIp}`);
      return response.status(404).json({error:'Cihaz grubu bulunamadı.',code:'GROUP_NOT_FOUND'});
    }
    const groupDefinitionMutation=(request.method==='POST'&&request.path==='/api/v1/device-groups')||(['PUT','DELETE'].includes(request.method)&&/^\/api\/v1\/device-groups\/\d+$/.test(request.path));
    if(key.allowedGroupIds.length&&groupDefinitionMutation){
      addLog('API',`REST isteği reddedildi | Sebep: grup tanımı kilitli | Anahtar: ${key.name} | Yol: ${request.method} ${request.path} | IP: ${remoteIp}`);
      return response.status(403).json({error:'Grup kapsamlı API anahtarları grup tanımını değiştiremez.',code:'GROUP_SCOPE_LOCKED'});
    }
    next();
  };}
  const apiGroupsFor=key=>groupsForKey(key,deviceAutomation.listGroups());
  const apiUsernamesFor=key=>usernamesForKey(key,deviceAutomation.listGroups());
  const apiCanAccessUser=(key,username)=>canAccessUser(key,deviceAutomation.listGroups(),username);
  const apiCanAccessGroup=(key,id)=>canAccessGroup(key,deviceAutomation.listGroups(),id);
  app.use('/api/v1',express.json({limit:'64kb'}));
  app.get('/api/v1/health',(request,response)=>response.json({status:'ok',time:new Date().toISOString(),version:require('./package.json').version}));
  app.get('/api/v1/devices',requireApiScope('read'),(request,response)=>{const devices=filterDevices(request.apiKey,deviceAutomation.listGroups(),[...onlineClients.values()]);response.json({devices:devices.map(({commandTopic,lastJson,...device})=>device)});});
  app.get('/api/v1/devices/:username',requireApiScope('read'),(request,response)=>{if(!apiCanAccessUser(request.apiKey,request.params.username))return response.status(404).json({error:'Cihaz bulunamadı.',code:'DEVICE_NOT_FOUND'});const device=[...onlineClients.values()].find(x=>x.username.toLowerCase()===request.params.username.toLowerCase());if(!device)return response.status(404).json({error:'Cihaz çevrimiçi değil.',code:'DEVICE_OFFLINE'});const{commandTopic,lastJson,...safe}=device;response.json({device:safe});});
  app.get('/api/v1/history',requireApiScope('read'),(request,response)=>{const allowed=apiUsernamesFor(request.apiKey),asked=(Array.isArray(request.query.username)?request.query.username:request.query.username?[request.query.username]:[...allowed]).filter(x=>allowed.has(String(x).toLowerCase()));if(!asked.length)return response.json({events:[]});response.json({events:history.listEvents({usernames:asked,type:request.query.type,limit:request.query.limit})});});
  app.get('/api/v1/device-groups',requireApiScope('read'),(request,response)=>response.json({groups:apiGroupsFor(request.apiKey)}));
  app.get('/api/v1/device-groups/:id',requireApiScope('read'),(request,response)=>{if(!apiCanAccessGroup(request.apiKey,request.params.id))return response.status(404).json({error:'Cihaz grubu bulunamadı.',code:'GROUP_NOT_FOUND'});const group=deviceAutomation.listGroups().find(x=>x.id===Number(request.params.id));if(!group)return response.status(404).json({error:'Cihaz grubu bulunamadı.',code:'GROUP_NOT_FOUND'});response.json({group});});
  app.post('/api/v1/device-groups',requireApiScope('control'),(request,response)=>{try{const id=deviceAutomation.saveGroup(request.body||{}),group=deviceAutomation.listGroups().find(x=>x.id===id);history.addAudit({actor:`api:${request.apiKey.name}`,action:'apiDeviceGroupCreate',target:String(id),remoteIp:security.normalizeIp(request.socket?.remoteAddress),details:{name:group.name,members:group.members}});response.status(201).json({group});}catch(error){response.status(400).json({error:error.message,code:'INVALID_GROUP'});}});
  app.put('/api/v1/device-groups/:id',requireApiScope('control'),(request,response)=>{try{const id=deviceAutomation.saveGroup({...request.body,id:Number(request.params.id)}),group=deviceAutomation.listGroups().find(x=>x.id===id);history.addAudit({actor:`api:${request.apiKey.name}`,action:'apiDeviceGroupUpdate',target:String(id),remoteIp:security.normalizeIp(request.socket?.remoteAddress),details:{name:group.name,members:group.members}});response.json({group});}catch(error){response.status(/bulunamadı/i.test(error.message)?404:400).json({error:error.message,code:/bulunamadı/i.test(error.message)?'GROUP_NOT_FOUND':'INVALID_GROUP'});}});
  app.delete('/api/v1/device-groups/:id',requireApiScope('control'),(request,response)=>{try{deviceAutomation.removeGroup(request.params.id);history.addAudit({actor:`api:${request.apiKey.name}`,action:'apiDeviceGroupRemove',target:String(request.params.id),remoteIp:security.normalizeIp(request.socket?.remoteAddress)});response.status(204).end();}catch(error){response.status(404).json({error:error.message,code:'GROUP_NOT_FOUND'});}});
  app.post('/api/v1/device-groups/:id/relays',requireApiScope('control'),async(request,response)=>{try{const group=deviceAutomation.listGroups().find(x=>x.id===Number(request.params.id));if(!group)return response.status(404).json({error:'Cihaz grubu bulunamadı.',code:'GROUP_NOT_FOUND'});const relays=[...new Set((request.body.relays||[]).map(Number))],position=Number(request.body.position),delay=Number(request.body.delay||0),queueOffline=request.body.queueOffline===true;if(!relays.length||relays.some(x=>!Number.isInteger(x)||x<1||x>4)||![0,1].includes(position)||!Number.isInteger(delay)||delay<0||delay>4294967)return response.status(400).json({error:'Grup röle komutu geçersiz.',code:'INVALID_COMMAND'});const results=[];for(const username of group.members){const target=[...onlineClients.values()].find(x=>x.username.toLowerCase()===username.toLowerCase());if(target){await publishRelayCommand(target,relays,position,delay);results.push({username,status:'sent'});}else if(queueOffline){const commandId=createCommandId(),queueId=deviceAutomation.enqueue(username,{type:'netrelay',command:'set',commandId,targetUsername:username,relays,position,delay},`api-group:${group.id}`);results.push({username,status:'queued',queueId});}else results.push({username,status:'offline'});}history.addAudit({actor:`api:${request.apiKey.name}`,action:'apiDeviceGroupRelayCommand',target:String(group.id),remoteIp:security.normalizeIp(request.socket?.remoteAddress),details:{relays,position,delay,queueOffline,results}});broadcastState();response.status(202).json({accepted:true,group:{id:group.id,name:group.name},summary:{sent:results.filter(x=>x.status==='sent').length,queued:results.filter(x=>x.status==='queued').length,offline:results.filter(x=>x.status==='offline').length},results});}catch(error){response.status(500).json({error:error.message,code:'PUBLISH_FAILED'});}});
  app.post('/api/v1/devices/:username/relays',requireApiScope('control'),async(request,response)=>{try{const target=[...onlineClients.values()].find(x=>x.username.toLowerCase()===request.params.username.toLowerCase());if(!target)return response.status(409).json({error:'Cihaz çevrimdışı.',code:'DEVICE_OFFLINE'});const relays=[...new Set((request.body.relays||[]).map(Number))],position=Number(request.body.position),delay=Number(request.body.delay||0);if(!relays.length||relays.some(x=>!Number.isInteger(x)||x<1||x>32)||![0,1].includes(position)||!Number.isInteger(delay)||delay<0||delay>4294967)return response.status(400).json({error:'Röle komutu geçersiz.',code:'INVALID_COMMAND'});if(target.deviceType==='netrelay'&&relays.some(x=>x>4))return response.status(400).json({error:'NetRelay röleleri 1..4 olmalıdır.',code:'INVALID_COMMAND'});const payload=await publishRelayCommand(target,relays,position,delay);history.addAudit({actor:`api:${request.apiKey.name}`,action:'apiRelayCommand',target:target.username,remoteIp:security.normalizeIp(request.socket?.remoteAddress),details:{relays,position,delay,deviceType:target.deviceType}});response.status(202).json({accepted:true,commandTopic:target.commandTopic,payload});}catch(error){response.status(400).json({error:error.message,code:'COMMAND_FAILED'});}});
  app.post('/api/v1/devices/:username/mpower',requireApiScope('control'),async(request,response)=>{try{const target=[...onlineClients.values()].find(x=>x.username.toLowerCase()===request.params.username.toLowerCase());if(!target)return response.status(409).json({error:'Cihaz çevrimdışı.',code:'DEVICE_OFFLINE'});if(target.deviceType!=='netrelay_mp')return response.status(400).json({error:'Hedef cihaz NetRelayMP değil.',code:'INVALID_DEVICE_TYPE'});const payload=await publishMpowerCommand(target,request.body||{});history.addAudit({actor:`api:${request.apiKey.name}`,action:'apiMpowerCommand',target:target.username,remoteIp:security.normalizeIp(request.socket?.remoteAddress),details:JSON.parse(payload)});response.status(202).json({accepted:true,commandTopic:target.commandTopic,payload:JSON.parse(payload)});}catch(error){response.status(400).json({error:error.message,code:'COMMAND_FAILED'});}});
  app.post('/api/v1/devices/:username/:action',requireApiScope('control'),async(request,response)=>{try{if(!['restart','sync'].includes(request.params.action))return response.status(404).json({error:'API işlemi bulunamadı.',code:'NOT_FOUND'});const target=[...onlineClients.values()].find(x=>x.username.toLowerCase()===request.params.username.toLowerCase());if(!target)return response.status(409).json({error:'Cihaz çevrimdışı.',code:'DEVICE_OFFLINE'});const type=getDeviceType(target.deviceType);if(request.params.action==='restart'&&!type.supportsRestart)return response.status(400).json({error:`${type.label} yeniden başlatmayı desteklemiyor.`,code:'UNSUPPORTED'});if(request.params.action==='sync'&&!type.supportsSync)return response.status(400).json({error:`${type.label} sync komutunu desteklemiyor.`,code:'UNSUPPORTED'});const payload={type:'netrelay',command:request.params.action,commandId:createCommandId(),targetUsername:target.username};await publishMqttJson(target.commandTopic,payload);history.addAudit({actor:`api:${request.apiKey.name}`,action:`apiDevice${request.params.action}`,target:target.username,remoteIp:security.normalizeIp(request.socket?.remoteAddress)});response.status(202).json({accepted:true,commandTopic:target.commandTopic,payload});}catch(error){response.status(400).json({error:error.message,code:'COMMAND_FAILED'});}});
  app.get('/log-rotation',requireAdminApi,(request,response)=>response.render('log-rotation',{currentUser:request.authUser}));
  app.get('/api/log-rotation',requireAdminApi,(request,response)=>response.json(logRotation.getSettings()));
  app.put('/api/log-rotation',requireAdminApi,express.json(),(request,response)=>{try{const settings=logRotation.saveSettings(request.body||{});history.addAudit({actor:request.authUser.username,action:'logRotationSettingsSave',remoteIp:security.normalizeIp(request.socket?.remoteAddress),details:settings});response.json({message:'Log rotasyonu ayarları kaydedildi.',settings});}catch(error){response.status(400).json({error:error.message});}});
  app.post('/api/log-rotation/run',requireAdminApi,(request,response)=>{try{const result=logRotation.run(true);history.addAudit({actor:request.authUser.username,action:'logRotationRun',remoteIp:security.normalizeIp(request.socket?.remoteAddress),details:result});response.json({message:`Rotasyon tamamlandı: ${result.archived} dosya arşivlendi, ${result.deleted} dosya silindi.`,result});}catch(error){response.status(500).json({error:error.message});}});
  app.get('/api/backup',requireAdminApi,async(request,response)=>{try{const buffer=await createBackup({databasePath:SECURITY_DB_PATH,envPath:path.join(__dirname,'.env')});history.addAudit({actor:request.authUser.username,action:'backupDownload',remoteIp:security.normalizeIp(request.socket?.remoteAddress)});response.setHeader('Content-Type','application/gzip');response.setHeader('Content-Disposition',`attachment; filename="netrelay-backup-${localDateKey()}.netrelay-backup.gz"`);response.send(buffer);}catch(error){response.status(500).json({error:error.message});}});
  app.post('/api/restore',requireAdminApi,backupUpload.single('backup'),(request,response)=>{try{if(!request.file)throw new Error('Yedek dosyası seçilmedi.');if(SECURITY_DB_PATH===':memory:')throw new Error('Bellek içi veritabanına geri yükleme yapılamaz.');const result=stageRestore({buffer:request.file.buffer,baseDir:__dirname,databaseTarget:SECURITY_DB_PATH,envTarget:path.join(__dirname,'.env'),restoreEnv:request.body.restoreEnv!=='false'});history.addAudit({actor:request.authUser.username,action:'restoreStaged',remoteIp:security.normalizeIp(request.socket?.remoteAddress),details:{backupCreatedAt:result.createdAt,restoreEnv:result.restoreEnv}});response.json({message:'Yedek doğrulandı ve geri yükleme için hazırlandı. Sunucuyu yeniden başlatın.',restartRequired:true,...result});}catch(error){response.status(400).json({error:error.message});}});
  function historyApi(request, response, next) {
    const user = webAuth.fromRequest(request);
    if (!user || user.mustChangePassword) return response.status(401).json({ error: 'Oturum gerekli.' });
    if (!webAuth.hasPermission(user, 'logs')) return response.status(403).json({ error: 'Geçmiş kayıtlarını görüntüleme yetkiniz yok.' });
    request.authUser = user; next();
  }
  const historyQuery = (query) => ({ usernames: Array.isArray(query.username) ? query.username : query.username ? [query.username] : [], type: query.type,
    from: query.from ? Date.parse(query.from) : undefined, to: query.to ? Date.parse(query.to) + 86399999 : undefined,
    limit: query.limit });
  app.get('/api/history', historyApi, (request, response) => {
    const query = historyQuery(request.query);
    response.json({ events: history.listEvents(query), connections: history.listConnections({ ...query, type: undefined }),
      audit: history.listAudit({ actor: request.query.actor, from: query.from, to: query.to, limit: query.limit }), stats: history.stats() });
  });
  app.get('/api/history/events.csv', historyApi, (request, response) => {
    const columns = ['occurred_at','event_type','username','client_id','channel','value','hostname','ip_address','uptime_ms','payload'];
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = history.listEvents({ ...historyQuery(request.query), limit: 2000 });
    const csv = ['Zaman,Tür,Kullanıcı,Client ID,Kanal,Değer,Hostname,IP,Uptime (ms),Payload',
      ...rows.map((row) => columns.map((column) => escape(column === 'occurred_at' ? new Date(row[column]).toISOString() : row[column])).join(','))].join('\r\n');
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="netrelay-events-${localDateKey()}.csv"`);
    response.send(`\uFEFF${csv}`);
  });
  app.get('/web-users', (request, response) => {
    const user = webAuth.fromRequest(request); if (!user) return response.redirect('/login');
    if (user.mustChangePassword) return response.redirect('/change-password');
    if (user.role !== 'admin') return response.status(403).send('Bu sayfa yalnızca yöneticilere açıktır.');
    response.render('web-users', { currentUser: user });
  });
  app.get('/mqtt-users', (request, response) => {
    const user = webAuth.fromRequest(request); if (!user) return response.redirect('/login');
    if (user.mustChangePassword) return response.redirect('/change-password');
    if (user.role !== 'admin') return response.status(403).send('Bu sayfa yalnızca yöneticilere açıktır.');
    response.render('mqtt-users', { currentUser: user });
  });

  wss = new WebSocketServer({ server: webServer, verifyClient(info, done) {
    const user = webAuth.fromRequest(info.req);
    if (!user || user.mustChangePassword) return done(false, 401, 'Oturum gerekli');
    info.req.authUser = user; done(true);
  }});
  wss.on('connection', (socket, request) => {
    socket.authUser = request.authUser;
    socket.publicBaseUrl = `${request.headers['x-forwarded-proto'] || (request.socket.encrypted ? 'https' : 'http')}://${request.headers.host}`;
    socket.remoteIp = security.normalizeIp(request.socket?.remoteAddress);
    const initialState=getState(socket.authUser);
    socket.send(JSON.stringify(initialState));
    socket.lastStateSnapshot=initialState;

    socket.on('message', async (rawMessage) => {
      let request;
      try {
        request = JSON.parse(rawMessage.toString());
        const requiredPermissions = {
          publish: 'relay', restartDevice: 'relay', syncDevice: 'dashboard', scheduledTaskSave: 'schedules', scheduledTaskEnabled: 'schedules', scheduledTaskRemove: 'schedules',
          firmwareUpdateStart: 'firmware', firmwareRemove: 'firmware',
          emailSettingsSave: 'email', emailMonitorSave: 'email', emailMonitorEnabled: 'email', emailMonitorRemove: 'email', emailSendTest: 'email',
          netgsmSettingsSave: 'email', netgsmSendTest: 'email', automationRuleSave: 'schedules', automationRuleEnabled: 'schedules', automationRuleRemove: 'schedules',
          deviceGroupSave: 'relay', deviceGroupRemove: 'relay', deviceGroupCommand: 'relay', queuedCommandRemove: 'relay',
          blacklistAdd: 'blacklist', blacklistRemove: 'blacklist', debugLoggingSet: 'logs', consoleLoggingSet: 'logs', webUserSave: 'users', webUserRemove: 'users',
          mqttUserSave: 'users', mqttUserEnabled: 'users', mqttUserRemove: 'users'
        };
        const requiredPermission = requiredPermissions[request.type];
        if (requiredPermission && !webAuth.hasPermission(socket.authUser, requiredPermission)) throw new Error('Bu işlem için yetkiniz yok.');
        if (requiredPermission) history.addAudit({ actor: socket.authUser.username, action: request.type,
          target: request.targetClientId || request.username || request.id || request.user?.username || request.task?.targetUsername || '',
          remoteIp: socket.remoteIp, details: auditSafeDetails(request) });

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
        if (request.type === 'mqttUserSave') {
          if (socket.authUser.role !== 'admin') throw new Error('Bu işlem için yönetici yetkisi gerekir.');
          const previous = request.user?.id ? mqttUsers.get(request.user.id) : null;
          const id = mqttUsers.save(request.user || {});
          if (previous) disconnectMqttUser(previous.username);
          socket.send(JSON.stringify({ type: 'mqttUserSuccess', message: `MQTT kullanıcısı kaydedildi (#${id}).` }));
          broadcastState(); return;
        }
        if (request.type === 'mqttUserEnabled') {
          if (socket.authUser.role !== 'admin') throw new Error('Bu işlem için yönetici yetkisi gerekir.');
          const existing = mqttUsers.get(request.id);
          mqttUsers.setEnabled(request.id, request.enabled === true);
          if (existing && request.enabled !== true) disconnectMqttUser(existing.username);
          broadcastState(); return;
        }
        if (request.type === 'mqttUserRemove') {
          if (socket.authUser.role !== 'admin') throw new Error('Bu işlem için yönetici yetkisi gerekir.');
          const existing = mqttUsers.get(request.id);
          mqttUsers.remove(request.id);
          if (existing) disconnectMqttUser(existing.username);
          socket.send(JSON.stringify({ type: 'mqttUserSuccess', message: 'MQTT kullanıcısı silindi.' }));
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
            const downloadUrl = `${FIRMWARE_PUBLIC_BASE_URL || socket.publicBaseUrl}/firmware/download/${created.token}`;
            const command = target.deviceType === 'netrelay_mp'
              ? JSON.stringify({ action: 'update', url: downloadUrl })
              : JSON.stringify({ type: 'netrelay', command: 'firmware_update', commandId: createCommandId(), targetUsername: target.username,
                jobId: created.job.id, version: created.firmware.version, hardware: created.firmware.hardware,
                url: downloadUrl, size: created.firmware.size, sha256: created.firmware.sha256 });
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
          systemSettings.setBoolean('debug_logging_enabled',debugLoggingEnabled);
          addLog('SİSTEM', `Ayrıntılı bağlantı logları ${debugLoggingEnabled ? 'açıldı' : 'kapatıldı'}.`);
          return;
        }

        if(request.type==='consoleLoggingSet'){
          consoleLoggingEnabled=request.enabled===true;
          systemSettings.setBoolean('console_logging_enabled',consoleLoggingEnabled);
          addLog('SİSTEM',`Terminal konsol çıktısı ${consoleLoggingEnabled?'açıldı':'kapatıldı'}.`);
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
        if (request.type === 'netgsmSettingsSave') {
          netgsm.save(request.settings || {}); socket.send(JSON.stringify({ type: 'netgsmSuccess', message: 'Netgsm ayarları kaydedildi.' })); broadcastState(); return;
        }
        if (request.type === 'netgsmSendTest') {
          const result = await netgsm.sendTest(request.number); socket.send(JSON.stringify({ type: 'netgsmSuccess', message: `Test SMS kuyruğa alındı. Görev: ${result.jobid}` })); return;
        }
        if (request.type === 'automationRuleSave') {
          const id = rules.save(request.rule || {}); socket.send(JSON.stringify({ type: 'automationRuleSuccess', message: `Kural kaydedildi (#${id}).` })); broadcastState(); return;
        }
        if (request.type === 'automationRuleEnabled') { rules.setEnabled(request.id, request.enabled === true); broadcastState(); return; }
        if (request.type === 'automationRuleRemove') { rules.remove(request.id); socket.send(JSON.stringify({ type: 'automationRuleSuccess', message: 'Kural silindi.' })); broadcastState(); return; }
        if(request.type==='deviceGroupSave'){const id=deviceAutomation.saveGroup(request.group||{});socket.send(JSON.stringify({type:'deviceGroupSuccess',message:`Cihaz grubu kaydedildi (#${id}).`}));broadcastState();return;}
        if(request.type==='deviceGroupRemove'){deviceAutomation.removeGroup(request.id);socket.send(JSON.stringify({type:'deviceGroupSuccess',message:'Cihaz grubu silindi.'}));broadcastState();return;}
        if(request.type==='queuedCommandRemove'){deviceAutomation.removeQueued(request.id);broadcastState();return;}
        if(request.type==='deviceGroupCommand'){
          const group=deviceAutomation.listGroups().find(x=>x.id===Number(request.groupId));if(!group)throw new Error('Cihaz grubu bulunamadı.');const relays=[...new Set((request.relays||[]).map(Number))],position=Number(request.position),delay=Number(request.delay||0);if(!relays.length||relays.some(x=>!Number.isInteger(x)||x<1||x>4)||![0,1].includes(position)||!Number.isInteger(delay)||delay<0)throw new Error('Grup röle komutu geçersiz.');let sent=0,queued=0;for(const username of group.members){const target=[...onlineClients.values()].find(x=>x.username.toLowerCase()===username.toLowerCase()),payload={type:'netrelay',command:'set',targetUsername:username,relays,position,delay};if(target){await publishRelayCommand(target,relays,position,delay);sent++;}else if(request.queueOffline===true){deviceAutomation.enqueue(username,payload,`group:${group.id}`);queued++;}}socket.send(JSON.stringify({type:'deviceGroupSuccess',message:`${sent} cihaza gönderildi, ${queued} komut kuyruğa alındı.`}));broadcastState();return;}

        if (request.type === 'restartDevice') {
          const target = onlineClients.get(String(request.targetClientId || ''));
          if (!target) throw new Error('Seçilen cihaz artık çevrimiçi değil.');
          if (!getDeviceType(target.deviceType).supportsRestart) throw new Error(`${getDeviceType(target.deviceType).label} yeniden başlatmayı desteklemiyor.`);
          const payload = JSON.stringify({ type: 'netrelay', command: 'restart', commandId: createCommandId(), targetUsername: target.username });
          await publishMqttJson(target.commandTopic, payload);
          addLog('KOMUT', `${target.username} cihazına yeniden başlatma komutu gönderildi.`);
          socket.send(JSON.stringify({ type: 'restartDeviceSuccess', message: 'Yeniden başlatma komutu gönderildi.' }));
          return;
        }
        if (request.type === 'syncDevice') {
          const target = onlineClients.get(String(request.targetClientId || ''));
          if (!target) throw new Error('Seçilen cihaz artık çevrimiçi değil.');
          if (!getDeviceType(target.deviceType).supportsSync) throw new Error(`${getDeviceType(target.deviceType).label} sync komutunu desteklemiyor.`);
          const payload = JSON.stringify({ type: 'netrelay', command: 'sync', commandId: createCommandId(), targetUsername: target.username });
          await publishMqttJson(target.commandTopic, payload);
          addLog('KOMUT', `${target.username} cihazından güncel durum istendi.`);
          socket.send(JSON.stringify({ type: 'syncDeviceSuccess', message: 'Durum yenileme isteği gönderildi.' }));
          return;
        }

        if (request.type !== 'publish') return;

        const target = onlineClients.get(String(request.targetClientId || ''));
        if (!target) throw new Error('Seçilen kullanıcı artık çevrimiçi değil.');

        const payload = JSON.parse(request.payload);
        let jsonPayload;

        if (target.deviceType === 'netrelay_mp') {
          const validated = validateMpowerCommand(payload);
          if (!validated.ok) throw new Error(validated.error);
          jsonPayload = JSON.stringify(validated.command);
        } else {
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
          payload.commandId = createCommandId();
          jsonPayload = JSON.stringify(payload);
        }

        const topic = target.commandTopic;
        broker.publish(
          {
            cmd: 'publish',
            topic,
            payload: Buffer.from(jsonPayload),
            qos: 1,
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
        const type = request?.type?.startsWith('blacklist') ? 'blacklistError' : request?.type?.startsWith('scheduledTask') ? 'scheduledTaskError' : request?.type?.startsWith('deviceGroup') || request?.type?.startsWith('queuedCommand') ? 'deviceGroupError' : request?.type?.startsWith('automationRule') ? 'automationRuleError' : request?.type?.startsWith('netgsm') ? 'netgsmError' : request?.type?.startsWith('email') ? 'emailNotificationError' : request?.type?.startsWith('webUser') ? 'webUserError' : request?.type?.startsWith('mqttUser') ? 'mqttUserError' : request?.type?.startsWith('restartDevice') ? 'restartDeviceError' : request?.type?.startsWith('syncDevice') ? 'syncDeviceError' : request?.type?.startsWith('firmware') ? 'firmwareError' : 'publishError';
        socket.send(JSON.stringify({ type, message: error.message }));
      }
    });
  });

  broker.on('clientReady', (client) => {
    const usernameWasOnline = [...onlineClients.values()].some((item) => item.username === client.authenticatedUsername);
    const deviceType = resolveDeviceType(client.authenticatedUsername);
    const typeMeta = getDeviceType(deviceType);
    onlineClients.set(client.id, {
      clientId: client.id,
      username: client.authenticatedUsername,
      deviceType,
      deviceTypeLabel: typeMeta.label,
      commandTopic: commandTopicFor(deviceType, client.authenticatedUsername),
      remoteIp: security.normalizeIp(client.conn?.remoteAddress),
      status: 'UP',
      deviceUptimeMs: 0,
      hostname: '',
      ipAddress: '',
      outlets: [],
      custom: null,
      portCount: typeMeta.defaultPortCount,
      lastSeenAt: new Date().toLocaleString('tr-TR'),
      connectedAt: new Date().toLocaleString('tr-TR'),
      connectedAtMs: Date.now(), lastStatusAt: null
    });
    addLog(
      'BAĞLANDI',
      `Kullanıcı: ${client.authenticatedUsername} | Tip: ${typeMeta.label} | Client ID: ${client.id}`
    );
    writeDailyStatusLog('DEVICE_UP', {
      username: client.authenticatedUsername, clientId: client.id, deviceType,
      remoteIp: security.normalizeIp(client.conn?.remoteAddress)
    });
    history.addConnection('connected', client, { remoteIp: security.normalizeIp(client.conn?.remoteAddress), deviceType });
    if (deviceType === 'netrelay') {
      publishHomeAssistantDiscovery(client.authenticatedUsername).catch(error=>addLog('HATA',`Home Assistant Discovery: ${error.message}`));
    }
    deliverQueuedCommands(onlineClients.get(client.id)).catch(error=>addLog('HATA',`Kuyruk teslimi: ${error.message}`));
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
    history.addConnection('disconnected', client, { remoteIp: security.normalizeIp(client.conn?.remoteAddress) });
    const usernameStillOnline = [...onlineClients.values()].some((item) => item.username === client.authenticatedUsername);
    if (!usernameStillOnline) emailNotifications.notifyDevice(client.authenticatedUsername, false, {
      clientId: client.id, remoteIp: security.normalizeIp(client.conn?.remoteAddress)
    }).then((sent) => { if (sent) addLog('E-POSTA', `${client.authenticatedUsername} pasif bildirimi gönderildi.`); })
      .catch((error) => addLog('HATA', `Pasif cihaz e-postası gönderilemedi: ${error.message}`));
  });

  broker.on('publish', (packet, client) => {
    if (!client) return;

    const message = packet.payload.toString();
    const currentClient = onlineClients.get(client.id);
    const netRelayEvent = parseNetRelayEvent(message, client, packet.topic);
    const mpowerEvent = currentClient?.deviceType === 'netrelay_mp'
      ? parseMpowerEvent(message, client, packet.topic, currentClient)
      : null;
    try {
      const rawEvent = JSON.parse(message);
      if (rawEvent.type === 'netrelay_firmware_status' && firmwareManager.updateJob(rawEvent)) {
        addLog('FIRMWARE', `${client.authenticatedUsername}: ${rawEvent.status} %${Number(rawEvent.progress) || 0} ${rawEvent.message || ''}`);
      }
    } catch {}

    if (mpowerEvent?.type === 'mpower_device_status' || mpowerEvent?.type === 'mpower_outlet_status' || mpowerEvent?.type === 'mpower_custom') {
      if (currentClient) {
        const changedFields = !currentClient.relays ? ['initial'] : [
          ...(JSON.stringify(currentClient.relays) !== JSON.stringify(mpowerEvent.relays) ? ['relays'] : []),
          ...(JSON.stringify(currentClient.custom ?? null) !== JSON.stringify(mpowerEvent.custom ?? null) ? ['custom'] : []),
          ...(String(currentClient.hostname || '') !== String(mpowerEvent.hostname || '') ? ['hostname'] : []),
          ...(String(currentClient.ipAddress || '') !== String(mpowerEvent.ipAddress || '') ? ['ipAddress'] : [])
        ];
        if (changedFields.length) history.addEvent({ ...mpowerEvent, changedFields }, message);
        if (currentClient.status === 'STALE') history.addConnection('recovered', currentClient, { reason: 'status_message_received' });
        onlineClients.set(client.id, {
          ...currentClient,
          status: 'UP',
          deviceUptimeMs: mpowerEvent.deviceUptimeMs || currentClient.deviceUptimeMs || 0,
          voltage: mpowerEvent.voltage ?? currentClient.voltage,
          temperature: mpowerEvent.temperature ?? currentClient.temperature,
          hostname: mpowerEvent.hostname || currentClient.hostname,
          ipAddress: mpowerEvent.ipAddress || currentClient.ipAddress,
          outlets: mpowerEvent.outlets,
          relays: mpowerEvent.relays,
          custom: mpowerEvent.custom ?? currentClient.custom,
          portCount: mpowerEvent.portCount || currentClient.portCount,
          lastJson: message,
          lastEventAt: mpowerEvent.serverReceivedAt,
          lastSeenAt: new Date().toLocaleString('tr-TR'),
          lastStatusAt: Date.now()
        });
        broadcastState();
      }
      if (consoleLoggingEnabled) console.log(`[MPOWER] ${client.authenticatedUsername} | ${packet.topic} | ${mpowerEvent.type}`);
      addLog('MESAJ', `Kullanıcı: ${client.authenticatedUsername} | Topic: ${packet.topic} | Mesaj: ${message}`);
      return;
    }

    if (netRelayEvent?.type === 'netrelay_device_status') {
      const existingClient = onlineClients.get(client.id);
      const changedFields = deviceStateChanges(existingClient, netRelayEvent);
      if (changedFields.length) history.addEvent({ ...netRelayEvent, changedFields }, message);
      if (existingClient) {
        if (existingClient.status === 'STALE') history.addConnection('recovered', existingClient, { reason: 'status_message_received' });
        onlineClients.set(client.id, {
          ...existingClient,
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
          lastEventAt: new Date().toISOString(),
          lastStatusAt: Date.now()
        });
        broadcastState();
      }
      if (consoleLoggingEnabled) console.log(
        `[DEVICE_STATUS] Kullanıcı: ${client.authenticatedUsername} | Client ID: ${client.id} | Uptime: ${netRelayEvent.deviceUptimeMs} ms`
      );
      executeMatchingRules(netRelayEvent).catch((error) => addLog('HATA', `Kural motoru: ${error.message}`));
      return;
    }

    if (netRelayEvent?.type === 'netrelay_input_event') {
      history.addEvent(netRelayEvent, message);
      const existingClient = onlineClients.get(client.id);
      if (existingClient) {
        const inputs = Array.from({ length: 4 }, (_, index) => existingClient.inputs?.[index] || { input: index + 1, name: `input${index + 1}`, io: null, voltage: 0 });
        inputs[netRelayEvent.input - 1] = { input: netRelayEvent.input, name: netRelayEvent.inputName, io: netRelayEvent.io, voltage: netRelayEvent.voltage };
        onlineClients.set(client.id, { ...existingClient, inputs, lastJson: message, lastEventAt: netRelayEvent.serverReceivedAt, lastSeenAt: new Date().toLocaleString('tr-TR') });
        broadcastState();
      }
      executeMatchingRules(netRelayEvent).catch((error) => addLog('HATA', `Kural motoru: ${error.message}`));
    }
    if (netRelayEvent?.type === 'netrelay_relay_event') {
      history.addEvent(netRelayEvent, message);
      const existingClient = onlineClients.get(client.id);
      if (existingClient) {
        const relays = Array.isArray(existingClient.relays) ? [...existingClient.relays] : [null, null, null, null];
        relays[netRelayEvent.relay - 1] = netRelayEvent.position;
        onlineClients.set(client.id, { ...existingClient, relays, lastJson: message, lastEventAt: netRelayEvent.serverReceivedAt, lastSeenAt: new Date().toLocaleString('tr-TR') });
        broadcastState();
      }
    }

    addLog(
      'MESAJ',
      `Kullanıcı: ${client.authenticatedUsername} | Topic: ${packet.topic} | Mesaj: ${message}`
    );

    if (netRelayEvent) {
      if (consoleLoggingEnabled) console.log(`[NETRELAY_JSON] ${JSON.stringify(netRelayEvent)}`);
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
    addLog('SİSTEM', `${mqttUsers.list().length} MQTT kullanıcısı SQLite veritabanından yüklendi.`);
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

  const activeWebPort = WEB_HTTPS_ENABLED ? WEB_HTTPS_PORT : WEB_PORT;
  const webScheme = WEB_HTTPS_ENABLED ? 'https' : 'http';
  webServer.listen(activeWebPort, HOST, () => {
    writeDailyStatusLog('SERVER_UP', { webPort: activeWebPort, webHttps: WEB_HTTPS_ENABLED, mqttPort: MQTT_PORT, mqttTlsPort: MQTT_TLS_ENABLED ? MQTT_TLS_PORT : null });
    addLog('SİSTEM', `Web paneli tüm ağlarda çalışıyor: ${HOST}:${activeWebPort} (${webScheme.toUpperCase()})`);
    for (const ip of getLocalIpAddresses()) {
      addLog('SİSTEM', `Web paneli adresi: ${webScheme}://${ip}:${activeWebPort}`);
    }
  });
}

const blacklistCleanupTimer = setInterval(() => {
  if (security.cleanupExpired() > 0) broadcastState();
}, 60 * 1000);
blacklistCleanupTimer.unref();

const historyCleanupTimer = setInterval(() => history.cleanup(), 6 * 60 * 60 * 1000);
historyCleanupTimer.unref();
history.cleanup();

const logRotationTimer = setInterval(() => {
  try { logRotation.run(); } catch (error) { addLog('HATA', `Log rotasyonu: ${error.message}`); }
}, 6 * 60 * 60 * 1000);
logRotationTimer.unref();
try { logRotation.run(); } catch (error) { console.error('[LOG ROTASYONU]', error.message); }

const staleDeviceTimer = setInterval(() => {
  let changed = false;
  const now = Date.now();
  for (const [clientId, client] of onlineClients) {
    const stale = now - (client.lastStatusAt || client.connectedAtMs || now) >= DEVICE_STALE_AFTER_MS;
    const nextStatus = stale ? 'STALE' : 'UP';
    if (client.status !== nextStatus) {
      onlineClients.set(clientId, { ...client, status: nextStatus });
      if (nextStatus === 'STALE') history.addConnection('stale', client, { reason: 'status_timeout', staleAfterMs: DEVICE_STALE_AFTER_MS });
      changed = true;
    }
  }
  if (changed) broadcastState();
}, Math.min(30000, Math.max(5000, Math.floor(DEVICE_STALE_AFTER_MS / 2))));
staleDeviceTimer.unref();

function shutdown() {
  writeDailyStatusLog('SERVER_DOWN', { reason: 'controlled_shutdown' });
  clearInterval(blacklistCleanupTimer);
  clearInterval(historyCleanupTimer);
  clearInterval(staleDeviceTimer);
  clearInterval(logRotationTimer);
  security.close();
  scheduledTasks.close();
  emailNotifications.close();
  webAuth.close();
  mqttUsers.close();
  firmwareManager.close();
  history.close();
  rules.close();
  netgsm.close();
  deviceAutomation.close();
  logRotation.close();
  systemSettings.close();
  apiKeys.close();
  homeAssistant.close();
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
