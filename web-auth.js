const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { normalizeIp } = require('./security');

const PERMISSIONS = ['dashboard', 'relay', 'schedules', 'firmware', 'email', 'blacklist', 'logs', 'users'];
const DEFAULT_ADMIN = process.env.INITIAL_ADMIN_USERNAME || 'admin@mlteknoloji.com';
const SESSION_MS = 12 * 60 * 60 * 1000;
// Web paneli giriş koruması: aynı IP'den art arda başarısız denemeler kilitlemeyle sonuçlanır.
const WEB_LOGIN_MAX_ATTEMPTS = Number(process.env.WEB_LOGIN_MAX_ATTEMPTS) || 5;
const WEB_LOGIN_FIND_TIME_MS = (Number(process.env.WEB_LOGIN_FIND_TIME_MINUTES) || 10) * 60 * 1000;
const WEB_LOGIN_LOCK_MS = (Number(process.env.WEB_LOGIN_LOCK_MINUTES) || 15) * 60 * 1000;

function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function cookies(header) {
  return Object.fromEntries(String(header || '').split(';').map((item) => item.trim().split('=').map(decodeURIComponent)).filter((parts) => parts.length === 2));
}

function createWebAuthStore(options) {
  const db = new Database(options.databasePath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'user',
      permissions TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS web_sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES web_users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS web_login_failures (
      ip TEXT PRIMARY KEY,
      attempt_count INTEGER NOT NULL,
      first_attempt_at INTEGER NOT NULL,
      last_attempt_at INTEGER NOT NULL,
      locked_until INTEGER
    );
  `);
  db.pragma('foreign_keys = ON');
  const admin = db.prepare('SELECT id FROM web_users WHERE username=?').get(DEFAULT_ADMIN);
  if (!admin) {
    const configuredPassword = String(process.env.INITIAL_ADMIN_PASSWORD || '');
    if (configuredPassword && configuredPassword.length < 12) throw new Error('INITIAL_ADMIN_PASSWORD en az 12 karakter olmalıdır.');
    const initialPassword = configuredPassword || crypto.randomBytes(18).toString('base64url');
    db.prepare(`INSERT INTO web_users
      (username,password_hash,display_name,role,permissions,enabled,must_change_password,created_at,updated_at)
      VALUES (?,?,?,?,?,1,1,?,?)`).run(DEFAULT_ADMIN, bcrypt.hashSync(initialPassword, 12), 'Sistem Yöneticisi', 'admin', JSON.stringify(PERMISSIONS), Date.now(), Date.now());
    if (!configuredPassword) console.warn(`[GÜVENLİK] İlk yönetici parolası (${DEFAULT_ADMIN}): ${initialPassword}`);
  }

  function publicUser(row) {
    if (!row) return null;
    return { id: row.id, username: row.username, displayName: row.display_name, role: row.role,
      permissions: row.role === 'admin' ? [...PERMISSIONS] : JSON.parse(row.permissions || '[]'),
      enabled: row.enabled === 1, mustChangePassword: row.must_change_password === 1,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }
  function fromRequest(request) {
    const token = cookies(request.headers.cookie).netrelay_session;
    if (!token) return null;
    const row = db.prepare(`SELECT u.* FROM web_sessions s JOIN web_users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=1`).get(tokenHash(token), Date.now());
    return publicUser(row);
  }
  function getActiveLoginFailure(ip) {
    const row = db.prepare('SELECT * FROM web_login_failures WHERE ip=?').get(ip);
    if (!row) return null;
    if (row.locked_until) {
      if (row.locked_until <= Date.now()) db.prepare('DELETE FROM web_login_failures WHERE ip=?').run(ip);
      return null;
    }
    if (Date.now() - row.first_attempt_at > WEB_LOGIN_FIND_TIME_MS) {
      db.prepare('DELETE FROM web_login_failures WHERE ip=?').run(ip);
      return null;
    }
    return row;
  }
  function loginLock(ip) {
    if (!ip) return null;
    const row = db.prepare('SELECT * FROM web_login_failures WHERE ip=? AND locked_until IS NOT NULL AND locked_until>?').get(ip, Date.now());
    if (!row) return null;
    const minutes = Math.ceil((row.locked_until - Date.now()) / 60000);
    return { lockedUntil: row.locked_until, message: `Çok fazla başarısız giriş denemesi. ${minutes} dakika sonra tekrar deneyin.` };
  }
  function recordLoginFailure(ip) {
    if (!ip) return;
    const current = getActiveLoginFailure(ip);
    const now = Date.now();
    const attempts = current ? current.attempt_count + 1 : 1;
    const firstAttemptAt = current ? current.first_attempt_at : now;
    if (attempts >= WEB_LOGIN_MAX_ATTEMPTS) {
      db.prepare(`INSERT INTO web_login_failures (ip, attempt_count, first_attempt_at, last_attempt_at, locked_until) VALUES (?,?,?,?,?)
        ON CONFLICT(ip) DO UPDATE SET attempt_count=excluded.attempt_count, locked_until=excluded.locked_until, last_attempt_at=excluded.last_attempt_at`)
        .run(ip, attempts, firstAttemptAt, now, now + WEB_LOGIN_LOCK_MS);
      return;
    }
    db.prepare(`INSERT INTO web_login_failures (ip, attempt_count, first_attempt_at, last_attempt_at) VALUES (?,?,?,?)
      ON CONFLICT(ip) DO UPDATE SET attempt_count=excluded.attempt_count,
        first_attempt_at=excluded.first_attempt_at, last_attempt_at=excluded.last_attempt_at`)
      .run(ip, attempts, firstAttemptAt, now);
  }
  function clearLoginFailures(ip) {
    if (ip) db.prepare('DELETE FROM web_login_failures WHERE ip=? AND locked_until IS NULL').run(ip);
  }
  function login(username, password, remoteIp) {
    const ip = normalizeIp(remoteIp);
    const lock = loginLock(ip);
    if (lock) return { ok: false, locked: true, message: lock.message };
    db.prepare('DELETE FROM web_sessions WHERE expires_at<=?').run(Date.now());
    const row = db.prepare('SELECT * FROM web_users WHERE username=? COLLATE NOCASE AND enabled=1').get(String(username || '').trim());
    if (!row || !bcrypt.compareSync(String(password || ''), row.password_hash)) {
      recordLoginFailure(ip);
      return { ok: false };
    }
    clearLoginFailures(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO web_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
      .run(tokenHash(token), row.id, Date.now() + SESSION_MS, Date.now());
    return { ok: true, token, user: publicUser(row) };
  }
  function logout(request) {
    const token = cookies(request.headers.cookie).netrelay_session;
    if (token) db.prepare('DELETE FROM web_sessions WHERE token_hash=?').run(tokenHash(token));
  }
  function changePassword(userId, currentPassword, newPassword) {
    const row = db.prepare('SELECT * FROM web_users WHERE id=?').get(Number(userId));
    if (!row || !bcrypt.compareSync(String(currentPassword || ''), row.password_hash)) throw new Error('Mevcut parola yanlış.');
    if (String(newPassword || '').length < 8) throw new Error('Yeni parola en az 8 karakter olmalıdır.');
    if (String(newPassword) === String(currentPassword)) throw new Error('Yeni parola mevcut paroladan farklı olmalıdır.');
    db.prepare('UPDATE web_users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?')
      .run(bcrypt.hashSync(String(newPassword), 12), Date.now(), row.id);
    db.prepare('DELETE FROM web_sessions WHERE user_id=?').run(row.id);
  }
  function listUsers() { return db.prepare('SELECT * FROM web_users ORDER BY role DESC, username').all().map(publicUser); }
  function saveUser(input, actor) {
    if (actor.role !== 'admin') throw new Error('Bu işlem için yönetici yetkisi gerekir.');
    const id = Number(input.id || 0), username = String(input.username || '').trim(), password = String(input.password || '');
    const role = input.role === 'admin' ? 'admin' : 'user';
    const permissions = PERMISSIONS.filter((permission) => Array.isArray(input.permissions) && input.permissions.includes(permission));
    if (!username) throw new Error('Kullanıcı adı zorunludur.');
    if (!id && password.length < 8) throw new Error('Yeni kullanıcı parolası en az 8 karakter olmalıdır.');
    if (id) {
      const existing = db.prepare('SELECT * FROM web_users WHERE id=?').get(id); if (!existing) throw new Error('Kullanıcı bulunamadı.');
      if (existing.id === actor.id && (role !== 'admin' || input.enabled === false)) throw new Error('Kendi yönetici hesabınızı pasif veya yetkisiz yapamazsınız.');
      db.prepare(`UPDATE web_users SET username=?,display_name=?,role=?,permissions=?,enabled=?,
        must_change_password=?,updated_at=? WHERE id=?`).run(username, String(input.displayName || '').trim(), role,
        JSON.stringify(permissions), input.enabled === false ? 0 : 1,
        input.mustChangePassword === false ? 0 : 1, Date.now(), id);
      if (password) {
        if (password.length < 8) throw new Error('Parola en az 8 karakter olmalıdır.');
        db.prepare('UPDATE web_users SET password_hash=?,must_change_password=1,updated_at=? WHERE id=?').run(bcrypt.hashSync(password, 12), Date.now(), id);
        db.prepare('DELETE FROM web_sessions WHERE user_id=? AND user_id<>?').run(id, actor.id);
      }
      return id;
    }
    return Number(db.prepare(`INSERT INTO web_users
      (username,password_hash,display_name,role,permissions,enabled,must_change_password,created_at,updated_at)
      VALUES (?,?,?,?,?,?,1,?,?)`).run(username, bcrypt.hashSync(password, 12), String(input.displayName || '').trim(), role,
      JSON.stringify(permissions), input.enabled === false ? 0 : 1, Date.now(), Date.now()).lastInsertRowid);
  }
  function removeUser(id, actor) {
    if (actor.role !== 'admin') throw new Error('Bu işlem için yönetici yetkisi gerekir.');
    if (Number(id) === actor.id) throw new Error('Kendi hesabınızı silemezsiniz.');
    if (!db.prepare('DELETE FROM web_users WHERE id=?').run(Number(id)).changes) throw new Error('Kullanıcı bulunamadı.');
  }
  function hasPermission(user, permission) { return Boolean(user && (user.role === 'admin' || user.permissions.includes(permission))); }
  return { permissions: PERMISSIONS, fromRequest, login, logout, changePassword, listUsers, saveUser, removeUser, hasPermission,
    cookie(token, secure = false) { return `netrelay_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`; },
    clearCookie: 'netrelay_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0', close: () => db.close() };
}

module.exports = { createWebAuthStore };
