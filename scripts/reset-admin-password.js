#!/usr/bin/env node
'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const PERMISSIONS = ['dashboard', 'relay', 'schedules', 'firmware', 'email', 'blacklist', 'logs', 'users'];
const username = String(process.env.INITIAL_ADMIN_USERNAME || 'admin@mlteknoloji.com').trim();
const configuredPassword = String(process.env.INITIAL_ADMIN_PASSWORD || '');
const configuredDbPath = process.env.SECURITY_DB_PATH || 'security.sqlite3';
const databasePath = configuredDbPath === ':memory:'
  ? ':memory:'
  : path.resolve(__dirname, '..', configuredDbPath);

if (!username) {
  console.error('HATA: INITIAL_ADMIN_USERNAME boş olamaz.');
  process.exit(1);
}

if (configuredPassword && configuredPassword.length < 12) {
  console.error('HATA: INITIAL_ADMIN_PASSWORD en az 12 karakter olmalıdır.');
  process.exit(1);
}

const password = configuredPassword || crypto.randomBytes(18).toString('base64url');
const mustChangePassword = configuredPassword ? 0 : 1;
const passwordHash = bcrypt.hashSync(password, 12);
const now = Date.now();

const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
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
`);

const existing = db.prepare('SELECT id, username FROM web_users WHERE username=? COLLATE NOCASE').get(username);
let action;
if (existing) {
  db.prepare(`UPDATE web_users
    SET password_hash=?, display_name=COALESCE(NULLIF(display_name,''),'Sistem Yöneticisi'),
        role='admin', permissions=?, enabled=1, must_change_password=?, updated_at=?
    WHERE id=?`)
    .run(passwordHash, JSON.stringify(PERMISSIONS), mustChangePassword, now, existing.id);
  action = 'güncellendi';
} else {
  db.prepare(`INSERT INTO web_users
    (username,password_hash,display_name,role,permissions,enabled,must_change_password,created_at,updated_at)
    VALUES (?,?,?,?,?,1,?,?,?)`)
    .run(username, passwordHash, 'Sistem Yöneticisi', 'admin', JSON.stringify(PERMISSIONS), mustChangePassword, now, now);
  action = 'oluşturuldu';
}

db.prepare('DELETE FROM web_sessions').run();
try { db.prepare('DELETE FROM web_login_failures').run(); } catch {}
db.close();

console.log(`Yönetici hesabı ${action}.`);
console.log(`Kullanıcı: ${username}`);
console.log(`Veritabanı: ${databasePath}`);
if (configuredPassword) {
  console.log('Parola: .env içindeki INITIAL_ADMIN_PASSWORD değerine ayarlandı.');
  console.log('İlk girişte parola değiştirme zorunluluğu kapalı.');
} else {
  console.log(`Yeni geçici parola: ${password}`);
  console.log('İlk girişte parola değiştirme zorunlu.');
  console.log('Kalıcı parola için .env dosyasına INITIAL_ADMIN_PASSWORD yazıp komutu tekrar çalıştırın.');
}
