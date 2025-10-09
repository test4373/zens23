# 🎉 Kurulum Tamamlandı - Sonraki Adımlar

Kurulum başarıyla tamamlandı! Şimdi sunucuyu başlatıp test edelim.

## 📋 Kurulum Özeti

✅ Node.js: v22.20.0  
✅ npm: 10.9.3  
✅ Bağımlılıklar: Yüklendi  
✅ Klasörler: Oluşturuldu  
✅ Veritabanı: Mevcut  
✅ PM2: Yüklendi  
⚠️ Firewall: Manuel ayar gerekli

## 🔥 ÖNEMLİ: Firewall Ayarı

Firewall kuralı henüz eklenmedi. **Yönetici yetkisi** ile ekleyin:

### Seçenek 1: Otomatik (Önerilen)
```powershell
# PowerShell'i YONETICI olarak aç
.\setup-firewall.ps1
```

### Seçenek 2: Manuel
```powershell
# PowerShell'i YONETICI olarak aç
New-NetFirewallRule -DisplayName "Zenshin Backend" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

## 🚀 Sunucuyu Başlatma

Firewall ayarını yaptıktan sonra sunucuyu başlatın:

### Seçenek 1: PM2 ile (ÖNERİLEN)

PM2 sunucuyu arka planda çalıştırır ve otomatik yeniden başlatır.

```powershell
# Backend klasöründe
pm2 start server.js --name zenshin-backend

# Kaydet (Windows ba��langıcında otomatik başlat)
pm2 save

# Startup script oluştur
pm2 startup

# Veya ecosystem config ile (daha gelişmiş)
pm2 start pm2-ecosystem.config.js
pm2 save
```

**PM2 Komutları:**
```powershell
pm2 status                    # Durum kontrolü
pm2 logs zenshin-backend      # Logları görüntüle
pm2 monit                     # Gerçek zamanlı monitoring
pm2 restart zenshin-backend   # Yeniden başlat
pm2 stop zenshin-backend      # Durdur
pm2 delete zenshin-backend    # Sil
```

### Seçenek 2: Batch ile (Kolay)

```cmd
start-vps.bat
```

Bu yöntem console penceresinde çalışır. Pencereyi kapatırsanız sunucu durur.

### Seçenek 3: Manuel

```powershell
npm start
```

## 🧪 Test Etme

Sunucu başladıktan sonra test edin:

### 1. Localhost Test
```
http://localhost:3000/ping
```
Yanıt: `pong` ✅

### 2. VPS IP Test

Tespit edilen IP adresleri:
- `http://10.1.0.104:3000/ping`
- `http://172.24.192.1:3000/ping`
- `http://100.115.129.2:3000/ping`

**Not:** Genellikle ilk IP (10.1.0.104) local network IP'sidir. Dışarıdan erişim için VPS'in **public IP**'sini kullanın.

### 3. Public IP Bulma

```powershell
# PowerShell
(Invoke-WebRequest -Uri "https://api.ipify.org").Content

# Veya tarayıcıda
# https://whatismyipaddress.com
```

Public IP'yi bulduktan sonra:
```
http://PUBLIC_IP:3000/ping
```

### 4. Diğer Test URL'leri

```
http://PUBLIC_IP:3000/active-torrents
http://PUBLIC_IP:3000/network-stats
```

## 🌐 Frontend Bağlantısı

Backend çalıştıktan sonra frontend'i bağlayın:

### 1. Frontend .env Dosyası

Frontend klasöründe `.env` dosyası oluşturun:

```env
VITE_BACKEND_URL=http://PUBLIC_IP:3000
```

Örnek:
```env
VITE_BACKEND_URL=http://45.123.45.67:3000
```

### 2. Frontend Deploy

**Vercel (Önerilen):**
```bash
cd FRONTEND
npm install -g vercel
vercel login
vercel

# Environment variable ekle
vercel env add VITE_BACKEND_URL
# Değer: http://PUBLIC_IP:3000
```

