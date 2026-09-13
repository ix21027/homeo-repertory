/*
 * unit.js — перевірки пошуку та реперторизації в Node, без браузера й без сервера.
 * Працює прямо з repertory.js і зібраними data/<lang>/, тож придатний для CI.
 * Запуск: node tools/uitest/unit.js
 * Код виходу: 0 — усі перевірки пройшли, 1 — є провал.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const R = require(path.join(ROOT, 'repertory.js'));
const SC = require(path.join(ROOT, 'search-core.js'));
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const idxRu = R.makeIndex(read('data/ru/index.json'));
const catRu = read('data/ru/catalog.json');
const catUa = read('data/ua/catalog.json');
const name = r => catRu.remedies[r].latin;

let ok = 0, fails = 0;
function check(title, fn) {
  try {
    const note = fn();
    ok++;
    console.log('OK   ' + title + (note ? ' — ' + note : ''));
  } catch (e) {
    fails++;
    console.log('FAIL ' + title + ' — ' + e.message);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Український індекс вантажимо лише за потреби (2,5 МБ JSON).
let _idxUa = null;
const idxUa = () => _idxUa || (_idxUa = R.makeIndex(read('data/ua/index.json')));

// Повнотекстовий пошук: рядки таблиці, відсортовані як в UI (бал, потім кількість збігів).
// Фрази в лапках підтверджуються за текстами документів — так само, як це робить app.js.
function top(q, lang, sec) {
  const idx = lang === 'ua' ? idxUa() : idxRu;
  const res = R.freeText(idx, q, sec || '', lang || 'ru');
  if (res.phraseTerms.length) R.confirmPhrases(idx, res, lang || 'ru', paraTexts(idx, lang || 'ru', res.paras));
  const rows = Array.from(res.byRemedy, ([r, e]) => ({ r, ...e }))
    .sort((a, b) => b.score - a.score || b.hits - a.hits);
  return { res, rows };
}

// Тексти абзаців для підтвердження фраз і для перевірок підстав (кеш документів, як state.docs).
const _docs = new Map();
function getDoc(lang, kind, id) {
  const k = lang + '/' + kind + '/' + id;
  if (!_docs.has(k)) _docs.set(k, read('data/' + lang + '/' + kind + '/' + id + '.json'));
  return _docs.get(k);
}
function paraMd(idx, lang, p) {
  const d = idx.docs[idx.pd[p]];
  const doc = getDoc(lang, d.t === 'r' ? 'remedies' : 'articles', d.id);
  const b = (d.t === 'r' ? doc.sections : doc.blocks)[idx.ps[p]];
  return b ? b.paras[idx.pp[p]] : null;
}
function paraTexts(idx, lang, paras) {
  const m = new Map();
  for (const x of paras) { const md = paraMd(idx, lang, x.p); if (md != null) m.set(x.p, md); }
  return m;
}

// ---- пошук -------------------------------------------------------------

check('«страх смерти» → перший Aconitum napellus', () => {
  const { res, rows } = top('страх смерти');
  assert(rows.length > 0, 'порожня видача');
  assert(/^Aconitum napellus/.test(name(rows[0].r)), 'перший ' + name(rows[0].r));
  return `препаратів ${res.byRemedy.size}, речень ${res.paras.length}`;
});

check('«ухудшение от движения» = «хуже от движения» (однакова перша десятка)', () => {
  const a = top('ухудшение от движения').rows.slice(0, 10).map(x => x.r);
  const b = top('хуже от движения').rows.slice(0, 10).map(x => x.r);
  assert(a.length === 10 && b.length === 10, `рядків ${a.length}/${b.length}`);
  const sa = a.slice().sort((x, y) => x - y), sb = b.slice().sort((x, y) => x - y);
  assert(sa.join() === sb.join(),
    'різні набори: ' + a.map(name).join(', ') + ' ≠ ' + b.map(name).join(', '));
  return a.slice(0, 3).map(name).join(', ') + '…';
});

check('«голвная боль» → виправлення одруку', () => {
  const { res } = top('голвная боль');
  assert(res.corrections.length > 0, 'corrections порожні');
  const c = res.corrections[0];
  assert(/головн/.test(JSON.stringify(c)), 'дивне виправлення ' + JSON.stringify(c));
  return JSON.stringify(res.corrections);
});

check('зайве слово відкидається (res.dropped) і видача перестає бути порожньою', () => {
  const strict = R.freeText(idxRu, 'страх смерти во время лихорадки ночью', '', 'ru');
  assert(strict.dropped.length > 0, 'dropped порожній');
  const { rows } = top('страх смерти');
  assert(rows.length > 0, 'базовий запит порожній');
  assert(strict.byRemedy.size > 0, 'після відкидання лишилось 0 препаратів');
  assert(strict.byRemedy.size < rows.length, `${strict.byRemedy.size} ≥ ${rows.length}: відкинули забагато`);
  return `без «${strict.dropped.join(', ')}» → препаратів ${strict.byRemedy.size}`;
});

check('«страх смерти» в лапках — підмножина звичайного запиту, слова стоять поруч', () => {
  const ph = top('"страх смерти"');
  const plain = top('страх смерти');
  assert(ph.rows.length > 0, 'фраза не знайшла нічого');
  assert(ph.rows.length < plain.rows.length, `фраза ${ph.rows.length} ≥ вільний пошук ${plain.rows.length}`);
  const set = new Set(plain.rows.map(x => x.r));
  const extra = ph.rows.filter(x => !set.has(x.r));
  assert(!extra.length, 'поза вільним пошуком: ' + extra.map(x => name(x.r)).join(', '));
  assert(ph.res.unverified === 0, `ru: ${ph.res.unverified} речень не перевірено за власним текстом`);
  // незалежна перевірка сусідства: розбиваємо речення простим регулярним виразом
  const near = sent => {
    const w = sent.replace(/\*\*|_/g, ' ').toLowerCase().replace(/ё/g, 'е').match(/[а-яa-z]+/g) || [];
    for (let i = 0; i < w.length; i++) {
      if (!w[i].startsWith('страх')) continue;
      if ((w[i + 1] || '').startsWith('смерт')) return true;
      if (w[i + 1] && (SC.STOP.has(w[i + 1]) || w[i + 1].length < 2) && (w[i + 2] || '').startsWith('смерт')) return true;
    }
    return false;
  };
  const pool = ph.res.paras.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = (i * 7919 + 13) % (i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const bad = [];
  let seen = 0;
  for (const x of pool.slice(0, 20)) {
    const sents = SC.splitSentences(paraMd(idxRu, 'ru', x.p));
    seen += x.units.length;
    // кожне підтверджене речення абзацу має містити пару поруч, а не хоч одне з них
    const off = x.units.filter(u => !near(sents[u - idxRu.pstart[x.p]] || ''));
    if (off.length) bad.push(sents[off[0] - idxRu.pstart[x.p]]);
  }
  assert(!bad.length, `${bad.length} абзаців із реченням без пари поруч: ` + bad[0]);
  return `препаратів ${ph.rows.length} проти ${plain.rows.length}; перевірено 20 абзаців / ${seen} речень`;
});

check('підказка «діарея» на ua-каталозі містить «Пронос»', () => {
  const s = R.suggest(catUa, 'діарея', 6, 'ua');
  assert(s.length > 0, 'немає підказок');
  assert(s.some(x => /^Пронос/.test(x.rb.t)), 'підказки: ' + s.map(x => x.rb.t).join(' | '));
  return s.map(x => x.rb.t + '(' + x.n + ')').join(' | ');
});

// ---- реперторизація ----------------------------------------------------

const iAstma = catRu.rubrics.findIndex(r => r.k === 'nos' && /^Астма$/i.test(r.t));
const iNight = catRu.rubrics.findIndex(r => r.k === 'mod' && r.key === 'w.night');

check('рубрики «Астма» і «Хуже: ночью» є в каталозі', () => {
  assert(iAstma >= 0, 'немає нозології «Астма»');
  assert(iNight >= 0, 'немає модальності w.night');
  return `астма ${R.rubricRemedies(catRu, iAstma).size} препаратів, w.night ${R.rubricRemedies(catRu, iNight).size}`;
});

const rub = i => ({ remedies: R.rubricRemedies(catRu, i) });

check('elim (обов’язкова рубрика) зменшує кількість рядків', () => {
  assert(iAstma >= 0 && iNight >= 0, 'рубрики не знайдено');
  const base = R.repertorize([rub(iAstma), rub(iNight)], { sort: 'total' }).length;
  const elim = R.repertorize([rub(iAstma), Object.assign(rub(iNight), { elim: true })], { sort: 'total' }).length;
  assert(elim > 0, 'elim лишив 0 рядків');
  assert(elim < base, `${base} → ${elim}`);
  return `${base} → ${elim}`;
});

check('excl (виключна рубрика) зменшує кількість рядків', () => {
  assert(iAstma >= 0 && iNight >= 0, 'рубрики не знайдено');
  const base = R.repertorize([rub(iAstma)], { sort: 'total' }).length;
  const excl = R.repertorize([rub(iAstma), Object.assign(rub(iNight), { excl: true })], { sort: 'total' }).length;
  assert(excl > 0, 'excl лишив 0 рядків');
  assert(excl < base, `${base} → ${excl}`);
  return `${base} → ${excl}`;
});

// ---- український індекс ------------------------------------------------

check('ua: «нудота вранці» знаходить препарати', () => {
  const { res, rows } = top('нудота вранці', 'ua');
  assert(rows.length > 0, 'порожня видача');
  return `препаратів ${res.byRemedy.size}, перший ${name(rows[0].r)}`;
});

check('ua: фраза «страх смерті» — підмножина звичайного запиту', () => {
  const ph = top('"страх смерті"', 'ua');
  const plain = top('страх смерті', 'ua');
  assert(ph.rows.length > 0, 'фраза не знайшла нічого');
  assert(ph.rows.length < plain.rows.length, `фраза ${ph.rows.length} ≥ вільний пошук ${plain.rows.length}`);
  const set = new Set(plain.rows.map(x => x.r));
  assert(ph.rows.every(x => set.has(x.r)), 'фраза дала препарати поза вільним пошуком');
  // у власному тексті слова немає — збіг прийшов із російського стему перекладу
  return `препаратів ${ph.rows.length} проти ${plain.rows.length}; речень із RU-стемів ${ph.res.unverified}`;
});

console.log(`\nПідсумок: OK ${ok}, FAIL ${fails}`);
process.exit(fails ? 1 : 0);
