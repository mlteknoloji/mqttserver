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

const client = { id: 'mp-1', authenticatedUsername: '24a43cd75475' };
const now = () => new Date('2026-01-02T03:04:05.000Z');

test('cihaz tipleri listelenir ve topic üretir', () => {
  assert.deepEqual(listDeviceTypes().map((item) => item.id), ['netrelay', 'netrelay_mp']);
  assert.equal(commandTopicFor('netrelay', 'cihaz1'), 'netrelay/cihaz1/command');
  assert.equal(commandTopicFor('netrelay_mp', '24a43cd75475'), 'mpower/24a43cd75475/cmd');
  assert.equal(isDeviceTopicAllowed('netrelay_mp', '24a43cd75475', 'mpower/24a43cd75475/state'), true);
  assert.equal(isDeviceTopicAllowed('netrelay_mp', '24a43cd75475', 'netrelay/24a43cd75475/events'), false);
  assert.equal(getDeviceType('netrelay_mp').label, 'NetRelayMP');
  assert.throws(() => normalizeDeviceType('unknown'));
});

test('mpower state telemetrisini ayrıştırır', () => {
  const event = parseMpowerEvent(JSON.stringify({
    output: [1, 0, 1],
    power: [12.5, 0, 3.2],
    custom: { room: 'lab' },
    hostname: 'NetRelayMP-1',
    voltage: 230.1
  }), client, 'mpower/24a43cd75475/state', {}, now);
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
  const outlet = parseMpowerEvent(JSON.stringify({ output: 1, power: 18.4, voltage: 229.5 }), client, 'mpower/24a43cd75475/outlet/1/json', previous, now);
  assert.equal(outlet.type, 'mpower_outlet_status');
  assert.equal(outlet.outlets[0].output, 1);
  assert.equal(outlet.outlets[0].power, 18.4);
  assert.equal(outlet.outlets[1].output, 1);
  const custom = parseMpowerEvent(JSON.stringify({ floor: 2 }), client, 'mpower/24a43cd75475/custom', outlet, now);
  assert.equal(custom.type, 'mpower_custom');
  assert.equal(custom.custom.floor, 2);
});

test('mpower komut doğrulaması', () => {
  assert.equal(validateMpowerCommand({ action: 'on', port: 1 }).ok, true);
  assert.equal(validateMpowerCommand({ action: 'pulse', port: 1, delay: 10, to: 1 }).ok, true);
  assert.equal(validateMpowerCommand({ action: 'cycle', port: 'all', delay: 10 }).ok, true);
  assert.equal(validateMpowerCommand({ action: 'update', url: 'http://pc/pkg.tar' }).ok, true);
  assert.equal(validateMpowerCommand({ action: 'pulse', port: 1 }).ok, false);
  assert.equal(validateMpowerCommand({ action: 'update', url: 'ftp://x' }).ok, false);
});
