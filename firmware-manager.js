const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const MAX_FIRMWARE_SIZE = 3264 * 1024;

function createFirmwareManager(options) {
  const db = new Database(options.databasePath);
  const storageDirectory = options.storageDirectory;
  fs.mkdirSync(storageDirectory, { recursive: true });
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS firmwares (
      id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL, hardware TEXT NOT NULL,
      original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, size INTEGER NOT NULL,
      sha256 TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS firmware_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, firmware_id INTEGER NOT NULL, target_username TEXT NOT NULL,
      target_client_id TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY(firmware_id) REFERENCES firmwares(id) ON DELETE CASCADE
    );
  `);
  db.pragma('foreign_keys = ON');
  const tokens = new Map();
  const mapFirmware = (row) => row && ({ id: row.id, version: row.version, hardware: row.hardware, originalName: row.original_name, size: row.size, sha256: row.sha256, notes: row.notes, createdAt: row.created_at });
  const mapJob = (row) => row && ({ id: row.id, firmwareId: row.firmware_id, targetUsername: row.target_username, targetClientId: row.target_client_id, status: row.status, progress: row.progress, message: row.message, createdAt: row.created_at, updatedAt: row.updated_at });

  function addFirmware(file, fields) {
    if (!file?.buffer?.length) throw new Error('Firmware .bin dosyası zorunludur.');
    if (!String(file.originalname).toLowerCase().endsWith('.bin')) throw new Error('Yalnızca .bin firmware dosyası yüklenebilir.');
    if (file.buffer.length > MAX_FIRMWARE_SIZE) throw new Error(`Firmware ${MAX_FIRMWARE_SIZE} bayttan büyük olamaz.`);
    if (file.buffer[0] !== 0xe9) throw new Error('Dosya geçerli bir ESP32 firmware imajı değil (0xE9 başlığı bulunamadı).');
    const version = String(fields.version || '').trim(), hardware = String(fields.hardware || '').trim();
    if (!version || !hardware) throw new Error('Firmware sürümü ve donanım modeli zorunludur.');
    const storedName = `${crypto.randomUUID()}.bin`;
    fs.writeFileSync(path.join(storageDirectory, storedName), file.buffer, { flag: 'wx' });
    try {
      return Number(db.prepare(`INSERT INTO firmwares (version,hardware,original_name,stored_name,size,sha256,notes,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(version, hardware, file.originalname, storedName, file.buffer.length,
        crypto.createHash('sha256').update(file.buffer).digest('hex'), String(fields.notes || '').trim(), Date.now()).lastInsertRowid);
    } catch (error) { fs.unlinkSync(path.join(storageDirectory, storedName)); throw error; }
  }
  function removeFirmware(id) {
    const row = db.prepare('SELECT * FROM firmwares WHERE id=?').get(Number(id)); if (!row) throw new Error('Firmware bulunamadı.');
    if (db.prepare('SELECT 1 FROM firmware_jobs WHERE firmware_id=? AND status IN (\'queued\',\'downloading\',\'writing\')').get(row.id)) throw new Error('Devam eden güncellemenin firmware’i silinemez.');
    db.prepare('DELETE FROM firmwares WHERE id=?').run(row.id);
    const filePath = path.join(storageDirectory, row.stored_name); if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  function createJob(firmwareId, target) {
    const firmwareRow = db.prepare('SELECT * FROM firmwares WHERE id=?').get(Number(firmwareId));
    if (!firmwareRow) throw new Error('Firmware bulunamadı.');
    if (db.prepare("SELECT 1 FROM firmware_jobs WHERE target_username=? AND status NOT IN ('completed','failed')").get(target.username)) throw new Error('Bu cihaz için devam eden bir firmware güncellemesi var.');
    const now = Date.now();
    const jobId = Number(db.prepare(`INSERT INTO firmware_jobs (firmware_id,target_username,target_client_id,status,progress,message,created_at,updated_at)
      VALUES (?,?,?,'queued',0,'Komut gönderiliyor',?,?)`).run(firmwareRow.id, target.username, target.clientId, now, now).lastInsertRowid);
    const token = crypto.randomBytes(32).toString('base64url');
    tokens.set(token, { firmwareId: firmwareRow.id, expiresAt: now + 30 * 60 * 1000 });
    return { job: mapJob(db.prepare('SELECT * FROM firmware_jobs WHERE id=?').get(jobId)), firmware: mapFirmware(firmwareRow), token };
  }
  function resolveDownload(token) {
    const entry = tokens.get(String(token));
    if (!entry || entry.expiresAt < Date.now()) { tokens.delete(String(token)); return null; }
    const row = db.prepare('SELECT * FROM firmwares WHERE id=?').get(entry.firmwareId); if (!row) return null;
    return { path: path.join(storageDirectory, row.stored_name), name: row.original_name, size: row.size, sha256: row.sha256 };
  }
  function updateJob(event) {
    const username = String(event.mqttUsername || event.username || '');
    const job = Number(event.jobId)
      ? db.prepare(`SELECT * FROM firmware_jobs WHERE id=? AND target_username=? AND status NOT IN ('completed','failed')`).get(Number(event.jobId), username)
      : db.prepare(`SELECT * FROM firmware_jobs WHERE target_username=? AND status NOT IN ('completed','failed') ORDER BY id DESC LIMIT 1`).get(username);
    if (!job) return false;
    const allowed = ['queued', 'downloading', 'writing', 'verifying', 'restarting', 'completed', 'failed'];
    const status = allowed.includes(event.status) ? event.status : job.status;
    const progress = Math.max(0, Math.min(100, Number(event.progress) || 0));
    db.prepare('UPDATE firmware_jobs SET status=?,progress=?,message=?,updated_at=? WHERE id=?').run(status, progress, String(event.message || ''), Date.now(), job.id);
    return true;
  }
  function failJob(id, message) { db.prepare("UPDATE firmware_jobs SET status='failed',message=?,updated_at=? WHERE id=?").run(String(message), Date.now(), Number(id)); }
  return {
    addFirmware, removeFirmware, createJob, resolveDownload, updateJob, failJob,
    getState: () => ({ firmwares: db.prepare('SELECT * FROM firmwares ORDER BY id DESC').all().map(mapFirmware), jobs: db.prepare('SELECT * FROM firmware_jobs ORDER BY id DESC LIMIT 100').all().map(mapJob), maxFirmwareSize: MAX_FIRMWARE_SIZE }),
    close: () => db.close()
  };
}

module.exports = { createFirmwareManager, MAX_FIRMWARE_SIZE };
