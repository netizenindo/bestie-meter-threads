// lib/threads.js  (Slice 2 — upgraded)
// Scraper berlapis. Return KONTRAK tetap:
//   { username, displayName, bio, avatar, stats:{followers,following}, posts:[string] }
//   - avatar: URL gambar mentah (di-proxy oleh api/generate.js). Boleh null.
//   - throw Error kalau profil tak terbaca (privat / diblok / tidak ada).
//
// Mode via env THREADS_PROVIDER:
//   "direct" (default, gratis)  | "scrapecreators" (butuh API key)
//
// Teknik guest-cookie + parsing payload JSON ter-embed diadaptasi dari
// proyek MIT: github.com/zikazama/kartu-thread-pengenal (lib/crawler.ts).
//
// CATATAN: tidak bisa diuji dari sandbox (threads.com diblok di sana). Struktur
// Threads bisa berubah sewaktu-waktu — verifikasi & iterasi setelah deploy.

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const UA = process.env.CRAWL_USER_AGENT || DEFAULT_UA;
const TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS || 15000);
const FETCH_REPLIES = process.env.CRAWL_REPLIES !== '0'; // default ON
const SESSION_COOKIE = process.env.THREADS_SESSION_COOKIE || '';
const PROXY_URL = process.env.PROXY_URL || '';

// Header ala-navigasi Chrome. Threads HANYA kirim data SSR untuk request yang
// terlihat seperti browser sungguhan + membawa cookie (guest pun cukup).
const BROWSER_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8,id;q=0.7',
  'Cache-Control': 'max-age=0',
  'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

let guestCookie = '';
let guestCookieAt = 0;
const GUEST_TTL_MS = 30 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Proxy opsional (residential) buat akali blokir IP datacenter. Best-effort. */
let dispatcherPromise = null;
async function getDispatcher() {
  if (!PROXY_URL) return undefined;
  if (!dispatcherPromise) {
    dispatcherPromise = import('undici')
      .then(({ ProxyAgent }) => new ProxyAgent(PROXY_URL))
      .catch(() => undefined);
  }
  return dispatcherPromise;
}

async function rawFetch(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const opts = { signal: controller.signal, redirect: 'follow', headers };
    const dispatcher = await getDispatcher();
    if (dispatcher) opts.dispatcher = dispatcher;
    return await fetch(url, opts);
  } finally {
    clearTimeout(timer);
  }
}

function clean(username) {
  const u = String(username || '').replace(/^@/, '').trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(u)) throw new Error('Username tidak valid.');
  return u;
}

async function fetchProfile(username) {
  const u = clean(username);
  const provider = (process.env.THREADS_PROVIDER || 'direct').toLowerCase();
  if (provider === 'scrapecreators' && process.env.SCRAPECREATORS_API_KEY) {
    return viaScrapeCreators(u);
  }
  return viaDirect(u);
}

/* ---------------- Guest cookie ---------------- */
async function ensureCookie() {
  if (SESSION_COOKIE) return SESSION_COOKIE;
  if (guestCookie && Date.now() - guestCookieAt < GUEST_TTL_MS) return guestCookie;
  try {
    const res = await rawFetch('https://www.threads.com/', {
      ...BROWSER_HEADERS, 'Sec-Fetch-Site': 'none'
    });
    const setCookies =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    const pairs = setCookies
      .map((c) => String(c).split(';')[0].trim())
      .filter((p) => p && p.includes('='));
    if (pairs.length) { guestCookie = pairs.join('; '); guestCookieAt = Date.now(); }
  } catch (_) { /* biarkan guestCookie apa adanya */ }
  return guestCookie;
}

async function fetchHtml(url, cookie) {
  const headers = { ...BROWSER_HEADERS, 'Sec-Fetch-Site': 'same-origin' };
  if (cookie) headers.Cookie = cookie;
  const MAX = 3;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      const res = await rawFetch(url, headers);
      if (res.status === 429 && attempt < MAX - 1) {
        await sleep(1200 * (attempt + 1) + Math.floor(Math.random() * 1000));
        continue;
      }
      return { status: res.status, html: await res.text() };
    } catch (err) {
      if (attempt < MAX - 1) { await sleep(700); continue; }
      throw new Error('Gagal mengakses Threads.');
    }
  }
  throw new Error('Gagal mengakses Threads.');
}

