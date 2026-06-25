// lib/prompt.js — Bestie Meter
const AI_METERS = ['chaos_bareng', 'healing_partner', 'drama_potensial'];

function summarize(p, signals, who) {
  const posts = (p.posts || []).slice(0, 8)
    .map((t, i) => `  ${i + 1}. ${String(t).replace(/\s+/g, ' ').trim()}`).join('\n') || '  (kosong)';
  return [
    `[${who}] @${p.username}`,
    p.bio ? `  Bio: ${p.bio}` : null,
    `  Postingan:`, posts
  ].filter(Boolean).join('\n');
}

function buildMessages(a, b, s) {
  const system = [
    'Kamu "petugas Dinas Pertemanan" yang iseng & jenaka. Tugasmu menilai kadar',
    'PERTEMANAN (bestie) dua akun Threads untuk hiburan — BUKAN penilaian sungguhan.',
    'Ini soal persahabatan, BUKAN romansa: jangan menjodohkan atau bikin konten cinta.',
    'Gaya: santai khas netizen Indonesia, lucu tapi RAMAH ke dua-duanya.',
    'DILARANG KERAS: SARA, body-shaming, seksual, ujaran kebencian, menyerang personal.',
    '',
    'Angka kebestiean & sebagian meter SUDAH dihitung dari data interaksi (jangan diubah).',
    'Tugasmu menulis narasinya + tiga meter sisanya.',
    '',
    'Balas HANYA satu objek JSON valid (tanpa teks lain / markdown / backtick):',
    '{',
    '  "status": string,   // label hubungan, contoh: "Mutualan Garis Keras", "Halu Bestie", "Silent Supporter"',
    '  "verdict": string,  // 1-2 kalimat lucu soal pertemanan mereka',
    '  "catatan_petugas": string,  // 1 kalimat nyeleneh',
    '  "ramalan_pertemanan": string, // 1 kalimat ramalan iseng',
    '  "meters": {  // WAJIB pakai rentang penuh 0-100. 0 = sama sekali tidak, 100 = ekstrem.',
    '    "chaos_bareng": int,     // potensi bikin onar/seru bareng',
    '    "healing_partner": int,  // cocok jadi teman healing/curhat',
    '    "drama_potensial": int   // potensi drama di antara mereka',
    '  }',
    '}',
    'Jangan main aman di angka tengah — kalau datanya ekstrem, beri nilai ekstrem.'
  ].join('\n');

  const user = [
    'Nilai dua akun ini. JSON saja.',
    '',
    summarize(a, s, 'A'),
    '',
    summarize(b, s, 'B'),
    '',
    'Data interaksi terhitung:',
    `- Tingkat bestie (sudah final): ${s.score}/100`,
    `- Saling mention: ${s.crossMentions}\u00D7 (A→B ${s.mentionsAtoB}, B→A ${s.mentionsBtoA}, mutual: ${s.mutual})`,
    `- Hashtag sama: ${s.sharedHashtags.join(', ') || '-'}`,
    `- Emoji sama: ${s.sharedEmojis.join(' ') || '-'}`,
    `- Topik nyambung: ${s.sharedKeywords.join(', ') || '-'}`,
    `- Jam aktif: A ${s.activeHours.a || '?'}, B ${s.activeHours.b || '?'}${s.activeHours.same ? ' (sama-sama)' : ''}`
  ].join('\n');

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function normalize(raw) {
  const out = {
    status: str(raw.status, 'Teman Seperjuangan FYP'),
    verdict: str(raw.verdict, 'Kalian punya energi yang nyambung di beranda.'),
    catatan_petugas: str(raw.catatan_petugas, 'Subjek layak dipertemukan di kolom komentar.'),
    ramalan_pertemanan: str(raw.ramalan_pertemanan, 'Minggu ini cocok healing bareng.'),
    meters: {}
  };
  const m = raw.meters || {};
  for (const k of AI_METERS) out.meters[k] = clampInt(m[k]);
  return out;
}

function str(v, fb) { return typeof v === 'string' && v.trim() ? v.trim().slice(0, 160) : fb; }
function clampInt(v) { let n = parseInt(v, 10); if (isNaN(n)) n = 50; return Math.max(0, Math.min(100, n)); }

module.exports = { buildMessages, normalize, AI_METERS };
