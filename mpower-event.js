function toFinite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toBinary(value) {
  if (value === true || value === 1 || value === '1' || value === 'on' || value === 'ON') return 1;
  if (value === false || value === 0 || value === '0' || value === 'off' || value === 'OFF') return 0;
  return null;
}

function extractOutputs(payload) {
  if (Array.isArray(payload.output)) return payload.output.map(toBinary);
  if (Array.isArray(payload.outputs)) return payload.outputs.map(toBinary);
  if (Array.isArray(payload.relays)) {
    return payload.relays.map((item) => (item && typeof item === 'object' ? toBinary(item.position ?? item.state ?? item.output) : toBinary(item)));
  }
  if (Array.isArray(payload.outlets)) {
    return payload.outlets.map((item) => toBinary(item?.output ?? item?.relay ?? item?.state ?? item));
  }
  return null;
}

function buildOutlets(payload, previousOutlets = []) {
  const outputs = extractOutputs(payload);
  const portCount = Math.max(
    Number(payload.portcount) || 0,
    Number(payload.portCount) || 0,
    outputs?.length || 0,
    Array.isArray(payload.outlets) ? payload.outlets.length : 0,
    Array.isArray(payload.power) ? payload.power.length : 0,
    previousOutlets.length,
    1
  );

  return Array.from({ length: portCount }, (_, index) => {
    const previous = previousOutlets[index] || { port: index + 1, output: null };
    const fromOutlet = Array.isArray(payload.outlets) ? payload.outlets[index] : null;
    const label = Array.isArray(payload.label) ? payload.label[index] : null;
    return {
      port: index + 1,
      name: String(fromOutlet?.name || fromOutlet?.label || label || previous.name || `OUT ${index + 1}`),
      output: outputs?.[index] ?? toBinary(fromOutlet?.output ?? fromOutlet?.relay ?? fromOutlet?.state) ?? previous.output,
      power: toFinite(fromOutlet?.power ?? payload.power?.[index], previous.power ?? null),
      energy: toFinite(fromOutlet?.energy ?? payload.energy?.[index], previous.energy ?? null),
      voltage: toFinite(fromOutlet?.voltage ?? payload.voltage?.[index] ?? payload.voltage, previous.voltage ?? null),
      current: toFinite(fromOutlet?.current ?? payload.current?.[index], previous.current ?? null),
      powerFactor: toFinite(fromOutlet?.pf ?? fromOutlet?.powerFactor ?? payload.pf?.[index], previous.powerFactor ?? null)
    };
  });
}

function mergeOutlet(previousOutlets = [], port, payload) {
  const outlets = previousOutlets.length
    ? previousOutlets.map((item) => ({ ...item }))
    : Array.from({ length: Math.max(port, 1) }, (_, index) => ({ port: index + 1, output: null }));
  while (outlets.length < port) outlets.push({ port: outlets.length + 1, output: null });
  const current = outlets[port - 1] || { port, output: null };
  outlets[port - 1] = {
    ...current,
    port,
    name: String(payload.name || payload.label || current.name || `OUT ${port}`),
    output: toBinary(payload.output ?? payload.relay ?? payload.state) ?? current.output,
    power: toFinite(payload.power, current.power ?? null),
    energy: toFinite(payload.energy, current.energy ?? null),
    voltage: toFinite(payload.voltage, current.voltage ?? null),
    current: toFinite(payload.current ?? payload.amps, current.current ?? null),
    powerFactor: toFinite(payload.pf ?? payload.powerFactor, current.powerFactor ?? null)
  };
  return outlets;
}

function relaysFromOutlets(outlets) {
  return outlets.map((item) => (item.output === 0 || item.output === 1 ? item.output : null));
}

