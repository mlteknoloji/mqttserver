# Running NetRelay as a Windows service

[Türkçe](WINDOWS-SERVICE.md)

NSSM is the recommended method. It runs the application when no user is signed in, restarts it after a failure, and writes Node.js output to `logs/service-output.log`.

## NSSM installation

1. Install Node.js LTS and NSSM. Confirm that `node.exe` and `nssm.exe` are available through `PATH`.
2. Open PowerShell as Administrator and change to the project directory.
3. Install production dependencies and the service:

```powershell
npm ci --omit=dev
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-windows-service.ps1
```

The default service name is `NetRelayMQTT`. Use `-ServiceName NetRelayTest` to choose another name.

```powershell
Get-Service NetRelayMQTT
Restart-Service NetRelayMQTT
Stop-Service NetRelayMQTT
Start-Service NetRelayMQTT
```

Before an update, stop the service, update files and dependencies, then start it again. Preserve `.env` and `security.sqlite3`.

```powershell
Stop-Service NetRelayMQTT
npm ci --omit=dev
Start-Service NetRelayMQTT
```

To uninstall from an elevated PowerShell prompt:

```powershell
.\scripts\uninstall-windows-service.ps1
```

This removes only the Windows service registration; it does not delete the database, settings or logs.

## PM2 alternative

PM2 can monitor the application, but reliable Windows startup also requires a startup manager or Task Scheduler configuration. NSSM is therefore simpler for production Windows installations.

```powershell
npm install --global pm2
pm2 start server.js --name netrelay-mqtt --cwd "D:\role_kart_tasarim\mqttserver"
pm2 save
pm2 status
pm2 logs netrelay-mqtt
```

If ports remain occupied, confirm that a terminal instance and the service are not running at the same time.
