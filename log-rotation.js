const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const Database = require('better-sqlite3');

function createLogRotation({ databasePath, logDirectory }) {
  const db = new Database(databasePath);
  db.exec(`CREATE TABLE IF NOT EXISTS log_rotation_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 1,
    archive_after_days INTEGER NOT NULL DEFAULT 7, delete_after_days INTEGER NOT NULL DEFAULT 90,
    updated_at INTEGER NOT NULL DEFAULT 0
  ); INSERT OR IGNORE INTO log_rotation_settings(id) VALUES(1);`);
  const read = db.prepare('SELECT * FROM log_rotation_settings WHERE id=1');
  function getSettings() { const row=read.get(); return {enabled:row.enabled===1,archiveAfterDays:row.archive_after_days,deleteAfterDays:row.delete_after_days,updatedAt:row.updated_at}; }
  function saveSettings(input) {
    const archiveAfterDays=Math.trunc(Number(input.archiveAfterDays)),deleteAfterDays=Math.trunc(Number(input.deleteAfterDays));
    if(!Number.isInteger(archiveAfterDays)||archiveAfterDays<1||archiveAfterDays>3650)throw new Error('Arşivleme süresi 1-3650 gün olmalıdır.');
    if(!Number.isInteger(deleteAfterDays)||deleteAfterDays<archiveAfterDays||deleteAfterDays>3650)throw new Error('Silme süresi arşivleme süresinden küçük olamaz ve en fazla 3650 gün olabilir.');
    db.prepare('UPDATE log_rotation_settings SET enabled=?,archive_after_days=?,delete_after_days=?,updated_at=? WHERE id=1').run(input.enabled?1:0,archiveAfterDays,deleteAfterDays,Date.now());return getSettings();
  }
  function fileDate(name){const match=/^device-status-(\d{4}-\d{2}-\d{2})\.log(?:\.gz)?$/.exec(name);if(!match)return null;const date=Date.parse(`${match[1]}T00:00:00Z`);return Number.isFinite(date)?date:null;}
  function run(force=false){const settings=getSettings();if(!settings.enabled&&!force)return {skipped:true,archived:0,deleted:0};fs.mkdirSync(logDirectory,{recursive:true});const now=Date.now();let archived=0,deleted=0;for(const entry of fs.readdirSync(logDirectory,{withFileTypes:true})){if(!entry.isFile())continue;const created=fileDate(entry.name);if(created===null)continue;const ageDays=Math.floor((now-created)/86400000),source=path.join(logDirectory,entry.name);if(ageDays>=settings.deleteAfterDays){fs.unlinkSync(source);deleted++;continue;}if(entry.name.endsWith('.log')&&ageDays>=settings.archiveAfterDays){const target=`${source}.gz`;if(!fs.existsSync(target))fs.writeFileSync(target,zlib.gzipSync(fs.readFileSync(source),{level:9}));fs.unlinkSync(source);archived++;}}return {skipped:false,archived,deleted,ranAt:new Date().toISOString()};}
  return {getSettings,saveSettings,run,close:()=>db.close()};
}
module.exports={createLogRotation};
