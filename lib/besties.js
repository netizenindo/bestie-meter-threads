// lib/besties.js
// Hitung sinyal "kebestiean" deterministik dari dua profil hasil scrape.
// Headline score & meter "Saling Sapa"/"Sefrekuensi" diikat ke data nyata —
// bukan dikarang AI. Tiap sinyal dipetakan ke 0-100 dengan titik jenuh, jadi
// pasangan yang interaksinya kuat memang bisa tembus 100.

function textOf(profile) {
  return [profile.bio || '', ...(profile.posts || [])].join('\n');
}

function mentionsOf(text) {
  return (text.match(/@[a-z0-9._]{1,30}/gi) || []).map((m) => m.slice(1).toLowerCase());
}
function hashtagsOf(text) {
  return new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.toLowerCase()));
}
function emojisOf(text) {
  return new Set(text.match(/\p{Extended_Pictographic}/gu) || []);
}
function keywordsOf(text) {
  const stop = new Set(['yang', 'sama', 'aja', 'gak', 'nggak', 'udah', 'banget', 'kalau', 'biar',
    'sih', 'dong', 'kok', 'lagi', 'buat', 'sama', 'kita', 'kamu', 'aku', 'this', 'that', 'with',
    'dari', 'untuk', 'pada', 'juga', 'tapi', 'atau', 'akan', 'bisa', 'ada', 'itu', 'ini']);
  const m = (text.toLowerCase().match(/[a-z\u00C0-\u024F]{4,}/g) || []).filter((w) => !stop.has(w));
  return new Set(m);
}
function inter(a, b) {
  const out = [];
  for (const x of a) if (b.has(x)) out.push(x);
  return out;
}
function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

var SHIFTS = ['dini hari', 'pagi', 'siang', 'sore', 'malam'];
function shiftLabel(hour) {
  if (hour <= 3) return 'dini hari';
  if (hour <= 9) return 'pagi';
  if (hour <= 14) return 'siang';
  if (hour <= 18) return 'sore';
  return 'malam';
}
function activeShift(times) {
  if (!times || !times.length) return null;
  const hours = new Array(24).fill(0);
  for (const ts of times) { const h = (((Math.floor(ts / 3600) + 7) % 24) + 24) % 24; hours[h]++; }
  let peak = 0, max = 0;
  hours.forEach((c, h) => { if (c > max) { max = c; peak = h; } });
  if (max === 0) return null;
  return { peakHour: peak, shift: shiftLabel(peak) };
}
function shiftAdjacent(s1, s2) {
  const i = SHIFTS.indexOf(s1), j = SHIFTS.indexOf(s2);
  if (i < 0 || j < 0) return false;
  const d = Math.abs(i - j);
  return d === 1 || d === SHIFTS.length - 1;
}

function computeSignals(a, b) {
  const ua = a.username.toLowerCase();
  const ub = b.username.toLowerCase();
  const ta = textOf(a);
  const tb = textOf(b);

  const aMentions = mentionsOf(ta);
  const bMentions = mentionsOf(tb);
  const mentionsAtoB = aMentions.filter((m) => m === ub).length;
  const mentionsBtoA = bMentions.filter((m) => m === ua).length;
  const crossMentions = mentionsAtoB + mentionsBtoA;
  const mutual = mentionsAtoB > 0 && mentionsBtoA > 0;

  const sharedHashtags = inter(hashtagsOf(ta), hashtagsOf(tb));
  const sharedEmojis = inter(emojisOf(ta), emojisOf(tb));
  const sharedKeywords = inter(keywordsOf(ta), keywordsOf(tb));

  // ---- meter: Saling Sapa (interaksi) ----
  const salingSapa = clamp(crossMentions * 10 + (mutual ? 20 : 0));

  // ---- overlap jam aktif (WIB) ----
  const shiftA = activeShift(a.postTimes);
  const shiftB = activeShift(b.postTimes);
  let timeOverlap = 0; // 0 beda, 1 berdekatan, 2 sama persis
  if (shiftA && shiftB) {
    if (shiftA.shift === shiftB.shift) timeOverlap = 2;
    else if (shiftAdjacent(shiftA.shift, shiftB.shift)) timeOverlap = 1;
  }

  // ---- meter: Sefrekuensi (overlap vibe + jam aktif) ----
  const sefrekuensi = clamp(
    sharedHashtags.length * 14 + sharedEmojis.length * 7 + sharedKeywords.length * 4 +
    (timeOverlap === 2 ? 12 : timeOverlap === 1 ? 6 : 0)
  );

  // ---- headline score ----
  const interaction = mutual
    ? Math.min(55, 25 + crossMentions * 4)
    : Math.min(30, crossMentions * 6);
  const vibe = sefrekuensi * 0.45; // 0-45
  const score = clamp(interaction + vibe);

  // ---- baris bukti (prioritas: mention, hashtag, jam aktif) ----
  const bits = [];
  if (crossMentions > 0) bits.push('saling mention ' + crossMentions + '\u00D7');
  else bits.push('belum pernah saling sebut');
  if (sharedHashtags.length) bits.push(sharedHashtags.length + ' hashtag sama');
  if (timeOverlap === 2) bits.push('sama-sama anak ' + shiftA.shift);
  if (sharedEmojis.length) bits.push(sharedEmojis.length + ' emoji sama');
  if (sharedKeywords.length) bits.push(sharedKeywords.length + ' topik nyambung');
  const evidence = bits.slice(0, 3).join(' \u00B7 ');

  return {
    score, mutual, crossMentions, mentionsAtoB, mentionsBtoA,
    sharedHashtags: sharedHashtags.slice(0, 6),
    sharedEmojis: sharedEmojis.slice(0, 6),
    sharedKeywords: sharedKeywords.slice(0, 8),
    meters: { saling_sapa: salingSapa, sefrekuensi },
    activeHours: {
      a: shiftA ? shiftA.shift : null,
      b: shiftB ? shiftB.shift : null,
      same: timeOverlap === 2
    },
    evidence
  };
}

module.exports = { computeSignals };
