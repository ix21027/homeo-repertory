#!/usr/bin/env node
/*
 * build.mjs — збирає дані сайту з content/*.md:
 *   data/catalog.json          — каталог препаратів, статей, рубрик (маленький, вантажиться одразу)
 *   data/remedies/<id>.json    — текст препарату за розділами
 *   data/articles/<id>.json    — текст статті за блоками
 *   data/index.json            — інвертований індекс абзаців для повнотекстового пошуку
 *
 *   node tools/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SC = require(path.join(ROOT, 'search-core.js'));

const CONTENT = path.join(ROOT, 'content');
const OUT = path.join(ROOT, 'data');

// ---------------------------------------------------------------------------
// Markdown → структура
// ---------------------------------------------------------------------------
function parseMd(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('no frontmatter: ' + file);
  const fm = {};
  for (const line of m[1].split('\n')) {
    const k = line.indexOf(':');
    if (k > 0) fm[line.slice(0, k).trim()] = line.slice(k + 1).trim();
  }
  const body = m[2];
  // блоки: заголовки ## / ### та абзаци (розділені порожнім рядком)
  const blocks = [];
  let cur = { level: 0, title: null, paras: [] };
  for (const chunk of body.split(/\n\s*\n/)) {
    const t = chunk.trim();
    if (!t) continue;
    const h = t.match(/^(##|###)\s+(.+)$/);
    if (h) {
      blocks.push(cur);
      cur = { level: h[1].length, title: h[2].trim(), paras: [] };
    } else {
      cur.paras.push(t.replace(/\s*\n\s*/g, ' '));
    }
  }
  blocks.push(cur);
  return { fm, blocks: blocks.filter(b => b.title !== null || b.paras.length) };
}

// ---------------------------------------------------------------------------
// Нормалізація латинських назв
// ---------------------------------------------------------------------------
const REPL = [
  [/\bsulfur/g, 'sulphur'], [/\bsulfuric/g, 'sulphuric'], [/\bsulphuris\b/g, 'sulphur'], [/\bnatrum\b/g, 'natrium'], [/\bkalium\b/g, 'kali'],
  [/\bmagnesia\b/g, 'magnesium'], [/\bcalcium\b/g, 'calcarea'], [/\bcarbonica\b/g, 'carbonicum'], [/\bphosphorica\b/g, 'phosphoricum'],
  [/\bmuriatica\b/g, 'muriaticum'], [/\bsulphurica\b/g, 'sulphuricum'], [/\bfluorica\b/g, 'fluoricum'], [/\biodata\b/g, 'iodatum'], [/\bjodatum\b/g, 'iodatum'],
  [/\barsenicosa\b/g, 'arsenicosum'], [/\bacida\b/g, 'acidum'], [/\bmuriatic\b/g, 'muriaticum'], [/\bcarbonic\b/g, 'carbonicum'],
  [/\bacidum ([a-z]+)/g, '$1 acidum'], [/\bgraphytes\b/g, 'graphites'], [/\bcinchona\b/g, 'china'], [/\bcocculus indicus\b/g, 'cocculus'],
  [/\bactaea\b/g, 'actea'], [/\bveratrum\b/g, 'veratrum'], [/\bmercurius solubilis hahnemanni\b/g, 'mercurius solubilis'],
  [/\bhepar sulphur( calcareum)?\b/g, 'hepar sulphur'], [/\brhus tox\b/g, 'rhus toxicodendron'], [/\bnux vom\b/g, 'nux vomica'],
];

