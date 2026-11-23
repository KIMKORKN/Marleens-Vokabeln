/* Vokabel-Trainer: Erkennungs- und Bewertungslogik (ohne Oberfläche, testbar) */
(function (root) {
  'use strict';

  // ---------- Hilfsfunktionen ----------
  function median(a) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  const MACRON = { 'ä': 'ā', 'ë': 'ē', 'ï': 'ī', 'ö': 'ō', 'ü': 'ū', 'Ä': 'Ā', 'Ë': 'Ē', 'Ï': 'Ī', 'Ö': 'Ō', 'Ü': 'Ū', 'é': 'ē', 'á': 'ā', 'í': 'ī', 'ó': 'ō', 'ú': 'ū' };
  // Im Lateinischen gibt es keine Umlaute: die Texterkennung liest Längenstriche oft als Umlaut.
  function fixLatin(t) {
    t = String(t).replace(/([a-zāēīōū])T\b/g, '$1ī')                 // ī wird oft als T gelesen
      .replace(/(^|\s)([A-Z])(?=[a-zāēīōū]{2})/g, (m, p, c) => p + c.toLowerCase());
    return t.replace(/&/g, 'ē').replace(/[äëïöüÄËÏÖÜéáíóú]/g, c => MACRON[c]).replace(/[|{}\[\]©®“”„"]/g, '').replace(/\s+/g, ' ').trim();
  }

  function isNoise(t) {
    if (!t) return true;
    if (/^[^A-Za-zÀ-ž0-9.]+$/.test(t)) return true;      // nur Sonderzeichen
    if (/^[VvYy\/\\|{}()<>✓]$/.test(t)) return true;       // Häkchen
    return false;
  }

  // ---------- Strichstärke eines Wortes (für Fett-Erkennung) ----------
  // gray: Uint8Array (Graustufen, normalisiert), w: Bildbreite
  function strokeWidth(gray, w, box) {
    const h = box.y1 - box.y0;
    const runs = [];
    for (let y = box.y0; y < box.y1; y++) {
      let r = 0;
      const off = y * w;
      for (let x = box.x0; x < box.x1; x++) {
        if (gray[off + x] < 150) r++;
        else if (r) { runs.push(r); r = 0; }
      }
      if (r) runs.push(r);
    }
    const f = runs.filter(r => r < h * 0.5).sort((a, b) => a - b);
    if (f.length < 4) return 0;
    const q = f.slice(f.length >> 2, (f.length * 3) >> 2);
    return q.reduce((a, b) => a + b, 0) / q.length;
  }

  // ---------- Schattenkorrektur ----------
  // gray: Uint8Array (w*h). Hintergrund (Papierhelligkeit) grob schätzen und herausdividieren.
  function normalizeGray(gray, w, h) {
    const F = 16, sw = Math.ceil(w / F), sh = Math.ceil(h / F);
    let bg = new Float32Array(sw * sh);
    for (let by = 0; by < sh; by++) for (let bx = 0; bx < sw; bx++) {
      // obere Helligkeit im Block (90. Perzentil grob über Maximum ohne Ausreißer)
      let m1 = 0, m2 = 0;
      for (let y = by * F; y < Math.min(h, by * F + F); y += 2) for (let x = bx * F; x < Math.min(w, bx * F + F); x += 2) {
        const v = gray[y * w + x];
        if (v > m1) { m2 = m1; m1 = v; } else if (v > m2) m2 = v;
      }
      bg[by * sw + bx] = m2 || m1;
    }
    // Dilatation (3x3) + mehrfacher Box-Blur im kleinen Bild
    const dil = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.max(0, Math.min(sh - 1, y + dy)), xx = Math.max(0, Math.min(sw - 1, x + dx));
        m = Math.max(m, bg[yy * sw + xx]);
      }
      dil[y * sw + x] = m;
    }
    bg = dil;
    for (let it = 0; it < 3; it++) {
      const t = new Float32Array(sw * sh);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= sh || xx >= sw) continue;
          s += bg[yy * sw + xx]; n++;
        }
        t[y * sw + x] = s / n;
      }
      bg = t;
    }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = Math.min(sh - 1.001, Math.max(0, y / F - 0.5)), y0 = Math.floor(fy), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(sw - 1.001, Math.max(0, x / F - 0.5)), x0 = Math.floor(fx), tx = fx - x0;
        const i = y0 * sw + x0;
        const b = (bg[i] * (1 - tx) + bg[i + 1] * tx) * (1 - ty) + (bg[i + sw] * (1 - tx) + bg[i + sw + 1] * tx) * ty;
        out[y * w + x] = Math.max(0, Math.min(255, Math.round(gray[y * w + x] * 255 / Math.max(20, b))));
      }
    }
    return out;
  }

  // ---------- Seitenanalyse ----------
  // words: [{text, conf, x0, y0, x1, y1, sw}]
  function parsePage(words, pageWidth) {
    const warnings = [];
    let ws = words
      .map(w => Object.assign({}, w, { text: String(w.text || '').trim() }))
      .filter(w => w.text && w.conf >= 35 && !isNoise(w.text));
    if (ws.length < 5) return { entries: [], warnings: ['Zu wenig Text erkannt. Bitte Foto heller und gerader aufnehmen.'] };

    ws.forEach(w => { w.h = w.y1 - w.y0; w.cx = (w.x0 + w.x1) / 2; w.cy = (w.y0 + w.y1) / 2; });
    const hMed = median(ws.map(w => w.h));
    ws = ws.filter(w => w.h > hMed * 0.45 && w.h < hMed * 2.5);

    // 2) Unteren Seitenbereich (+++ Sätze, Wortkasten) abschneiden
    const cut = words.filter(w => /\+\+|•/.test(String(w.text))).map(w => (w.y0 + w.y1) / 2);
    if (cut.length) {
      const yc = Math.min.apply(null, cut) - hMed * 0.6;
      ws = ws.filter(w => w.cy < yc);
      if (ws.length < 5) return { entries: [], warnings: ['Zu wenig Text erkannt.'] };
    }

    // 1) Schräglage und Wölbung der Seite: Zeilenneigung aus längeren Wortketten messen
    //    und als glatte Fläche s(x,y) = a + b·x + c·y + d·x·y modellieren.
    const meas = [];
    const used = new Set();
    const byX = ws.slice().sort((p, q) => p.x0 - q.x0);
    const nextOf = a => {
      let best = null, bd = Infinity;
      byX.forEach(b => {
        if (b === a || b.x0 <= a.x1 - 2) return;
        const dx = b.x0 - a.x1;
        if (dx > 4 * hMed) return;
        if (Math.abs(b.y1 - a.y1) > 0.7 * hMed) return;
        if (dx < bd) { bd = dx; best = b; }
      });
      return best;
    };
    const base = w => /[gjpqyß(),;]/.test(w.text) ? null : w.y1;
    byX.forEach(a => {
      if (used.has(a)) return;
      const chain = [a]; used.add(a);
      let c = a, n;
      while ((n = nextOf(c)) && !used.has(n)) { chain.push(n); used.add(n); c = n; }
      const pts2 = chain.filter(w => w.conf > 60 && base(w) !== null).map(w => ({ x: w.cx, y: base(w) }));
      if (pts2.length < 2) return;
      const span = pts2[pts2.length - 1].x - pts2[0].x;
      if (span < 3 * hMed) return;
      const mx = pts2.reduce((t, p) => t + p.x, 0) / pts2.length, my = pts2.reduce((t, p) => t + p.y, 0) / pts2.length;
      let sxy = 0, sxx = 0;
      pts2.forEach(p => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) * (p.x - mx); });
      if (sxx > 0) meas.push({ x: mx, y: my, s: sxy / sxx, wt: span });
    });
    const gx0 = Math.min.apply(null, ws.map(w => w.x0));
    const W = Math.max.apply(null, ws.map(w => w.x1)) - gx0 || 1;
    const gy0 = Math.min.apply(null, ws.map(w => w.y0));
    const H = Math.max.apply(null, ws.map(w => w.y1)) - gy0 || 1;
    function fit(ms) {
      // gewichtete kleinste Quadrate für 4 Parameter
      const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], B = [0, 0, 0, 0];
      ms.forEach(m => {
        const u = (m.x - gx0) / W, v = (m.y - gy0) / H, f = [1, u, v, u * v];
        for (let i = 0; i < 4; i++) { B[i] += m.wt * f[i] * m.s; for (let j = 0; j < 4; j++) A[i][j] += m.wt * f[i] * f[j]; }
      });
      for (let i = 0; i < 4; i++) A[i][i] += 1e-6 * (A[0][0] || 1);
      for (let i = 0; i < 4; i++) {           // Gauß-Elimination
        let p = i; for (let r = i + 1; r < 4; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
        [A[i], A[p]] = [A[p], A[i]]; [B[i], B[p]] = [B[p], B[i]];
        for (let r = i + 1; r < 4; r++) { const f = A[r][i] / A[i][i]; for (let k = i; k < 4; k++) A[r][k] -= f * A[i][k]; B[r] -= f * B[i]; }
      }
      const x = [0, 0, 0, 0];
      for (let i = 3; i >= 0; i--) { let t = B[i]; for (let k = i + 1; k < 4; k++) t -= A[i][k] * x[k]; x[i] = t / A[i][i]; }
      return x;
    }
    const evalS = (c, x, y) => { const u = (x - gx0) / W, v = (y - gy0) / H; return c[0] + c[1] * u + c[2] * v + c[3] * u * v; };
    let coef = [median(meas.map(m => m.s)) || 0, 0, 0, 0];
    if (meas.length >= 6) {
      coef = fit(meas);
      const resid = meas.map(m => Math.abs(m.s - evalS(coef, m.x, m.y)));
      const mad = median(resid) || 0.01;
      const good = meas.filter((m, i) => resid[i] < 3 * mad + 0.01);
      if (good.length >= 6) coef = fit(good);
    }
    const slopeAt = (x, y) => Math.max(-0.35, Math.min(0.35, evalS(coef, x, y)));
    const globalS = slopeAt(gx0 + W / 2, gy0 + H / 2);
    // Jedes Wort entlang seiner Zeile bis zum linken Rand zurückverfolgen
    ws.forEach(w => {
      let x = w.cx, y = w.y1;
      const step = hMed;
      while (x > gx0) { const dx = Math.min(step, x - gx0); y -= slopeAt(x - dx / 2, y) * dx; x -= dx; }
      w.ry = y;
      w.rx = w.cx; w.rx0 = w.x0; w.rx1 = w.x1;
    });
    const slope = globalS;

    // 3) Spalten über Lücken im Belegungs-Histogramm finden
    const minX = Math.min.apply(null, ws.map(w => w.rx0));
    const maxX = Math.max.apply(null, ws.map(w => w.rx1));
    const bins = 240, bw = (maxX - minX) / bins;
    const cov = new Array(bins).fill(0);
    ws.forEach(w => {
      const a = Math.max(0, Math.floor((w.rx0 - minX) / bw));
      const b = Math.min(bins - 1, Math.floor((w.rx1 - minX) / bw));
      for (let i = a; i <= b; i++) cov[i]++;
    });
    const mx = Math.max.apply(null, cov);
    const thr = Math.max(1, mx * 0.12);
    const gutters = [];
    let i = 0;
    while (i < bins) {
      if (cov[i] <= thr) {
        let j = i;
        while (j < bins && cov[j] <= thr) j++;
        if (i > 0 && j < bins && (j - i) * bw > hMed * 0.9) gutters.push(minX + ((i + j) / 2) * bw);
        i = j;
      } else i++;
    }
    const col = w => { let c = 0; gutters.forEach(g => { if (w.rx > g) c++; }); return c; };
    ws.forEach(w => { w.col = col(w); });
    let latC = 0, formC = 1, deC = 2;
    if (gutters.length === 1) { formC = -1; deC = 1; warnings.push('Nur zwei Spalten erkannt. Bitte Formen prüfen.'); }
    if (gutters.length === 0) return { entries: [], warnings: ['Spalten wurden nicht erkannt. Bitte die Seite gerade und vollständig fotografieren.'] };

    // 4) Zeilen bilden
    function lines(list) {
      const s = list.slice().sort((a, b) => a.ry - b.ry);
      const out = [];
      s.forEach(w => {
        const l = out.find(l => Math.abs(l.ry - w.ry) < hMed * 0.6);
        if (l) { l.words.push(w); l.ry = (l.ry * (l.words.length - 1) + w.ry) / l.words.length; }
        else out.push({ ry: w.ry, words: [w] });
      });
      out.forEach(l => l.words.sort((a, b) => a.rx - b.rx));
      return out.sort((a, b) => a.ry - b.ry);
    }

    const latLines = lines(ws.filter(w => w.col === latC)).filter(l => {
      const t = l.words.map(w => w.text).join(' ');
      return /[a-zA-Zāēīōū]{2,}/.test(fixLatin(t));
    });
    if (!latLines.length) return { entries: [], warnings: ['Keine lateinischen Wörter erkannt.'] };

    // Feinabgleich: Zeilen der Formen- und Deutschspalte auf die nächstgelegenen Lateinzeilen ausrichten
    const anchors = latLines.map(l => l.ry);
    const nearest = y => anchors.reduce((b, a) => Math.abs(a - y) < Math.abs(b - y) ? a : b, anchors[0]);
    [formC, deC].forEach(c => {
      if (c < 0) return;
      const ls = lines(ws.filter(w => w.col === c));
      const res = ls.map(l => ({ y: l.ry, r: l.ry - nearest(l.ry) }));
      ls.forEach(l => {
        const near = res.slice().sort((a, b) => Math.abs(a.y - l.ry) - Math.abs(b.y - l.ry)).slice(0, 7).map(x => x.r);
        const corr = median(near);
        l.words.forEach(w => { w.ry -= corr; });
      });
    });

    const entries = latLines.map(l => ({ ry: l.ry, latin: fixLatin(l.words.map(w => w.text).join(' ')), formW: [], deW: [] }));
    const firstY = entries[0].ry - hMed * 0.8;
    function owner(w) {
      let e = null;
      for (const en of entries) { if (en.ry <= w.ry + hMed * 0.55) e = en; else break; }
      return e;
    }
    ws.forEach(w => {
      if (w.ry < firstY) return;
      if (w.col === formC) { const e = owner(w); if (e) e.formW.push(w); }
      else if (w.col === deC) {
        if (w.text.length === 1 && !/[a-zäöüß]/i.test(w.text)) return;
        if (/^[vVyYE4\/✓]{1,3}$/.test(w.text)) return;            // Häkchen-Reste
        w.text = w.text.replace(/([,;])[vVyY\/]+$/, '$1');
        const e = owner(w); if (e) e.deW.push(w);
      }
    });

    // 5) Fett-Schwelle über alle deutschen Wörter (2 Gruppen)
    const sws = ws.filter(w => w.col === deC && w.sw > 0 && /[a-zäöüß]{3,}/i.test(w.text) && !/^\(/.test(w.text)).map(w => w.sw);
    let boldThr = 0;
    if (sws.length >= 4) {
      let lo = Math.min.apply(null, sws), hi = Math.max.apply(null, sws);
      for (let k = 0; k < 15; k++) {
        const t = (lo + hi) / 2;
        const A = sws.filter(s => s < t), B = sws.filter(s => s >= t);
        if (!A.length || !B.length) break;
        lo = A.reduce((a, b) => a + b, 0) / A.length;
        hi = B.reduce((a, b) => a + b, 0) / B.length;
      }
      boldThr = (hi - lo) / hi > 0.12 ? (lo + hi) / 2 : 0;
      if (!boldThr) warnings.push('Fettdruck nicht sicher erkennbar. Bitte Hauptbedeutungen prüfen.');
    }

    const out = entries.map(e => {
      const forms = fixLatin(lines(e.formW).map(l => l.words.map(w => w.text).join(' ')).join(' '));
      const deWords = [];
      lines(e.deW).forEach(l => l.words.forEach(w => deWords.push(w)));
      return { latin: e.latin, forms, meanings: splitMeanings(deWords, boldThr) };
    }).filter(e => e.latin.length > 1);

    return { entries: out, warnings, slope, gutters: gutters.length };
  }

  // Bedeutungen an , und ; trennen; ein Teil gilt als Hauptbedeutung, wenn die Mehrheit fett ist
  function splitMeanings(deWords, boldThr) {
    const items = [];
    let cur = [];
    const flush = () => {
      const text = cur.map(w => w.text).join(' ').replace(/[;,]+$/, '').replace(/\s+/g, ' ').trim();
      if (text && /[a-zäöüß]/i.test(text)) {
        const core = cur.filter(w => !/^\(.*\)?[;,]?$/.test(w.text) && /[a-zäöüß]{3,}/i.test(w.text));
        const votes = (core.length ? core : cur);
        const bold = boldThr ? votes.filter(w => w.sw >= boldThr).length * 2 >= votes.length : true;
        items.push({ text: text.replace(/[|{}\[\]©®“”„"]/g, '').trim(), main: bold });
      }
      cur = [];
    };
    let depth = 0;
    deWords.forEach(w => {
      cur.push(w);
      depth += (w.text.match(/\(/g) || []).length - (w.text.match(/\)/g) || []).length;
      if (depth <= 0 && /[;,]$/.test(w.text)) { depth = 0; flush(); }
    });
    flush();
    return items;
  }

  // ---------- Bewertung ----------
  const STRIP = /\b(der|die|das|ein|eine|einen|sich|etw\.?|etwas|jmdn\.?|jmdm\.?|jemanden|jemandem|m\.|mit)\b/g;
  function norm(s) {
    return String(s).toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/ß/g, 'ss')
      .replace(/\.\.\./g, ' ').replace(/…/g, ' ')
      .replace(STRIP, ' ')
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/[^a-z ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  // Variante mit Klammerinhalt, z. B. "(bereit)willig" -> "bereitwillig"
  function normFull(s) {
    return norm(String(s).replace(/[()]/g, ''));
  }
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let p = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const c = [i];
      for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      p = c;
    }
    return p[n];
  }
  // 2 = richtig, 1 = fast richtig (Tippfehler), 0 = falsch
  function matchOne(answer, meaning) {
    const a = norm(answer);
    if (!a) return 0;
    const vars = [norm(meaning), normFull(meaning)].filter(Boolean);
    let best = 0;
    vars.forEach(v => {
      if (a === v) best = 2;
      else {
        const tol = v.length <= 4 ? 0 : v.length <= 8 ? 1 : 2;
        if (tol && lev(a, v) <= tol) best = Math.max(best, 1);
      }
    });
    return best;
  }

  const POINTS = { main: 10, extraMain: 5, side: 20 };

  // answerText: Eingabe der Schülerin (mehrere Bedeutungen durch , ; oder "und" getrennt)
  function grade(answerText, meanings, already) {
    const parts = String(answerText).split(/[,;\/\n]|\bund\b/).map(s => s.trim()).filter(Boolean);
    const res = meanings.map((m, i) => ({ i, text: m.text, main: m.main, hit: already && already[i] ? already[i] : 0 }));
    const unmatched = [];
    parts.forEach(p => {
      let bestI = -1, bestS = 0;
      res.forEach((r, i) => {
        if (r.hit === 2) return;
        const s = matchOne(p, r.text);
        if (s > bestS) { bestS = s; bestI = i; }
      });
      if (bestI >= 0) res[bestI].hit = Math.max(res[bestI].hit, bestS);
      else unmatched.push(p);
    });
    return { items: res, unmatched };
  }

  function score(items) {
    let pts = 0, mainFound = 0;
    items.filter(r => r.main && r.hit).forEach(r => {
      const base = mainFound === 0 ? POINTS.main : POINTS.extraMain;
      pts += r.hit === 2 ? base : Math.round(base / 2);
      mainFound++;
    });
    items.filter(r => !r.main && r.hit).forEach(r => { pts += r.hit === 2 ? POINTS.side : POINTS.side / 2; });
    const mains = items.filter(r => r.main);
    const sides = items.filter(r => !r.main);
    return {
      points: pts,
      mainOk: mainFound > 0,
      allMain: mains.every(r => r.hit),
      allSide: sides.every(r => r.hit),
      missingSide: sides.filter(r => !r.hit).length,
      typos: items.filter(r => r.hit === 1).length
    };
  }

  const api = { normalizeGray, parsePage, splitMeanings, strokeWidth, fixLatin, norm, matchOne, grade, score, lev, POINTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VokCore = api;
})(typeof window !== 'undefined' ? window : this);
