const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');

function createEmailNotificationStore(options) {
  const db = new Database(options.databasePath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      host TEXT NOT NULL DEFAULT '', port INTEGER NOT NULL DEFAULT 587,
      secure INTEGER NOT NULL DEFAULT 0, username TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL DEFAULT '', sender TEXT NOT NULL DEFAULT '',
      recipients TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_device_monitors (
      username TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1, recipients TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO email_settings (id, updated_at) VALUES (1, 0);
  `);
  const monitorColumns = db.prepare('PRAGMA table_info(email_device_monitors)').all().map((column) => column.name);
  if (!monitorColumns.includes('recipients')) db.exec("ALTER TABLE email_device_monitors ADD COLUMN recipients TEXT NOT NULL DEFAULT ''");
  const getSettingsStatement = db.prepare('SELECT * FROM email_settings WHERE id=1');
  const listMonitorsStatement = db.prepare('SELECT * FROM email_device_monitors ORDER BY username');

  function settings(includePassword = false) {
    const row = getSettingsStatement.get();
    return {
      host: row.host, port: row.port, secure: row.secure === 1, username: row.username,
      password: includePassword ? row.password : '', hasPassword: Boolean(row.password),
      sender: row.sender, recipients: row.recipients, enabled: row.enabled === 1,
      updatedAt: row.updated_at
    };
  }
  function monitors() {
    return listMonitorsStatement.all().map((row) => ({ username: row.username, displayName: row.display_name, recipients: row.recipients || '', enabled: row.enabled === 1 }));
  }
  function saveSettings(input) {
    const current = settings(true);
    const value = {
      host: String(input.host || '').trim(), port: Number(input.port), secure: input.secure ? 1 : 0,
      username: String(input.username || '').trim(), password: String(input.password || '') || current.password,
      sender: String(input.sender || '').trim(), recipients: String(input.recipients || '').trim(),
      enabled: input.enabled ? 1 : 0, now: Date.now()
    };
    if (!value.host) throw new Error('SMTP sunucusu zorunludur.');
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('SMTP portu geçersiz.');
    if (!value.sender || !value.recipients) throw new Error('Gönderen ve alıcı e-posta adresi zorunludur.');
    db.prepare(`UPDATE email_settings SET host=@host,port=@port,secure=@secure,username=@username,
      password=@password,sender=@sender,recipients=@recipients,enabled=@enabled,updated_at=@now WHERE id=1`).run(value);
  }
  function saveMonitor(input) {
    const username = String(input.username || '').trim();
    if (!username) throw new Error('İzlenecek MQTT kullanıcısı zorunludur.');
    db.prepare(`INSERT INTO email_device_monitors (username,display_name,recipients,enabled,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(username) DO UPDATE SET display_name=excluded.display_name,recipients=excluded.recipients,enabled=excluded.enabled`)
      .run(username, String(input.displayName || '').trim(), String(input.recipients || '').trim(), input.enabled === false ? 0 : 1, Date.now());
  }
  function transporter(config) {
    return nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure,
      auth: config.username ? { user: config.username, pass: config.password } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
    });
  }
  async function send(subject, text, ignoreEnabled = false, recipientsOverride = '') {
    const config = settings(true);
    if (!ignoreEnabled && !config.enabled) return false;
    if (!config.host || !config.sender || !config.recipients) throw new Error('E-posta ayarları eksik.');
    await transporter(config).sendMail({ from: config.sender, to: String(recipientsOverride || config.recipients), subject, text });
    return true;
  }
  async function notifyDevice(username, online, details = {}) {
    const monitor = db.prepare('SELECT * FROM email_device_monitors WHERE username=? AND enabled=1').get(username);
    if (!monitor) return false;
    const name = monitor.display_name || username;
    const state = online ? 'AKTİF' : 'PASİF';
    const time = new Date().toLocaleString('tr-TR');
    return send(`NetRelay cihaz ${state}: ${name}`, [
      `İzlenen cihaz ${state.toLocaleLowerCase('tr-TR')} duruma geçti.`, '',
      `Cihaz: ${name}`, `MQTT kullanıcısı: ${username}`,
      details.clientId ? `Client ID: ${details.clientId}` : '',
      details.remoteIp ? `IP adresi: ${details.remoteIp}` : '',
      `Tarih: ${time}`
    ].filter(Boolean).join('\n'), false, monitor.recipients);
  }

  return {
    getState: () => ({ settings: settings(false), monitors: monitors() }),
    saveSettings, saveMonitor,
    setMonitorEnabled(username, enabled) { if (!db.prepare('UPDATE email_device_monitors SET enabled=? WHERE username=?').run(enabled ? 1 : 0, String(username)).changes) throw new Error('Cihaz izleme kaydı bulunamadı.'); },
    removeMonitor(username) { if (!db.prepare('DELETE FROM email_device_monitors WHERE username=?').run(String(username)).changes) throw new Error('Cihaz izleme kaydı bulunamadı.'); },
    sendTest: () => send('NetRelay test e-postası', `SMTP ayarlarınız başarıyla çalışıyor.\nTarih: ${new Date().toLocaleString('tr-TR')}`, true),
    notifyDevice,
    close: () => db.close()
  };
}

module.exports = { createEmailNotificationStore };
