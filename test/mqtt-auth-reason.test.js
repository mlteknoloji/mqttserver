const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMqttUserStore } = require('../mqtt-users');
const { createSecurityStore } = require('../security');

test('authenticateResult reddetme sebebini ayırır', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqtt-users-'));
  const databasePath = path.join(dir, 'test.sqlite3');
  const store = createMqttUserStore({ databasePath });
  try {
    store.save({ username: 'cihaz1', password: 'guclu-parola-1', enabled: true });
    const disabledId = store.save({ username: 'pasif1', password: 'guclu-parola-2', enabled: false });
    assert.equal(store.authenticateResult('', 'x').reason, 'kullanıcı adı boş');
    assert.equal(store.authenticateResult('cihaz1', '').reason, 'parola boş');
    assert.equal(store.authenticateResult('yok', 'x').reason, 'kullanıcı bulunamadı');
    assert.equal(store.authenticateResult('pasif1', 'guclu-parola-2').reason, 'hesap pasif');
    assert.equal(store.authenticateResult('cihaz1', 'yanlis').reason, 'parola hatalı');
    assert.equal(store.authenticateResult('cihaz1', 'guclu-parola-1').ok, true);
    store.setEnabled(disabledId, true);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getBlacklistEntry engel nedenini döndürür', () => {
  const store = createSecurityStore({ databasePath: ':memory:', maxAttempts: 2, findTimeMs: 60000, banTimeMs: 60000 });
  try {
    store.recordFailure('10.0.0.8');
    store.recordFailure('10.0.0.8');
    const entry = store.getBlacklistEntry('10.0.0.8');
    assert.equal(entry.ip, '10.0.0.8');
    assert.match(entry.reason, /başarısız MQTT girişi/);
  } finally {
    store.close();
  }
});
