const express = require('express');
const axios = require('axios');
const router = express.Router();

// Proxy for nyaa.si to avoid CORS issues
router.get('/nyaa', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    // Use nyaa.si RSS feed and convert to JSON
    const nyaaUrl = `https://nyaa.si/?page=rss&q=${encodeURIComponent(q)}&c=1_2&f=0`;
    
    const response = await axios.get(nyaaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    // Parse RSS XML to extract torrent data
    const xml = response.data;
    const parser = require('xml2js');
    
    parser.parseString(xml, { mergeAttrs: true }, (err, result) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to parse RSS feed' });
      }

      try {
        const items = result.rss.channel[0].item || [];
        const torrents = items.map(item => ({
          title: item.title[0],
          link: item.link[0],
          guid: item.guid[0],
          pubDate: item.pubDate[0],
          seeders: item['nyaa:seeders'] ? item['nyaa:seeders'][0] : '0',
          leechers: item['nyaa:leechers'] ? item['nyaa:leechers'][0] : '0',
          downloads: item['nyaa:downloads'] ? item['nyaa:downloads'][0] : '0',
          infoHash: item['nyaa:infoHash'] ? item['nyaa:infoHash'][0] : '',
          categoryId: item['nyaa:categoryId'] ? item['nyaa:categoryId'][0] : '',
          category: item['nyaa:category'] ? item['nyaa:category'][0] : '',
          size: item['nyaa:size'] ? item['nyaa:size'][0] : '',
          comments: item['nyaa:comments'] ? item['nyaa:comments'][0] : '0',
          trusted: item['nyaa:trusted'] ? item['nyaa:trusted'][0] : 'No',
          remake: item['nyaa:remake'] ? item['nyaa:remake'][0] : 'No',
          description: item.description ? item.description[0] : ''
        }));

        res.json(torrents);
      } catch (parseError) {
        console.error('Parse error:', parseError);
        res.status(500).json({ error: 'Failed to process torrent data' });
      }
    });

  } catch (error) {
    console.error('Nyaa proxy error:', error.message);
    res.status(500).json({ error: 'Failed to fetch from nyaa.si' });
  }
});

module.exports = router;
