const Database = require('better-sqlite3');
const SunCalc = require('suncalc');

function parseField(value, min, max, sundayAlias = false) {
  const result = new Set();
  for (const part of String(value).split(',')) {
    const [rangeText, stepText] = part.split('/');
    const step = Number(stepText || 1);
    if (!Number.isInteger(step) || step < 1) throw new Error('Cron adımı geçersiz.');
    let start = min;
    let end = max;
    if (rangeText !== '*') {
      const bounds = rangeText.split('-').map(Number);
      start = bounds[0];
      end = bounds.length === 2 ? bounds[1] : bounds[0];
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error('Cron alanı geçersiz.');
    }
    for (let number = start; number <= end; number += step) result.add(sundayAlias && number === 7 ? 0 : number);
  }
  return result;
}

function compileCron(expression) {
  const fields = String(expression || '').trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('Cron ifadesi 5 alandan oluşmalıdır.');
  return [
    parseField(fields[0], 0, 59),
    parseField(fields[1], 0, 23),
    parseField(fields[2], 1, 31),
    parseField(fields[3], 1, 12),
    parseField(fields[4], 0, 7, true)
  ];
}

function cronMatches(compiled, date, includeTime = true) {
  return (!includeTime || (compiled[0].has(date.getMinutes()) && compiled[1].has(date.getHours()))) &&
    compiled[2].has(date.getDate()) && compiled[3].has(date.getMonth() + 1) && compiled[4].has(date.getDay());
}

function mapRow(row) {
  return {
    id: row.id, name: row.name, targetUsername: row.target_username,
    relays: JSON.parse(row.relays), position: row.position, cron: row.cron,
    mode: row.mode, latitude: row.latitude, longitude: row.longitude,
    solarOffsetMinutes: row.solar_offset_minutes, restoreSeconds: row.restore_seconds,
    enabled: row.enabled === 1, lastRunAt: row.last_run_at, lastResult: row.last_result,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function createScheduledTaskStore(options) {
  const db = new Database(options.databasePath);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    target_username TEXT NOT NULL,
    relays TEXT NOT NULL,
    position INTEGER NOT NULL,
    cron TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'cron',
    latitude REAL,
    longitude REAL,
    solar_offset_minutes INTEGER NOT NULL DEFAULT 0,
    restore_seconds INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    last_result TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  const listStatement = db.prepare('SELECT * FROM scheduled_tasks ORDER BY id DESC');
  const getStatement = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?');
  const insertStatement = db.prepare(`INSERT INTO scheduled_tasks
    (name,target_username,relays,position,cron,mode,latitude,longitude,solar_offset_minutes,restore_seconds,enabled,created_at,updated_at)
    VALUES (@name,@targetUsername,@relays,@position,@cron,@mode,@latitude,@longitude,@solarOffsetMinutes,@restoreSeconds,@enabled,@now,@now)`);
  const updateStatement = db.prepare(`UPDATE scheduled_tasks SET name=@name,target_username=@targetUsername,
    relays=@relays,position=@position,cron=@cron,mode=@mode,latitude=@latitude,longitude=@longitude,
    solar_offset_minutes=@solarOffsetMinutes,restore_seconds=@restoreSeconds,enabled=@enabled,updated_at=@now WHERE id=@id`);
  const resultStatement = db.prepare('UPDATE scheduled_tasks SET last_run_at = ?, last_result = ? WHERE id = ?');

  function validate(input) {
    const relays = [...new Set((Array.isArray(input.relays) ? input.relays : []).map(Number))];
    const task = {
      id: Number(input.id), name: String(input.name || '').trim(), targetUsername: String(input.targetUsername || '').trim(),
      relays: JSON.stringify(relays), position: Number(input.position), cron: String(input.cron || '').trim(),
      mode: ['cron', 'sunrise', 'sunset'].includes(input.mode) ? input.mode : 'cron',
      latitude: input.latitude === '' || input.latitude == null ? null : Number(input.latitude),
      longitude: input.longitude === '' || input.longitude == null ? null : Number(input.longitude),
      solarOffsetMinutes: Number(input.solarOffsetMinutes || 0), restoreSeconds: Number(input.restoreSeconds || 0),
      enabled: input.enabled === false ? 0 : 1, now: Date.now()
    };
    if (!task.name || !task.targetUsername) throw new Error('Görev adı ve hedef kullanıcı zorunludur.');
    if (!relays.length || relays.some((r) => !Number.isInteger(r) || r < 1 || r > 4)) throw new Error('En az bir geçerli röle seçin.');
    if (![0, 1].includes(task.position)) throw new Error('Röle konumu geçersiz.');
    compileCron(task.cron);
    if (task.mode !== 'cron' && (!Number.isFinite(task.latitude) || task.latitude < -90 || task.latitude > 90 || !Number.isFinite(task.longitude) || task.longitude < -180 || task.longitude > 180)) throw new Error('Güneş zamanları için geçerli enlem ve boylam girin.');
    if (!Number.isInteger(task.solarOffsetMinutes) || Math.abs(task.solarOffsetMinutes) > 1440) throw new Error('Güneş zamanı farkı geçersiz.');
    if (!Number.isInteger(task.restoreSeconds) || task.restoreSeconds < 0 || task.restoreSeconds > 4294967) throw new Error('Geri alma süresi geçersiz.');
    return task;
  }

  let timer;
  const lastKeys = new Map();
  function start(onRun) {
    const tick = async () => {
      const now = new Date();
      for (const row of listStatement.all().filter((item) => item.enabled === 1)) {
        try {
          const task = mapRow(row);
          const cron = compileCron(task.cron);
          let due = cronMatches(cron, now, task.mode === 'cron');
          if (task.mode !== 'cron') {
            const solar = SunCalc.getTimes(now, task.latitude, task.longitude)[task.mode];
            const targetMinute = Math.floor((solar.getTime() + task.solarOffsetMinutes * 60000) / 60000);
            due = due && Math.floor(now.getTime() / 60000) === targetMinute;
          }
          const key = `${task.id}:${Math.floor(now.getTime() / 60000)}`;
          if (!due || lastKeys.get(task.id) === key) continue;
          lastKeys.set(task.id, key);
          const result = await onRun(task);
          resultStatement.run(Date.now(), String(result || 'Çalıştırıldı'), task.id);
        } catch (error) {
          resultStatement.run(Date.now(), `Hata: ${error.message}`, row.id);
        }
      }
    };
    timer = setInterval(tick, 1000);
    timer.unref();
    tick();
  }

  return {
    list: () => listStatement.all().map(mapRow),
    save(input) { const task = validate(input); if (task.id) { if (!updateStatement.run(task).changes) throw new Error('Görev bulunamadı.'); return task.id; } return Number(insertStatement.run(task).lastInsertRowid); },
    setEnabled(id, enabled) { if (!db.prepare('UPDATE scheduled_tasks SET enabled=?, updated_at=? WHERE id=?').run(enabled ? 1 : 0, Date.now(), Number(id)).changes) throw new Error('Görev bulunamadı.'); },
    remove(id) { if (!db.prepare('DELETE FROM scheduled_tasks WHERE id=?').run(Number(id)).changes) throw new Error('Görev bulunamadı.'); },
    start,
    close() { if (timer) clearInterval(timer); db.close(); }
  };
}

module.exports = { createScheduledTaskStore, compileCron };
