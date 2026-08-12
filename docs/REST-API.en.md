# NetRelay REST API v1

[Türkçe](REST-API.md)

Create a key under **System → REST API** in the administrator panel. The token is displayed once; only its SHA-256 digest is stored by the server.

```http
Authorization: Bearer nr_...
```

`X-API-Key` is supported as an alternative header. Each key is limited to 120 requests per minute. `read` permits device/history reads; `control` includes read access and permits commands. Every new key must be assigned to at least one device group and can access only those groups and their members.

| Method | Endpoint | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/health` | None | Server health/version |
| GET | `/api/v1/devices` | read | Authorized online devices |
| GET | `/api/v1/devices/:username` | read | Live state of one device |
| GET | `/api/v1/history?username=device1&limit=100` | read | Change history |
| GET | `/api/v1/device-groups` | read | Assigned device groups |
| GET | `/api/v1/device-groups/:id` | read | One assigned group |
| POST | `/api/v1/device-groups/:id/relays` | control | Group relay command |
| POST | `/api/v1/devices/:username/relays` | control | Device relay / outlet command (NetRelay and NetRelayMP) |
| POST | `/api/v1/devices/:username/mpower` | control | Native NetRelayMP mPower command |
| POST | `/api/v1/devices/:username/restart` | control | Restart device |
| POST | `/api/v1/devices/:username/sync` | control | Request current state |

Relay request:

```json
{"relays":[1,2],"position":1,"delay":0}
```

Native NetRelayMP command example (`POST /devices/:username/mpower`):

```json
{"action":"on","port":1}
```

Accepted commands return `202 Accepted`. Common error codes include `INVALID_API_KEY`, `INSUFFICIENT_SCOPE`, `RATE_LIMITED`, `DEVICE_OFFLINE`, `INVALID_COMMAND`, `INVALID_DEVICE_TYPE`, `UNSUPPORTED` and `COMMAND_FAILED`.

## Device-group isolation

Group relay request:

```json
{"relays":[1,2],"position":1,"delay":0,"queueOffline":true}
```

With `queueOffline: true`, commands for offline members are queued. The response reports `sent`, `queued` or `offline` for every member plus summary counters.

`GET /api/v1/devices` returns cards only for members of the key's assigned groups. Single-device state, history, relay, restart and sync routes enforce the same set. Out-of-scope resources return `404 Not Found` to avoid leaking their existence. Group-scoped keys cannot create, edit or delete group definitions; manage membership under `/device-groups` in the administrator panel.

## Mobile application integration

Store the base URL as `https://server-address/api/v1`. On initial connection call `GET /health`, then authenticate with `GET /devices`. Build the UI only from returned devices.

Recommended screens:

1. Server URL and token setup
2. Authorized online-device list
3. Relay/input/voltage/temperature/uptime detail
4. Confirmed relay, sync and restart actions
5. Per-device event history

Store tokens with Android Keystore or iOS Keychain, never in source code, plain settings or logs. Do not embed a shared key in a public app-store build; use a user-authenticated intermediary service in that scenario. Handle `401`, `403`, `404`, `409` and `429` explicitly and use measured polling with backoff.

```js
const response = await fetch(`${baseUrl}/devices/biga_sube/relays`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ relays: [1], position: 1, delay: 0 })
});
```

## Home Assistant

First create an enabled, strongly protected `homeassistant` account under **MQTT Users**. Under **System → REST API**, keep the recommended `homeassistant` Discovery prefix, enable Discovery, and click **Save and publish**. Configure Home Assistant's MQTT integration with this broker account on port `1883`, or `8883` with CA-verified TLS.

Each card is discovered as one device with four relay `switch` entities and four input `binary_sensor` entities. Input entities process both real-time input events and periodic status packets. The integration account receives only the Discovery, event-subscription and command-publication topic permissions it requires.
