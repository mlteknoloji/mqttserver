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
      power: toFinite(fromOutlet?.power ?? fromOutlet?.watt ?? payload.power?.[index] ?? payload.watt?.[index], previous.power ?? null),
      energy: toFinite(fromOutlet?.energy ?? fromOutlet?.wh ?? payload.energy?.[index] ?? payload.wh?.[index], previous.energy ?? null),
      voltage: toFinite(fromOutlet?.voltage ?? fromOutlet?.volt ?? payload.voltage?.[index] ?? payload.volt?.[index] ?? payload.voltage ?? payload.volt, previous.voltage ?? null),
      current: toFinite(fromOutlet?.current ?? fromOutlet?.amps ?? fromOutlet?.amp ?? payload.current?.[index] ?? payload.amp?.[index], previous.current ?? null),
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
    power: toFinite(payload.power ?? payload.watt, current.power ?? null),
    energy: toFinite(payload.energy ?? payload.wh, current.energy ?? null),
    voltage: toFinite(payload.voltage ?? payload.volt, current.voltage ?? null),
    current: toFinite(payload.current ?? payload.amps ?? payload.amp, current.current ?? null),
    powerFactor: toFinite(payload.pf ?? payload.powerFactor, current.powerFactor ?? null)
  };
  return outlets;
}

function relaysFromOutlets(outlets) {
  return outlets.map((item) => (item.output === 0 || item.output === 1 ? item.output : null));
}

function parseMpowerEvent(message, client, topic, previous = {}, now = () => new Date()) {
  const username = client.authenticatedUsername;
  const clientDeviceId = /^mp[0-9a-f]+$/i.test(String(client.id || '')) ? String(client.id).slice(2).toLowerCase() : String(client.id || '');
  const root = `mpower/${username}/${clientDeviceId}`;
  const prefix = `${root}/`;
  if (!topic.startsWith(prefix) && topic !== root) return null;

  const rest = topic.slice(prefix.length);
  let payload;
  try { payload = JSON.parse(message); } catch { payload = message; }

  const currentOutlets = previous.outlets || [];
  const scalarEvent = (type, outlets, extra = {}) => {
    const normalized = outlets.map((item) => ({ ...item }));
    while (normalized.length < Math.max(previous.portCount || 3, 3)) normalized.push({ port: normalized.length + 1, output: null });
    return ({
    mqttUsername: username, deviceId: clientDeviceId, mqttEventTopic: topic,
    serverReceivedAt: now().toISOString(), type, outlets: normalized,
    relays: relaysFromOutlets(normalized), portCount: normalized.length,
    deviceUptimeMs: previous.deviceUptimeMs || 0, hostname: previous.hostname || '',
    ipAddress: previous.ipAddress || '', custom: previous.custom, ...extra, raw: payload
  }); };

  if (rest === 'uptime') {
    const seconds = toFinite(payload);
    if (seconds === null) return null;
    return scalarEvent('mpower_device_status', currentOutlets, { deviceUptimeMs: seconds * 1000 });
  }
  const relayMatch = rest.match(/^relay\/(\d+)$/);
  if (relayMatch) {
    const port = Number(relayMatch[1]), output = toBinary(payload);
    if (port < 1 || port > 32 || output === null) return null;
    return scalarEvent('mpower_outlet_status', mergeOutlet(currentOutlets, port, { relay: output }), { port });
  }
  const metricMatch = rest.match(/^outlet\/(\d+)\/(watt|wh|volt|amp|pf)$/);
  if (metricMatch) {
    const port = Number(metricMatch[1]), value = toFinite(payload);
    if (port < 1 || port > 32 || value === null) return null;
    return scalarEvent('mpower_outlet_status', mergeOutlet(currentOutlets, port, { [metricMatch[2]]: value }), { port });
  }
  if (rest === 'custom' && String(message).trim() === '') {
    return scalarEvent('mpower_custom', currentOutlets, { custom: null });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const received = () => now().toISOString();
  const base = {
    mqttUsername: username,
    deviceId: clientDeviceId,
    mqttEventTopic: topic,
    serverReceivedAt: received(),
    ipAddress: String(payload.ipAddress || payload.ip || payload.localip || previous.ipAddress || ''),
    hostname: String(payload.hostname || payload.name || payload.$name || previous.hostname || ''),
    deviceUptimeMs: toFinite(payload.deviceUptimeMs ?? payload.uptimeMs ?? (payload.uptime != null ? Number(payload.uptime) * 1000 : null), previous.deviceUptimeMs || 0) || 0,
    voltage: toFinite(payload.voltage, previous.voltage ?? null),
    temperature: toFinite(payload.temperature, previous.temperature ?? null),
    custom: payload.custom !== undefined ? payload.custom : previous.custom,
    macAddress: String(payload.mac || previous.macAddress || ''),
    firmware: String(payload.firmware || previous.firmware || ''),
    overlay: String(payload.overlay || previous.overlay || ''),
    ssid: String(payload.ssid || previous.ssid || ''),
    deviceDateTime: String(payload.now || previous.deviceDateTime || '')
  };

  if (rest === 'state') {
    const outlets = buildOutlets(payload, previous.outlets || []);
    const outletVoltage = outlets.find((item) => item.voltage !== null)?.voltage ?? null;
    return {
      ...base,
      type: 'mpower_device_status',
      voltage: base.voltage ?? outletVoltage,
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
  if (!['on', 'off', 'pulse', 'cycle'].includes(action)) return { ok: false, error: 'mPower action on/off/pulse/cycle olmalıdır.' };

  if ((action === 'on' || action === 'off') && payload.port === 'all') {
    return { ok: true, command: { action, port: 'all' } };
  }

  const port = Number(payload.port);
  if (!Number.isInteger(port) || port < 1 || port > 3) return { ok: false, error: 'port 1..3 arası tam sayı olmalıdır.' };

  if (action === 'pulse' || action === 'cycle') {
    const delay = Number(payload.delay);
    if (!Number.isInteger(delay) || delay < 0 || delay > 4294967) return { ok: false, error: `${action} komutu için delay 0..4294967 arası tam sayı olmalıdır.` };
    return { ok: true, command: { action, port, delay } };
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
