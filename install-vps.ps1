# Zenshin Backend - Windows VPS Kurulum Script
# PowerShell ile calistirin: .\install-vps.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ZENSHIN BACKEND - VPS KURULUM" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Yonetici kontrolu
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[UYARI] Bu script yonetici yetkisi gerektirir" -ForegroundColor Yellow
    Write-Host "PowerShell'i 'Yonetici olarak calistir' ile acin" -ForegroundColor Yellow
    Write-Host ""
}

# Node.js kontrolu
Write-Host "[1/8] Node.js kontrol ediliyor..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "[OK] Node.js bulundu: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[HATA] Node.js bulunamadi!" -ForegroundColor Red
    Write-Host "Node.js yuklemek ister misiniz? (E/H)" -ForegroundColor Yellow
    $response = Read-Host
    if ($response -eq "E" -or $response -eq "e") {
        Write-Host "Node.js indiriliyor..." -ForegroundColor Cyan
        try {
            winget install OpenJS.NodeJS.LTS
            Write-Host "[OK] Node.js yuklendi. Lutfen PowerShell'i yeniden baslatin." -ForegroundColor Green
            pause
            exit
        } catch {
            Write-Host "[HATA] Otomatik yukleme basarisiz." -ForegroundColor Red
            Write-Host "Manuel yukleme: https://nodejs.org" -ForegroundColor Yellow
            pause
            exit 1
        }
    } else {
        Write-Host "Node.js gerekli. Kurulumu iptal ediliyor." -ForegroundColor Red
        pause
        exit 1
    }
}
Write-Host ""

# npm kontrolu
Write-Host "[2/8] npm kontrol ediliyor..." -ForegroundColor Yellow
try {
    $npmVersion = npm --version
    Write-Host "[OK] npm bulundu: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "[HATA] npm bulunamadi!" -ForegroundColor Red
    pause
    exit 1
}
Write-Host ""

# Bagimliliklar yukleme
Write-Host "[3/8] Bagimliliklar yukleniyor..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    Write-Host "[BILGI] node_modules mevcut, atlanıyor..." -ForegroundColor Cyan
} else {
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[HATA] npm install basarisiz!" -ForegroundColor Red
        pause
        exit 1
    }
    Write-Host "[OK] Bagimliliklar yuklendi" -ForegroundColor Green
}
Write-Host ""

# Gerekli klasorleri olustur
Write-Host "[4/8] Klasorler olusturuluyor..." -ForegroundColor Yellow
$folders = @("downloads", "temp_subs", "hls_cache", "uploads")
foreach ($folder in $folders) {
    if (-not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder | Out-Null
        Write-Host "[OK] $folder olusturuldu" -ForegroundColor Green
    } else {
        Write-Host "[BILGI] $folder zaten mevcut" -ForegroundColor Cyan
    }
}
Write-Host ""

# Veritabani kontrolu
Write-Host "[5/8] Veritabani kontrol ediliyor..." -ForegroundColor Yellow
$dbFiles = Get-ChildItem -Filter "*.db" -ErrorAction SilentlyContinue
if ($dbFiles.Count -eq 0) {
    Write-Host "[UYARI] Veritabani bulunamadi" -ForegroundColor Yellow
    Write-Host "Ilk admin kullanicisi olusturmak ister misiniz? (E/H)" -ForegroundColor Yellow
    $response = Read-Host
    if ($response -eq "E" -or $response -eq "e") {
        npm run create-admin
    } else {
        Write-Host "[BILGI] Admin olusturma atlandı. Daha sonra 'npm run create-admin' calistirin." -ForegroundColor Cyan
    }
} else {
    Write-Host "[OK] Veritabani mevcut" -ForegroundColor Green
}
Write-Host ""

