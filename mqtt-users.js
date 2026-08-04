const fs = require('node:fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

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

  if (db.prepare('SELECT COUNT(*) count FROM mqtt_users').get().count === 0 && usersFile && fs.existsSync(usersFile)) {
    const data = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    if (!Array.isArray(data.users)) throw new Error('users.json içindeki users alanı bir dizi olmalıdır.');
    const insert = db.prepare('INSERT INTO mqtt_users (username,password_hash,enabled,created_at,updated_at) VALUES (?,?,1,?,?)');
    db.transaction((users) => {
      for (const user of users) {
        const username = String(user.username || '').trim(), password = String(user.password || '');
        if (!username || !password) throw new Error('Her MQTT kullanıcısı için kullanıcı adı ve parola zorunludur.');
        const now = Date.now();
        insert.run(username, bcrypt.hashSync(password, 12), now, now);
      }
    })(data.users);
  }

  const publicUser = (row) => row && ({ id: row.id, username: row.username, enabled: row.enabled === 1,
    createdAt: row.created_at, updatedAt: row.updated_at });

  function list() { return db.prepare('SELECT * FROM mqtt_users ORDER BY username COLLATE NOCASE').all().map(publicUser); }
  function get(id) { return publicUser(db.prepare('SELECT * FROM mqtt_users WHERE id=?').get(Number(id))); }
  function authenticate(username, password) {
    const row = db.prepare('SELECT password_hash FROM mqtt_users WHERE username=? COLLATE NOCASE AND enabled=1').get(String(username || '').trim());
    return Boolean(row && bcrypt.compareSync(String(password || ''), row.password_hash));
  }
  function save(input) {
    const id = Number(input.id || 0), username = String(input.username || '').trim(), password = String(input.password || '');
    if (!username) throw new Error('MQTT kullanıcı adı zorunludur.');
    if (!id && password.length < 8) throw new Error('Yeni MQTT kullanıcı parolası en az 8 karakter olmalıdır.');
    const now = Date.now();
    if (id) {
      if (!db.prepare('SELECT 1 FROM mqtt_users WHERE id=?').get(id)) throw new Error('MQTT kullanıcısı bulunamadı.');
      if (password && password.length < 8) throw new Error('MQTT kullanıcı parolası en az 8 karakter olmalıdır.');
      db.prepare('UPDATE mqtt_users SET username=?,enabled=?,updated_at=? WHERE id=?').run(username, input.enabled === false ? 0 : 1, now, id);
      if (password) {
        db.prepare('UPDATE mqtt_users SET password_hash=?,updated_at=? WHERE id=?').run(bcrypt.hashSync(password, 12), now, id);
      }
      return id;
    }
    return Number(db.prepare('INSERT INTO mqtt_users (username,password_hash,enabled,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(username, bcrypt.hashSync(password, 12), input.enabled === false ? 0 : 1, now, now).lastInsertRowid);
  }
  function setEnabled(id, enabled) {
    if (!db.prepare('UPDATE mqtt_users SET enabled=?,updated_at=? WHERE id=?').run(enabled ? 1 : 0, Date.now(), Number(id)).changes) throw new Error('MQTT kullanıcısı bulunamadı.');
  }
  function remove(id) {
    if (!db.prepare('DELETE FROM mqtt_users WHERE id=?').run(Number(id)).changes) throw new Error('MQTT kullanıcısı bulunamadı.');
  }
  return { list, get, authenticate, save, setEnabled, remove, close: () => db.close() };
}

module.exports = { createMqttUserStore };
