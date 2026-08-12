# NetRelay MQTT Server

[Türkçe dokümantasyon](README.md)

A Node.js MQTT broker and management platform for NetRelay devices. It provides authenticated MQTT/MQTT TLS, a live role-based web panel, SQLite persistence, automation, notifications, REST/mobile access and Home Assistant MQTT Discovery.

## Where can I buy it?

NetRelay products are available from the official store: **[Buy NetRelay](https://netrelay.tr/satin-al)**

## Features

- MQTT on `31883` and optional TLS/mTLS on `38883`
- SQLite-backed MQTT users with add/edit/delete and enabled state
- Per-user topic ACL: `netrelay/<username>/*`
- MQTT and web-login brute-force protection/blacklist
- Live device cards, stale-device detection and Device I/O view
- QoS 1 relay, sync, restart, queued and OTA commands
- Change-based event history, audit log and CSV export
- Cron/sunrise/sunset schedules with exceptions and execution history
- Input, voltage and temperature rule engine with relay, SMTP and Netgsm actions
- Device groups, bulk control and offline command queue
- Group-scoped REST API keys for mobile apps, Node-RED and integrations
- Home Assistant Discovery for four relays and four digital inputs
- Database/settings backup and restore
- Automatic log compression/retention and Windows service scripts
- Turkish/English UI catalogs designed for additional languages
- Dark/light responsive panel and WebSocket delta updates

## Requirements

- Node.js 18 or newer
- npm
- Windows, Linux or macOS
- A fixed local IP or resolvable hostname for the server
- Open local firewall ports as required: `31883`, `38883`, `8082`

## Installation

```powershell
git clone https://github.com/mlteknoloji/mqttserver.git
cd mqttserver
npm install
Copy-Item .env.example .env
Copy-Item users.example.json users.json
npm start
```

For a downloaded archive, extract it, open a terminal in the project directory, run `npm install`, create `.env` and `users.json` from the examples, then run `npm start`.

> **Important:** Before the first `npm start`, set `INITIAL_ADMIN_PASSWORD` in `.env`. Otherwise the admin password is generated randomly and printed to the console only once; if missed, it must be reset. See [Configuration](#configuration) for details.

## Docker installation

The ready-to-run image is published to GitHub Container Registry as `ghcr.io/mlteknoloji/mqttserver:latest`. Docker Engine or Docker Desktop with Docker Compose is required on the target machine.

Clone the repository and create the runtime configuration files:

```powershell
git clone https://github.com/mlteknoloji/mqttserver.git
cd mqttserver
Copy-Item .env.example .env
Copy-Item users.example.json users.json
```

Replace the example usernames and passwords in `.env` and `users.json` before production use. If the GHCR package is private, sign in with your GitHub username and a Personal Access Token that has `read:packages` permission:

```powershell
docker login ghcr.io
```

Pull the image and start the server in the background:

```powershell
docker compose pull
docker compose up -d
```

Check the container, application logs and PM2 process:

```powershell
docker compose ps
docker compose logs -f
docker exec netrelay-mqtt-server pm2 status
```

The web panel is available at `http://localhost:8082` and the MQTT broker at `mqtt://localhost:31883`. The `restart: unless-stopped` setting in `compose.yml` starts the container again after a machine restart, while `pm2-runtime` restarts the application if it exits unexpectedly inside the container.

To change ports in a Docker installation, edit `MQTT_PORT`, `WEB_PORT`, `MQTT_TLS_PORT` or `WEB_HTTPS_PORT` in `.env`. The `compose.yml` file uses these values for both the host and container ports. Recreate the container to apply the change:

```powershell
docker compose up -d --force-recreate
docker compose ps
```

This installation uses the following custom ports instead of the standard ports:

```env
MQTT_PORT=31883
WEB_PORT=8082
MQTT_TLS_PORT=38883
```

With these settings, the web panel is available at `http://SERVER_IP:8082`, the plain MQTT broker at `mqtt://SERVER_IP:31883`, and the TLS broker at `mqtts://SERVER_IP:38883` when TLS is enabled. After changing the ports, update the firewall rules and the MQTT/MQTT TLS ports configured on every NetRelay device. Do not leave the unused former standard ports exposed to the internet.

Non-standard ports may reduce automated internet scanning, but they are not a security control by themselves. Strong unique passwords, MQTT TLS, login protection, firewall IP restrictions or a VPN are recommended.

Update the installation after a new image is published:

```powershell
docker compose pull
docker compose up -d
```

Or use the helper script (preserves `.env` and volumes):

```powershell
.\scripts\update.ps1 -Docker
```

Stop or restart the server with:

```powershell
docker compose stop
docker compose restart
```

To build the Docker image on GitHub, run `githuba_gonder.bat`. After the GitHub push completes, enter `E` at the Docker prompt or press Enter to accept the default `E` choice. Follow the build on the repository's **Actions → Docker imaji** page.

## Configuration

Typical `.env` values:

```env
HOST=0.0.0.0
MQTT_PORT=31883
WEB_PORT=8082
MQTT_HOST=192.168.1.100

MQTT_USERNAME=admin
MQTT_PASSWORD=replace-with-a-strong-password

MQTT_TLS_ENABLED=0
MQTT_TLS_PORT=38883
MQTT_TLS_KEY=certs/server-key.pem
MQTT_TLS_CERT=certs/server-cert.pem
MQTT_TLS_CA=certs/ca-cert.pem
MQTT_TLS_REQUEST_CLIENT_CERT=0
MQTT_TLS_CLIENT_CERT=certs/client-cert.pem
MQTT_TLS_CLIENT_KEY=certs/client-key.pem

FAIL2BAN_MAX_ATTEMPTS=5
FAIL2BAN_FIND_TIME_MINUTES=10
FAIL2BAN_BAN_TIME_MINUTES=60
SECURITY_DB_PATH=security.sqlite3

MQTT_TOPIC_ENFORCEMENT=1

WEB_HTTPS_ENABLED=0
WEB_HTTPS_PORT=3443
WEB_HTTPS_KEY=certs/server-key.pem
WEB_HTTPS_CERT=certs/server-cert.pem

WEB_LOGIN_MAX_ATTEMPTS=5
WEB_LOGIN_FIND_TIME_MINUTES=10
WEB_LOGIN_LOCK_MINUTES=15

INITIAL_ADMIN_USERNAME=admin@mlteknoloji.com
INITIAL_ADMIN_PASSWORD=at-least-12-char-strong-password
```

> **Initial admin password:** If `INITIAL_ADMIN_PASSWORD` is set in `.env`, that password is used. Otherwise a secure random password is generated and printed to the `npm start` console **only once** as `[GÜVENLİK] İlk yönetici parolasi (admin@mlteknoloji.com): ...`. To avoid missing it, set `INITIAL_ADMIN_PASSWORD` in `.env` before installation. If the password is lost, see [Resetting the admin password](#resetting-the-admin-password).

| Setting | Description |
|---|---|
| `HOST` | Listening address; `0.0.0.0` accepts all interfaces. |
| `MQTT_PORT` | Plain MQTT port, `31883` in this installation. |
| `WEB_PORT` | Web panel and REST API port, `8082` in this installation. |
| `MQTT_HOST` | Host used by `npm run client`. |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | Test-client credentials. |
| `MQTT_TLS_ENABLED` | Set to `1` to enable MQTT TLS. |
| `MQTT_TLS_PORT` | TLS MQTT port, `38883` in this installation. |
| `MQTT_TLS_KEY`, `MQTT_TLS_CERT` | PEM server private key and certificate. |
| `MQTT_TLS_CA` | CA used for server/client certificate verification. |
| `MQTT_TLS_REQUEST_CLIENT_CERT` | Set to `1` to require a valid client certificate. |
| `FAIL2BAN_*` | MQTT authentication-failure window, threshold and ban duration. |
| `SECURITY_DB_PATH` | SQLite database path. |
| `MQTT_TOPIC_ENFORCEMENT` | `1` (default) restricts each MQTT user to their own `netrelay/<username>/*` topics. `0` allows access to all topics. |
| `WEB_HTTPS_ENABLED` | Set to `1` to serve the web panel over HTTPS. |
| `WEB_HTTPS_PORT` | HTTPS web panel port. Default `3443`. |
| `WEB_HTTPS_KEY`, `WEB_HTTPS_CERT` | PEM private key and certificate for the web panel. |
| `WEB_HTTPS_CA` | Optional CA certificate for the web panel. |
| `WEB_LOGIN_MAX_ATTEMPTS` | Failed web-login attempts before an IP is locked. |
| `WEB_LOGIN_FIND_TIME_MINUTES` | Time window for counting failed web logins. |
| `WEB_LOGIN_LOCK_MINUTES` | Web-login lock duration in minutes. |
| `INITIAL_ADMIN_USERNAME` | Administrator username created on first install. Default `admin@mlteknoloji.com`. |
| `INITIAL_ADMIN_PASSWORD` | Password assigned to the admin on first install. At least 12 characters. If empty, a random password is generated and printed to the console. |

`.env`, `users.json`, SQLite databases, certificates' private keys and backup archives are ignored by Git. If any of them were ever published, remove them from history and rotate every affected secret.

### Initial MQTT users

`users.json` is an import/bootstrap format. Runtime users are managed from **System → MQTT Users** and stored in SQLite.

```json
{
  "users": [
    {"username":"admin","password":"strong-unique-password"},
    {"username":"device1","password":"different-strong-password"}
  ]
}
```

Use a different username and password for every card. Never share one device account across branches.

## Running the server

```powershell
npm start
```

The console prints reachable MQTT and web-panel addresses. Open:

```text
http://SERVER_IP:8082
```

The first web administrator is created automatically. The generated initial password is printed once to the server console and must be changed at first sign-in. The system always retains at least one active administrator; the final active admin cannot be deleted, disabled or demoted.

### Resetting the admin password

If the admin password is lost and the panel cannot be accessed, it can be reset directly in the database. Run the following command in the project directory; it generates a new random password for `admin@mlteknoloji.com`, prints it to the console, and forces a password change on first sign-in:

```powershell
node -e "const Database=require('better-sqlite3');const bcrypt=require('bcryptjs');const crypto=require('node:crypto');const db=new Database('security.sqlite3');const p=crypto.randomBytes(18).toString('base64url');db.prepare('UPDATE web_users SET password_hash=?, must_change_password=1, updated_at=? WHERE username=?').run(bcrypt.hashSync(p,12),Date.now(),'admin@mlteknoloji.com');db.prepare('DELETE FROM web_sessions').run();console.log('New temporary password:',p);"
```

After signing in with the printed password, you will be asked to set a new one. Only trusted personnel with direct server access should perform this procedure.

> **Note:** If `INITIAL_ADMIN_PASSWORD` and `INITIAL_ADMIN_USERNAME` are defined in `.env`, those values are used on first install. If undefined, a random password is generated and printed to the console. In production, setting `INITIAL_ADMIN_PASSWORD` with at least 12 characters is recommended.

For unattended Windows startup, see [Windows service setup](docs/WINDOWS-SERVICE.en.md).

## Connecting a NetRelay device

In the card's MQTT page configure:

| Device field | Value |
|---|---|
| MQTT Server | Server IP or DNS name, without scheme/path |
| MQTT Port | `31883`, or configured plain port |
| MQTT TLS | Enable when using TLS |
| MQTT TLS Port | `38883`, or configured TLS port |
| Server CA Certificate | PEM CA that signed the server certificate |
| Client Certificate/Key | Required only when mTLS is enabled |
| MQTT User/Password | One enabled MQTT account from the panel |
| MQTT Client Mode | Enabled |
| Client ID | Unique for every card |

After saving, restart the card if necessary. It should appear under **Online Devices**. Clicking its branch/username opens Device I/O with that card selected.

## MQTT TLS and mTLS

Place the server certificate and private key under `certs/`, then enable TLS:

```env
MQTT_TLS_ENABLED=1
MQTT_TLS_REQUEST_CLIENT_CERT=0
```

For mutual TLS:

```env
MQTT_TLS_ENABLED=1
MQTT_TLS_REQUEST_CLIENT_CERT=1
MQTT_TLS_CA=certs/ca-cert.pem
```

Every mTLS card needs its own client certificate and matching private key. Keep CA, server and client private keys outside Git and restrict filesystem permissions.

The server certificate Subject Alternative Name must match exactly what is entered in the device's MQTT Server field:

```ini
# Direct local IP (the DNS form is also included for older ESP32 TLS stacks)
subjectAltName=DNS:192.168.1.4,IP:192.168.1.4

# Local DNS
subjectAltName=DNS:mqtt.lan.example.com,IP:192.168.1.4

# Public domain
subjectAltName=DNS:mqtt.example.com
```

Do not enter `mqtt://`, `mqtts://`, a port or a path in the device's host field. Keep the device date/time correct because certificate validation depends on it.

### Certificate generation outline

The following OpenSSL flow creates a private CA and server certificate. Protect `ca-key.pem` carefully.

```powershell
New-Item -ItemType Directory -Force certs
Set-Location certs

openssl genrsa -out ca-key.pem 4096
openssl req -x509 -new -nodes -key ca-key.pem -sha256 -days 3650 -out ca-cert.pem -subj "/CN=NetRelay Root CA"

openssl genrsa -out server-key.pem 2048
openssl req -new -key server-key.pem -out server.csr -subj "/CN=192.168.1.4"
```

Create `server-ext.cnf` with the correct SAN:

```ini
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:192.168.1.4,IP:192.168.1.4
```

Then sign and verify:

```powershell
openssl x509 -req -in server.csr -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial -out server-cert.pem -days 825 -sha256 -extfile server-ext.cnf
openssl verify -CAfile ca-cert.pem server-cert.pem
```

For mTLS, generate a separate key/certificate per card with `extendedKeyUsage=clientAuth`. The server stores only the CA certificate used to validate clients; each card receives its own client certificate/key and the server CA certificate.

| Deployment | Device host | Certificate SAN | Port forwarding |
|---|---|---|---|
| Local IP | `192.168.1.4` | `DNS:192.168.1.4,IP:192.168.1.4` | None |
| Local DNS | `mqtt.lan.example.com` | `DNS:mqtt.lan.example.com` | None |
| Internet domain | `mqtt.example.com` | `DNS:mqtt.example.com` | TCP `38883` only |

Prefer a VPN for remote access. Never expose plain MQTT `31883` or the panel `8082` directly to the internet. If public access is unavoidable, use verified TLS, firewall restrictions and an authenticated HTTPS reverse proxy.

## MQTT topics and commands

Each normal device account is isolated to:

```text
netrelay/<username>/events
netrelay/<username>/command
```

Example relay command:

```json
{
  "type": "netrelay",
  "command": "set",
  "commandId": "unique-command-id",
  "targetUsername": "device1",
  "relays": [1, 2],
  "position": 1,
  "delay": 3
}
```

`position` is `0` or `1`. With `delay: 0` the new state remains; a positive delay restores the previous state after that many seconds. Relay, restart, sync, queue and OTA commands use MQTT QoS 1. Current firmware stores recent `commandId` values to make redelivery safe.

## Web panel

The role-aware panel includes:

- dashboard, online-device cards and device connection statistics
- Device I/O with relay switches, inputs, voltage, temperature, raw JSON, sync and restart
- change-only history filters and CSV export
- schedules, holidays/exceptions and run history
- automation rules with relay, e-mail and Netgsm SMS actions
- device groups and offline queues
- MQTT users, panel users and section permissions
- firmware catalog and MQTT OTA deployment
- SMTP, Netgsm, blacklist and log settings
- API keys, Home Assistant Discovery, backup/restore and log rotation
- Turkish/English language selection and light/dark themes

Detailed MQTT/TLS logs can be enabled under **Server Logs**. Passwords and private-key contents are never logged. Disable debug logging after troubleshooting to reduce log volume.

## REST API and mobile apps

Create device groups first, then issue a `read` or `control` key under **System → REST API**. Every new key is limited to selected groups; cards outside those groups cannot be listed, read or controlled.

```http
Authorization: Bearer nr_...
```

Key routes include devices, history, groups, relay control, sync, restart and group relay control. See [REST API and mobile guide](docs/REST-API.en.md).

## Home Assistant

1. Create an enabled MQTT user named `homeassistant` with a strong password.
2. Open **System → REST API**, enable Home Assistant Discovery and keep the recommended `homeassistant` prefix.
3. Click **Save and publish**.
4. Configure Home Assistant's MQTT integration with the server address, port `31883` or TLS `38883`, and this account.

Each NetRelay card appears as one device with four relay switches and four input binary sensors. The integration account receives only the extra Discovery/event/command topic permissions it requires.

## Firmware updates

Upload an ESP32 `.bin` with its version and hardware model under **Firmware Update**. The server validates the image header, OTA size and SHA-256, then sends a time-limited download URL and tracks device progress.

Existing `S-3.3.4` devices do not support the MQTT OTA command. Install the first OTA-capable `S-3.3.5` once through the card's `/system` web updater; later releases can be deployed centrally. Never interrupt power or networking during an update.

Current firmware downloads: [https://netrelay.tr/software](https://netrelay.tr/software)

## Backup, logs and service operation

- Backups can include SQLite plus optional environment settings; treat archives as secrets.
- Device lifecycle records use JSON Lines in `logs/device-status-YYYY-MM-DD.log`.
- Log rotation compresses old files to `.gz` and deletes them after the configured retention period.
- NSSM scripts install/uninstall the server as a recoverable Windows service.

See [Windows service setup](docs/WINDOWS-SERVICE.en.md).

## Test client and automated tests

With the server running, start the MQTT test client in another terminal:

```powershell
npm run client
```

Run the Node.js test suite:

```powershell
npm test
```

Tests cover topic/group isolation, API key hashing, history change detection, Home Assistant entities, translation completeness, event parsing, cron fields, login protection, WebSocket deltas, persistent settings and the active-administrator invariant.

## Troubleshooting

### MQTT authentication rejected

- Compare the exact username/password with the active SQLite MQTT-user record.
- Remove leading/trailing whitespace.
- Check blacklist/failure logs and topic authorization messages.

### MQTT connection fails

- Verify server IP/hostname and port.
- Confirm `npm start` or the Windows service is running.
- Check VLAN routing and firewall TCP `31883`/`38883`.
- For TLS, check device time, CA, SAN hostname/IP and optional client certificate.

### Panel does not open

- Try `http://localhost:8082` on the server.
- From another computer use the server IP, not `localhost`.
- Check TCP `8082` and whether another process occupies the port.

### Device is connected but missing

- Enable MQTT client mode and use a unique Client ID.
- Verify the account is active and inspect connection/status logs.
- Confirm the card publishes periodic status/events.

### `EADDRINUSE`

Another process already owns `31883`, `38883` or `8082`. Do not run both a terminal instance and the Windows service. Stop the duplicate process or change the port in `.env`.

## Project structure

```text
server.js                  MQTT broker, web/API and WebSocket server
web-auth.js                panel accounts, roles and login protection
mqtt-users.js              SQLite MQTT users
history.js                 event/audit persistence
automation-rules.js        event-driven rule engine
device-automation.js       groups and offline command queue
api-keys.js                hashed, scoped REST keys
home-assistant.js          MQTT Discovery definitions
views/                     panel pages
public/                    CSS, browser code and locale catalogs
docs/                      Turkish and English documentation
scripts/                   Windows service scripts
test/                      node:test suite
```

## Security

- Keep `.env`, databases, private keys and backups out of Git.
- Use unique strong credentials and rotate any exposed values.
- Keep MQTT topic enforcement and login protection enabled.
- Restrict API keys to the minimum groups and scopes.
- Use an IoT VLAN, firewall and VPN; use TLS/HTTPS for untrusted networks.
- Review audit/history records and revoke unused accounts/keys.

## Documentation

- [Detailed Turkish HTML guide](docs/netrelay-mqtt-kullanim-kilavuzu.html)
- [Detailed English HTML guide](docs/netrelay-mqtt-user-guide-en.html)
- [REST API – English](docs/REST-API.en.md) · [Türkçe](docs/REST-API.md)
- [Windows service – English](docs/WINDOWS-SERVICE.en.md) · [Türkçe](docs/WINDOWS-SERVICE.md)
- [Language system – English](docs/I18N.en.md) · [Türkçe](docs/I18N.md)

## License

This repository currently does not contain a separate license file.
