# 🚀 VERCEL CDN KURULUMU (5 Dakika)

## ✅ Neden Vercel?
- ✅ **100 GB bandwidth/ay** (günlük limit YOK!)
- ✅ **Sınırsız istek**
- ✅ **Ücretsiz**
- ✅ **Global CDN** (70+ lokasyon)

---

## 📋 Adım 1: Vercel CLI Kur

### Windows (PowerShell):
```powershell
npm install -g vercel
```

### Linux/Mac:
```bash
npm install -g vercel
```

**Test et:**
```bash
vercel --version
```

---

## 📋 Adım 2: Vercel'e Giriş Yap

```bash
vercel login
```

Bu komut **tarayıcı açacak**:
1. Email adresinle giriş yap (veya GitHub ile)
2. "Authorize Vercel" butonuna tıkla
3. Terminal'e geri dön

---

## 📋 Adım 3: Deploy Et

### Option A: Script ile (Kolay) ✅

**Windows:**
```powershell
cd BACKEND
bash deploy-vercel.sh
```

**Linux/Mac:**
```bash
cd BACKEND
chmod +x deploy-vercel.sh
./deploy-vercel.sh
```

### Option B: Manuel (Adım adım)

```bash
cd BACKEND
vercel
```

**Sorulacak sorular:**
1. "Set up and deploy?" → **Y** (Enter)
2. "Which scope?" → Seç (Enter)
3. "Link to existing project?" → **N** (Enter)
4. "What's your project's name?" → **zenshin-cdn** (Enter)
5. "In which directory?" → **.** (Enter - nokta!)
6. "Want to modify settings?" → **N** (Enter)

**Deploy tamamlanınca:**
```
✅ Production: https://zenshin-cdn-xxxx.vercel.app
```

Bu URL'yi kopyala! 📋

---

## 📋 Adım 4: CDN'i Aktif Et

### 4.1 - `cdn-config.js` dosyasını aç

```bash
cd BACKEND
notepad cdn-config.js  # Windows
nano cdn-config.js     # Linux/Mac
```

### 4.2 - Vercel URL'ini yapıştır

**Değiştir:**
```javascript
vercel: {
  enabled: false,  // ❌ Kapalı
  edgeUrl: 'https://your-app.vercel.app/api',
  // ...
}
```

**Şuna:**
```javascript
vercel: {
  enabled: true,  // ✅ Açık
  edgeUrl: 'https://zenshin-cdn-xxxx.vercel.app/api',  // Kendi URL'in
  // ...
}
```

### 4.3 - Netlify'ı kapat (opsiyonel)

```javascript
netlify: {
  enabled: false,  // Sadece birini kullan
  // ...
}
```

**Kaydet ve kapat!**

---

## 📋 Adım 5: Server'ı Yeniden Başlat

```bash
cd BACKEND
npm start
```

veya

```bash
node server.js
```

---

## ✅ Test Et

### Test 1: CDN çalışıyor mu?

```bash
curl "https://zenshin-cdn-xxxx.vercel.app/api/cdn?url=http://localhost:64621/ping"
```

**Beklenen sonuç:**
```
pong
```

### Test 2: Video streaming?

```bash
curl -I "https://zenshin-cdn-xxxx.vercel.app/api/cdn?url=http://localhost:64621/streamfile/..."
```

**Beklenen header:**
```
HTTP/2 206
x-cdn: Vercel
cache-control: public, max-age=3600
```

---

## 🎯 Kullanım

### Frontend'de CDN URL kullan:

**Eski (CDN yok):**
```javascript
const videoUrl = 'http://localhost:64621/streamfile/magnet/filename';
```

**Yeni (CDN ile):**
```javascript
const backendUrl = 'http://localhost:64621/streamfile/magnet/filename';
const cdnUrl = `https://zenshin-cdn-xxxx.vercel.app/api/cdn?url=${encodeURIComponent(backendUrl)}`;
```

**veya otomatik:**
```javascript
import { getCDNUrl } from './cdn-config.js';

const videoUrl = getCDNUrl('http://localhost:64621/streamfile/magnet/filename');
```

---

## 📊 Bandwidth Tasarrufu

### Örnek: 1 bölüm (1080p, 20 dakika)

**CDN olmadan:**
```
Direct download: 3 GB
Your bandwidth: 3 GB ❌
```

**CDN ile (ilk izleme):**
```
First viewer: 3 GB → CDN cache
Your bandwidth: 3 GB
```

**CDN ile (sonraki izlemeler - 1 saat içinde):**
```
Other viewers: From CDN cache ✅
Your bandwidth: 0 GB! 🎉
```

**Sonuç:**
- 5 kişi izlese: **12 GB tasarruf!**
- 10 kişi izlese: **27 GB tasarruf!**

---

## 🔧 Sorun Giderme

### Sorun 1: "Command not found: vercel"

```bash
# Tekrar kur
npm install -g vercel

# PATH'i güncelle (Windows)
refreshenv

# PATH'i güncelle (Linux/Mac)
source ~/.bashrc
```

### Sorun 2: "No Space Left"

```bash
# Eski deploymentları sil
vercel rm zenshin-cdn --yes
```

### Sorun 3: "Not authorized"

```bash
# Tekrar giriş yap
vercel logout
vercel login
```

### Sorun 4: "Deploy failed"

```bash
# Detaylı log
vercel --debug

# veya manuel deploy
vercel --prod
```

---

## 🎨 İleri Seviye

### Custom domain ekle (opsiyonel)

```bash
vercel domains add yourdomain.com
```

### Environment variables

```bash
vercel env add CACHE_DURATION
# Value: 3600
```

### Logs görüntüle

```bash
vercel logs
```

---

## 💰 Maliyet Hesaplama

### FREE Tier Limits:
- ✅ 100 GB bandwidth/ay
- ✅ Sınırsız istek
- ✅ 100 GB build output

### Kullanım örneği:

**Senaryo:** Her gün 3 bölüm anime izliyorsun
- Episode size: 150 MB (CDN'den sonra)
- Daily: 3 × 150 MB = 450 MB
- Monthly: 450 MB × 30 = **13.5 GB/ay**

**Sonuç:** ✅ Rahatça FREE tier'da kalırsın!

### Limit aşarsan ne olur?

Vercel **otomatik uyarı** gönderir:
1. 80% kullanımda: Email ⚠️
2. 100% kullanımda: CDN durur (ama site çalışır)

**Çözüm:** Netlify'a geç (oda 100 GB bedava!)

---

## 🚀 Hızlı Özet

```bash
# 1. CLI kur
npm install -g vercel

# 2. Login
vercel login

# 3. Deploy
cd BACKEND
vercel --prod

# 4. URL'i cdn-config.js'e yapıştır
# 5. Server'ı restart et

# ✅ Bitti!
```

---

## 📞 Yardım

### Vercel dokümantasyon:
https://vercel.com/docs

### Edge Functions:
https://vercel.com/docs/functions/edge-functions

### Pricing:
https://vercel.com/pricing

---

## 🎉 Tebrikler!

Artık **ücretsiz global CDN** kullanıyorsun! 🌍

- ✅ Evdeki internet hızlanacak
- ✅ Video loading çok daha hızlı
- ✅ Bandwidth %95 azalacak

**İyi seyirler!** 🍿
