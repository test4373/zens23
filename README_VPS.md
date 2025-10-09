# 🚀 Zenshin Backend - Windows VPS Kurulum

Backend'i Windows 11 VPS'e kurmak için **3 kolay adım**!

## ⚡ Hızlı Başlangıç

### 1️⃣ Dosyaları VPS'e Aktar

BACKEND klasörünü VPS'e kopyalayın (RDP, OneDrive, GitHub, vb.)

### 2️⃣ Otomatik Kurulum

PowerShell'i **Yönetici olarak** açın ve çalıştırın:

```powershell
cd C:\path\to\BACKEND
.\install-vps.ps1
```

Bu script:
- ✅ Node.js kontrol eder (yoksa yükler)
- ✅ Bağımlılıkları yükler
- ✅ Klasörleri oluşturur
- ✅ Firewall'u ayarlar
- ✅ PM2 kurar (opsiyonel)

### 3️⃣ Sunucuyu Başlat

**Seçenek A: Batch ile (Kolay)**
```cmd
start-vps.bat
```

**Seçenek B: PM2 ile (Önerilen - Arka planda çalışır)**
```powershell
pm2 start pm2-ecosystem.config.js
pm2 save
pm2 startup
```

**Seçenek C: Manuel**
```powershell
npm start
```

## 🎯 Test

Tarayıcıda açın:
```
http://VPS_IP_ADRESI:3000/ping
```

Yanıt: `pong` ✅

## 📚 Detaylı Rehberler

- **[VPS_KURULUM.md](VPS_KURULUM.md)** - Detaylı kurulum rehberi
- **[FRONTEND_BAGLANTI.md](FRONTEND_BAGLANTI.md)** - Frontend bağlantı rehberi

## 🔧 Hızlı Komutlar

```powershell
# Sunucu durumu
pm2 status

# Logları görüntüle
pm2 logs zenshin-backend

# Yeniden başlat
pm2 restart zenshin-backend

# Durdur
pm2 stop zenshin-backend

# Admin oluştur
npm run create-admin

# Port kontrolü
netstat -ano | findstr :3000
```

## 🌐 Frontend Bağlantısı

Frontend `.env` dosyasında:

```env
VITE_BACKEND_URL=http://VPS_IP_ADRESI:3000
```

## 🔒 Güvenlik

1. **Firewall**: Port 3000 açık olmalı
2. **Admin Şifresi**: Güçlü şifre kullanın
3. **Windows Update**: VPS'i güncel tutun
4. **HTTPS**: Production'da SSL kullanın (Cloudflare Tunnel önerilir)

## 🐛 Sorun mu var?

### Backend başlamıyor
```powershell
# Logları kontrol et
pm2 logs zenshin-backend

# Veya manuel çalıştır
node server.js
```

### Port zaten kullanımda
```powershell
# Portu kullanan process'i bul
netstat -ano | findstr :3000

# Process'i sonlandır
taskkill /PID PROCESS_ID /F
```

### Node modülleri hatası
```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

## 📊 Sistem Gereksinimleri

- **OS**: Windows 11 (veya Windows Server 2019+)
- **RAM**: Minimum 4GB (8GB+ önerilir)
- **Disk**: 50GB+ boş alan
- **Network**: 100 Mbps+ internet
- **Node.js**: 18+ (LTS)

## 🎉 Kurulum Tamamlandı!

Backend başarıyla çalışıyor. Şimdi frontend'i bağlayabilirsiniz.

**Test URL'leri:**
- Health: `http://VPS_IP:3000/ping`
- Torrents: `http://VPS_IP:3000/active-torrents`
- Stats: `http://VPS_IP:3000/network-stats`

## 💡 İpuçları

1. **PM2 kullanın** - Sunucu crash olsa bile otomatik yeniden başlar
2. **Cloudflare Tunnel** - Ücretsiz HTTPS ve domain
3. **Monitoring** - `pm2 monit` ile gerçek zamanlı izleme
4. **Backup** - Veritabanını düzenli yedekleyin
5. **Updates** - Backend'i güncel tutun

## 🆘 Destek

- GitHub Issues
- Discord/Telegram topluluğu
- [VPS_KURULUM.md](VPS_KURULUM.md) - Detaylı sorun giderme

---

**Not:** Render.com kullanmıyorsunuz, bu yüzden `render.yaml` ve deployment scriptleri görmezden gelebilirsiniz. VPS kurulumu için yukarıdaki adımlar yeterli.
