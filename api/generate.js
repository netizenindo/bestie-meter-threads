// api/generate.js — Bestie Meter
// GET /api/generate?u1=a&u2=b  atau POST {u1,u2}
const { fetchProfile } = require('../lib/threads');
const { computeSignals } = require('../lib/besties');
const { buildMessages, normalize } = require('../lib/prompt');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const u1 = pick(req, 'u1');
    const u2 = pick(req, 'u2');
    if (!valid(u1) || !valid(u2)) {
      return res.status(400).json({ ok: false, error: 'Dua username Threads-nya kurang pas.' });
    }
    if (u1.replace(/^@/, '').toLowerCase() === u2.replace(/^@/, '').toLowerCase()) {
      return res.status(400).json({ ok: false, error: 'Masukin dua akun yang beda ya. 😅' });
    }

    const [a, b] = await Promise.all([safe(u1), safe(u2)]);
    const signals = computeSignals(a, b);
    const ai = await analyze(a, b, signals);

    return res.status(200).json({
      ok: true,
      a: profileOut(a),
      b: profileOut(b),
      score: signals.score,
      evidence: signals.evidence,
      status: ai.status,
      verdict: ai.verdict,
      catatan_petugas: ai.catatan_petugas,
      ramalan_pertemanan: ai.ramalan_pertemanan,
      meters: Object.assign({}, signals.meters, ai.meters)
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: 'Salah satu profil susah diakses (privat/diblok) atau ada kendala. Coba lagi ya. 🤷'
    });
  }
};

async function safe(u) {
  try { return await fetchProfile(u); }
  catch (e) { throw new Error('profile_failed:' + u); }
}

function profileOut(p) {
  return {
    username: p.username,
    displayName: p.displayName || p.username,
    avatar: p.avatar ? '/api/avatar?u=' + encodeURIComponent(p.avatar) : null
  };
}

async function analyze(a, b, signals) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY belum di-set.');
  const resp = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, temperature: 0.95, max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: buildMessages(a, b, signals)
    })
  });
  if (!resp.ok) throw new Error('Groq error ' + resp.status);
  const data = await resp.json();
  return normalize(safeParse((data.choices && data.choices[0] && data.choices[0].message.content) || '{}'));
}

function pick(req, k) {
  return (req.query && req.query[k]) || (req.body && req.body[k]) || '';
}
function valid(u) { return /^@?[\w.]{1,40}$/.test(String(u)); }
function safeParse(s) {
  try { return JSON.parse(s); }
  catch (_) {
    const m = String(s).replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    try { return m ? JSON.parse(m[0]) : {}; } catch (_) { return {}; }
  }
}
