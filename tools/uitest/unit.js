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
function top(q, lang, sec) {
  const res = R.freeText(lang === 'ua' ? idxUa() : idxRu, q, sec || '', lang || 'ru');
  const rows = Array.from(res.byRemedy, ([r, e]) => ({ r, ...e }))
    .sort((a, b) => b.score - a.score || b.hits - a.hits);
  return { res, rows };
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

console.log(`\nПідсумок: OK ${ok}, FAIL ${fails}`);
process.exit(fails ? 1 : 0);
