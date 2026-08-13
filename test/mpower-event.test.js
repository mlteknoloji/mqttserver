const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listDeviceTypes,
  getDeviceType,
  commandTopicFor,
  isDeviceTopicAllowed,
  normalizeDeviceType
} = require('../device-types');
const { parseMpowerEvent, validateMpowerCommand } = require('../mpower-event');

const client = { id: 'mp24a43cd750b5', authenticatedUsername: 'mltek' };
const now = () => new Date('2026-01-02T03:04:05.000Z');

test('cihaz tipleri listelenir ve topic üretir', () => {
  assert.deepEqual(listDeviceTypes().map((item) => item.id), ['netrelay', 'netrelay_mp']);
  assert.equal(commandTopicFor('netrelay', 'cihaz1'), 'netrelay/cihaz1/command');
  assert.equal(commandTopicFor('netrelay_mp', 'mltek', client.id), 'mpower/mltek/24a43cd750b5/cmd');
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'mpower/mltek/state'), true);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'netrelay/mltek/events'), false);
  assert.equal(getDeviceType('netrelay_mp').label, 'NetRelayMP');
  assert.throws(() => normalizeDeviceType('unknown'));
});

test('NetRelay baştaki / temizlenir; boşluklu topic reddedilir; fromServer legacy kabul edilir', () => {
  const { normalizeMqttTopic } = require('../device-types');
  assert.equal(normalizeMqttTopic('/netrelay/atakoy_sube'), 'netrelay/atakoy_sube');
  assert.equal(normalizeMqttTopic('netrelay/ atakoy_sube/command'), '');
  assert.equal(normalizeMqttTopic('netrelay/atakoy_sube/events'), 'netrelay/atakoy_sube/events');
  assert.equal(isDeviceTopicAllowed('netrelay', 'atakoy_sube', '/netrelay/atakoy_sube'), true);
  assert.equal(isDeviceTopicAllowed('netrelay', 'atakoy_sube', 'netrelay/atakoy_sube/command'), true);
  assert.equal(isDeviceTopicAllowed('netrelay', 'atakoy_sube', 'netrelay/ atakoy_sube/command'), false);
  assert.equal(isDeviceTopicAllowed('netrelay', 'atakoy_sube', 'netrelay/ atakoy_sube/events'), false);
  assert.equal(isDeviceTopicAllowed('netrelay', 'atakoy_sube', 'fromServer'), true);
  assert.equal(isDeviceTopicAllowed('netrelay', 'atakoy_sube', 'atakoy_sube'), true);
  assert.equal(isDeviceTopicAllowed('netrelay', 'atakoy_sube', 'netrelay/baska/command'), false);
});

test('NetRelayMP mpower topicleri bozulmaz; boşluklu ve legacy topicler reddedilir', () => {
  const { parseMpowerTopic } = require('../device-types');
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'mpower/mltek/state'), true);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'mpower/mltek/custom'), true);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'mpower/mltek/24a43cd750b5/cmd'), true);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'mpower/mltek/24a43cd750b5/state'), true);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'mpower/mltek/24a43cd750b5/outlet/1/json'), true);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', '/mpower/mltek/state'), true);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'mpower/ mltek/state'), false);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'fromServer'), false);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'mltek'), false);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'netrelay/mltek/events'), false);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'netrelay/mltek/command'), false);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', 'mltek', 'mpower/baska/state'), false);
  assert.deepEqual(parseMpowerTopic('mpower/mltek/24a43cd750b5/state', 'mltek'), { kind: 'other', rest: '24a43cd750b5/state' });
  assert.deepEqual(parseMpowerTopic('mpower/mltek/state', 'mltek'), { kind: 'state' });
  assert.deepEqual(parseMpowerTopic('/mpower/mltek/custom', 'mltek'), { kind: 'custom' });
  assert.equal(parseMpowerTopic('mpower/ mltek/outlet/2/json', 'mltek'), null);
});

test('mpower state telemetrisini ayrıştırır', () => {
  const event = parseMpowerEvent(JSON.stringify({
    output: [1, 0, 1],
    power: [12.5, 0, 3.2],
    custom: { room: 'lab' },
    hostname: 'NetRelayMP-1',
    voltage: 230.1
  }), client, 'mpower/mltek/24a43cd750b5/state', {}, now);
  assert.equal(event.type, 'mpower_device_status');
  assert.deepEqual(event.relays, [1, 0, 1]);
  assert.equal(event.outlets[0].power, 12.5);
  assert.equal(event.custom.room, 'lab');
  assert.equal(event.hostname, 'NetRelayMP-1');
});

