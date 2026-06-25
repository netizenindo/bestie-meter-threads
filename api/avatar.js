// api/avatar.js — proxy gambar avatar Threads (same-origin) supaya html2canvas bisa export.
// Hanya mengizinkan host CDN Meta/Threads (anti open-proxy/SSRF).

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ALLOW = [
  /\.fbcdn\.net$/i,
  /\.cdninstagram\.com$/i,
  /(^|\.)instagram\.[a-z0-9.\-]+$/i,
  /(^|\.)threads\.(net|com)$/i
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const raw = (req.query && req.query.u) || '';
  let url;
  try { url = new URL(raw); } catch (_) {
    return res.status(400).json({ ok: false, error: 'URL tidak valid.' });
  }
  if (url.protocol !== 'https:' || !ALLOW.some(re => re.test(url.hostname))) {
    return res.status(400).json({ ok: false, error: 'Host tidak diizinkan.' });
  }

  try {
    const r = await fetch(url.toString(), {
      headers: { 'User-Agent': UA, 'Referer': 'https://www.threads.com/' }
    });
    if (!r.ok) return res.status(404).end();
    const type = r.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//i.test(type)) return res.status(415).end();
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    return res.status(200).send(buf);
  } catch (_) {
    return res.status(502).end();
  }
};
