# Firewall Kurali Ekleme Script
# PowerShell'i YONETICI olarak calistirin

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FIREWALL KURALI EKLENIYOR" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Yonetici kontrolu
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "[HATA] Bu script yonetici yetkisi gerektirir!" -ForegroundColor Red
    Write-Host "PowerShell'i 'Yonetici olarak calistir' ile acin" -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "[OK] Yonetici yetkisi var" -ForegroundColor Green
Write-Host ""

# Mevcut kurali kontrol et
$existingRule = Get-NetFirewallRule -DisplayName "Zenshin Backend" -ErrorAction SilentlyContinue

if ($null -ne $existingRule) {
    Write-Host "[BILGI] Firewall kurali zaten mevcut" -ForegroundColor Yellow
    Write-Host "Mevcut kurali silip yeniden olusturmak ister misiniz? (E/H)" -ForegroundColor Yellow
    $response = Read-Host
    
    if ($response -eq "E" -or $response -eq "e") {
        Remove-NetFirewallRule -DisplayName "Zenshin Backend"
        Write-Host "[OK] Eski kural silindi" -ForegroundColor Green
    } else {
        Write-Host "[BILGI] Islem iptal edildi" -ForegroundColor Cyan
        pause
        exit 0
    }
}

# Yeni kural olustur
Write-Host "Port 3000 icin firewall kurali olusturuluyor..." -ForegroundColor Cyan

try {
    New-NetFirewallRule -DisplayName "Zenshin Backend" `
                        -Direction Inbound `
                        -LocalPort 3000 `
                        -Protocol TCP `
                        -Action Allow `
                        -Profile Any `
                        -Enabled True | Out-Null
    
    Write-Host "[OK] Firewall kurali basariyla olusturuldu!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Port 3000 artik acik" -ForegroundColor Green
    Write-Host "Backend'e erisim: http://VPS_IP:3000" -ForegroundColor Cyan
} catch {
    Write-Host "[HATA] Firewall kurali olusturulamadi!" -ForegroundColor Red
    Write-Host "Hata: $_" -ForegroundColor Red
    pause
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  FIREWALL AYARI TAMAMLANDI!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

pause
