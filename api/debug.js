// api/debug.js — diagnostik MANDIRI. Pakai: /api/debug?u=username
// Tidak bergantung export apa pun dari lib/threads.js (tahan version-drift).
// Hapus file ini kalau sudah selesai kalibrasi.

let fetchProfile = null;
try { fetchProfile = require('../lib/threads').fetchProfile; } catch (_) {}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const H = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0', 'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

async function getCookie() {
  if (process.env.THREADS_SESSION_COOKIE) return process.env.THREADS_SESSION_COOKIE;
  try {
    const r = await fetch('https://www.threads.com/', { headers: { ...H, 'Sec-Fetch-Site': 'none' } });
    const sc = typeof r.headers.getSetCookie === 'function'
      ? r.headers.getSetCookie()
      : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
    return sc.map((c) => String(c).split(';')[0].trim()).filter((p) => p.includes('=')).join('; ');
  } catch (_) { return ''; }
}

async function getHtml(url, cookie) {
  const headers = { ...H, 'Sec-Fetch-Site': 'same-origin' };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(url, { headers, redirect: 'follow' });
  return { status: r.status, html: await r.text() };
}

function parseBlocks(html) {
  const blocks = [];
  const re = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) { try { blocks.push(JSON.parse(m[1])); } catch (_) {} }
  return blocks;
}

function probe(blocks, owner) {
  const p = { captionCount: 0, captionWithUserUsername: 0, sampleAuthors: [], sampleCaptionParentKeys: null, hasFollowerCount: false };
  for (const b of blocks) {
    const stack = [b];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object') continue;
      if (!p.hasFollowerCount && !Array.isArray(cur) && 'follower_count' in cur) p.hasFollowerCount = true;
      const cap = cur['caption'];
      if (cap && typeof cap === 'object' && typeof cap.text === 'string') {
        p.captionCount++;
        if (!p.sampleCaptionParentKeys) p.sampleCaptionParentKeys = Object.keys(cur).slice(0, 25);
        const au = cur.user && cur.user.username;
        if (typeof au === 'string') {
          p.captionWithUserUsername++;
          if (p.sampleAuthors.length < 8 && au.toLowerCase() !== owner) p.sampleAuthors.push(au);
        }
      }
      for (const v of Object.values(cur)) if (v && typeof v === 'object') stack.push(v);
    }
  }
  return p;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const raw = (req.query && req.query.u) || '';
  if (!/^@?[\w.]{1,40}$/.test(String(raw))) return res.status(400).json({ ok: false, error: 'Pakai ?u=username' });
  const u = String(raw).replace(/^@/, '').toLowerCase();

  const out = { ok: true, mode: (process.env.THREADS_PROVIDER || 'direct').toLowerCase(), usingThreadsModule: !!fetchProfile };

  // 1) Apa yang dikembalikan fetchProfile versi ter-deploy (ungkap kalau masih kode lama).
  if (fetchProfile) {
    try {
      const pr = await fetchProfile(u);
      out.profileSummary = {
        followers: pr.stats && pr.stats.followers,
        postsCount: (pr.posts || []).length,
        hasReplyTextsField: Array.isArray(pr.replyTexts),
        replyTextsCount: (pr.replyTexts || []).length,
        hasRepliedToField: !!pr.repliedTo,
        repliedTo: pr.repliedTo || {}
      };
    } catch (e) { out.profileError = String((e && e.message) || e); }
  }

  // 2) Probe mandiri halaman utama + /replies (ungkap IP-block vs struktur field).
  try {
    const cookie = await getCookie();
    out.cookieLen = (cookie || '').length;
    const main = await getHtml('https://www.threads.com/@' + u, cookie);
    const mb = parseBlocks(main.html);
    out.mainProbe = { httpStatus: main.status, htmlLen: main.html.length, jsonBlocks: mb.length, ...probe(mb, u) };

    const rep = await getHtml('https://www.threads.com/@' + u + '/replies', cookie);
    const rb = parseBlocks(rep.html);
    out.repliesProbe = { httpStatus: rep.status, htmlLen: rep.html.length, jsonBlocks: rb.length, ...probe(rb, u) };
  } catch (e) { out.probeError = String((e && e.message) || e); }

  return res.status(200).json(out);
};
