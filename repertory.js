/*
 * repertory.js — логіка реперторію без DOM: пошук по індексу, підказки рубрик,
 * зведення таблиці реперторизації. Тестується у Node, використовується в app.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Repertory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SC = (typeof module !== 'undefined' && module.exports) ? require('./search-core.js') : globalThis.SearchCore;

  // ---- індекс -----------------------------------------------------------
  function makeIndex(json) {
    const cache = new Map();
    const idx = Object.assign({}, json);
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

  // Повнотекстовий пошук: усі слова запиту мають бути в одному абзаці
  // (кожне слово — будь-який зі своїх альтернативних стемів).
  function freeText(idx, query, sectionFilter, lang) {
    const words = SC.queryStems(query, lang || 'ru');
    const stems = Array.from(new Set(words.flat()));
    const res = { stems, units: [], byRemedy: new Map(), byArticle: new Map() };
    if (!words.length) return res;
    let units = null;
    for (const alts of words) {
      const u = union(alts.map(st => unitsForStem(idx, st)));
      units = units === null ? u : intersect(units, u);
      if (!units.length) break;
    }
    if (sectionFilter) {
      units = units.filter(u => { const d = idx.docs[idx.ud[u]]; return d.t === 'r' && d.s[idx.us[u]] === sectionFilter; });
    }
    res.units = units;
    for (const u of units) {
      const d = idx.docs[idx.ud[u]];
      const r = idx.ur[u];
      if (r >= 0) {
        let e = res.byRemedy.get(r);
        if (!e) { e = { hits: 0, units: [] }; res.byRemedy.set(r, e); }
        e.hits++; e.units.push(u);
      }
      if (d.t === 'a') {
        let e = res.byArticle.get(d.a);
        if (!e) { e = { hits: 0, units: [] }; res.byArticle.set(d.a, e); }
        e.hits++; e.units.push(u);
      }
    }
    return res;
  }

  // ---- зведення ---------------------------------------------------------
  function grade(hits) { return hits >= 5 ? 3 : hits >= 2 ? 2 : hits >= 1 ? 1 : 0; }

  // rubrics: [{ remedies: Map(remedyIdx -> hits) }]
  function repertorize(rubrics) {
    const rows = new Map();
    rubrics.forEach((rb, k) => {
      if (!rb.remedies) return;
      for (const [r, hits] of rb.remedies) {
        let row = rows.get(r);
        if (!row) {
          row = { r, cover: 0, total: 0, sumHits: 0, grades: new Array(rubrics.length).fill(0), hits: new Array(rubrics.length).fill(0) };
          rows.set(r, row);
        }
        const g = grade(hits);
        row.grades[k] = g; row.hits[k] = hits; row.cover++; row.total += g; row.sumHits += hits;
      }
    });
    return Array.from(rows.values()).sort((a, b) => b.cover - a.cover || b.total - a.total || b.sumHits - a.sumHits || a.r - b.r);
  }

  // ---- підказки рубрик --------------------------------------------------
  function foldForMatch(s, lang) {
    if (lang === 'ua') return s.toLowerCase().split(/\s+/).map(w => SC.foldLetters(w, 'ua')).join(' ').replace(/[^a-zа-яіїє0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.toLowerCase().split(/\s+/).map(w => SC.UA_RU[w] || w).map(w => SC.foldLetters(w, 'ru')).join(' ').replace(/э/g, 'е').replace(/[^a-zа-я0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function suggest(catalog, query, limit, lang) {
    const q = foldForMatch(query, lang);
    if (q.length < 2) return [];
    const words = q.split(' ').filter(Boolean);
    const out = [];
    catalog.rubrics.forEach((rb, i) => {
      const t = rb._f || (rb._f = foldForMatch(rb.t, lang));
      let score = 0;
      if (t.startsWith(q)) score = 4;
      else if (t.includes(' ' + q)) score = 3;
      else if (words.every(w => t.startsWith(w) || t.includes(' ' + w))) score = 2;
      else if (words.every(w => t.includes(w))) score = 1;
      if (score) out.push({ i, score, rb });
    });
    const kindRank = { nos: 0, art: 1, line: 2 };
    out.sort((a, b) => b.score - a.score || kindRank[a.rb.k] - kindRank[b.rb.k] || b.rb.r.length - a.rb.r.length || a.rb.t.length - b.rb.t.length);
    return out.slice(0, limit || 12);
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

  return { makeIndex, freeText, grade, repertorize, suggest, matchRemedies, foldForMatch, vocabRange };
});
