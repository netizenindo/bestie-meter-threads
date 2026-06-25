// app.js — Bestie Meter
(function () {
  'use strict';

  var METERS = [
    ['saling_sapa', 'Saling Sapa'], ['sefrekuensi', 'Sefrekuensi'],
    ['chaos_bareng', 'Chaos Bareng'], ['healing_partner', 'Healing Partner'],
    ['drama_potensial', 'Drama Potensial']
  ];
  var RING_C = 2 * Math.PI * 40; // r=40

  var $ = function (id) { return document.getElementById(id); };
  var els = {};

  document.addEventListener('DOMContentLoaded', function () {
    els = {
      form: $('form'), u1: $('u1'), u2: $('u2'), err: $('err'),
      inputView: $('input-view'), loading: $('loading'), resultView: $('result-view'),
      capture: $('capture'), verdict: $('verdict'),
      caption: $('caption'), hint: $('share-hint'),
      btnSave: $('btn-save'), btnShare: $('btn-share'), btnAgain: $('btn-again'),
      chipCopy: $('chip-copy'), chipWa: $('chip-wa'), chipThreads: $('chip-threads')
    };
    els.form.addEventListener('submit', onSubmit);
    els.btnAgain.addEventListener('click', reset);
    els.btnSave.addEventListener('click', savePng);
    els.btnShare.addEventListener('click', nativeShare);
    els.chipCopy.addEventListener('click', copyCaption);
    els.chipWa.addEventListener('click', function () { openShare('https://wa.me/?text='); });
    els.chipThreads.addEventListener('click', function () { openShare('https://www.threads.net/intent/post?text='); });
  });

  function onSubmit(e) {
    e.preventDefault();
    var a = clean(els.u1.value), b = clean(els.u2.value);
    if (!ok(a) || !ok(b)) { els.err.textContent = 'Isi dua username Threads yang valid ya.'; return; }
    if (a === b) { els.err.textContent = 'Masukin dua akun yang beda. 😅'; return; }
    els.err.textContent = '';
    show('loading');
    if (location.protocol === 'file:') return renderResult(demoData(a, b));
    fetch('/api/generate?u1=' + encodeURIComponent(a) + '&u2=' + encodeURIComponent(b))
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d || !d.ok) throw new Error(d && d.error); renderResult(d); })
      .catch(function () { renderResult(demoData(a, b)); });
  }

  function renderResult(d) {
    var arc = (Math.max(0, Math.min(100, d.score)) / 100) * RING_C;
    var meters = METERS.map(function (m) {
      var v = d.meters[m[0]] != null ? d.meters[m[0]] : 0;
      return '<div class="meter"><span class="mlab">' + m[1] + '</span>' +
        '<span class="mtrack"><span class="mfill" style="width:' + v + '%"></span></span>' +
        '<span class="mval">' + v + '</span></div>';
    }).join('');

    els.capture.innerHTML =
      '<div class="bm-card">' +
        '<div class="bm-head"><span class="l">' + friends(18) + ' BESTIE METER</span><span class="r">DINAS PERTEMANAN +62</span></div>' +
        '<div class="bm-top">' +
          photo(d.a) +
          '<div class="bm-ring">' +
            '<svg viewBox="0 0 110 110" width="118" height="118">' +
              '<circle cx="55" cy="55" r="40" fill="none" stroke="' + cssv('--track') + '" stroke-width="12"/>' +
              '<circle cx="55" cy="55" r="40" fill="none" stroke="' + cssv('--fill') + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + arc.toFixed(1) + ' ' + RING_C.toFixed(1) + '" transform="rotate(-90 55 55)"/>' +
            '</svg>' +
            '<span class="mark">' + friends(40) + '</span>' +
          '</div>' +
          photo(d.b) +
        '</div>' +
        '<div class="bm-score">' +
          '<div class="bm-num">' + d.score + '%</div>' +
          '<div class="bm-cap">TINGKAT BESTIE</div>' +
          '<div class="bm-status">' + esc(d.status) + '</div>' +
          '<div class="bm-evidence">' + esc(d.evidence) + '</div>' +
        '</div>' +
        '<div class="bm-meters"><div class="bm-meters-title">METERAN PERSAHABATAN</div>' +
          '<div class="bm-grid">' + meters + '</div></div>' +
      '</div>';

    els.verdict.innerHTML =
      '<div class="v-main">' + esc(d.verdict) + '</div>' +
      '<div class="v-sub">📝 ' + esc(d.catatan_petugas) + '<br>🔮 ' + esc(d.ramalan_pertemanan) + '</div>';

    els.caption.value =
      'Tingkat bestie @' + d.a.username + ' \u00D7 @' + d.b.username + ': ' + d.score + '% \u2014 "' + d.status + '" 🤝\n' +
      d.verdict + '\nCek bestie kamu juga di ' + (location.origin || '');
    els.hint.textContent = '';
    show('result');
  }

  function photo(p) {
    var pic = p.avatar
      ? '<img src="' + esc(p.avatar) + '" crossorigin="anonymous" alt="">'
      : silhouette();
    return '<div class="bm-photo"><div class="bm-pic">' + pic + '</div>' +
      '<div class="bm-uname">@' + esc(p.username) + '</div></div>';
  }

  function silhouette() {
    return '<svg viewBox="0 0 78 96" width="78" height="96" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="39" cy="36" r="18" fill="#F5C4B3"/>' +
      '<path d="M8 96 C8 68 26 60 39 60 C52 60 70 68 70 96 Z" fill="#F5C4B3"/></svg>';
  }
  function friends(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<circle cx="8.5" cy="8" r="3" fill="' + cssv('--head') + '"/>' +
      '<circle cx="15.5" cy="8" r="3" fill="' + cssv('--head') + '"/>' +
      '<path d="M3 20 C3 15 6 13 8.5 13 C11 13 14 15 14 20 Z" fill="' + cssv('--head') + '"/>' +
      '<path d="M10 20 C10 15 13 13 15.5 13 C18 13 21 15 21 20 Z" fill="' + cssv('--head') + '"/></svg>';
  }

  function savePng() {
    render().then(function (c) {
      var a = document.createElement('a');
      a.download = 'bestie-meter.png'; a.href = c.toDataURL('image/png'); a.click();
    });
  }
  function nativeShare() {
    render().then(function (c) {
      c.toBlob(function (blob) {
        var file = new File([blob], 'bestie-meter.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], text: els.caption.value }).catch(function () {});
        } else if (navigator.share) {
          navigator.share({ text: els.caption.value }).catch(function () {});
        } else { openShare('https://wa.me/?text='); }
      }, 'image/png');
    });
  }
  function render() { return html2canvas(els.capture, { backgroundColor: null, scale: 2, useCORS: true }); }

  function copyCaption() {
    var t = els.caption.value;
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(done).catch(fallbackCopy);
    else fallbackCopy();
    function fallbackCopy() { els.caption.select(); try { document.execCommand('copy'); } catch (_) {} done(); }
    function done() { els.hint.textContent = 'Caption disalin \u2713'; }
  }
  function openShare(baseUrl) { window.open(baseUrl + encodeURIComponent(els.caption.value), '_blank'); }

  function show(v) {
    els.inputView.classList.toggle('hidden', v !== 'input');
    els.loading.classList.toggle('hidden', v !== 'loading');
    els.resultView.classList.toggle('hidden', v !== 'result');
  }
  function reset() { els.u1.value = ''; els.u2.value = ''; els.err.textContent = ''; show('input'); }
  function clean(s) { return (s || '').replace(/^@/, '').trim().toLowerCase(); }
  function ok(s) { return /^[\w.]{1,40}$/.test(s); }
  function cssv(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#993C1D'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function demoData(a, b) {
    return {
      ok: true,
      a: { username: a, displayName: a, avatar: null },
      b: { username: b, displayName: b, avatar: null },
      score: 91, evidence: 'saling mention 12\u00D7 \u00B7 5 hashtag sama \u00B7 sama-sama anak malam',
      status: 'Mutualan Garis Keras',
      verdict: 'Kalian tuh kayak kopi sama gula \u2014 nggak lengkap kalau salah satu nggak nongol di beranda.',
      catatan_petugas: 'Subjek terdeteksi saling balas dalam hitungan detik.',
      ramalan_pertemanan: 'Minggu ini cocok healing bareng sambil mantengin FYP.',
      meters: { saling_sapa: 100, sefrekuensi: 84, chaos_bareng: 92, healing_partner: 76, drama_potensial: 28 }
    };
  }
})();
