const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const JSZip = require('jszip');

const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 11470}`;

const manifest = {
  id: 'org.greeksubs.stremio',
  version: '1.0.2',
  name: 'Greek Subs',
  description: 'Greek subtitles from yifysubtitles.ch, subs4free.club/subs4series.com & greeksubs.net (full Kodi port)',
  logo: 'https://i.imgur.com/5Z3Zf0K.png',
  resources: ['subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [],
  behaviorHints: {
    configurable: true
  },
  config: [
    {
      key: 'provider_yifi',
      type: 'checkbox',
      title: 'YIFI (yifysubtitles.ch)',
      default: 'checked'
    },
    {
      key: 'provider_s4f',
      type: 'checkbox',
      title: 'S4F (subs4free/subs4series)',
      default: 'checked'
    },
    {
      key: 'provider_subz',
      type: 'checkbox',
      title: 'SUBZ (greeksubs.net)',
      default: 'checked'
    }
  ]
};

const builder = new addonBuilder(manifest);

async function fetchWithHeaders(url, referer = '') {
  return axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': referer || url
    },
    timeout: 10000
  });
}

async function getYifi(query, imdb) {
  try {
    let page;
    if (imdb && imdb.startsWith('tt')) {
      page = await fetchWithHeaders(`https://yifysubtitles.ch/movie-imdb/${imdb}`);
    } else {
      const title = query.split('/imdb=')[0].trim();
      page = await fetchWithHeaders(`https://yifysubtitles.ch/search?q=${encodeURIComponent(title)}`);
    }
    const $ = cheerio.load(page.data);
    const items = $('tr[data-id]').filter((i, el) => $(el).html().toLowerCase().includes('greek'));
    const results = [];

    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      const name = $(el).find('a').first().text().trim().replace(/subtitle/gi, '');
      let dlLink = $(el).find('a.btn-icon.download-subtitle').attr('href') || '';
      if (dlLink.startsWith('/')) dlLink = 'https://yifysubtitles.ch' + dlLink;
      if (name && dlLink) {
        results.push({ name: `[YIFI] ${name}`, url: dlLink, lang: 'el', rating: 5 });
      }
    }
    return results;
  } catch (e) { return []; }
}

async function getS4F(query, isTV) {
  try {
    const base = isTV ? 'https://www.subs4series.com' : 'https://www.subs4free.club';
    const searchUrl = `\( {base}/search_report.php?search= \){encodeURIComponent(query)}&searchType=1`;
    const page = await fetchWithHeaders(searchUrl, base);
    const $ = cheerio.load(page.data);
    const results = [];

    $('.movie-download, .seeMedium, .seeDark').each((i, el) => {
      if ($(el).html().toLowerCase().includes('greek')) {
        const link = $(el).find('a').first().attr('href');
        const title = $(el).find('a').first().attr('title') || $(el).text();
        const dlCount = $(el).text().match(/(\d+)DLs/i);
        const rating = dlCount ? Math.min(5, Math.max(1, Math.floor(parseInt(dlCount[1]) / 100) + 1)) : 3;
        if (link) {
          const fullLink = link.startsWith('http') ? link : base + link;
          results.push({ name: `[S4F] ${title.replace(/Greek subtitle.*/i, '')}`, url: fullLink, lang: 'el', rating });
        }
      }
    });
    return results;
  } catch (e) { return []; }
}

async function getSUBZ(query, imdb) {
  try {
    const base = 'https://greeksubs.net';
    const session = await axios.get(base);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_1) AppleWebKit/537.36',
      'Cookie': session.headers['set-cookie'] ? session.headers['set-cookie'].join('; ') : ''
    };

    let pageUrl;
    if (imdb && imdb.startsWith('tt')) {
      pageUrl = `\( {base}/view/ \){imdb}`;
    } else if (query.includes('S') && query.includes('E')) {
      const title = query.split(' S')[0];
      pageUrl = `\( {base}/search/ \){encodeURIComponent(title)}/tv`;
    } else {
      pageUrl = `\( {base}/search/ \){encodeURIComponent(query.split('/imdb=')[0])}/movies`;
    }

    const page = await axios.get(pageUrl, { headers });
    const $ = cheerio.load(page.data);
    const secCode = $('input#secCode').val() || '';
    const results = [];

    $('tbody tr').each((i, el) => {
      const downloadMatch = $(el).html().match(/downloadMe\(['"]([\w-]+)['"]/);
      const nameMatch = $(el).find('td').last().text().trim();
      if (downloadMatch && nameMatch) {
        const dlId = downloadMatch[1];
        const url = `\( {base}/dll/ \){dlId}/0/${secCode}`;
        results.push({ name: `[SUBZ] ${nameMatch}`, url, lang: 'el', rating: 5 });
      }
    });
    return results;
  } catch (e) { return []; }
}

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
  const config = args.config || {};        // ← this now receives the checkboxes
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
console.log(`✅ Greek Subs running → ${BASE_URL}/manifest.json`);          return res.send(content);
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
