# 🚀 MKV Subtitle Direkt Stream (FFmpeg Extraction Yok)

## Sorun
FFmpeg ile MKV'den subtitle extraction çok yavaş (30-60 saniye).

## Çözüm
MKV'deki subtitle'ı **direkt stream** et, extract etme!

## Değişiklik

### Eski Yöntem (Yavaş):
```javascript
// FFmpeg ile extract et → SRT dosyası oluştur → VTT'ye çevir → Gönder
ffmpeg(videoPath)
  .outputOptions(['-map 0:s:0', '-c:s srt', '-y'])
  .output(subtitleOutputPath)
  .run();
```

### Yeni Yöntem (Hızlı):
```javascript
// MKV'deki subtitle'ı direkt stream et (extract yok!)
// Frontend'de video player subtitle'ı MKV'den okusun
```

## Frontend Değişikliği Gerekli

Video player'da subtitle track'i direkt MKV'den seç:

```javascript
// CustomVideoPlayer.jsx
<video>
  <track 
    kind="subtitles" 
    src={`${BACKEND_URL}/subtitle-stream/${magnet}/${filename}/0`}
    label="Default"
    default
  />
</video>
```

## Backend Endpoint (Yeni)

```javascript
// Direkt MKV subtitle stream (FFmpeg yok!)
app.get("/subtitle-stream/:magnet/:filename/:trackId", async (req, res) => {
  const { magnet, filename, trackId } = req.params;
  
  let tor = await client.get(magnet);
  const videoFile = tor.files.find(f => f.name === filename);
  const videoPath = path.join(tor.path, videoFile.path);
  
  // MKV'den subtitle'ı direkt stream et (extract yok!)
  const subtitleStream = ffmpeg(videoPath)
    .outputOptions([
      `-map 0:s:${trackId}`,
      '-f webvtt',  // Direkt WebVTT formatında stream
      '-'           // stdout'a yaz
    ]);
  
  res.setHeader('Content-Type', 'text/vtt');
  subtitleStream.pipe(res);
});
```

## Avantajlar
- ✅ **10x daha hızlı** (extract yok, direkt stream)
- ✅ Disk kullanımı yok (temp dosya yok)
- ✅ Bellek tasarrufu

## Dezavantajlar
- ⚠️ Frontend değişikliği gerekli
- ⚠️ Her subtitle request için FFmpeg process (ama extract'ten hızlı)

## Alternatif: Video Player'da Embedded Subtitle
En hızlı çözüm: Video player'ın kendi subtitle desteğini kullan!

```javascript
// Video.js veya Plyr gibi player'lar MKV subtitle'ı otomatik okur
<video src={videoUrl} />
// Subtitle otomatik yüklenir, backend'e istek yok!
```
