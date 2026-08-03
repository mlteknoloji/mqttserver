@echo off
setlocal

rem Kullanim:
rem   githuba_gonder.bat
rem   githuba_gonder.bat minor
rem   githuba_gonder.bat major "Yeni ana surum"
rem Varsayilan surum artisi: patch (1.0.0 -> 1.0.1)

cd /d "%~dp0"

set "SURUM_TURU=%~1"
if not defined SURUM_TURU set "SURUM_TURU=patch"

if /i not "%SURUM_TURU%"=="patch" if /i not "%SURUM_TURU%"=="minor" if /i not "%SURUM_TURU%"=="major" (
    echo HATA: Surum turu patch, minor veya major olmalidir.
    echo Ornek: githuba_gonder.bat minor "Yeni ozellikler"
    exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
    echo HATA: Git bulunamadi. Git'i kurup terminali yeniden aciniz.
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo HATA: npm bulunamadi. Node.js'i kurup terminali yeniden aciniz.
    exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo HATA: Bu klasor bir Git deposu degil.
    exit /b 1
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo HATA: origin uzak deposu tanimli degil.
    echo Ornek: git remote add origin https://github.com/KULLANICI/mqttserver.git
    exit /b 1
)

echo Surum %SURUM_TURU% olarak artiriliyor...
call npm version %SURUM_TURU% --no-git-tag-version
if errorlevel 1 (
    echo HATA: Surum guncellenemedi.
    exit /b 1
)

for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "YENI_SURUM=%%V"
if not defined YENI_SURUM (
    echo HATA: Yeni surum package.json dosyasindan okunamadi.
    exit /b 1
)

echo Dosyalar hazirlaniyor...
git add -A

git diff --cached --quiet
if not errorlevel 1 (
    echo Gonderilecek bir degisiklik bulunamadi.
    exit /b 0
)

set "MESAJ=%~2"
if not defined MESAJ set "MESAJ=Release v%YENI_SURUM%"

echo Commit olusturuluyor: %MESAJ%
git commit -m "%MESAJ%"
if errorlevel 1 (
    echo HATA: Commit olusturulamadi.
    exit /b 1
)

git tag -a "v%YENI_SURUM%" -m "Release v%YENI_SURUM%"
if errorlevel 1 (
    echo HATA: v%YENI_SURUM% etiketi olusturulamadi.
    exit /b 1
)

echo GitHub'a gonderiliyor...
git push origin HEAD
if errorlevel 1 (
    echo HATA: Commit GitHub'a gonderilemedi. Yerel commit ve etiket korundu.
    exit /b 1
)

git push origin "v%YENI_SURUM%"
if errorlevel 1 (
    echo HATA: Commit gonderildi ancak v%YENI_SURUM% etiketi gonderilemedi.
    exit /b 1
)

echo.
echo TAMAMLANDI: v%YENI_SURUM% GitHub'a gonderildi.
exit /b 0
