const DEVICE_TYPES = Object.freeze({
  netrelay: Object.freeze({
    id: 'netrelay',
    label: 'NetRelay',
    topicRoot: 'netrelay',
    commandSuffix: 'command',
    eventSuffix: 'events',
    supportsInputs: true,
    supportsRestart: true,
    supportsSync: true,
    defaultPortCount: 4
  }),
  netrelay_mp: Object.freeze({
    id: 'netrelay_mp',
    label: 'NetRelayMP',
    topicRoot: 'mpower',
    commandSuffix: 'cmd',
    eventSuffix: 'state',
    supportsInputs: false,
    supportsRestart: false,
    supportsSync: false,
    defaultPortCount: 3,
    telemetryTopics: Object.freeze(['state', 'custom', 'outlet/+/json'])
  })
});

const DEFAULT_DEVICE_TYPE = 'netrelay';

function normalizeDeviceType(value) {
  const id = String(value || DEFAULT_DEVICE_TYPE).trim().toLowerCase();
  if (!DEVICE_TYPES[id]) throw new Error(`Desteklenmeyen cihaz tipi: ${value}`);
  return id;
}

function getDeviceType(value = DEFAULT_DEVICE_TYPE) {
  return DEVICE_TYPES[normalizeDeviceType(value)];
}

function listDeviceTypes() {
  return Object.values(DEVICE_TYPES).map((item) => ({ id: item.id, label: item.label }));
}

function mpowerDeviceId(clientId) {
  const value = String(clientId || '').trim();
  return /^mp[0-9a-f]+$/i.test(value) ? value.slice(2).toLowerCase() : value;
}

function topicPrefix(deviceType, username, clientId) {
  const type = getDeviceType(deviceType);
  if (type.id === 'netrelay_mp' && clientId) return `${type.topicRoot}/${username}/${mpowerDeviceId(clientId)}`;
  return `${type.topicRoot}/${username}`;
}

function commandTopicFor(deviceType, username, clientId) {
  const type = getDeviceType(deviceType);
  return `${topicPrefix(type.id, username, clientId)}/${type.commandSuffix}`;
}

/** Baştaki / işaretini temizler. Boşluk içeren topic'ler geçersizdir. */
function normalizeMqttTopic(topic) {
  const value = String(topic || '').trim();
  if (!value || /\s/.test(value)) return '';
  return value.replace(/^\/+/, '');
}

function isDeviceTopicAllowed(deviceType, username, topic) {
  const normalizedUser = String(username || '').trim();
  if (!normalizedUser || /\s/.test(String(topic || '').trim())) return false;
  const normalizedTopic = normalizeMqttTopic(topic);
  if (!normalizedTopic) return false;
  const type = getDeviceType(deviceType);
  const prefix = topicPrefix(type.id, normalizedUser);
  if (normalizedTopic === prefix || normalizedTopic.startsWith(`${prefix}/`)) return true;
  // Yalnızca klasik NetRelay arayüzü: Başlık=<kullanıcı>, Sub Topic=fromServer
  // NetRelayMP (mpower/...) bu legacy topic'leri kullanmaz.
  if (type.id === 'netrelay' && (normalizedTopic === 'fromServer' || normalizedTopic === normalizedUser)) return true;
  return false;
}

function parseMpowerTopic(topic, username) {
  if (/\s/.test(String(topic || '').trim())) return null;
  const root = topicPrefix('netrelay_mp', username);
  const normalizedTopic = normalizeMqttTopic(topic);
  const prefix = `${root}/`;
  if (!normalizedTopic || (!normalizedTopic.startsWith(prefix) && normalizedTopic !== root)) return null;
  const rest = normalizedTopic.slice(prefix.length);
  if (rest === 'state') return { kind: 'state' };
  if (rest === 'custom') return { kind: 'custom' };
  if (rest === 'cmd') return { kind: 'cmd' };
  const outlet = rest.match(/^outlet\/(\d+)\/json$/);
  if (outlet) return { kind: 'outlet', port: Number(outlet[1]) };
  return { kind: 'other', rest };
}

module.exports = {
  DEVICE_TYPES,
  DEFAULT_DEVICE_TYPE,
  normalizeDeviceType,
  getDeviceType,
  listDeviceTypes,
  topicPrefix,
  commandTopicFor,
  normalizeMqttTopic,
  isDeviceTopicAllowed,
  parseMpowerTopic,
  mpowerDeviceId
};