/* ---------------- JSON payload helpers ---------------- */
function parseEmbeddedJson(html) {
  const blocks = [];
  const re = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { blocks.push(JSON.parse(m[1])); } catch (_) { /* skip */ }
  }
  return blocks;
}

function findFirst(obj, key) {
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur && typeof cur === 'object') {
      if (!Array.isArray(cur) && key in cur) {
        const v = cur[key];
        if (v !== null && v !== undefined && v !== '') return v;
      }
      for (const v of Object.values(cur)) if (v && typeof v === 'object') stack.push(v);
    }
  }
  return undefined;
}

function collectPosts(obj, out, seen, limit) {
  const stack = [obj];
  while (stack.length && out.length < limit) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    const caption = cur['caption'];
    if (caption && typeof caption === 'object' && typeof caption.text === 'string') {
      const t = caption.text.trim();
      if (t && !seen.has(t)) { seen.add(t); out.push({ text: t, takenAt: toNum(cur['taken_at']) }); }
    }
    for (const v of Object.values(cur)) if (v && typeof v === 'object') stack.push(v);
  }
}

// Dari tab /replies: pisahkan teks balasan milik OWNER (buat deteksi mention)
// dan kumpulkan penulis postingan yang dibalas owner (buat deteksi interaksi).
function collectReplies(obj, owner, outTexts, outAuthors, seen, limit) {
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    const cap = cur['caption'];
    if (cap && typeof cap === 'object' && typeof cap.text === 'string') {
      const author = cur.user && typeof cur.user === 'object' && typeof cur.user.username === 'string'
        ? cur.user.username.toLowerCase() : null;
      const text = cap.text.trim();
      const key = (author || '?') + '|' + text;
      if (text && !seen.has(key)) {
        seen.add(key);
        if (!author || author === owner) {
          if (outTexts.length < limit) outTexts.push(text);
        } else {
          outAuthors[author] = (outAuthors[author] || 0) + 1;
        }
      }
    }
    for (const v of Object.values(cur)) if (v && typeof v === 'object') stack.push(v);
  }
}