function parseMpowerEvent(message, client, topic, previous = {}, now = () => new Date()) {
  const username = client.authenticatedUsername;
  const prefix = `mpower/${username}/`;
  if (!topic.startsWith(prefix) && topic !== `mpower/${username}`) return null;

  let payload;
  try {
    payload = JSON.parse(message);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const received = () => now().toISOString();
  const rest = topic.slice(prefix.length);
  const base = {
    mqttUsername: username,
    deviceId: client.id,
    mqttEventTopic: topic,
    serverReceivedAt: received(),
    ipAddress: String(payload.ipAddress || payload.ip || payload.localip || previous.ipAddress || ''),
    hostname: String(payload.hostname || payload.name || payload.$name || previous.hostname || ''),
    deviceUptimeMs: toFinite(payload.deviceUptimeMs ?? payload.uptimeMs ?? (payload.uptime != null ? Number(payload.uptime) * 1000 : null), previous.deviceUptimeMs || 0) || 0,
    voltage: toFinite(payload.voltage, previous.voltage ?? null),
    temperature: toFinite(payload.temperature, previous.temperature ?? null),
    custom: payload.custom !== undefined ? payload.custom : previous.custom
  };

  if (rest === 'state') {
    const outlets = buildOutlets(payload, previous.outlets || []);
    return {
      ...base,
      type: 'mpower_device_status',
      custom: payload.custom !== undefined ? payload.custom : base.custom,
      outlets,
      relays: relaysFromOutlets(outlets),
      portCount: outlets.length,
      raw: payload
    };
  }

  if (rest === 'custom') {
    return {
      ...base,
      type: 'mpower_custom',
      custom: payload,
      outlets: previous.outlets || [],
      relays: Array.isArray(previous.relays) ? previous.relays : relaysFromOutlets(previous.outlets || []),
      portCount: (previous.outlets || []).length || previous.portCount || 0,
      raw: payload
    };
  }

  const outletMatch = rest.match(/^outlet\/(\d+)\/json$/);
  if (outletMatch) {
    const port = Number(outletMatch[1]);
    if (!Number.isInteger(port) || port < 1 || port > 32) return null;
    const outlets = mergeOutlet(previous.outlets || [], port, payload);
    return {
      ...base,
      type: 'mpower_outlet_status',
      port,
      outlets,
      relays: relaysFromOutlets(outlets),
      portCount: outlets.length,
      raw: payload
    };
  }

  return null;
}

function validateMpowerCommand(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'mPower komutu geçersiz.' };
  const action = String(payload.action || '').toLowerCase();
  if (!['on', 'off', 'pulse', 'cycle', 'update'].includes(action)) {
    return { ok: false, error: 'mPower action on/off/pulse/cycle/update olmalıdır.' };
  }

  if (action === 'update') {
    const url = String(payload.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'update komutu için geçerli bir url zorunludur.' };
    return { ok: true, command: { action: 'update', url } };
  }

  const delay = payload.delay === undefined ? undefined : Number(payload.delay);
  if (delay !== undefined && (!Number.isInteger(delay) || delay < 0 || delay > 4294967)) {
    return { ok: false, error: 'delay 0..4294967 arası tam sayı olmalıdır.' };
  }

  if (action === 'cycle') {
    const port = payload.port === 'all' ? 'all' : Number(payload.port);
    if (port !== 'all' && (!Number.isInteger(port) || port < 1 || port > 32)) {
      return { ok: false, error: 'cycle port all veya 1..32 olmalıdır.' };
    }
    if (delay === undefined) return { ok: false, error: 'cycle komutu için delay zorunludur.' };
    return { ok: true, command: { action: 'cycle', port, delay } };
  }

  const port = Number(payload.port);
  if (!Number.isInteger(port) || port < 1 || port > 32) {
    return { ok: false, error: 'port 1..32 arası tam sayı olmalıdır.' };
  }

  if (action === 'pulse') {
    if (delay === undefined) return { ok: false, error: 'pulse komutu için delay zorunludur.' };
    const to = Number(payload.to);
    if (![0, 1].includes(to)) return { ok: false, error: 'pulse to değeri 0 veya 1 olmalıdır.' };
    return { ok: true, command: { action: 'pulse', port, delay, to } };
  }

  return { ok: true, command: { action, port } };
}

module.exports = {
  parseMpowerEvent,
  validateMpowerCommand,
  buildOutlets,
  mergeOutlet,
  relaysFromOutlets,
  toBinary
};
