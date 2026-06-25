// api/debug.js — diagnostik scraper. Pakai: /api/debug?u=username
// Hapus file ini kalau sudah selesai kalibrasi.
const { inspect } = require('../lib/threads');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const u = (req.query && req.query.u) || '';
  if (!/^@?[\w.]{1,40}$/.test(String(u))) {
    return res.status(400).json({ ok: false, error: 'Pakai ?u=username' });
  }
  try {
    const data = await inspect(u);
    return res.status(200).json({ ok: true, ...data });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
