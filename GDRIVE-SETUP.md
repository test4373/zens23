# 🎥 Google Drive Video Streaming - Kurulum Rehberi

## ✨ Özellikler
- ✅ **Tamamen ücretsiz** - 15GB storage
- ✅ **750GB/gün bandwidth** - Çok fazla!
- ✅ **Google CDN** - Çok hızlı
- ✅ **Kolay kurulum** - 10 dakika

---

## 📋 Adım Adım Kurulum

### 1️⃣ Google Cloud Console'da Proje Oluştur

1. [Google Cloud Console](https://console.cloud.google.com/) → Giriş yap
2. Yeni proje oluştur: **"Zenshin Video Streaming"**
3. Proje seçiliyken devam et

### 2️⃣ Google Drive API'yi Aktifleştir

1. Sol menüden **"APIs & Services"** → **"Library"**
2. **"Google Drive API"** ara
3. **"Enable"** butonuna tıkla

### 3️⃣ OAuth 2.0 Credentials Oluştur

#### Yöntem A: OAuth 2.0 (Kolay - Önerilen)

1. **"APIs & Services"** → **"Credentials"**
2. **"Create Credentials"** → **"OAuth client ID"**
3. Application type: **"Web application"**
4. Name: **"Zenshin Backend"**
5. **Authorized redirect URIs** ekle:
   ```
   http://localhost:64621/gdrive/auth/callback
   ```
6. **"Create"** tıkla
7. **Client ID** ve **Client Secret** kopyala

#### Yöntem B: Service Account (İleri Seviye)

1. **"Create Credentials"** → **"Service Account"**
2. Name: **"zenshin-video-streamer"**
3. Role: **Viewer** (okuma yetkisi)
4. **"Done"** tıkla
5. Service Account'a tıkla → **"Keys"** tab
6. **"Add Key"** → **"Create new key"** → **JSON**
7. İndirilen dosyayı **`gdrive-credentials.json`** olarak kaydet
8. Dosyayı **BACKEND/** klasörüne kopyala

---

## 🔧 Backend Konfigürasyonu

### .env Dosyası Oluştur

`BACKEND/.env` dosyasına ekle:

```env
# Google Drive OAuth (Yöntem A)
GDRIVE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GDRIVE_CLIENT_SECRET=your-client-secret-here
GDRIVE_REDIRECT_URI=http://localhost:64621/gdrive/auth/callback
GDRIVE_REFRESH_TOKEN=your-refresh-token-here

# Service Account kullanıyorsan (Yöntem B)
# gdrive-credentials.json dosyası BACKEND/ klasöründe olmalı
```

### Package.json'a Bağımlılık Ekle

```bash
cd BACKEND
npm install googleapis
```

### server.js'e Entegre Et

`BACKEND/server.js` dosyasını güncelle:

```javascript
// Google Drive streaming routes
const gdriveRouter = require('./routes/gdrive-stream');
app.use('/gdrive', gdriveRouter);

console.log(chalk.cyan('🌐 Google Drive routes: /gdrive/*'));
```

---

## 🔐 İlk Kurulum (OAuth ile)

### 1. Backend'i Başlat
```bash
cd BACKEND
node server.js
```

### 2. OAuth Flow'u Başlat
Browser'da aç:
```
http://localhost:64621/gdrive/auth/start
```

### 3. Google Hesabını Seç
- Google hesabınızla giriş yapın
- Drive erişimine izin verin

### 4. Refresh Token'ı Kopyala
- Callback sayfasında **refresh_token** gösterilecek
- `.env` dosyasına ekleyin:
  ```env
  GDRIVE_REFRESH_TOKEN=1//0abcd...xyz
  ```

### 5. Backend'i Yeniden Başlat
```bash
# Ctrl+C ile durdur
node server.js
```

✅ **Artık hazırsınız!**

---

## 📤 Video Nasıl Yüklenir?

### Yöntem 1: Google Drive Web UI (En Kolay)

1. [Google Drive](https://drive.google.com/) → Giriş yap
2. Klasör oluştur: **"Zenshin Videos"**
3. Video dosyalarını sürükle-bırak
4. Video → Sağ tık → **"Get link"** → **"Anyone with the link"**
5. Link'ten **File ID** kopyala:
   ```
   https://drive.google.com/file/d/1ABC...XYZ/view
                                    ↑
                              File ID budur
   ```

### Yöntem 2: API ile Upload

```bash
curl -X POST http://localhost:64621/gdrive/upload \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "/path/to/video.mkv",
    "fileName": "Episode 01.mkv",
    "folderId": "your-folder-id"
  }'
```

---

## 🎬 Kullanım

### Video Streaming

```javascript
// Frontend'de
const videoUrl = `http://localhost:64621/gdrive/stream/${fileId}`;

<video src={videoUrl} controls />
```

### Video Listesi

```bash
# Tüm videoları listele
GET http://localhost:64621/gdrive/list

# Klasördeki videoları listele
GET http://localhost:64621/gdrive/list/FOLDER_ID
```

### Video Bilgisi

```bash
GET http://localhost:64621/gdrive/info/FILE_ID
```

---

## 📊 Limitler

| Limit | Değer | Açıklama |
|-------|-------|----------|
| Storage | 15GB | Ücretsiz hesap |
| Bandwidth | 750GB/gün | Per hesap |
| API Calls | 1000/user/100s | Yeterli |
| File Size | 5TB | Video başına |

**Not**: 750GB/gün = ~30 kullanıcı x 25GB video izleme

---

## 🔒 Güvenlik

### File ID Gizleme (Önerilen)

```javascript
// BACKEND/routes/gdrive-stream.js

// Database'de mapping sakla
const fileIdMap = {
  'anime_123_ep_1': '1ABC...XYZ',  // Gerçek Google Drive File ID
  'anime_123_ep_2': '1DEF...UVW',
};

router.get('/stream/:animeId/:episode', async (req, res) => {
  const { animeId, episode } = req.params;
  const key = `${animeId}_ep_${episode}`;
  const fileId = fileIdMap[key];
  
  if (!fileId) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  // Stream with hidden file ID
  // ... streaming kodu
});
```

---

## 🚀 Production Deployment

### Vercel/Railway ile Deploy

1. **Environment Variables** ekle:
   - `GDRIVE_CLIENT_ID`
   - `GDRIVE_CLIENT_SECRET`
   - `GDRIVE_REFRESH_TOKEN`

2. **gdrive-credentials.json** güvenli sakla:
   - Base64 encode et
   - Environment variable olarak ekle
   - Runtime'da decode et

```javascript
// Decode service account from env
const credentials = JSON.parse(
  Buffer.from(process.env.GDRIVE_CREDENTIALS_BASE64, 'base64').toString()
);
```

---

## 🆘 Sorun Giderme

### "Unauthorized" Hatası
→ Refresh token yenile veya credentials.json kontrol et

### "Quota Exceeded"
→ 750GB/gün limiti aşıldı, yarın tekrar dene

### "File not found"
→ File ID doğru mu? Link paylaşımı açık mı?

### Yavaş Streaming
→ Google Drive bazen throttle yapabilir, birkaç saniye bekle

---

## 💡 Pro Tips

1. **Klasör yapısı**:
   ```
   Zenshin Videos/
   ├── Dandadan/
   │   ├── Season 1/
   │   │   ├── Episode 01.mkv
   │   │   ├── Episode 02.mkv
   ```

2. **Toplu upload**: rclone kullan
   ```bash
   rclone copy ./videos gdrive:Zenshin\ Videos/
   ```

3. **Subtitle dosyaları**: Ayrı klasörde sakla

4. **Cache**: File ID'leri cache'le (database)

---

## 📞 Yardım

Kurulumda sorun yaşarsanız:
1. Console loglarını kontrol edin
2. `.env` dosyası doğru mu?
3. `gdrive-credentials.json` var mı?
4. Google Cloud Console'da API aktif mi?

---

✅ **Kurulum tamamlandığında artık tamamen ücretsiz video streaming'iniz var!**
