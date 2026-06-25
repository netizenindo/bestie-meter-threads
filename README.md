# 🤝 Bestie Meter

Ukur kadar pertemanan dua akun Threads (satir, buat hiburan). Masukin dua
username → skor "kebestiean" + status + meteran. Skor headline & meter
"Saling Sapa"/"Sefrekuensi" dihitung dari data nyata (saling mention + overlap
hashtag/emoji/topik); meter vibe & narasinya dari Groq.

## Struktur
```
api/generate.js  → fetch 2 profil paralel → computeSignals → Groq → JSON
api/avatar.js    → proxy avatar (same-origin, buat export PNG)
lib/threads.js   → scraper (sama dengan KTP: guest-cookie + payload JSON)
lib/besties.js   → hitung sinyal kebestiean deterministik
lib/prompt.js    → prompt + kontrak JSON (ramah, persahabatan bukan romansa)
public/          → 2 input, kartu, export, share
```

## Jalan / deploy
- Coba cepat: buka `public/index.html` (pakai data demo karena file:// tak bisa fetch).
- Lokal: `npm i -g vercel && vercel dev` lalu set `GROQ_API_KEY`.
- Deploy: import ke Vercel (framework Other) + env `GROQ_API_KEY`.

Catatan: scraper tak bisa diuji dari sandbox; verifikasi setelah deploy.
