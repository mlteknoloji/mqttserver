# Changelog

[Türkçe](CHANGELOG.md)

## v1.0.18

### Added
- **NetRelayMP (mPower) device support:** Telemetry (`mpower/<id>/state`, `custom`, `outlet/N/json`) and command (`mpower/<id>/cmd`) infrastructure.
- **Device type selection:** MQTT users can be set to `NetRelay` or `NetRelayMP`; the registry is ready for additional types later.
- **Panel and I/O:** Device-type-aware command form, outlet controls, and pulse / cycle actions.
- **REST API:** `POST /api/v1/devices/:username/mpower` for native mPower commands; existing `/relays` also works for NetRelayMP.
- **Update scripts:** `scripts/update.ps1` and `scripts/update.sh` pull GitHub/Docker updates while preserving settings.
- **Admin password reset:** Restore from `.env` `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD` with `npm run reset-admin` (alias: `npm run sifre-sifirla`).

### Preserved settings
Updates leave `.env`, `users.json`, `security.sqlite3`, and Docker volume data unchanged. Existing NetRelay accounts default to type `netrelay`.

### How to update
```powershell
# Windows
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\update.ps1
```

```bash
# Linux / macOS
chmod +x scripts/update.sh
./scripts/update.sh
```

Docker:
```powershell
.\scripts\update.ps1 -Docker
```
