const Database = require('better-sqlite3');

function createHistoryStore({ databasePath, retentionDays = 90 }) {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at INTEGER NOT NULL,
      event_type TEXT NOT NULL, username TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '',
      channel INTEGER, value REAL, hostname TEXT NOT NULL DEFAULT '', ip_address TEXT NOT NULL DEFAULT '',
      uptime_ms INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_device_events_time ON device_events(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_device_events_user_time ON device_events(username, occurred_at DESC);
    CREATE TABLE IF NOT EXISTS device_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at INTEGER NOT NULL,
      event_type TEXT NOT NULL, username TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '',
      remote_ip TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_device_connections_user_time ON device_connections(username, occurred_at DESC);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at INTEGER NOT NULL,
      actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'accepted', remote_ip TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit_log(actor, occurred_at DESC);
  `);

  const addEventStatement = db.prepare(`INSERT INTO device_events
    (occurred_at,event_type,username,client_id,channel,value,hostname,ip_address,uptime_ms,payload)
    VALUES (@occurredAt,@eventType,@username,@clientId,@channel,@value,@hostname,@ipAddress,@uptimeMs,@payload)`);
  const addConnectionStatement = db.prepare(`INSERT INTO device_connections
    (occurred_at,event_type,username,client_id,remote_ip,details) VALUES (?,?,?,?,?,?)`);
  const addAuditStatement = db.prepare(`INSERT INTO audit_log
    (occurred_at,actor,action,target,status,remote_ip,details) VALUES (?,?,?,?,?,?,?)`);

  const cleanText = (value, max = 500) => String(value ?? '').slice(0, max);
  const redact = (value) => {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      /password|parola|secret|token|certificate|privatekey/i.test(key) ? '[GİZLİ]' : redact(item)]));
  };
  function addEvent(event, rawPayload = '') {
    const channel = event.relay ?? event.input ?? null;
    const value = event.position ?? event.io ?? null;
    addEventStatement.run({ occurredAt: Date.now(), eventType: cleanText(event.type, 50),
      username: cleanText(event.mqttUsername || event.username, 100), clientId: cleanText(event.deviceId || event.clientId, 150),
      channel, value, hostname: cleanText(event.hostname, 150), ipAddress: cleanText(event.ipAddress, 80),
      uptimeMs: Math.max(0, Number(event.deviceUptimeMs) || 0), payload: cleanText(rawPayload, 10000) });
  }
  function addConnection(type, client, details = {}) {
    addConnectionStatement.run(Date.now(), type, cleanText(client.authenticatedUsername || client.username, 100),
      cleanText(client.id || client.clientId, 150), cleanText(details.remoteIp || client.conn?.remoteAddress, 80), cleanText(JSON.stringify(details), 2000));
  }
  function addAudit({ actor, action, target, status = 'accepted', remoteIp, details }) {
    addAuditStatement.run(Date.now(), cleanText(actor, 150), cleanText(action, 100), cleanText(target, 200),
      cleanText(status, 30), cleanText(remoteIp, 80), cleanText(JSON.stringify(redact(details || {})), 5000));
  }
  function filters(input = {}) {
    const where = [], params = {};
    const usernames=[...new Set((Array.isArray(input.usernames)?input.usernames:input.username?[input.username]:[]).map(x=>cleanText(x,100)).filter(Boolean))].slice(0,100);
    if(usernames.length){const placeholders=usernames.map((username,index)=>{const key=`username${index}`;params[key]=username;return `@${key}`;});where.push(`username COLLATE NOCASE IN (${placeholders.join(',')})`);}
    if (input.type) { where.push('event_type = @type'); params.type = cleanText(input.type, 50); }
    if (input.from) { where.push('occurred_at >= @from'); params.from = Number(input.from); }
    if (input.to) { where.push('occurred_at <= @to'); params.to = Number(input.to); }
    return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }
  function listEvents(input = {}) {
    const { clause, params } = filters(input), limit = Math.min(Math.max(Number(input.limit) || 200, 1), 2000);
    return db.prepare(`SELECT * FROM device_events ${clause} ORDER BY occurred_at DESC LIMIT @limit`).all({ ...params, limit });
  }
  function listConnections(input = {}) {
    const { clause, params } = filters(input), limit = Math.min(Math.max(Number(input.limit) || 200, 1), 2000);
    return db.prepare(`SELECT * FROM device_connections ${clause} ORDER BY occurred_at DESC LIMIT @limit`).all({ ...params, limit });
  }
  function listAudit(input = {}) {
    const where = [], params = {}, actor = cleanText(input.actor, 150);
    if (actor) { where.push('actor = @actor COLLATE NOCASE'); params.actor = actor; }
    if (input.from) { where.push('occurred_at >= @from'); params.from = Number(input.from); }
    if (input.to) { where.push('occurred_at <= @to'); params.to = Number(input.to); }
    const limit = Math.min(Math.max(Number(input.limit) || 200, 1), 2000);
    return db.prepare(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY occurred_at DESC LIMIT @limit`).all({ ...params, limit });
  }
  function stats(since = Date.now() - 24 * 60 * 60 * 1000) {
    const events = db.prepare('SELECT COUNT(*) count FROM device_events WHERE occurred_at>=?').get(since).count;
    const connections = db.prepare(`SELECT event_type,COUNT(*) count FROM device_connections WHERE occurred_at>=? GROUP BY event_type`).all(since);
    const avg = db.prepare(`SELECT AVG(uptime_ms) value FROM device_events WHERE occurred_at>=? AND event_type='netrelay_device_status' AND uptime_ms>0`).get(since).value;
    return { events, connections: Object.fromEntries(connections.map((x) => [x.event_type, x.count])), averageUptimeMs: Math.round(avg || 0) };
  }
  function cleanup() {
    const cutoff = Date.now() - Math.max(1, Number(retentionDays) || 90) * 86400000;
    return db.transaction(() => ({ events: db.prepare('DELETE FROM device_events WHERE occurred_at<?').run(cutoff).changes,
      connections: db.prepare('DELETE FROM device_connections WHERE occurred_at<?').run(cutoff).changes,
      audit: db.prepare('DELETE FROM audit_log WHERE occurred_at<?').run(cutoff).changes }))();
  }
  return { addEvent, addConnection, addAudit, listEvents, listConnections, listAudit, stats, cleanup, close: () => db.close() };
}

module.exports = { createHistoryStore };
