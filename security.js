const net = require('node:net');
const path = require('node:path');
const Database = require('better-sqlite3');

function normalizeIp(value) {
  const ip = String(value || '').trim();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function createSecurityStore(options = {}) {
  const databasePath = options.databasePath || path.join(__dirname, 'security.sqlite3');
  const maxAttempts = options.maxAttempts || 5;
  const findTimeMs = options.findTimeMs || 10 * 60 * 1000;
  const banTimeMs = options.banTimeMs || 60 * 60 * 1000;
  const db = new Database(databasePath);

  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS blacklist (
      ip TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      banned_at INTEGER NOT NULL,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS login_failures (
      ip TEXT PRIMARY KEY,
      attempt_count INTEGER NOT NULL,
      first_attempt_at INTEGER NOT NULL,
      last_attempt_at INTEGER NOT NULL
    );
  `);

  const statements = {
    deleteExpired: db.prepare('DELETE FROM blacklist WHERE expires_at IS NOT NULL AND expires_at <= ?'),
    getBan: db.prepare('SELECT * FROM blacklist WHERE ip = ?'),
    listBans: db.prepare('SELECT * FROM blacklist ORDER BY banned_at DESC'),
    removeBan: db.prepare('DELETE FROM blacklist WHERE ip = ?'),
    getFailure: db.prepare('SELECT * FROM login_failures WHERE ip = ?'),
    upsertFailure: db.prepare(`
      INSERT INTO login_failures (ip, attempt_count, first_attempt_at, last_attempt_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET
        attempt_count = excluded.attempt_count,
        first_attempt_at = excluded.first_attempt_at,
        last_attempt_at = excluded.last_attempt_at
    `),
    clearFailure: db.prepare('DELETE FROM login_failures WHERE ip = ?'),
    addBan: db.prepare(`
      INSERT INTO blacklist (ip, reason, failed_attempts, banned_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET
        reason = excluded.reason,
        failed_attempts = excluded.failed_attempts,
        banned_at = excluded.banned_at,
        expires_at = excluded.expires_at
    `)
  };

  function cleanupExpired() {
    return statements.deleteExpired.run(Date.now()).changes;
  }

  function listBlacklist() {
    cleanupExpired();
    return statements.listBans.all().map((entry) => ({
      ip: entry.ip,
      reason: entry.reason,
      failedAttempts: entry.failed_attempts,
      bannedAt: new Date(entry.banned_at).toISOString(),
      expiresAt: entry.expires_at ? new Date(entry.expires_at).toISOString() : null
    }));
  }

  function isBlacklisted(value) {
    const ip = normalizeIp(value);
    if (!ip) return false;
    cleanupExpired();
    return Boolean(statements.getBan.get(ip));
  }

  function getBlacklistEntry(value) {
    const ip = normalizeIp(value);
    if (!ip) return null;
    cleanupExpired();
    const entry = statements.getBan.get(ip);
    if (!entry) return null;
    return {
      ip: entry.ip,
      reason: entry.reason,
      failedAttempts: entry.failed_attempts,
      bannedAt: new Date(entry.banned_at).toISOString(),
      expiresAt: entry.expires_at ? new Date(entry.expires_at).toISOString() : null
    };
  }

  function clearFailures(value) {
    const ip = normalizeIp(value);
    if (ip) statements.clearFailure.run(ip);
  }

  function recordFailure(value) {
    const ip = normalizeIp(value);
    if (!net.isIP(ip)) return { banned: false, attempts: 0, ip };

    const now = Date.now();
    const current = statements.getFailure.get(ip);
    const withinWindow = current && now - current.first_attempt_at <= findTimeMs;
    const attempts = withinWindow ? current.attempt_count + 1 : 1;
    const firstAttemptAt = withinWindow ? current.first_attempt_at : now;

    statements.upsertFailure.run(ip, attempts, firstAttemptAt, now);
    if (attempts < maxAttempts) return { banned: false, attempts, ip };

    statements.addBan.run(
      ip,
      `${findTimeMs / 60000} dakika içinde ${attempts} başarısız MQTT girişi`,
      attempts,
      now,
      now + banTimeMs
    );
    statements.clearFailure.run(ip);
    return { banned: true, attempts, ip };
  }

  function addManualBan(value, reason = 'Web panelinden manuel engellendi') {
    const ip = normalizeIp(value);
    if (!net.isIP(ip)) throw new Error('Geçerli bir IPv4 veya IPv6 adresi girin.');
    statements.addBan.run(ip, String(reason).slice(0, 200), 0, Date.now(), null);
    statements.clearFailure.run(ip);
    return ip;
  }

  function removeBan(value) {
    const ip = normalizeIp(value);
    return statements.removeBan.run(ip).changes > 0;
  }

  return {
    addManualBan,
    cleanupExpired,
    clearFailures,
    close: () => db.close(),
    getBlacklistEntry,
    isBlacklisted,
    listBlacklist,
    normalizeIp,
    recordFailure,
    removeBan
  };
}

module.exports = { createSecurityStore, normalizeIp };
