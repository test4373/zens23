# 🚀 Zenshin Backend - Deploy Guide

## 📦 Gereksinimler

### Tüm Platformlar:
- **Node.js** v18+ 
- **FFmpeg** (altyazı çıkartma için)
- **VLC** veya **MPV** (opsiyonel - harici player için)

---

## 🐧 Linux (Ubuntu/Debian)

### 1. Gerekli Paketleri Kur:
```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# FFmpeg (altyazı çıkartma için - ZORUNLU)
sudo apt install -y ffmpeg

# MPV (önerilen - en iyi altyazı desteği)
sudo apt install -y mpv

# VLC (alternatif)
sudo apt install -y vlc
```

### 2. Backend'i Çalıştır:
```bash
cd BACKEND
npm install
npm start
```

---

## 🪟 Windows

### 1. Chocolatey ile:
```powershell
# Chocolatey kurulu değilse: https://chocolatey.org/install

# FFmpeg (ZORUNLU)
choco install ffmpeg

# MPV (önerilen)
choco install mpv

# VLC (alternatif)
choco install vlc
```

### 2. Manuel Kurulum:
- **FFmpeg**: https://ffmpeg.org/download.html
- **MPV**: https://mpv.io/installation/
- **VLC**: https://www.videolan.org/vlc/

### 3. Backend'i Çalıştır:
```powershell
cd BACKEND
npm install
npm start
```

---

## 🍎 macOS

### 1. Homebrew ile:
```bash
# Homebrew kurulu değilse: https://brew.sh/

# FFmpeg (ZORUNLU)
brew install ffmpeg

# MPV (önerilen)
brew install mpv

# VLC (alternatif)
brew install --cask vlc
```

### 2. Backend'i Çalıştır:
```bash
cd BACKEND
npm install
npm start
```

---

## 🐳 Docker (Tüm Platformlar)

```dockerfile
FROM node:20-alpine

# FFmpeg ekle
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 64621

CMD ["npm", "start"]
```

```bash
# Build
docker build -t zenshin-backend .

# Run
docker run -p 64621:64621 -v $(pwd)/downloads:/app/downloads zenshin-backend
```

---

## ☁️ Production Deploy

### PM2 ile (Linux/Mac):
```bash
# PM2 kur
npm install -g pm2

# Backend'i başlat
cd BACKEND
pm2 start server.js --name zenshin-backend

# Auto-restart on crash
pm2 save
pm2 startup
```

### Nginx Reverse Proxy (Opsiyonel):
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:64621;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## ✅ Başarı Kontrolü

Backend başlatıldığında görmeli:
```
🎬 FFmpeg path: /usr/bin/ffmpeg
✅ VLC found: /usr/bin/vlc
✅ MPV found: /usr/bin/mpv
═══════════════════════════════════════════
  🚀 Zenshin Server Running
  📡 Port: 64621
  🔒 Security: Enabled
  💾 Database: SQLite
═══════════════════════════════════════════
```

---

## 🔧 Sorun Giderme

### FFmpeg bulunamadı:
```bash
# Test
ffmpeg -version

# Kurulu değilse
sudo apt install ffmpeg  # Linux
choco install ffmpeg     # Windows
brew install ffmpeg      # macOS
```

### MPV/VLC bulunamadı:
- **Sorun değil!** Tarayıcıda oynatma çalışır
- Harici player opsiyonel

### Port 64621 kullanımda:
```bash
# Başka port kullan
PORT=3001 npm start
```

---

## 📝 Environment Variables

`.env` dosyası oluştur:
```env
PORT=64621
NODE_ENV=production
DATABASE_PATH=./database.sqlite
DOWNLOADS_PATH=./downloads
```

---

## 🎯 Önerilen Kurulum (Production)

```bash
# Linux Server (Ubuntu)
sudo apt update
sudo apt install -y nodejs npm ffmpeg mpv
cd BACKEND
npm install --production
npm install -g pm2
pm2 start server.js --name zenshin
pm2 save
pm2 startup
```

✅ Artık sunucu yeniden başladığında backend otomatik başlar!