**Netlify:**
```bash
cd FRONTEND
npm install -g netlify-cli
netlify login
netlify init
```

**GitHub Pages:**
```bash
cd FRONTEND
npm install --save-dev gh-pages
npm run deploy
```

Detaylı rehber: `FRONTEND_BAGLANTI.md`

## 🔒 HTTPS Kurulumu (Önerilen)

Production için HTTPS kullanın:

### Cloudflare Tunnel (Ücretsiz)

1. Cloudflare hesabı oluştur
2. Domain ekle (ücretsiz domain: freenom.com)
3. Cloudflared kur:

```powershell
# Cloudflared indir
# https://github.com/cloudflare/cloudflared/releases

# Tunnel oluştur
cloudflared tunnel login
cloudflared tunnel create zenshin-backend

# Config dosyası: C:\Users\USERNAME\.cloudflared\config.yml
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
# Tunnel başlat
cloudflared tunnel run zenshin-backend

# Servis olarak kur
cloudflared service install
```

Artık backend'e şu adresten erişebilirsiniz:
```
https://api.yourdomain.com
```

Frontend .env:
```env
VITE_BACKEND_URL=https://api.yourdomain.com
```

## 📊 Monitoring

### PM2 Monitoring

```powershell
# Gerçek zamanlı monitoring
pm2 monit

# Loglar
pm2 logs zenshin-backend --lines 100

# Durum
pm2 status

# Detaylı bilgi
pm2 show zenshin-backend
```

### Windows Task Manager

- CPU kullanımı
- RAM kullanımı
- Network trafiği

## 🐛 Sorun Giderme

### Sunucu başlamıyor

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

### Firewall sorunu

```powershell
# Firewall kuralını kontrol et
Get-NetFirewallRule -DisplayName "Zenshin Backend"

# Kuralı sil ve yeniden oluştur
Remove-NetFirewallRule -DisplayName "Zenshin Backend"
.\setup-firewall.ps1
```

### Frontend bağlanamıyor

1. Backend çalışıyor mu? `pm2 status`
2. Firewall açık mı? Port 3000
3. Public IP doğru mu?
4. CORS ayarları doğru mu?

## ✅ Checklist

- [ ] Firewall kuralı eklendi
- [ ] Sunucu başlatıldı (PM2 ile)
- [ ] `http://localhost:3000/ping` test edildi
- [ ] Public IP bulundu
- [ ] `http://PUBLIC_IP:3000/ping` test edildi
- [ ] Frontend .env güncellendi
- [ ] Frontend deploy edildi
- [ ] Frontend-Backend bağlantısı test edildi
- [ ] HTTPS kuruldu (opsiyonel)
- [ ] Monitoring aktif

## 🎯 Özet

**Şu anda yapılması gerekenler:**

1. **Firewall ayarı** (Yönetici yetkisi ile)
   ```powershell
   .\setup-firewall.ps1
   ```

2. **Sunucuyu başlat**
   ```powershell
   pm2 start server.js --name zenshin-backend
   pm2 save
   ```

3. **Test et**
   ```
   http://localhost:3000/ping
   ```

4. **Public IP bul ve test et**
   ```
   http://PUBLIC_IP:3000/ping
   ```

5. **Frontend'i bağla**
   - `.env` dosyası oluştur
   - `VITE_BACKEND_URL=http://PUBLIC_IP:3000`
   - Deploy et

## 📚 Faydalı Linkler

- PM2 Docs: https://pm2.keymetrics.io
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/
- Vercel: https://vercel.com
- Netlify: https://netlify.com

## 🆘 Yardım

Sorun yaşarsanız:
1. `pm2 logs zenshin-backend` - Logları kontrol edin
2. `VPS_KURULUM.md` - Detaylı sorun giderme
3. GitHub Issues - Topluluk desteği

---

**Başarılar! 🚀**

Backend VPS'te hazır, şimdi frontend'i bağlayıp projenizi tamamlayabilirsiniz!
