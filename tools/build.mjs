#!/usr/bin/env node
/*
 * build.mjs — збирає дані сайту з content/<lang>/*.md для кожної мови (ru, ua):
 *   data/<lang>/catalog.json          — каталог препаратів, статей, рубрик (маленький, вантажиться одразу)
 *   data/<lang>/remedies/<id>.json    — текст препарату за розділами
 *   data/<lang>/articles/<id>.json    — текст статті за блоками
 *   data/<lang>/index.json            — інвертований індекс абзаців для повнотекстового пошуку
 *
 * Український індекс містить і російські стеми вирівняних абзаців оригіналу, тому запит
 * українською знаходить абзац і через словничок UA→RU, і через український стемер.
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
const CLINIC = { ru: 'Клиника', ua: 'Клініка' };

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
  [/\bactaea\b/g, 'actea'], [/\bmercurius solubilis hahnemanni\b/g, 'mercurius solubilis'],
  [/\bhepar sulphur( calcareum)?\b/g, 'hepar sulphur'], [/\brhus tox\b/g, 'rhus toxicodendron'], [/\bnux vom\b/g, 'nux vomica'],
];

function normName(s) {
  let n = s.toLowerCase().replace(/[()«»"“”,.;:]/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.split(' ').map(w => SC.foldHomoglyphs(w)).join(' ');
  n = n.replace(/[^a-z\- ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, to] of REPL) n = n.replace(re, to);
  return n.trim();
}

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

// Тематичні групи статей (ключі мовно-незалежні; визначаються за російськими назвами)
const TOPICS = [
  ['pregnancy', /беремен|родов|послерод|соск|молок|лохии|роды|лактац|гипергалакт|кормящ|подготовка к родам/i],
  ['children', /грудн|детей|ребен|детск|новорожд|колики первого|прорезыван|коклюш|свинка|краснуха|ветрян|корь|молочница у грудн|у детей/i],
  ['heart', /сердц|тахикард|брадикард|аритм|экстрасистол|перикард|миокард|эндокард|гипертон|венозн|варикоз|геморрой|сердцебиен/i],
  ['resp', /бронхит|кашель|насморк|ринит|ларингит|фарингит|ангина|синусит|гайморит|мокрота|храп|простуда|грипп|отит|глухота|носу|астма|коронавирус/i],
  ['digest', /понос|диарея|запор|изжога|тошнота|рвота|желудоч|расстройство желудка|привкус|запах изо рта|оскомина|сухость во рту|зуд в заднем|анальн|глисты|пищев|гепатит|печен/i],
  ['skin', /экзема|дерматоз|дерматит|крапивниц|импетиго|сыпь|кож|моллюск|нагноен|рожист|пролежн|ожог|волос|облысен|ногт|пигмент|запах пота|высыпан|чувствительность кожи/i],
  ['mind', /депресс|бессонниц|сон|сомнамбул|галлюцин|характер|плач|психоз|рассеянн|психик|сновид|дремот|головная боль|невралг|паралич|кривошея|тризм|судорог|метео|стариков/i],
  ['cfs', /СХУ|хронической усталости/i],
  ['joints', /ревматизм|сустав|травм|спазм, боль|солей/i],
  ['urogen', /цистит|цистопат|менструац|предменструальн|бели|мочев|бесплод/i],
];
function topicOf(title, group) {
  if (group === 'bach') return 'bach';
  if (group === 'about') return 'about';
  for (const [key, re] of TOPICS) if (re.test(title)) return key;
  return 'other';
}

// ---------------------------------------------------------------------------
// Збірка однієї мови
// ---------------------------------------------------------------------------
function buildLang(lang, ruBuilt) {
  const dir = path.join(CONTENT, lang);
  const remedyFiles = fs.readdirSync(path.join(dir, 'remedies')).filter(f => f.endsWith('.md')).sort();
  const articleFiles = fs.readdirSync(path.join(dir, 'articles')).filter(f => f.endsWith('.md')).sort();
  const clinic = CLINIC[lang];
  const rep = [];

  const remedies = [];
  const remedyDocs = [];
  for (const f of remedyFiles) {
    const { fm, blocks } = parseMd(path.join(dir, 'remedies', f));
    const sections = blocks.map(b => ({ title: b.title || (lang === 'ua' ? 'Загальне' : 'Общее'), paras: b.paras })).filter(s => s.paras.length);
    remedies.push({ id: fm.id, latin: fm.latin, alt: fm.alt_latin || '', translit: fm.transliteration || '', common: fm.common || '', title: fm.title, nsec: sections.length, ext: false });
    remedyDocs.push({ id: fm.id, latin: fm.latin, alt: fm.alt_latin || '', translit: fm.transliteration || '', common: fm.common || '', title: fm.title,
      source: fm.source || '', origin: fm.origin || '', sections });
  }

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
  for (const [fw, set] of firstWord) if (set.size === 1 && !alias.has(fw) && fw.length > 3) alias.set(fw, Array.from(set)[0]);

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
      for (const [k, v] of alias) {
        if (k.startsWith(two.slice(0, Math.max(two.length - 2, 6))) && k.split(' ').length === words.length) return v;
      }
    }
    const fw = firstWord.get(words[0]);
    if (fw && fw.size === 1 && words.length === 1) return Array.from(fw)[0];
    return fuzzyAlias(n);
  }

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

  function splitRemedyHeader(title, splitCaps) {
    const names = [];
    const noParen = title.replace(/\([^)]*\)/g, ' ').replace(/[Θ]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const part of noParen.split(/\s+(?:и|і|та|=|,|—|–|-)\s+|,\s*/)) {
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
    return Array.from(new Set(out));
  }
  function resolveBoldList(text) {
    const t = text.replace(/\*\*/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
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
      const i = resolveName(nm);
      if (i < 0) { unresolvedList.set(nm, (unresolvedList.get(nm) || 0) + 1); continue; }
      out.push(i);
    }
    return Array.from(new Set(out));
  }

  // --- статті
  const articles = [];
  const articleDocs = [];
  const lineRubrics = [];
  for (const f of articleFiles) {
    const { fm, blocks } = parseMd(path.join(dir, 'articles', f));
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
          if (/^\*\*[^*]{20,}\*\*$/.test(p.trim()) && /[A-Z][a-z]+ [A-Z][a-z]+/.test(p)) resolveBoldList(p).forEach(i => remSet.add(i));
        }
      }
      for (const p of b.paras) {
        const m = p.match(/^(?:_([^_]{3,90})_|\*\*([^*]{3,90})\*\*)\s*[:—–-]\s*(.{3,400})$/);
        if (!m) continue;
        const label = (m[1] || m[2]).replace(/[:.]+$/, '').trim();
        const items = m[3].split(/[,;.]\s*/).map(s => s.replace(/\*\*/g, '').trim()).filter(Boolean);
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
          lineRubrics.push({ k: 'line', t: fm.title + ': ' + label, a: aIdx, r: Array.from(new Set(ids)) });
          ids.forEach(i => remSet.add(i));
        }
      }
      outBlocks.push(ob);
    }
    const topic = ruBuilt ? (ruBuilt.topicById.get(fm.id) || topicOf(fm.title, fm.group)) : topicOf(fm.title, fm.group);
    articles.push({ id: fm.id, title: fm.title, group: fm.group, topic, rem: Array.from(remSet).sort((a, b) => a - b), nblocks: outBlocks.filter(b => b.kind === 'remedy').length });
    articleDocs.push({ id: fm.id, title: fm.title, group: fm.group, source: fm.source || '', author: fm.author || '', origin: fm.origin || '', blocks: outBlocks });
  }

  // --- рубрики
  const nosMap = new Map();
  const nosTermsByRemedy = new Map();   // remedy id → [terms] (для вирівнювання між мовами)
  function splitTerms(p) {
    const out = [];
    for (let term of p.replace(/\*\*|_/g, '').split(/[.;]\s+|\.$/)) {
      term = term.replace(/^[\s•\-–—]+|[\s.]+$/g, '').trim();
      if (term.length >= 3 && term.length <= 70) out.push(term);
    }
    return out;
  }
  remedyDocs.forEach((doc, i) => {
    const sec = doc.sections.find(s => s.title === clinic);
    if (!sec) return;
    const terms = [];
    for (const p of sec.paras) for (const term of splitTerms(p)) {
      terms.push(term);
      const key = term.toLowerCase();
      if (!nosMap.has(key)) nosMap.set(key, { t: term, r: new Set() });
      nosMap.get(key).r.add(i);
    }
    nosTermsByRemedy.set(doc.id, terms);
  });
  const rubrics = [];
  const collator = new Intl.Collator(lang === 'ua' ? 'uk' : 'ru');
  for (const [, v] of Array.from(nosMap.entries()).sort((a, b) => collator.compare(a[0], b[0]))) {
    rubrics.push({ k: 'nos', t: v.t, r: Array.from(v.r).sort((a, b) => a - b) });
  }
  articles.forEach((a, i) => { if (a.rem.length >= 2 && a.group === 'lechebnik') rubrics.push({ k: 'art', t: a.title, a: i, r: a.rem }); });
  for (const lr of lineRubrics) rubrics.push(lr);

  // --- індекс абзаців
  const docs = [];
  const ud = [], us = [], up = [], ur = [];
  const postings = new Map();
  let aligned = 0, misaligned = 0;
  function addUnit(docIdx, secIdx, paraIdx, remIdx, text, ruText) {
    const uid = ud.length;
    ud.push(docIdx); us.push(secIdx); up.push(paraIdx); ur.push(remIdx);
    const seen = new Set();
    const add = st => { if (seen.has(st)) return; seen.add(st); let arr = postings.get(st); if (!arr) { arr = []; postings.set(st, arr); } arr.push(uid); };
    for (const st of SC.stems(text.replace(/\*\*|_/g, ' '), lang)) add(st);
    if (ruText) for (const st of SC.stems(ruText.replace(/\*\*|_/g, ' '), 'ru')) add(st);
  }
  const ruParas = ruBuilt ? ruBuilt.paras : null;   // id → плоский список абзаців оригіналу
  remedyDocs.forEach((doc, i) => {
    const d = docs.length;
    docs.push({ t: 'r', id: doc.id, r: i, s: doc.sections.map(s => s.title) });
    const flat = doc.sections.flatMap(s => s.paras);
    const ru = ruParas ? ruParas.get('r:' + doc.id) : null;
    const ok = ru && ru.length === flat.length;
    if (ruParas) { if (ok) aligned++; else misaligned++; }
    let k = 0;
    doc.sections.forEach((s, si) => s.paras.forEach((p, pi) => { addUnit(d, si, pi, i, p, ok ? ru[k] : null); k++; }));
  });
  articleDocs.forEach((doc, i) => {
    const d = docs.length;
    docs.push({ t: 'a', id: doc.id, a: i, s: doc.blocks.map(b => b.title || '') });
    const flat = doc.blocks.flatMap(b => b.paras);
    const ru = ruParas ? ruParas.get('a:' + doc.id) : null;
    const ok = ru && ru.length === flat.length;
    if (ruParas) { if (ok) aligned++; else misaligned++; }
    let k = 0;
    doc.blocks.forEach((b, bi) => b.paras.forEach((p, pi) => { addUnit(d, bi, pi, b.rem.length === 1 ? b.rem[0] : -1, p, ok ? ru[k] : null); k++; }));
  });
  const vocab = Array.from(postings.keys()).sort();
  const post = vocab.map(v => SC.encodeList(postings.get(v)));

  // --- запис
  const out = path.join(OUT, lang);
  fs.mkdirSync(path.join(out, 'remedies'), { recursive: true });
  fs.mkdirSync(path.join(out, 'articles'), { recursive: true });
  const catalog = {
    lang, built: new Date().toISOString().slice(0, 10), remedies, articles, rubrics,
    stats: { remedies: remedies.filter(r => !r.ext).length, ext: remedies.filter(r => r.ext).length, articles: articles.length, rubrics: rubrics.length, units: ud.length, vocab: vocab.length },
  };
  fs.writeFileSync(path.join(out, 'catalog.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ v: 2, lang, docs, ud, us, up, ur, vocab, post }));
  for (const doc of remedyDocs) fs.writeFileSync(path.join(out, 'remedies', doc.id + '.json'), JSON.stringify(doc));
  for (const doc of articleDocs) fs.writeFileSync(path.join(out, 'articles', doc.id + '.json'), JSON.stringify(doc));

  rep.push(`[${lang}] remedies: ${catalog.stats.remedies} (+${catalog.stats.ext} без сторінки); articles: ${articles.length}; rubrics: ${rubrics.length} (nos ${rubrics.filter(r => r.k === 'nos').length}, art ${rubrics.filter(r => r.k === 'art').length}, line ${rubrics.filter(r => r.k === 'line').length})`);
  rep.push(`[${lang}] index units: ${ud.length}; vocab: ${vocab.length}; index.json ${(fs.statSync(path.join(out, 'index.json')).size / 1e6).toFixed(2)} MB; catalog.json ${(fs.statSync(path.join(out, 'catalog.json')).size / 1e6).toFixed(2)} MB` + (ruParas ? `; aligned with ru: ${aligned}, misaligned: ${misaligned}` : ''));
  const totalHeaders = articleDocs.reduce((n, d) => n + d.blocks.filter(b => b.kind === 'remedy').length, 0);
  rep.push(`[${lang}] remedy block headers: ${totalHeaders}; unresolved in headers: ${Array.from(unresolvedHeaders.values()).reduce((a, b) => a + b, 0)}; unresolved in intro lists: ${Array.from(unresolvedList.values()).reduce((a, b) => a + b, 0)}`);
  if (lang === 'ru') {
    rep.push('unresolved in headers: ' + Array.from(unresolvedHeaders.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${k}×${v}`).join(', '));
    rep.push('unresolved in intro lists: ' + Array.from(unresolvedList.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${k}×${v}`).join(', '));
  }

  // для вирівнювання інших мов
  const paras = new Map();
  for (const doc of remedyDocs) paras.set('r:' + doc.id, doc.sections.flatMap(s => s.paras));
  for (const doc of articleDocs) paras.set('a:' + doc.id, doc.blocks.flatMap(b => b.paras));
  const topicById = new Map(articles.map(a => [a.id, a.topic]));
  return { catalog, paras, topicById, nosTermsByRemedy, rep };
}

// ---------------------------------------------------------------------------
// Перехресні посилання рубрик між мовами (щоб перемикання мови зберігало рубрики)
// ---------------------------------------------------------------------------
function crossLink(ru, ua) {
  const ru2ua = new Map();
  for (const [id, ruTerms] of ru.nosTermsByRemedy) {
    const uaTerms = ua.nosTermsByRemedy.get(id);
    if (!uaTerms || uaTerms.length !== ruTerms.length) continue;
    ruTerms.forEach((t, i) => { if (!ru2ua.has(t.toLowerCase())) ru2ua.set(t.toLowerCase(), uaTerms[i]); });
  }
  const ua2ru = new Map();
  for (const [k, v] of ru2ua) if (!ua2ru.has(v.toLowerCase())) ua2ru.set(v.toLowerCase(), k);
  const ruNosDisplay = new Map(ru.catalog.rubrics.filter(r => r.k === 'nos').map(r => [r.t.toLowerCase(), r.t]));
  const uaNosDisplay = new Map(ua.catalog.rubrics.filter(r => r.k === 'nos').map(r => [r.t.toLowerCase(), r.t]));
  let linked = 0;
  for (const rb of ru.catalog.rubrics) {
    if (rb.k !== 'nos') continue;
    const t = ru2ua.get(rb.t.toLowerCase());
    if (t && uaNosDisplay.has(t.toLowerCase())) { rb.x = uaNosDisplay.get(t.toLowerCase()); linked++; }
  }
  for (const rb of ua.catalog.rubrics) {
    if (rb.k !== 'nos') continue;
    const t = ua2ru.get(rb.t.toLowerCase());
    if (t && ruNosDisplay.has(t)) rb.x = ruNosDisplay.get(t);
  }
  const byArt = list => { const m = new Map(); list.forEach(r => { if (!m.has(r.a)) m.set(r.a, []); m.get(r.a).push(r); }); return m; };
  const ruL = byArt(ru.catalog.rubrics.filter(r => r.k === 'line')), uaL = byArt(ua.catalog.rubrics.filter(r => r.k === 'line'));
  for (const [a, list] of ruL) {
    const id = ru.catalog.articles[a].id;
    const uaA = ua.catalog.articles.findIndex(x => x.id === id);
    const other = uaL.get(uaA);
    if (!other || other.length !== list.length) continue;
    list.forEach((r, i) => { r.x = other[i].t; other[i].x = r.t; });
  }
  return linked;
}

// ---------------------------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
const report = [];
const ru = buildLang('ru', null);
report.push(...ru.rep);
let ua = null;
if (fs.existsSync(path.join(CONTENT, 'ua', 'remedies')) && fs.readdirSync(path.join(CONTENT, 'ua', 'remedies')).length) {
  ua = buildLang('ua', ru);
  report.push(...ua.rep);
  const linked = crossLink(ru, ua);
  report.push(`cross-linked nosology rubrics ru→ua: ${linked}/${ru.catalog.rubrics.filter(r => r.k === 'nos').length}`);
  fs.writeFileSync(path.join(OUT, 'ru', 'catalog.json'), JSON.stringify(ru.catalog));
  fs.writeFileSync(path.join(OUT, 'ua', 'catalog.json'), JSON.stringify(ua.catalog));
}
fs.writeFileSync(path.join(OUT, 'langs.json'), JSON.stringify({ langs: ua ? ['ua', 'ru'] : ['ru'] }));
fs.writeFileSync(path.join(ROOT, 'tools', 'build-report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