function metaContent(html, prop) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const t of tags) {
    if (new RegExp('(?:property|name)\\s*=\\s*["\']' + reEsc(prop) + '["\']', 'i').test(t)) {
      const c = t.match(/content\s*=\s*["']([\s\S]*?)["']/i);
      if (c) return decode(c[1]).trim();
    }
  }
  return '';
}

/* ---------------- Mode DIRECT ---------------- */
async function viaDirect(u) {
  const cookie = await ensureCookie();
  const { status, html } = await fetchHtml('https://www.threads.com/@' + u, cookie);

  if (status === 404) throw new Error('Akun @' + u + ' tidak ditemukan.');
  if (status === 429) throw new Error('Threads lagi membatasi akses (rate-limit).');
  if (status >= 400) throw new Error('Threads membalas status ' + status + '.');
  if (/isn't available|Page Not Found/i.test(html) && !html.includes('follower_count')) {
    throw new Error('Akun @' + u + ' tidak ditemukan.');
  }

  const blocks = parseEmbeddedJson(html);
  let followers = null, following = null, bio = null, fullName = null, avatar = null, isPrivate = false;

  for (const b of blocks) {
    if (followers == null) followers = toNum(findFirst(b, 'follower_count'));
    if (following == null) following = toNum(findFirst(b, 'following_count'));
    if (bio == null) bio = str(findFirst(b, 'biography'));
    if (fullName == null) fullName = str(findFirst(b, 'full_name'));
    if (avatar == null) avatar = str(findFirst(b, 'profile_pic_url_hd')) || str(findFirst(b, 'profile_pic_url'));
    const priv = findFirst(b, 'text_post_app_is_private');
    if (priv === true || findFirst(b, 'is_private') === true) isPrivate = true;
  }

  // Postingan dari halaman utama (teks + waktu).
  const collected = [];
  const seen = new Set();
  for (const b of blocks) collectPosts(b, collected, seen, 15);
  const posts = collected.map((p) => p.text);
  const postTimes = collected.map((p) => p.takenAt).filter((t) => typeof t === 'number');

  // Fallback Open Graph.
  const ogDesc = metaContent(html, 'og:description');
  if (followers == null) followers = followersFromOg(ogDesc);
  if (!avatar) avatar = metaContent(html, 'og:image') || null;
  if (!fullName) {
    const title = metaContent(html, 'og:title');
    if (title) fullName = title.replace(/\s*\(@.*\)\s*•?\s*Threads.*$/i, '').split('(@')[0].trim() || null;
  }
  if (!bio && ogDesc) bio = stripCounts(ogDesc);

  if (isPrivate) throw new Error('Akun @' + u + ' privat — tidak bisa dibaca.');

  // Sudah pakai guest cookie tapi tetap kosong → IP (Vercel) kemungkinan diblok.
  if (followers == null && posts.length === 0 && !bio && !fullName) {
    throw new Error('Threads tidak mengirim data (IP kemungkinan kena rate-limit). ' +
      'Coba lagi, atau set THREADS_SESSION_COOKIE / PROXY_URL.');
  }

  // Tab /replies (best-effort): interaksi via balasan/komentar.
  let replyTexts = [];
  let repliedTo = {};
  if (FETCH_REPLIES) {
    try {
      const r = await fetchHtml('https://www.threads.com/@' + u + '/replies', cookie);
      if (r.status < 400) {
        const rblocks = parseEmbeddedJson(r.html);
        const rseen = new Set();
        for (const b of rblocks) collectReplies(b, u, replyTexts, repliedTo, rseen, 40);
      }
    } catch (_) { /* abaikan: degrade ke mention-only */ }
  }

  return {
    username: u,
    displayName: fullName || u,
    bio: bio || '',
    avatar: avatar || null,
    stats: { followers, following },
    posts: posts.length ? posts : (bio ? [bio] : []),
    postTimes,
    replyTexts,
    repliedTo
  };
}

/* ---------------- Mode PROVIDER: ScrapeCreators ----------------
   Verifikasi endpoint & nama field di docs provider saat dipakai. */
async function viaScrapeCreators(u) {
  const key = process.env.SCRAPECREATORS_API_KEY;
  const base = process.env.SCRAPECREATORS_BASE || 'https://api.scrapecreators.com/v1';

  const pr = await fetch(base + '/threads/profile?handle=' + encodeURIComponent(u), {
    headers: { 'x-api-key': key }
  });
  if (!pr.ok) throw new Error('Provider profile HTTP ' + pr.status);
  const pj = await pr.json();
  const p = pj.data || pj;

  const profile = {
    username: p.username || u,
    displayName: p.full_name || p.name || p.username || u,
    bio: p.biography || p.bio || '',
    avatar: pickPic(p),
    stats: {
      followers: toNum(p.follower_count != null ? p.follower_count : p.followers),
      following: toNum(p.following_count != null ? p.following_count : p.following)
    },
    posts: [],
    postTimes: [],
    replyTexts: [],
    repliedTo: {}
  };

  try {
    const ps = await fetch(base + '/threads/user-posts?handle=' + encodeURIComponent(u), {
      headers: { 'x-api-key': key }
    });
    if (ps.ok) {
      const pjp = await ps.json();
      const items = (pjp && pjp.data && (pjp.data.items || pjp.data.posts)) || pjp.posts || [];
      profile.posts = items
        .map((it) => (it && it.caption && it.caption.text) || (it && it.text) || it.caption || '')
        .filter(Boolean).slice(0, 15);
      profile.postTimes = items
        .map((it) => toNum(it && (it.taken_at != null ? it.taken_at : it.taken_at_timestamp)))
        .filter((t) => typeof t === 'number');
    }
  } catch (_) { /* abaikan */ }

  // Balasan (best-effort): endpoint & field bisa beda antar provider — defensif.
  try {
    const rs = await fetch(base + '/threads/user-replies?handle=' + encodeURIComponent(u), {
      headers: { 'x-api-key': key }
    });
    if (rs.ok) {
      const rj = await rs.json();
      const items = (rj && rj.data && (rj.data.items || rj.data.replies)) || rj.replies || [];
      for (const it of items) {
        const text = (it && it.caption && it.caption.text) || (it && it.text) || '';
        if (text) profile.replyTexts.push(String(text));
        const parent = it && (it.reply_to_author || it.parent_username ||
          (it.parent && it.parent.username) || (it.replied_to && it.replied_to.username));
        if (parent) {
          const pu = String(parent).toLowerCase();
          if (pu !== u) profile.repliedTo[pu] = (profile.repliedTo[pu] || 0) + 1;
        }
      }
      profile.replyTexts = profile.replyTexts.slice(0, 30);
    }
  } catch (_) { /* abaikan */ }

  if (!profile.bio && profile.posts.length === 0) profile.bio = 'akun threads @' + u;
  return profile;
}

/* ---------------- small utils ---------------- */
function toNum(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const n = Number(v.replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : null; }
  return null;
}
function str(v) { return typeof v === 'string' && v.trim() ? v.trim() : null; }
function pickPic(p) {
  if (Array.isArray(p.hd_profile_pic_versions) && p.hd_profile_pic_versions.length) {
    return p.hd_profile_pic_versions[p.hd_profile_pic_versions.length - 1].url;
  }
  return p.profile_pic_url || p.profile_pic || p.avatar || null;
}
function followersFromOg(desc) {
  if (!desc) return null;
  const m = /([\d.,]+\s*[KMB]?)\s*Followers/i.exec(desc);
  if (!m) return null;
  const raw = m[1].trim().toUpperCase();
  const mult = raw.endsWith('K') ? 1e3 : raw.endsWith('M') ? 1e6 : raw.endsWith('B') ? 1e9 : 1;
  const n = parseFloat(raw.replace(/[KMB]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}
function stripCounts(desc) {
  return desc.replace(/^[^-–—]*(Followers|Following|Threads)[^-–—]*[-–—]\s*/i, '').trim();
}
function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
}

/* ---------------- Diagnostik ----------------
   Lihat apa yang sebenarnya ditarik scraper (buat kalibrasi field tanpa nebak). */
async function inspect(u0) {
  const u = clean(u0);
  const provider = (process.env.THREADS_PROVIDER || 'direct').toLowerCase();
  const profile = await fetchProfile(u);
  const out = {
    mode: provider,
    fetchReplies: FETCH_REPLIES,
    username: profile.username,
    displayName: profile.displayName,
    followers: profile.stats && profile.stats.followers,
    following: profile.stats && profile.stats.following,
    bioLen: (profile.bio || '').length,
    postsCount: (profile.posts || []).length,
    postsSample: (profile.posts || []).slice(0, 3),
    postTimesCount: (profile.postTimes || []).length,
    replyTextsCount: (profile.replyTexts || []).length,
    replyTextsSample: (profile.replyTexts || []).slice(0, 3),
    repliedTo: profile.repliedTo || {}
  };

  // Probe struktur /replies (hanya mode direct) — ungkap di mana username penulis berada.
  if (provider !== 'scrapecreators') {
    try {
      const cookie = await ensureCookie();
      const r = await fetchHtml('https://www.threads.com/@' + u + '/replies', cookie);
      const blocks = parseEmbeddedJson(r.html);
      const probe = {
        httpStatus: r.status, htmlLen: r.html.length, jsonBlocks: blocks.length,
        captionCount: 0, captionWithUserUsername: 0, sampleAuthors: [], sampleCaptionParentKeys: null
      };
      for (const b of blocks) probeReplies(b, u, probe);
      out.repliesProbe = probe;
    } catch (e) { out.repliesProbe = { error: String((e && e.message) || e) }; }
  }
  return out;
}

function probeReplies(obj, owner, probe) {
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    const cap = cur['caption'];
    if (cap && typeof cap === 'object' && typeof cap.text === 'string') {
      probe.captionCount++;
      if (!probe.sampleCaptionParentKeys) probe.sampleCaptionParentKeys = Object.keys(cur).slice(0, 25);
      const au = cur.user && cur.user.username;
      if (typeof au === 'string') {
        probe.captionWithUserUsername++;
        if (probe.sampleAuthors.length < 8 && au.toLowerCase() !== owner) probe.sampleAuthors.push(au);
      }
    }
    for (const v of Object.values(cur)) if (v && typeof v === 'object') stack.push(v);
  }
}

module.exports = { fetchProfile, inspect };
