# Windows 11 VPS Kurulum Rehberi

Bu rehber, Zenshin backend'ini Windows 11 VPS'e kurmak için gerekli adımları içerir.

## 🚀 Hızlı Kurulum

### 1. Gereksinimler
- Windows 11 VPS
- Node.js 18+ (LTS önerilir)
- Git (opsiyonel)
- Port 3000 açık olmalı

### 2. Node.js Kurulumu

VPS'e bağlandıktan sonra PowerShell'i yönetici olarak açın:

```powershell
# Node.js indirme (LTS versiyon)
# https://nodejs.org/en/download/ adresinden Windows Installer (.msi) indirin
# Veya winget kullanın:
winget install OpenJS.NodeJS.LTS
```

Node.js kurulumunu kontrol edin:
```powershell
node --version
npm --version
```

### 3. Backend Dosyalarını VPS'e Aktarma

**Seçenek A: GitHub üzerinden (önerilir)**
```powershell
# Eğer projeniz GitHub'daysa
git clone https://github.com/KULLANICI_ADI/PROJE_ADI.git
cd PROJE_ADI/BACKEND
```

**Seçenek B: Manuel aktarım**
1. BACKEND klasörünü zip'leyin
2. VPS'e RDP ile bağlanın
3. Zip dosyasını VPS'e kopyalayın (RDP clipboard paylaşımı veya OneDrive/Google Drive)
4. Zip'i açın

### 4. Bağımlılıkları Yükleme

```powershell
cd BACKEND
npm install
```

### 5. Veritabanı Oluşturma

İlk admin kullanıcısı oluşturun:
```powershell
npm run create-admin
```

Kullanıcı adı ve şifre girin.

### 6. Sunucuyu Başlatma

**Geliştirme Modu (test için):**
```powershell
npm start
```

**Production Modu (sürekli çalışması için):**
```powershell
# PM2 kurulumu (process manager)
npm install -g pm2

# Sunucuyu başlat
pm2 start server.js --name zenshin-backend

# Otomatik başlatma (Windows başlangıcında)
pm2 startup
pm2 save
```

### 7. Firewall Ayarları

Port 3000'i açın:
```powershell
# PowerShell (Yönetici)
New-NetFirewallRule -DisplayName "Zenshin Backend" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

### 8. Backend'e Erişim

Backend şu adreste çalışacak:
```
http://VPS_IP_ADRESI:3000
```

Test için:
```
http://VPS_IP_ADRESI:3000/ping
```

Yanıt: `pong`

## 🔧 Yapılandırma

### Port Değiştirme

`server.js` dosyasının sonunda PORT değişkenini bulun ve değiştirin:

```javascript
const PORT = process.env.PORT || 3000; // İstediğiniz port
```

### Frontend Bağlantısı

Frontend'de backend URL'ini güncelleyin. Frontend `.env` dosyasında:

```env
VITE_BACKEND_URL=http://VPS_IP_ADRESI:3000
```

## 📊 Sunucu Yönetimi

### PM2 Komutları

```powershell
# Durumu kontrol et
pm2 status

# Logları görüntüle
pm2 logs zenshin-backend

# Yeniden başlat
pm2 restart zenshin-backend

# Durdur
pm2 stop zenshin-backend

# Sil
pm2 delete zenshin-backend

# Monitoring
pm2 monit
```

### Sunucu Logları

```powershell
# PM2 ile
pm2 logs zenshin-backend --lines 100

# Manuel çalıştırıyorsanız
# Loglar console'da görünür
```

## 🔒 Güvenlik Önerileri

1. **Firewall**: Sadece gerekli portları açın (3000, RDP)
2. **Admin Şifresi**: Güçlü şifre kullanın
3. **HTTPS**: Production'da SSL sertifikası kullanın (Nginx/Caddy ile)
4. **Rate Limiting**: Zaten aktif (server.js'de)
5. **Windows Update**: VPS'i güncel tutun

## 🌐 Domain Bağlama (Opsiyonel)

### Cloudflare Tunnel (Ücretsiz)

1. Cloudflare hesabı oluşturun
2. Cloudflared kurulumu:

```powershell
# Cloudflared indir
# https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

# Tunnel oluştur
cloudflared tunnel login
cloudflared tunnel create zenshin-backend
cloudflared tunnel route dns zenshin-backend api.yourdomain.com

# Config dosyası oluştur (C:\Users\USERNAME\.cloudflared\config.yml)
```

config.yml:
```yaml
tunnel: TUNNEL_ID
credentials-file: C:\Users\USERNAME\.cloudflared\TUNNEL_ID.json

ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

```powershell
# Tunnel'ı başlat
cloudflared tunnel run zenshin-backend

# Servis olarak kur
cloudflared service install
```

## 🐛 Sorun Giderme

### Port zaten kullanımda
```powershell
# Portu kullanan process'i bul
netstat -ano | findstr :3000

# Process'i sonlandır
taskkill /PID PROCESS_ID /F
```

### Node modülleri hatası
```powershell
# node_modules'u sil ve yeniden yükle
Remove-Item -Recurse -Force node_modules
npm install
```

### FFmpeg hatası
Backend otomatik olarak FFmpeg'i yükler. Manuel yükleme:
```powershell
# Chocolatey ile
choco install ffmpeg

# Veya manuel: https://ffmpeg.org/download.html
```

### Veritabanı hatası
```powershell
# Veritabanını sıfırla
Remove-Item *.db
npm run create-admin
```

## 📈 Performans İyileştirme

### 1. Windows Defender İstisnaları
```powershell
# Backend klasörünü taramadan hariç tut
Add-MpPreference -ExclusionPath "C:\path\to\BACKEND"
```

### 2. Disk Optimizasyonu
- SSD kullanın
- Downloads klasörü için yeterli alan bırakın (min 50GB)

### 3. RAM Optimizasyonu
- Minimum 4GB RAM önerilir
- 8GB+ ideal

### 4. Network Optimizasyonu
- Hızlı internet bağlantısı (min 100 Mbps)
- Unlimited bandwidth

## 🔄 Güncelleme

```powershell
# Git ile
git pull origin main
npm install
pm2 restart zenshin-backend

# Manuel
# Yeni dosyaları kopyalayın
npm install
pm2 restart zenshin-backend
```

## 📞 Destek

Sorun yaşarsanız:
1. Logları kontrol edin: `pm2 logs zenshin-backend`
2. GitHub Issues'da sorun açın
3. Discord/Telegram topluluğuna katılın

## ✅ Kurulum Tamamlandı!

Backend başarıyla kuruldu. Şimdi frontend'i yapılandırabilirsiniz.

**Test URL'leri:**
- Health Check: `http://VPS_IP:3000/ping`
- Active Torrents: `http://VPS_IP:3000/active-torrents`
- Network Stats: `http://VPS_IP:3000/network-stats`
