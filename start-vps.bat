@echo off
echo ========================================
echo   ZENSHIN BACKEND - VPS STARTER
echo ========================================
echo.

REM Node.js kontrolu
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [HATA] Node.js bulunamadi!
    echo Lutfen Node.js yukleyin: https://nodejs.org
    pause
    exit /b 1
)

echo [OK] Node.js bulundu
node --version
echo.

REM npm kontrolu
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [HATA] npm bulunamadi!
    pause
    exit /b 1
)

echo [OK] npm bulundu
npm --version
echo.

REM node_modules kontrolu
if not exist "node_modules\" (
    echo [UYARI] node_modules bulunamadi
    echo Bagimliliklari yukleniyor...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [HATA] npm install basarisiz!
        pause
        exit /b 1
    )
    echo [OK] Bagimliliklar yuklendi
    echo.
)

REM Veritabani kontrolu
if not exist "*.db" (
    echo [UYARI] Veritabani bulunamadi
    echo Ilk admin kullanicisi olusturuluyor...
    call npm run create-admin
    echo.
)

REM Gerekli klasorleri olustur
if not exist "downloads\" mkdir downloads
if not exist "temp_subs\" mkdir temp_subs
if not exist "hls_cache\" mkdir hls_cache
if not exist "uploads\" mkdir uploads

echo [OK] Klasorler hazir
echo.

REM Firewall kontrolu
echo [BILGI] Port 3000 firewall'da acik olmali
echo Eger baglanti sorunu yasarsaniz:
echo   New-NetFirewallRule -DisplayName "Zenshin" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
echo.

echo ========================================
echo   SUNUCU BASLATILIYOR...
echo ========================================
echo.
echo Backend adresi: http://localhost:3000
echo Durdurmak icin: CTRL+C
echo.

REM Sunucuyu baslat
node server.js

pause
