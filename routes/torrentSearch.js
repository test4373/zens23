import chalk from 'chalk';

// AnimeTosho'dan torrent ara
export async function searchTorrentsAnimeTosho(query) {
  try {
    console.log(chalk.blue('🔍 Searching AnimeTosho:'), query);
    
    // AnimeTosho JSON API
    const searchUrl = `https://feed.animetosho.org/json?q=${encodeURIComponent(query)}`;
    console.log(chalk.cyan('URL:'), searchUrl);
    
    const response = await fetch(searchUrl);
    const data = await response.json();
    
    console.log(chalk.yellow('Results:'), data.length);
    
    // Her torrent için web sayfasını kontrol et (attachment var mı)
    const detailedTorrents = [];
    
    // Attachment kontrolü yapmadan direkt tüm sonuçları dön (hızlı olması için)
    // Sadece ilk 5 sonucu attachment için kontrol et
    const checkLimit = Math.min(data.length, 5);
    
    for (let i = 0; i < checkLimit; i++) {
      const item = data[i];
      
      // Web sayfasından attachment kontrolü
      try {
        const pageResponse = await fetch(item.link);
        const html = await pageResponse.text();
        
        // Attachment link ara
        const attachMatch = html.match(/\/storage\/torattachpk\/(\d+)\/([^"]+)_attachments\.7z/);
        
        if (attachMatch) {
          const attachmentUrl = `https://animetosho.org/storage/torattachpk/${attachMatch[1]}/${attachMatch[2]}_attachments.7z`;
          
          console.log(chalk.green(`✅ [${i+1}] ${item.title.substring(0, 50)} - HAS ATTACHMENTS`));
          
          detailedTorrents.push({
            ...item,
            hasAttachments: true,
            attachmentUrl
          });
        } else {
          console.log(chalk.gray(`⚪ [${i+1}] ${item.title.substring(0, 50)} - no attachments`));
        }
      } catch (err) {
        console.log(chalk.yellow(`⚠️ Failed to check: ${item.title.substring(0, 30)}`));
      }
    }
    
    console.log(chalk.cyan(`📎 Torrents with attachments: ${detailedTorrents.length}/${data.length}`));
    
    // TÜM sonuçları dön (max 100)
    const itemsToProcess = data.slice(0, 100);
    
    // Format'la
    const torrents = itemsToProcess.map(item => {
      const totalSize = item.total_size || 0;
      const sizeInGB = (totalSize / (1024 * 1024 * 1024)).toFixed(2);
      const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
      const sizeStr = totalSize > 1024 * 1024 * 1024 ? `${sizeInGB} GB` : `${sizeInMB} MB`;
      
      return {
        title: item.title,
        link: item.link,
        torrentUrl: item.torrent_url,
        magnet: item.magnet_uri,
        size: sizeStr,
        seeders: item.seeders || '?',
        leechers: item.leechers || '?',
        date: item.timestamp ? new Date(item.timestamp * 1000).toLocaleDateString('tr-TR') : 'Bilinmiyor',
        infoHash: item.info_hash,
        numFiles: item.num_files,
        hasAttachments: item.hasAttachments || false,
        attachmentUrl: item.attachmentUrl || null
      };
    });
    
    console.log(chalk.green(`✅ Returning ${torrents.length} torrents (${detailedTorrents.length} with attachments)`));
    
    return torrents;
  } catch (error) {
    console.error(chalk.red('AnimeTosho search error:'), error);
    throw error;
  }
}
