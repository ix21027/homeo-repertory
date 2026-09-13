/*
 * repertory.js — логіка реперторію без DOM: пошук по індексу речень, підказки рубрик,
 * зведення таблиці реперторизації (ваги, елімінативні та виключні рубрики, сортування).
 * Тестується у Node, використовується в app.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Repertory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SC = (typeof module !== 'undefined' && module.exports) ? require('./search-core.js') : globalThis.SearchCore;

  // Вага розділу Materia Medica у повнотекстовому підборі (решта розділів — 1)
  const SECTION_WEIGHT = { 'Характеристика': 0.5, 'Тип': 0.5, 'Взаимосвязи': 0.3, 'Взаємозв’язки': 0.3, 'Общее': 0.7, 'Загальне': 0.7 };

  // ---- індекс -----------------------------------------------------------
  // Формат v3: одиниця індексу — речення; абзаци описано масивами pd (документ), ps (розділ),
  // pp (номер абзацу в розділі), pr (препарат або -1), pn (кількість речень).
  function makeIndex(json) {
    if (json.v !== 3) throw new Error('index format v' + json.v);
    const idx = Object.assign({}, json);
    const nP = json.pd.length;
    const pstart = new Int32Array(nP + 1);
    for (let p = 0; p < nP; p++) pstart[p + 1] = pstart[p] + json.pn[p];
    const nU = pstart[nP];
    const u2p = new Int32Array(nU);
    for (let p = 0; p < nP; p++) for (let u = pstart[p]; u < pstart[p + 1]; u++) u2p[u] = p;
    const remParas = new Map();
    for (let p = 0; p < nP; p++) { const r = json.pr[p]; if (r >= 0 && json.docs[json.pd[p]].t === 'r') remParas.set(r, (remParas.get(r) || 0) + 1); }
    const cache = new Map();
    idx.pstart = pstart; idx.u2p = u2p; idx.nUnits = nU; idx.remParas = remParas;
    idx.getPostings = function (i) {
      let v = cache.get(i);
      if (!v) { v = SC.decodeList(json.post[i]); cache.set(i, v); }
      return v;
    };
    return idx;
  }

  function vocabRange(vocab, prefix) {
    let lo = 0, hi = vocab.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (vocab[mid] < prefix) lo = mid + 1; else hi = mid;
    }
    const out = [];
    for (let i = lo; i < vocab.length && vocab[i].startsWith(prefix); i++) out.push(i);
    return out;
  }

  function unitsForStem(idx, st) {
    let ids = vocabRange(idx.vocab, st);
    if (st.length < 4) ids = ids.filter(i => idx.vocab[i] === st);
    else if (ids.length > 80) ids = ids.slice(0, 80);
    if (!ids.length) return [];
    if (ids.length === 1) return idx.getPostings(ids[0]);
    const seen = new Set();
    for (const i of ids) for (const u of idx.getPostings(i)) seen.add(u);
    return Array.from(seen).sort((a, b) => a - b);
  }

  function intersect(a, b) {
    const out = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { out.push(a[i]); i++; j++; }
      else if (a[i] < b[j]) i++; else j++;
    }
    return out;
  }

  function union(lists) {
    if (lists.length === 1) return lists[0];
    const seen = new Set();
    for (const l of lists) for (const u of l) seen.add(u);
    return Array.from(seen).sort((a, b) => a - b);
  }

  // Відстань Левенштейна з обмеженням (для виправлення одруків за словником індексу)
  function lev(a, b, max) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > max) return max + 1;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  function fuzzyStems(idx, st) {
    if (st.length < 5) return [];
    const maxD = st.length <= 7 ? 1 : 2;
    const out = [];
    for (const i of vocabRange(idx.vocab, st[0])) {
      const v = idx.vocab[i];
      if (Math.abs(v.length - st.length) > maxD) continue;
      const d = lev(v, st, maxD);
      if (d <= maxD) out.push({ i, d, df: idx.post[i].length });
    }
    out.sort((a, b) => a.d - b.d || b.df - a.df);
    return out.slice(0, 3).map(x => idx.vocab[x.i]);
  }

  function gradeScore(score) { return score >= 6 ? 3 : score >= 3 ? 2 : score > 0 ? 1 : 0; }

  // Повнотекстовий пошук. Сильний збіг — усі слова запиту в одному реченні (2 бали),
  // слабкий — в одному абзаці (1 бал); бал множиться на вагу розділу; сума по препарату
  // ділиться на м'яку поправку за обсяг опису (поліхрести мають більше абзаців).
  // Слова з «-» попереду виключають абзаци. Слово без збігів замінюється найближчим за
  // словником індексу (res.corrections).
  function freeText(idx, query, sectionFilter, lang) {
    const { inc, exc } = SC.queryTerms(query, lang || 'ru');
    const res = { stems: [], paras: [], byRemedy: new Map(), byArticle: new Map(), corrections: [] };
    if (!inc.length) return res;
    const slots = [];
    const stemSet = new Set();
    for (const term of inc) {
      let alts = term.alts;
      let u = union(alts.map(st => unitsForStem(idx, st)));
      if (!u.length) {
        const fz = fuzzyStems(idx, alts[0]);
        if (fz.length) { res.corrections.push({ word: term.word, to: fz }); alts = fz; u = union(fz.map(st => unitsForStem(idx, st))); }
      }
      slots.push({ units: u, alts });
      alts.forEach(s => stemSet.add(s));
    }
    res.stems = Array.from(stemSet);
    let strong = slots[0].units;
    for (let i = 1; i < slots.length && strong.length; i++) strong = intersect(strong, slots[i].units);
    const toParas = units => { const s = new Set(); for (const u of units) s.add(idx.u2p[u]); return s; };
    let paraSet = toParas(slots[0].units);
    for (let i = 1; i < slots.length && paraSet.size; i++) {
      const other = toParas(slots[i].units);
      paraSet = new Set(Array.from(paraSet).filter(p => other.has(p)));
    }
    if (exc.length && paraSet.size) {
      for (const term of exc) for (const u of union(term.alts.map(st => unitsForStem(idx, st)))) paraSet.delete(idx.u2p[u]);
    }
    const strongByPara = new Map();
    for (const u of strong) { const p = idx.u2p[u]; if (!paraSet.has(p)) continue; let a = strongByPara.get(p); if (!a) strongByPara.set(p, a = []); a.push(u); }
    const unitsByPara = new Map();
    for (const s of slots) for (const u of s.units) { const p = idx.u2p[u]; if (!paraSet.has(p) || strongByPara.has(p)) continue; let a = unitsByPara.get(p); if (!a) unitsByPara.set(p, a = new Set()); a.add(u); }
    const paras = [];
    for (const p of Array.from(paraSet).sort((a, b) => a - b)) {
      const d = idx.docs[idx.pd[p]];
      if (sectionFilter && !(d.t === 'r' && d.s[idx.ps[p]] === sectionFilter)) continue;
      const su = strongByPara.get(p);
      const units = su ? su : Array.from(unitsByPara.get(p) || []).sort((a, b) => a - b);
      const w = d.t === 'r' ? (SECTION_WEIGHT[d.s[idx.ps[p]]] || 1) : 1;
      const score = (su ? 2 : 1) * w;
      const k = paras.length;
      paras.push({ p, strong: !!su, units, score });
      const r = idx.pr[p];
      if (r >= 0) {
        let e = res.byRemedy.get(r);
        if (!e) res.byRemedy.set(r, e = { hits: 0, raw: 0, score: 0, best: 0, g: 0, paras: [] });
        e.hits++; e.raw += score; if (score > e.best) e.best = score; e.paras.push(k);
      }
      if (d.t === 'a') {
        let e = res.byArticle.get(d.a);
        if (!e) res.byArticle.set(d.a, e = { hits: 0, paras: [] });
        e.hits++; e.paras.push(k);
      }
    }
    for (const [r, e] of res.byRemedy) {
      const np = idx.remParas.get(r) || 60;
      e.score = e.raw / (1 + Math.log10(1 + np / 80));
      e.g = gradeScore(e.score);
    }
    res.paras = paras;
    return res;
  }

  // ---- рубрики каталогу --------------------------------------------------
  // Map(remedy → {g, hits}); для «Клініки» ступінь з каталогу, дочірні рубрики (ієрархія) — ступінь 1.
  function rubricRemedies(catalog, i) {
    const rb = catalog.rubrics[i];
    if (rb._rem) return rb._rem;
    const m = new Map();
    rb.r.forEach((r, k) => m.set(r, { g: rb.g ? rb.g[k] : 2, hits: 1 }));
    if (rb.ch) {
      const seen = new Set([i]);
      const walk = (j, depth) => {
        if (seen.has(j) || depth > 3) return;
        seen.add(j);
        const c = catalog.rubrics[j];
        for (const r of c.r) if (!m.has(r)) m.set(r, { g: 1, hits: 1, child: j });
        if (c.ch) for (const k of c.ch) walk(k, depth + 1);
      };
      for (const j of rb.ch) walk(j, 1);
    }
    rb._rem = m;
    return m;
  }

  // ---- зведення ---------------------------------------------------------
  // rubrics: [{ remedies: Map(remedy → {g, hits, score?} | number), weight?, elim?, excl? }]
  // opts.sort: 'cover' (типово) | 'total' | 'name' (потрібен opts.nameOf)
  function repertorize(rubrics, opts) {
    opts = opts || {};
    const rows = new Map();
    const excl = new Set();
    let nElim = 0;
    rubrics.forEach((rb, k) => {
      if (!rb.remedies) return;
      if (rb.excl) { for (const r of rb.remedies.keys()) excl.add(r); return; }
      const w = rb.weight || 1;
      if (rb.elim) nElim++;
      for (const [r, v] of rb.remedies) {
        const g = typeof v === 'number' ? v : v.g;
        const hits = typeof v === 'number' ? 1 : (v.hits || 1);
        const sc = typeof v === 'number' ? g : (v.score != null ? v.score : g);
        let row = rows.get(r);
        if (!row) rows.set(r, row = { r, cover: 0, total: 0, sumHits: 0, sumScore: 0, elimOk: 0, grades: new Array(rubrics.length).fill(0), hits: new Array(rubrics.length).fill(0) });
        row.grades[k] = g; row.hits[k] = hits; row.cover++; row.total += g * w; row.sumHits += hits; row.sumScore += sc * w;
        if (rb.elim) row.elimOk++;
      }
    });
    const out = Array.from(rows.values()).filter(row => !excl.has(row.r) && row.elimOk === nElim);
    const byCover = (a, b) => b.cover - a.cover || b.total - a.total || b.sumScore - a.sumScore || a.r - b.r;
    const byTotal = (a, b) => b.total - a.total || b.cover - a.cover || b.sumScore - a.sumScore || a.r - b.r;
    const byName = (a, b) => opts.nameOf(a.r).localeCompare(opts.nameOf(b.r)) || a.r - b.r;
    return out.sort(opts.sort === 'total' ? byTotal : opts.sort === 'name' && opts.nameOf ? byName : byCover);
  }

  // ---- підказки рубрик --------------------------------------------------
  function foldForMatch(s, lang) {
    if (lang === 'ua') return s.toLowerCase().split(/\s+/).map(w => SC.foldLetters(w, 'ua')).join(' ').replace(/[^a-zа-яіїє0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.toLowerCase().split(/\s+/).map(w => SC.UA_RU[w] || w).map(w => SC.foldLetters(w, 'ru')).join(' ').replace(/э/g, 'е').replace(/[^a-zа-я0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const KIND_RANK = { nos: 0, mod: 1, etio: 1, art: 2, line: 3 };
  function suggest(catalog, query, limit, lang) {
    const q = foldForMatch(query, lang);
    if (q.length < 2) return [];
    const stop = lang === 'ua' ? SC.STOP_UA : SC.STOP;
    const words = q.split(' ').filter(w => w && !stop.has(w));
    if (!words.length) return [];
    const slots = SC.queryTerms(query, lang).inc.map(t => t.alts);
    const stemHit = (st, a) => st.has(a) || (a.length >= 4 && Array.from(st).some(s => s.startsWith(a)));
    const out = [];
    catalog.rubrics.forEach((rb, i) => {
      const t = rb._f || (rb._f = foldForMatch(rb.t, lang));
      let score = 0;
      if (t.startsWith(q)) score = 5;
      else if (t.includes(' ' + q)) score = 4;
      else if (words.every(w => t.startsWith(w) || t.includes(' ' + w))) score = 3;
      else if (words.every(w => t.includes(w))) score = 2;
      else if (slots.length) {
        // збіг за стемами й синонімами (нудота ↔ Тошнота, діарея ↔ Понос)
        const st = rb._st || (rb._st = new Set(SC.stems(rb.t, lang)));
        if (slots.every(alts => alts.some(a => stemHit(st, a)))) {
          // повний збіг (усі стеми рубрики покриті запитом, напр. «діарея» ↔ «Понос») важить як збіг слова
          const full = Array.from(st).every(s => slots.some(alts => alts.some(a => s === a || (a.length >= 4 && s.startsWith(a)))));
          score = full ? 4.5 : 1;
        }
      }
      if (score) out.push({ i, score, rb, n: rubricRemedies(catalog, i).size });
    });
    out.sort((a, b) => b.score - a.score || KIND_RANK[a.rb.k] - KIND_RANK[b.rb.k] || b.n - a.n || a.rb.t.length - b.rb.t.length);
    // не більше 3 рядкових рубрик однієї статті, щоб вони не витісняли решту підказок
    const perArt = new Map();
    const res = [];
    for (const x of out) {
      if (x.rb.k === 'line') { const n = (perArt.get(x.rb.a) || 0) + 1; perArt.set(x.rb.a, n); if (n > 3) continue; }
      res.push(x);
      if (res.length >= (limit || 12)) break;
    }
    return res;
  }

  // Пошук назв препаратів (для каталогу та переходу за назвою)
  function matchRemedies(catalog, query, limit, lang) {
    const q = foldForMatch(query, lang);
    if (!q) return [];
    const out = [];
    catalog.remedies.forEach((r, i) => {
      if (r.ext) return;
      const f = r._f || (r._f = foldForMatch([r.latin, r.alt, r.translit, r.common].join(' '), lang));
      let score = 0;
      if (f.startsWith(q)) score = 3;
      else if (f.includes(' ' + q)) score = 2;
      else if (f.includes(q)) score = 1;
      if (score) out.push({ i, score, r });
    });
    out.sort((a, b) => b.score - a.score || a.r.latin.localeCompare(b.r.latin));
    return out.slice(0, limit || 8);
  }

  return { makeIndex, freeText, gradeScore, repertorize, rubricRemedies, suggest, matchRemedies, foldForMatch, vocabRange, SECTION_WEIGHT };
});
