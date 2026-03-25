const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const JSZip = require('jszip');

const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 11470}`;

const manifest = {
  id: 'org.greeksubs.stremio',
  version: '1.0.1',
  name: 'Greek Subs',
  description: 'Greek subtitles from yifysubtitles.ch, subs4free.club & greeksubs.net (full Kodi port)',
  logo: 'https://i.imgur.com/5Z3Zf0K.png',
  resources: ['subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [],
  behaviorHints: { configurable: true }
};

const builder = new addonBuilder(manifest);

builder.defineConfig({
  title: 'Greek Subs Settings',
  items: [
    { id: 'provider_yifi', name: 'YIFI (yifysubtitles.ch)', type: 'checkbox', default: true },
    { id: 'provider_s4f', name: 'S4F (subs4free/subs4series)', type: 'checkbox', default: true },
    { id: 'provider_subz', name: 'SUBZ (greeksubs.net)', type: 'checkbox', default: true }
  ]
});

async function fetchWithHeaders(url, referer = '') {
  return axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': referer || url
    },
    timeout: 10000
  });
}

// (the three provider functions getYifi, getS4F, getSUBZ are exactly the same as before — I kept them unchanged for brevity)
// → Just paste the full functions from my previous message here (getYifi, getS4F, getSUBZ)

builder.defineRoute({
  method: 'GET',
  path: '/proxy',
  handler: async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url');
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      const filename = url.split('/').pop().toLowerCase();

      if (filename.endsWith('.srt')) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="greek.srt"');
        return res.send(response.data);
      }

      if (filename.endsWith('.zip')) {
        const zip = await JSZip.loadAsync(response.data);
        const srtFile = Object.keys(zip.files).find(f => f.toLowerCase().endsWith('.srt'));
        if (srtFile) {
          const content = await zip.file(srtFile).async('string');
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${srtFile}"`);
          return res.send(content);
        }
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(response.data);
    } catch (e) {
      res.status(500).send('Proxy error');
    }
  }
});

builder.defineSubtitlesHandler(async (args) => {
  const { type, id, extra } = args;
  const config = args.config || {};
  const imdb = id || '0';

  let query = extra?.name || 'unknown';
  if (type === 'series' && extra?.season && extra?.episode) {
    query += ` S\( {String(extra.season).padStart(2,'0')}E \){String(extra.episode).padStart(2,'0')}`;
  }
  query += `/imdb=${imdb}`;

  const promises = [];
  if (config.provider_yifi !== false) promises.push(getYifi(query, imdb));
  if (config.provider_s4f !== false) promises.push(getS4F(query, type === 'series'));
  if (config.provider_subz !== false) promises.push(getSUBZ(query, imdb));

  const allResults = (await Promise.all(promises)).flat();
  allResults.sort((a, b) => (b.rating || 0) - (a.rating || 0));

  const subtitles = allResults.map(item => ({
    url: `\( {BASE_URL}/proxy?url= \){encodeURIComponent(item.url)}`,
    lang: item.lang,
    name: item.name
  }));

  return { subtitles };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 11470 });
console.log(`✅ Greek Subs running → manifest: ${BASE_URL}/manifest.json`);