test('mpower outlet ve custom topiclerini birleştirir', () => {
  const previous = {
    outlets: [{ port: 1, output: 0, power: 1 }, { port: 2, output: 1, power: 2 }],
    relays: [0, 1]
  };
  const outlet = parseMpowerEvent(JSON.stringify({ port: 1, relay: 1, watt: 18.4, volt: 229.5, amp: 0.08, wh: 12, pf: 0.9 }), client, 'mpower/mltek/24a43cd750b5/outlet/1/json', previous, now);
  assert.equal(outlet.type, 'mpower_outlet_status');
  assert.equal(outlet.outlets[0].output, 1);
  assert.equal(outlet.outlets[0].power, 18.4);
  assert.equal(outlet.outlets[0].voltage, 229.5);
  assert.equal(outlet.outlets[0].current, 0.08);
  assert.equal(outlet.outlets[0].energy, 12);
  assert.equal(outlet.outlets[1].output, 1);
  const custom = parseMpowerEvent(JSON.stringify({ floor: 2 }), client, 'mpower/mltek/24a43cd750b5/custom', outlet, now);
  assert.equal(custom.type, 'mpower_custom');
  assert.equal(custom.custom.floor, 2);
});

test('gerçek mPower scalar topiclerini birleştirir', () => {
  let event = parseMpowerEvent('11620', client, 'mpower/mltek/24a43cd750b5/uptime', {}, now);
  assert.equal(event.deviceUptimeMs, 11620000);
  event = parseMpowerEvent('ON', client, 'mpower/mltek/24a43cd750b5/relay/1', event, now);
  assert.deepEqual(event.relays, [1, null, null]);
  event = parseMpowerEvent('221.14323306', client, 'mpower/mltek/24a43cd750b5/outlet/1/volt', event, now);
  assert.equal(event.outlets[0].voltage, 221.14323306);
  event = parseMpowerEvent('', client, 'mpower/mltek/24a43cd750b5/custom', event, now);
  assert.equal(event.custom, null);
});

test('birleşik gerçek mPower state JSON içeriğini ayrıştırır', () => {
  const payload = {
    mac: '24a43cd750b5', hostname: 'mFi-mPower-D650B5', name: 'NetRelayMP',
    firmware: '2.1.11', overlay: '1.3.0', ip: '192.168.1.134', ssid: 'WiFi',
    uptime: 86400, now: '2026-08-12 16:20:00', custom: 'site=warehouse',
    outlets: [
      { port: 1, relay: 1, watt: 120, wh: 3500, volt: 230, amp: 0.52, pf: 0.96 },
      { port: 2, relay: 0, watt: 0, wh: 1250, volt: 230, amp: 0, pf: 0 },
      { port: 3, relay: 1, watt: 45, wh: 780, volt: 230, amp: 0.2, pf: 0.91 }
    ]
  };
  const event = parseMpowerEvent(JSON.stringify(payload), client, 'mpower/mltek/24a43cd750b5/state', {}, now);
  assert.deepEqual(event.relays, [1, 0, 1]);
  assert.deepEqual(event.outlets[0], { port: 1, name: 'OUT 1', output: 1, power: 120, energy: 3500, voltage: 230, current: 0.52, powerFactor: 0.96 });
  assert.equal(event.deviceUptimeMs, 86400000);
  assert.equal(event.macAddress, payload.mac);
  assert.equal(event.firmware, payload.firmware);
  assert.equal(event.overlay, payload.overlay);
  assert.equal(event.ssid, payload.ssid);
  assert.equal(event.deviceDateTime, payload.now);
  assert.equal(event.custom, 'site=warehouse');
});

test('mpower komut doğrulaması', () => {
  assert.equal(validateMpowerCommand({ action: 'on', port: 1 }).ok, true);
  assert.deepEqual(validateMpowerCommand({ action: 'pulse', port: 1, delay: 10 }).command, { action: 'pulse', port: 1, delay: 10 });
  assert.equal(validateMpowerCommand({ action: 'cycle', port: 1, delay: 10 }).ok, true);
  assert.equal(validateMpowerCommand({ action: 'on', port: 'all' }).ok, true);
  assert.equal(validateMpowerCommand({ action: 'off', port: 'all' }).ok, true);
  assert.equal(validateMpowerCommand({ action: 'cycle', port: 'all', delay: 10 }).ok, false);
  assert.equal(validateMpowerCommand({ action: 'on', port: 4 }).ok, false);
  assert.equal(validateMpowerCommand({ action: 'pulse', port: 1 }).ok, false);
  assert.equal(validateMpowerCommand({ action: 'update', url: 'ftp://x' }).ok, false);
});