function normName(s) {
  let n = s.toLowerCase().replace(/[()«»"“”,.;:]/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.split(' ').map(w => SC.foldHomoglyphs(w)).join(' ');
  n = n.replace(/[^a-z\- ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, to] of REPL) n = n.replace(re, to);
  return n.trim();
}

// ---------------------------------------------------------------------------
// Читання контенту
// ---------------------------------------------------------------------------
const remedyFiles = fs.readdirSync(path.join(CONTENT, 'remedies')).filter(f => f.endsWith('.md')).sort();
const articleFiles = fs.readdirSync(path.join(CONTENT, 'articles')).filter(f => f.endsWith('.md')).sort();

const remedies = [];           // каталог
const remedyDocs = [];         // повні тексти
for (const f of remedyFiles) {
  const { fm, blocks } = parseMd(path.join(CONTENT, 'remedies', f));
  const sections = blocks.map(b => ({ title: b.title || 'Общее', paras: b.paras })).filter(s => s.paras.length);
  const idx = remedies.length;
  remedies.push({
    id: fm.id, latin: fm.latin, alt: fm.alt_latin || '', translit: fm.transliteration || '', common: fm.common || '',
    title: fm.title, nsec: sections.length, ext: false,
  });
  remedyDocs.push({ id: fm.id, latin: fm.latin, alt: fm.alt_latin || '', translit: fm.transliteration || '', common: fm.common || '', title: fm.title,
    source: fm.source || '', origin: fm.origin || '', keywords: fm.keywords ? fm.keywords.split(';').map(s => s.trim()).filter(Boolean) : [], sections });
}

// alias → remedy idx
const alias = new Map();
const firstWord = new Map();
function addAlias(name, idx) {
  const n = normName(name);
  if (!n) return;
  if (!alias.has(n)) alias.set(n, idx);
  const fw = n.split(' ')[0];
  if (!firstWord.has(fw)) firstWord.set(fw, new Set());
  firstWord.get(fw).add(idx);
}
remedies.forEach((r, i) => { addAlias(r.latin, i); if (r.alt) addAlias(r.alt, i); });

// Спеціальні скорочення, поширені у статтях
const SPECIAL = {
  'mercurius solubilis': 'Mercurius', 'mercurius vivus': 'Mercurius', 'merc sol': 'Mercurius', 'merc': 'Mercurius', 'hepar': 'Hepar sulphur', 'hepar sulphur calcareum': 'Hepar sulphur',
  'arsenicum': 'Arsenicum album', 'arsenicum alb': 'Arsenicum album', 'rhus': 'Rhus toxicodendron', 'nux': 'Nux vomica', 'china': 'China officinalis',
  'calcarea': 'Calcarea carbonica', 'calc carb': 'Calcarea carbonica', 'natrium': 'Natrium muriaticum', 'nat mur': 'Natrium muriaticum',
  'sulphur': 'Sulphur', 'sulph': 'Sulphur', 'lycopodium': 'Lycopodium clavatum', 'pulsatilla': 'Pulsatilla', 'silicea': 'Silicea terra',
  'ignatia': 'Ignatia amara', 'bryonia': 'Bryonia alba', 'phosphorus': 'Phosphorus', 'sepia': 'Sepia officinalis', 'lachesis': 'Lachesis',
  'apis': 'Apis mellifica', 'arnica': 'Arnica montana', 'belladonna': 'Belladonna', 'chamomilla': 'Chamomilla', 'aconitum': 'Aconitum napellus',
  'aconit': 'Aconitum napellus', 'gelsemium': 'Gelsemium', 'ipecacuanha': 'Ipecacuanha', 'ipeca': 'Ipecacuanha', 'cimicifuga': 'Actea racemosa',
  'thuja': 'Thuja occidentalis', 'carbo veg': 'Carbo vegetabilis', 'veratrum': 'Veratrum album', 'kali carb': 'Kali carbonicum',
  'ant tart': 'Antimonium tartaricum', 'ant crud': 'Antimonium crudum', 'ferrum': 'Ferrum metallicum', 'cuprum': 'Cuprum metallicum',
  'zincum': 'Zincum metallicum', 'platina': 'Platinum metallicum', 'platinum': 'Platinum metallicum', 'aurum': 'Aurum metallicum',
  'argentum': 'Argentum nitricum', 'plumbum': 'Plumbum metallicum', 'stannum': 'Stannum metallicum', 'magnesium': 'Magnesium carbonicum',
  'baryta': 'Baryta carbonica', 'kali': 'Kali carbonicum', 'ammonium': 'Ammonium carbonicum', 'nitricum acidum': 'Nitricum acidum',
  'hyoscyamus': 'Hyoscyamus niger', 'conium': 'Conium maculatum', 'colocynthis': 'Colocynthis', 'colocyntis': 'Colocynthis', 'dulcamara': 'Dulcamara',
  'hamamelis': 'Hamamelis virginica', 'hypericum': 'Hypericum perforatum', 'ledum': 'Ledum palustre', 'ruta': 'Ruta graveolens', 'symphytum': 'Symphytum officinale',
  'staphysagria': 'Staphysagria', 'coffea': 'Coffea cruda', 'cocculus': 'Cocculus indicus', 'drosera': 'Drosera rotundifolia', 'spongia': 'Spongia tosta',
  'agaricus': 'Agaricus muscarius', 'anacardium': 'Anacardium orientale', 'causticum': 'Causticum', 'graphites': 'Graphites', 'petroleum': 'Petroleum',
  'psorinum': 'Psorinum', 'medorrhinum': 'Medorrhinum', 'tuberculinum': 'Tuberculinum', 'luesinum': 'Luesinum', 'opium': 'Opium', 'stramonium': 'Stramonium',
  'iodum': 'Iodum', 'borax': 'Borax', 'capsicum': 'Capsicum annuum', 'cina': 'Cina', 'euphrasia': 'Euphrasia officinalis', 'allium cepa': 'Allium cepa',
  'sabina': 'Sabina', 'secale': 'Secale cornutum', 'sanguinaria': 'Sanguinaria canadensis', 'spigelia': 'Spigelia anthelmia', 'tabacum': 'Tabacum',
  'urtica': 'Urtica urens', 'cantharis': 'Cantharis', 'mezereum': 'Mezereum', 'kreosotum': 'Kreosotum', 'lac caninum': 'Lac caninum',
};

function lev(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function fuzzyAlias(n) {
  if (n.length < 6) return -1;
  let best = -1, bestD = 3;
  for (const [k, v] of alias) {
    if (k[0] !== n[0]) continue;
    const d = lev(k, n);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

function resolveName(name) {
  const n = normName(name);
  if (!n) return -1;
  if (alias.has(n)) return alias.get(n);
  if (SPECIAL[n]) {
    const t = normName(SPECIAL[n]);
    if (alias.has(t)) return alias.get(t);
  }
  const words = n.split(' ');
  if (words.length >= 2) {
    const two = words.slice(0, 2).join(' ');
    if (alias.has(two)) return alias.get(two);
    // прикметник міг бути в іншому роді: "kali carbonica" ~ "kali carbonicum"
    for (const [k, v] of alias) {
      if (k.startsWith(two.slice(0, Math.max(two.length - 2, 6))) && k.split(' ').length === words.length) return v;
    }
  }
  const fw = firstWord.get(words[0]);
  if (fw && fw.size === 1 && words.length === 1) return [...fw][0];
  return fuzzyAlias(n);
}

// «Зовнішні» препарати — згадані в статтях, але без сторінки в архіві
const extIdx = new Map();
function extRemedy(name) {
  const n = normName(name);
  if (!n) return -1;
  if (extIdx.has(n)) return extIdx.get(n);
  const idx = remedies.length;
  const latin = name.trim().split(' ').map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(' ');
  remedies.push({ id: 'ext-' + n.replace(/\s+/g, '-'), latin, alt: '', translit: '', common: '', title: latin, nsec: 0, ext: true });
  extIdx.set(n, idx);
  addAlias(latin, idx);
  return idx;
}

const LATIN_WORD = /^[A-Z][a-z\-]+$/;
function splitRemedyHeader(title, splitCaps) {
  // "Aconitum (Аконитум)" | "Ferrum aceticum и Ferrum metallicum (…)" | "Larch (Larix decidua) - Лиственница"
  const names = [];
  const noParen = title.replace(/\([^)]*\)/g, ' ').replace(/[Θ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const part of noParen.split(/\s+(?:и|=|,|—|–|-)\s+|,\s*/)) {
    const p = part.replace(/[:.]+$/, '').trim();
    if (!p) continue;
    const words = p.split(' ');
    let cur = [];
    for (const w of words) {
      const fw = SC.foldHomoglyphs(w.toLowerCase());
      if (!/^[a-z\-]+$/.test(fw)) break;
      if (splitCaps && /^[A-Z]/.test(w) && cur.length) { names.push(cur.join(' ')); cur = []; }
      cur.push(w);
    }
    if (cur.length && /^[A-Z]/.test(cur[0])) names.push(cur.join(' '));
  }
  return names;
}

const unresolvedHeaders = new Map();
const unresolvedList = new Map();
function resolveHeaderNames(title, allowExt) {
  const out = [];
  for (const nm of splitRemedyHeader(title, allowExt)) {
    let i = resolveName(nm);
    if (i < 0 && allowExt && nm.length >= 4) i = extRemedy(nm);
    if (i < 0) unresolvedHeaders.set(nm, (unresolvedHeaders.get(nm) || 0) + 1);
    else out.push(i);
  }
  return [...new Set(out)];
}

// Список у вступі: "**Aconitum Allium cepa Anacardium …**" — сегментація за великими літерами
function resolveBoldList(text) {
  let t = text.replace(/\*\*/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  t = t.split(' ').map(w => SC.foldHomoglyphs(w.toLowerCase()) === w.toLowerCase() ? w : w.split('').map(ch => ch).join('')).join(' ');
  const words = t.split(' ').filter(Boolean);
  const names = [];
  let cur = [];
  for (const w of words) {
    const fw = SC.foldHomoglyphs(w.toLowerCase());
    if (!/^[a-z\-]+$/.test(fw)) { if (cur.length) { names.push(cur.join(' ')); cur = []; } continue; }
    if (/^[A-ZА-Я]/.test(w) && cur.length) { names.push(cur.join(' ')); cur = []; }
    cur.push(w);
  }
  if (cur.length) names.push(cur.join(' '));
  const out = [];
  for (const nm of names) {
    let i = resolveName(nm);
    if (i < 0) { unresolvedList.set(nm, (unresolvedList.get(nm) || 0) + 1); continue; }
    out.push(i);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Статті
// ---------------------------------------------------------------------------
const TOPICS = [
  ['Вагітність, пологи, годування', /беремен|родов|послерод|соск|молок|лохии|роды|лактац|гипергалакт|кормящ|подготовка к родам/i],
  ['Немовлята й діти', /грудн|детей|ребен|детск|новорожд|колики первого|прорезыван|коклюш|свинка|краснуха|ветрян|корь|молочница у грудн|у детей/i],
  ['Серце і судини', /сердц|тахикард|брадикард|аритм|экстрасистол|перикард|миокард|эндокард|гипертон|венозн|варикоз|геморрой|сердцебиен/i],
  ['Дихання, горло, ніс, вуха', /бронхит|кашель|насморк|ринит|ларингит|фарингит|ангина|синусит|гайморит|мокрота|храп|простуда|грипп|отит|глухота|носу|астма|коронавирус/i],
  ['Травлення', /понос|диарея|запор|изжога|тошнота|рвота|желудоч|расстройство желудка|привкус|запах изо рта|оскомина|сухость во рту|зуд в заднем|анальн|глисты|пищев|гепатит|печен/i],
  ['Шкіра, волосся, нігті', /экзема|дерматоз|дерматит|крапивниц|импетиго|сыпь|кож|моллюск|нагноен|рожист|пролежн|ожог|волос|облысен|ногт|пигмент|запах пота|высыпан|чувствительность кожи/i],
  ['Психіка, сон, нервова система', /депресс|бессонниц|сон|сомнамбул|галлюцин|характер|плач|психоз|рассеянн|психик|сновид|дремот|головная боль|невралг|паралич|кривошея|тризм|судорог|метео|стариков/i],
  ['Синдром хронічної втоми', /СХУ|хронической усталости/i],
  ['Суглоби, м’язи, травми', /ревматизм|сустав|травм|спазм, боль|солей/i],
  ['Сечостатева сфера', /цистит|цистопат|менструац|предменструальн|бели|мочев|бесплод/i],
];
function topicOf(title, group) {
  if (group === 'bach') return 'Квіткові настої д-ра Баха';
  if (group === 'about') return 'Про гомеопатію';
  for (const [name, re] of TOPICS) if (re.test(title)) return name;
  return 'Різне';
}

const articles = [];
const articleDocs = [];
const lineRubrics = [];   // рубрики з рядків "_Локалізація_ - Remedy, Remedy"
for (const f of articleFiles) {
  const { fm, blocks } = parseMd(path.join(CONTENT, 'articles', f));
  const aIdx = articles.length;
  const outBlocks = [];
  const remSet = new Set();
  for (const b of blocks) {
    const ob = { kind: b.level === 3 ? 'remedy' : b.level === 2 ? 'sub' : 'intro', title: b.title, paras: b.paras, rem: [] };
    if (ob.kind === 'remedy') {
      ob.rem = resolveHeaderNames(b.title, fm.group !== 'bach');
      ob.rem.forEach(i => remSet.add(i));
    }
    if (ob.kind === 'intro') {
      for (const p of b.paras) {
        if (/^\*\*[^*]{20,}\*\*$/.test(p.trim()) && /[A-Z][a-z]+ [A-Z][a-z]+/.test(p)) {
          resolveBoldList(p).forEach(i => remSet.add(i));
        }
      }
    }
    // рядкові рубрики: "_Экзема на сгибе суставов_ - Graphites, Sepia, Sulphur."
    for (const p of b.paras) {
      const m = p.match(/^(?:_([^_]{3,90})_|\*\*([^*]{3,90})\*\*)\s*[:—–-]\s*(.{3,400})$/);
      if (!m) continue;
      const label = (m[1] || m[2]).replace(/[:.]+$/, '').trim();
      const listText = m[3];
      const items = listText.split(/[,;.]\s*/).map(s => s.replace(/\*\*/g, '').trim()).filter(Boolean);
      if (!items.length) continue;
      const ids = [];
      let latinItems = 0;
      for (const it of items) {
        const fw = SC.foldHomoglyphs(it.split(' ')[0].toLowerCase());
        if (!/^[a-z\-]+$/.test(fw)) continue;
        latinItems++;
        const i = resolveName(it.replace(/\([^)]*\)/g, '').trim());
        if (i >= 0) ids.push(i);
      }
      if (latinItems >= 1 && ids.length >= 1 && latinItems >= items.length * 0.6) {
        lineRubrics.push({ k: 'line', t: fm.title + ': ' + label, a: aIdx, r: [...new Set(ids)] });
        ids.forEach(i => remSet.add(i));
      }
    }
    outBlocks.push(ob);
  }
  articles.push({ id: fm.id, title: fm.title, group: fm.group, topic: topicOf(fm.title, fm.group), rem: [...remSet].sort((a, b) => a - b), nblocks: outBlocks.filter(b => b.kind === 'remedy').length });
  articleDocs.push({ id: fm.id, title: fm.title, group: fm.group, source: fm.source || '', author: fm.author || '', origin: fm.origin || '', blocks: outBlocks });
}

// ---------------------------------------------------------------------------
// Рубрики
// ---------------------------------------------------------------------------
const nosMap = new Map();     // key → {t, r:Set}
remedyDocs.forEach((doc, i) => {
  const sec = doc.sections.find(s => s.title === 'Клиника');
  if (!sec) return;
  for (const p of sec.paras) {
    for (let term of p.replace(/\*\*|_/g, '').split(/[.;]\s+|\.$/)) {
      term = term.replace(/^[\s•\-–—]+|[\s.]+$/g, '').trim();
      if (term.length < 3 || term.length > 70) continue;
      const key = term.toLowerCase();
      if (!nosMap.has(key)) nosMap.set(key, { t: term, r: new Set() });
      nosMap.get(key).r.add(i);
    }
  }
});
const rubrics = [];
for (const [, v] of [...nosMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'))) {
  rubrics.push({ k: 'nos', t: v.t, r: [...v.r].sort((a, b) => a - b) });
}
articles.forEach((a, i) => {
  if (a.rem.length >= 2 && a.group === 'lechebnik') rubrics.push({ k: 'art', t: a.title, a: i, r: a.rem });
});
for (const lr of lineRubrics) rubrics.push(lr);

// ---------------------------------------------------------------------------
// Індекс абзаців
// ---------------------------------------------------------------------------
const docs = [];      // {t:'r'|'a', id}
const ud = [], us = [], up = [], ur = [];
const postings = new Map();   // stem → array of unit ids
function addUnit(docIdx, secIdx, paraIdx, remIdx, text) {
  const uid = ud.length;
  ud.push(docIdx); us.push(secIdx); up.push(paraIdx); ur.push(remIdx);
  const seen = new Set();
  for (const st of SC.stems(text.replace(/\*\*|_/g, ' '))) {
    if (seen.has(st)) continue;
    seen.add(st);
    let arr = postings.get(st);
    if (!arr) { arr = []; postings.set(st, arr); }
    arr.push(uid);
  }
}
remedyDocs.forEach((doc, i) => {
  const d = docs.length;
  docs.push({ t: 'r', id: doc.id, r: i, s: doc.sections.map(s => s.title) });
  doc.sections.forEach((s, si) => s.paras.forEach((p, pi) => addUnit(d, si, pi, i, p)));
});
articleDocs.forEach((doc, i) => {
  const d = docs.length;
  docs.push({ t: 'a', id: doc.id, a: i, s: doc.blocks.map(b => b.title || '') });
  doc.blocks.forEach((b, bi) => b.paras.forEach((p, pi) => addUnit(d, bi, pi, b.rem.length === 1 ? b.rem[0] : -1, p)));
});
const vocab = [...postings.keys()].sort();
const post = vocab.map(v => SC.encodeList(postings.get(v)));

// ---------------------------------------------------------------------------
// Запис
// ---------------------------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'remedies'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'articles'), { recursive: true });
const catalog = {
  built: new Date().toISOString().slice(0, 10),
  remedies, articles, rubrics,
  stats: { remedies: remedies.filter(r => !r.ext).length, ext: remedies.filter(r => r.ext).length, articles: articles.length, rubrics: rubrics.length, units: ud.length, vocab: vocab.length },
};
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ v: 1, docs, ud, us, up, ur, vocab, post }));
for (const doc of remedyDocs) fs.writeFileSync(path.join(OUT, 'remedies', doc.id + '.json'), JSON.stringify(doc));
for (const doc of articleDocs) fs.writeFileSync(path.join(OUT, 'articles', doc.id + '.json'), JSON.stringify(doc));

// Звіт
const rep = [];
rep.push(`remedies: ${catalog.stats.remedies} (+${catalog.stats.ext} без сторінки, згадані в статтях)`);
rep.push(`articles: ${articles.length}; rubrics: ${rubrics.length} (nos ${rubrics.filter(r => r.k === 'nos').length}, art ${rubrics.filter(r => r.k === 'art').length}, line ${rubrics.filter(r => r.k === 'line').length})`);
rep.push(`index units: ${ud.length}; vocab: ${vocab.length}; index.json ${(fs.statSync(path.join(OUT, 'index.json')).size / 1e6).toFixed(2)} MB; catalog.json ${(fs.statSync(path.join(OUT, 'catalog.json')).size / 1e6).toFixed(2)} MB`);
const totalHeaders = articleDocs.reduce((n, d) => n + d.blocks.filter(b => b.kind === 'remedy').length, 0);
const unresH = [...unresolvedHeaders.values()].reduce((a, b) => a + b, 0);
rep.push(`remedy block headers: ${totalHeaders}, unresolved names in headers: ${unresH}`);
rep.push('unresolved in intro lists (top): ' + [...unresolvedList.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${k}×${v}`).join(', '));
rep.push('unresolved in headers: ' + [...unresolvedHeaders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${k}×${v}`).join(', '));
rep.push('ext remedies: ' + remedies.filter(r => r.ext).map(r => r.latin).join(', '));
fs.writeFileSync(path.join(ROOT, 'tools', 'build-report.txt'), rep.join('\n') + '\n');
console.log(rep.join('\n'));