# Firewall kurali
Write-Host "[6/8] Firewall kurali kontrol ediliyor..." -ForegroundColor Yellow
if ($isAdmin) {
    $existingRule = Get-NetFirewallRule -DisplayName "Zenshin Backend" -ErrorAction SilentlyContinue
    if ($null -eq $existingRule) {
        Write-Host "Port 3000 icin firewall kurali olusturuluyor..." -ForegroundColor Cyan
        try {
            New-NetFirewallRule -DisplayName "Zenshin Backend" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow | Out-Null
            Write-Host "[OK] Firewall kurali olusturuldu" -ForegroundColor Green
        } catch {
            Write-Host "[UYARI] Firewall kurali olusturulamadi" -ForegroundColor Yellow
            Write-Host "Manuel olarak port 3000'i acin" -ForegroundColor Yellow
        }
    } else {
        Write-Host "[OK] Firewall kurali zaten mevcut" -ForegroundColor Green
    }
} else {
    Write-Host "[UYARI] Yonetici yetkisi yok, firewall kurali atlandı" -ForegroundColor Yellow
    Write-Host "Manuel komut: New-NetFirewallRule -DisplayName 'Zenshin Backend' -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow" -ForegroundColor Cyan
}
Write-Host ""

# PM2 kurulumu (opsiyonel)
Write-Host "[7/8] PM2 kontrol ediliyor..." -ForegroundColor Yellow
try {
    $pm2Version = pm2 --version
    Write-Host "[OK] PM2 bulundu: $pm2Version" -ForegroundColor Green
} catch {
    Write-Host "[BILGI] PM2 bulunamadi" -ForegroundColor Cyan
    Write-Host "PM2 (Process Manager) yuklemek ister misiniz? (E/H)" -ForegroundColor Yellow
    Write-Host "PM2 sunucuyu arka planda surekli calistirir ve otomatik yeniden baslatir" -ForegroundColor Gray
    $response = Read-Host
    if ($response -eq "E" -or $response -eq "e") {
        Write-Host "PM2 yukleniyor..." -ForegroundColor Cyan
        npm install -g pm2
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] PM2 yuklendi" -ForegroundColor Green
            Write-Host ""
            Write-Host "PM2 ile baslatmak icin:" -ForegroundColor Cyan
            Write-Host "  pm2 start server.js --name zenshin-backend" -ForegroundColor White
            Write-Host "  pm2 save" -ForegroundColor White
            Write-Host "  pm2 startup" -ForegroundColor White
        } else {
            Write-Host "[UYARI] PM2 yuklenemedi" -ForegroundColor Yellow
        }
    }
}
Write-Host ""

# IP adresini al
Write-Host "[8/8] Network bilgileri..." -ForegroundColor Yellow
$ipAddresses = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" } | Select-Object -ExpandProperty IPAddress
Write-Host "[OK] VPS IP Adresleri:" -ForegroundColor Green
foreach ($ip in $ipAddresses) {
    Write-Host "  - http://${ip}:3000" -ForegroundColor Cyan
}
Write-Host ""

# Kurulum tamamlandi
Write-Host "========================================" -ForegroundColor Green
Write-Host "  KURULUM TAMAMLANDI!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Sunucuyu baslatmak icin:" -ForegroundColor Yellow
Write-Host "  1. Manuel: " -ForegroundColor White -NoNewline
Write-Host "npm start" -ForegroundColor Cyan
Write-Host "  2. PM2 ile: " -ForegroundColor White -NoNewline
Write-Host "pm2 start server.js --name zenshin-backend" -ForegroundColor Cyan
Write-Host "  3. Batch ile: " -ForegroundColor White -NoNewline
Write-Host ".\start-vps.bat" -ForegroundColor Cyan
Write-Host ""
Write-Host "Test URL: " -ForegroundColor White -NoNewline
Write-Host "http://localhost:3000/ping" -ForegroundColor Cyan
Write-Host ""
Write-Host "Daha fazla bilgi icin: " -ForegroundColor White -NoNewline
Write-Host "VPS_KURULUM.md" -ForegroundColor Cyan
Write-Host ""

pause
