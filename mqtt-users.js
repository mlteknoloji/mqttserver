const fs = require('node:fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { DEFAULT_DEVICE_TYPE, normalizeDeviceType, getDeviceType } = require('./device-types');

function createMqttUserStore({ databasePath, usersFile }) {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS mqtt_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  const columns = db.prepare('PRAGMA table_info(mqtt_users)').all().map((row) => row.name);
  if (!columns.includes('device_type')) {
    db.exec(`ALTER TABLE mqtt_users ADD COLUMN device_type TEXT NOT NULL DEFAULT '${DEFAULT_DEVICE_TYPE}'`);
  }

  if (db.prepare('SELECT COUNT(*) count FROM mqtt_users').get().count === 0 && usersFile && fs.existsSync(usersFile)) {
    const data = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    if (!Array.isArray(data.users)) throw new Error('users.json içindeki users alanı bir dizi olmalıdır.');
    const insert = db.prepare('INSERT INTO mqtt_users (username,password_hash,enabled,device_type,created_at,updated_at) VALUES (?,?,?,?,?,?)');
    db.transaction((users) => {
      for (const user of users) {
        const username = String(user.username || '').trim(), password = String(user.password || '');
        if (!username || !password) throw new Error('Her MQTT kullanıcısı için kullanıcı adı ve parola zorunludur.');
        if (!/^[A-Za-z0-9._-]+$/.test(username)) throw new Error(`MQTT kullanıcı adı yalnızca harf, rakam, nokta, alt çizgi ve tire içerebilir: ${username}`);
        const now = Date.now();
        const deviceType = normalizeDeviceType(user.deviceType || user.device_type || DEFAULT_DEVICE_TYPE);
        insert.run(username, bcrypt.hashSync(password, 12), 1, deviceType, now, now);
      }
    })(data.users);
  }

  const publicUser = (row) => row && ({
    id: row.id,
    username: row.username,
    enabled: row.enabled === 1,
    deviceType: normalizeDeviceType(row.device_type || DEFAULT_DEVICE_TYPE),
    deviceTypeLabel: getDeviceType(row.device_type || DEFAULT_DEVICE_TYPE).label,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  function list() { return db.prepare('SELECT * FROM mqtt_users ORDER BY username COLLATE NOCASE').all().map(publicUser); }
  function get(id) { return publicUser(db.prepare('SELECT * FROM mqtt_users WHERE id=?').get(Number(id))); }
  function getByUsername(username) {
    return publicUser(db.prepare('SELECT * FROM mqtt_users WHERE username=? COLLATE NOCASE').get(String(username || '').trim()));
  }
  function authenticateResult(username, password) {
    const trimmed = String(username == null ? '' : username).trim();
    const enteredPassword = password == null ? '' : Buffer.isBuffer(password) ? password.toString('utf8') : String(password);
    if (!trimmed) return { ok: false, reason: 'kullanıcı adı boş' };
    if (!enteredPassword) return { ok: false, reason: 'parola boş' };
    const row = db.prepare('SELECT username, password_hash, enabled FROM mqtt_users WHERE username=? COLLATE NOCASE').get(trimmed);
    if (!row) return { ok: false, reason: 'kullanıcı bulunamadı', username: trimmed };
    if (row.enabled !== 1) return { ok: false, reason: 'hesap pasif', username: row.username };
    if (!bcrypt.compareSync(enteredPassword, row.password_hash)) {
      return { ok: false, reason: 'parola hatalı', username: row.username };
    }
    return { ok: true, username: row.username };
  }
  function authenticate(username, password) {
    return authenticateResult(username, password).ok;
  }
  function save(input) {
    const id = Number(input.id || 0), username = String(input.username || '').trim(), password = String(input.password || '');
    const deviceType = normalizeDeviceType(input.deviceType || input.device_type || DEFAULT_DEVICE_TYPE);
    if (!username) throw new Error('MQTT kullanıcı adı zorunludur.');
    if (!/^[A-Za-z0-9._-]+$/.test(username)) throw new Error('MQTT kullanıcı adı yalnızca harf, rakam, nokta, alt çizgi ve tire içerebilir.');
    if (!id && password.length < 8) throw new Error('Yeni MQTT kullanıcı parolası en az 8 karakter olmalıdır.');
    const now = Date.now();
    if (id) {
      if (!db.prepare('SELECT 1 FROM mqtt_users WHERE id=?').get(id)) throw new Error('MQTT kullanıcısı bulunamadı.');
      if (password && password.length < 8) throw new Error('MQTT kullanıcı parolası en az 8 karakter olmalıdır.');
      db.prepare('UPDATE mqtt_users SET username=?,enabled=?,device_type=?,updated_at=? WHERE id=?')
        .run(username, input.enabled === false ? 0 : 1, deviceType, now, id);
      if (password) {
        db.prepare('UPDATE mqtt_users SET password_hash=?,updated_at=? WHERE id=?').run(bcrypt.hashSync(password, 12), now, id);
      }
      return id;
    }
    return Number(db.prepare('INSERT INTO mqtt_users (username,password_hash,enabled,device_type,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(username, bcrypt.hashSync(password, 12), input.enabled === false ? 0 : 1, deviceType, now, now).lastInsertRowid);
  }
  function setEnabled(id, enabled) {
    if (!db.prepare('UPDATE mqtt_users SET enabled=?,updated_at=? WHERE id=?').run(enabled ? 1 : 0, Date.now(), Number(id)).changes) throw new Error('MQTT kullanıcısı bulunamadı.');
  }
  function remove(id) {
    if (!db.prepare('DELETE FROM mqtt_users WHERE id=?').run(Number(id)).changes) throw new Error('MQTT kullanıcısı bulunamadı.');
  }
  return { list, get, getByUsername, authenticate, authenticateResult, save, setEnabled, remove, close: () => db.close() };
}

module.exports = { createMqttUserStore };
