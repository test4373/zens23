# Railway Deployment Rehberi

## Hızlı Başlangıç

### 1. Railway Hesabı Oluştur
- [Railway.app](https://railway.app) adresine git
- GitHub hesabınla giriş yap

### 2. Yeni Proje Oluştur
1. "New Project" butonuna tıkla
2. "Deploy from GitHub repo" seç
3. Repository'ni seç
4. Root directory'yi `BACKEND` olarak ayarla

### 3. Environment Variables Ayarla
Railway dashboard'da şu değişkenleri ekle:

```env
NODE_ENV=production
PORT=64621
JWT_SECRET=your-super-secret-jwt-key-change-this
CORS_ORIGIN=https://your-frontend-domain.com

# Opsiyonel - Google Drive streaming için
GDRIVE_CLIENT_ID=your-gdrive-client-id
GDRIVE_CLIENT_SECRET=your-gdrive-client-secret
GDRIVE_REFRESH_TOKEN=your-gdrive-refresh-token
```

### 4. Deploy Et
- Railway otomatik olarak Dockerfile'ı algılayacak
- Build başlayacak (3-5 dakika sürer)
- Deploy tamamlandığında URL alacaksın

## Önemli Notlar

### RAM ve Performans
- **Free Tier:** 512MB RAM, 500 saat/ay
- **Hobby Plan:** $5/ay, 8GB RAM, sınırsız saat
- Anime streaming için minimum 1GB RAM önerilir

### Port Ayarları
- Railway otomatik olarak PORT değişkenini ayarlar
- Dockerfile'da 64621 portu expose edilmiş
- Railway bunu otomatik olarak yönlendirir

### Database
- SQLite database otomatik oluşturulur
- İlk admin kullanıcısı için:
  ```bash
  railway run npm run create-admin
  ```

### Dosya Depolama
- Railway ephemeral storage kullanır
- Her deploy'da dosyalar silinir
- Kalıcı depolama için Railway Volume ekle

## Sorun Giderme

### Build Hatası
```bash
# Logs'u kontrol et
railway logs
```

### Database Hatası
```bash
# Database'i sıfırla
railway run rm -f database.sqlite
railway run npm run create-admin
```

### Memory Hatası
- Hobby plan'a geç ($5/ay)
- Veya Railway Volume ekle

## Faydalı Komutlar

```bash
# Railway CLI kur
npm i -g @railway/cli

# Login
railway login

# Logs izle
railway logs

# Environment variables listele
railway variables

# Shell aç
railway shell
```

## Alternatif Deployment

Eğer Railway çalışmazsa:
- **Fly.io:** Daha hızlı, global edge network
- **Render.com:** Kolay kurulum ama cold start var
- **Koyeb:** Ücretsiz, sürekli aktif

## Destek

Sorun yaşarsan:
1. Railway logs'u kontrol et: `railway logs`
2. GitHub Issues'da sor
3. Railway Discord'una katıl
