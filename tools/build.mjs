#!/usr/bin/env node
/*
 * build.mjs — збирає дані сайту з content/<lang>/*.md для кожної мови (ru, ua):
 *   data/<lang>/catalog.json          — каталог препаратів, статей, рубрик (маленький, вантажиться одразу)
 *   data/<lang>/remedies/<id>.json    — текст препарату за розділами + структуровані модальності, етіологія, зв'язки
 *   data/<lang>/articles/<id>.json    — текст статті за блоками
 *   data/<lang>/index.json            — інвертований індекс (одиниця — речення; абзаци описано масивами pd/ps/pp/pr/pn)
 *
 * Український індекс містить і російські стеми вирівняних речень оригіналу, тому запит
 * українською знаходить речення і через словничок UA→RU, і через український стемер.
 *
 *   node tools/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { MOD_CATS, ETIO_CATS, parseModalities, parseEtiology, parseRelations, splitClauses, mineModalities } from './modalities.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SC = require(path.join(ROOT, 'search-core.js'));

const CONTENT = path.join(ROOT, 'content');
const OUT = path.join(ROOT, 'data');
const CLINIC = { ru: 'Клиника', ua: 'Клініка' };
const MODAL = { ru: 'Модальности', ua: 'Модальності' };
const ETIOL = { ru: 'Этиология', ua: 'Етіологія' };
const RELAT = { ru: 'Взаимосвязи', ua: 'Взаємозв’язки' };
const DIR_LABEL = { ru: { w: 'Хуже', b: 'Лучше' }, ua: { w: 'Гірше', b: 'Краще' } };
const ETIO_LABEL = { ru: 'После', ua: 'Після' };
// Фаза 2: розділи, з яких модальності НЕ видобуваємо — сама секція модальностей і етіологія
// (розібрані окремо), довідкові та рекомендаційні розділи і вступний блок про рослину
// («Лучше цветет на влажной почве»).
const MINE_SKIP = new Set(['Модальности', 'Этиология', 'Взаимосвязи', 'Клиника', 'Характеристика', 'Тип', 'Рекомендации', 'Общее']);
const MINE_STRIP = /\*\*|_/g;

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
  // написання зі статей, що позначають наявний препарат Кларка (звірено з покажчиком Boericke)
  'crotalus': 'Crotalus horridus', 'kali hydroiodicum': 'Kali iodatum', 'nux juglans': 'Juglans regia',
  'mercurius photoiodatus': 'Mercurius iodatus flavus', 'mercurius protoiodatus': 'Mercurius iodatus flavus',
  'calcarea fluorata': 'Calcarea fluorica',
  // родові назви, які до появи описів Boericke резолвились як єдині з таким першим словом;
  // друга сіль того ж роду зняла цю однозначність, тож типовий препарат називаємо явно
  'apocynum': 'Apocynum cannabinum', 'tarentula': 'Tarentula hispanica', 'actea': 'Actea racemosa',
  'bismuthum': 'Bismuthum metallicum', 'carboneum': 'Carboneum sulphuratum', 'manganum': 'Manganum carbonicum',
  'saccharum': 'Saccharum lactis', 'solanum': 'Solanum nigrum',
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

const stripMd = s => s.replace(/\*\*|_/g, ' ');
const MOD_MARK = /^\*\*\s*•?\s*(Хуже|Лучше|Гірше|Краще)[.:]?\s*[а-яёА-ЯЁіїєІЇЄ]*\*\*[.:]?\s*/;

// ---------------------------------------------------------------------------
// Збірка однієї мови
// ---------------------------------------------------------------------------
function buildLang(lang, ruBuilt) {
  const dir = path.join(CONTENT, lang);
  // препарати з двох тек: Кларк (remedies/) і Boericke (boericke/, frontmatter src: boericke) — спільний список за назвою файлу
  const mdIn = sub => (fs.existsSync(path.join(dir, sub)) ? fs.readdirSync(path.join(dir, sub)) : []).filter(f => f.endsWith('.md')).map(f => [sub, f]);
  const remedyFiles = [...mdIn('remedies'), ...mdIn('boericke')].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const articleFiles = fs.readdirSync(path.join(dir, 'articles')).filter(f => f.endsWith('.md')).sort();
  const clinic = CLINIC[lang];
  const rep = [];

  const remedies = [];
  const remedyDocs = [];
  for (const [sub, f] of remedyFiles) {
    const { fm, blocks } = parseMd(path.join(dir, sub, f));
    const sections = blocks.map(b => ({ title: b.title || (lang === 'ua' ? 'Загальне' : 'Общее'), paras: b.paras })).filter(s => s.paras.length);
    const src = fm.src || '';
    remedies.push({ id: fm.id, latin: fm.latin, alt: fm.alt_latin || '', translit: fm.transliteration || '', common: fm.common || '', title: fm.title, nsec: sections.length, ext: false, ...(src ? { src } : {}) });
    remedyDocs.push({ id: fm.id, latin: fm.latin, alt: fm.alt_latin || '', translit: fm.transliteration || '', common: fm.common || '', title: fm.title,
      source: fm.source || '', origin: fm.origin || '', ...(src ? { src } : {}), sections });
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
  // alt_latin — список написань через «;» (Boericke несе там і назву з каталогу, і синоніми видання)
  remedies.forEach((r, i) => { addAlias(r.latin, i); for (const a of r.alt.split(';')) if (a.trim()) addAlias(a, i); });
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

  // --- модальності, етіологія, зв'язки (структуровано; для ua — перенесення категорій з ru)
  const modsById = new Map(), etioById = new Map(), relById = new Map(), minedById = new Map();
  const modStats = { clauses: 0, assigned: 0 }, etioStats = { clauses: 0, assigned: 0 };
  const mineStats = { sentences: 0, marked: 0, items: 0, remedies: 0, newCats: 0, aligned: 0, total: 0 };
  let relNames = 0, relResolved = 0;
  let clauseAligned = 0, clauseTotal = 0;
  const modRubrics = new Map();   // 'w.motion' → Map(remedy → ступінь: 2 секційна, 1 видобута)
  const etioRubrics = new Map();  // 'fright' → Set(remedy)
  remedyDocs.forEach((doc, i) => {
    const modSec = doc.sections.find(s => s.title === MODAL[lang]);
    const etioSec = doc.sections.find(s => s.title === ETIOL[lang]);
    const relSec = doc.sections.find(s => s.title === RELAT[lang]);
    let mods = [], etio = [], rel = [], mined = [];
    if (lang === 'ru') {
      if (modSec) { const r = parseModalities(modSec.paras); mods = r.items; modStats.clauses += r.stats.clauses; modStats.assigned += r.stats.assigned; }
      if (etioSec) { const r = parseEtiology(etioSec.paras); etio = r.items; etioStats.clauses += r.stats.clauses; etioStats.assigned += r.stats.assigned; }
      if (relSec) rel = parseRelations(relSec.paras);
      for (const x of rel) {
        const ids = [];
        for (const nm of x.names) {
          relNames++;
          const j = resolveName(nm);
          if (j >= 0 && j !== i) { ids.push(j); relResolved++; }
        }
        x.r = Array.from(new Set(ids));
        delete x.names;
      }
      // фаза 2: модальності з речень симптомних розділів (ступінь 1 у рубриках)
      let flat = 0;
      for (const s of doc.sections) {
        if (!MINE_SKIP.has(s.title)) {
          const r = mineModalities(s.paras, SC.splitSentences, s.title);
          mineStats.sentences += r.stats.sentences; mineStats.marked += r.stats.marked;
          for (const it of r.items) mined.push({ d: it.d, c: it.c, t: it.t, src: 'text', sec: it.sec, flat: flat + it.para, sent: it.sent });
        }
        flat += s.paras.length;
      }
    } else {
      // категорії з російського розбору того ж препарату; текст фрази — з українського абзацу, якщо фрази вирівнюються 1:1
      const ruMods = ruBuilt.modsById.get(doc.id) || [], ruEtio = ruBuilt.etioById.get(doc.id) || [], ruRel = ruBuilt.relById.get(doc.id) || [];
      const uaClauses = modSec ? modSec.paras.flatMap(p => splitClauses(p.replace(/^\s*-\s*/, '').replace(MOD_MARK, '')).filter(c => !/^(гірше|краще|хуже|лучше)$/i.test(c))) : [];
      if (ruMods.length) { clauseTotal++; if (uaClauses.length === ruMods.length) clauseAligned++; }
      const okM = uaClauses.length === ruMods.length;
      mods = ruMods.map((m, k) => ({ d: m.d, c: m.c, t: okM ? uaClauses[k] : '' }));
      const uaE = etioSec ? etioSec.paras.flatMap(p => splitClauses(p.replace(/^\s*-\s*/, '').replace(/^\*\*[^*]{0,40}\*\*[.:]?\s*/, ''))) : [];
      const okE = uaE.length === ruEtio.length;
      etio = ruEtio.map((e, k) => ({ c: e.c, t: okE ? uaE[k] : '' }));
      const uaLabels = relSec ? relSec.paras.flatMap(p => Array.from(p.matchAll(/\*\*([^*]{2,90})\*\*/g)).map(m => m[1].replace(/[:.]+$/, '').trim())) : [];
      const okR = uaLabels.length === ruRel.length;
      rel = ruRel.map((x, k) => ({ k: x.k, t: okR ? uaLabels[k] : x.t, r: x.r }));
      // видобуті речення: категорії з ru, текст — українське речення за (абзац, номер речення)
      const ruFlat = ruBuilt.paras.get('r:' + doc.id) || [];
      const uaFlat = doc.sections.flatMap(s => s.paras);
      const uaSecOf = [];
      doc.sections.forEach(s => s.paras.forEach(() => uaSecOf.push(s.title)));
      const okFlat = ruFlat.length === uaFlat.length;
      mined = (ruBuilt.minedById.get(doc.id) || []).map(m => {
        mineStats.total++;
        let t = '';
        if (okFlat && uaFlat[m.flat] != null) {
          const uaS = SC.splitSentences(uaFlat[m.flat].replace(MINE_STRIP, ''));
          const ruS = SC.splitSentences(ruFlat[m.flat].replace(MINE_STRIP, ''));
          const j = uaS.length === ruS.length ? m.sent : Math.min(uaS.length - 1, Math.floor(m.sent * uaS.length / Math.max(ruS.length, 1)));
          if (uaS[j]) { t = uaS[j].trim(); mineStats.aligned++; }
        }
        return { d: m.d, c: m.c, t, src: 'text', sec: (okFlat && uaSecOf[m.flat]) || m.sec };
      });
    }
    modsById.set(doc.id, mods); etioById.set(doc.id, etio); relById.set(doc.id, rel); minedById.set(doc.id, mined);
    mods = mods.filter(m => m.c.length);
    etio = etio.filter(e => e.c.length);
    rel = rel.filter(x => x.r.length);
    const secKeys = new Set();
    for (const m of mods) for (const c of m.c) secKeys.add(m.d + '.' + c);
    mineStats.items += mined.length;
    if (mined.length) mineStats.remedies++;
    if (mined.some(m => m.c.some(c => !secKeys.has(m.d + '.' + c)))) mineStats.newCats++;
    mods = mods.concat(mined.map(m => ({ d: m.d, c: m.c, t: m.t, src: m.src, sec: m.sec })));
    for (const m of mods) for (const c of m.c) {
      const key = m.d + '.' + c, g = m.src ? 1 : 2;
      if (!modRubrics.has(key)) modRubrics.set(key, new Map());
      const cur = modRubrics.get(key);
      if ((cur.get(i) || 0) < g) cur.set(i, g);
    }
    for (const e of etio) for (const c of e.c) { if (!etioRubrics.has(c)) etioRubrics.set(c, new Set()); etioRubrics.get(c).add(i); }
    doc.mods = mods; doc.etio = etio; doc.rel = rel;
  });

  // --- індекс речень
  const docs = [];
  const pd = [], ps = [], pp = [], pr = [], pn = [];
  const postings = new Map();
  let aligned = 0, misaligned = 0, sentAligned = 0, sentTotal = 0, nUnits = 0;
  const remSentences = remedyDocs.map(() => []);   // remedy → [Set(stems)] поза «Клінікою» (для ступенів рубрик)
  function addPara(docIdx, secIdx, paraIdx, remIdx, text, ruText, collect) {
    const sents = SC.splitSentences(text);
    const ruSents = ruText ? SC.splitSentences(ruText) : null;
    if (ruSents) { sentTotal++; if (ruSents.length === sents.length) sentAligned++; }
    pd.push(docIdx); ps.push(secIdx); pp.push(paraIdx); pr.push(remIdx); pn.push(sents.length);
    sents.forEach((sent, k) => {
      const uid = nUnits++;
      const seen = new Set();
      const add = st => { if (seen.has(st)) return; seen.add(st); let arr = postings.get(st); if (!arr) { arr = []; postings.set(st, arr); } arr.push(uid); };
      const own = SC.stems(stripMd(sent), lang);
      for (const st of own) add(st);
      if (ruSents) {
        const j = ruSents.length === sents.length ? k : Math.min(ruSents.length - 1, Math.floor(k * ruSents.length / sents.length));
        for (const st of SC.stems(stripMd(ruSents[j]), 'ru')) add(st);
      }
      if (collect) remSentences[remIdx].push(new Set(own));
    });
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
    doc.sections.forEach((s, si) => s.paras.forEach((p, pi) => { addPara(d, si, pi, i, p, ok ? ru[k] : null, s.title !== clinic); k++; }));
  });
  articleDocs.forEach((doc, i) => {
    const d = docs.length;
    docs.push({ t: 'a', id: doc.id, a: i, s: doc.blocks.map(b => b.title || '') });
    const flat = doc.blocks.flatMap(b => b.paras);
    const ru = ruParas ? ruParas.get('a:' + doc.id) : null;
    const ok = ru && ru.length === flat.length;
    if (ruParas) { if (ok) aligned++; else misaligned++; }
    let k = 0;
    doc.blocks.forEach((b, bi) => b.paras.forEach((p, pi) => { addPara(d, bi, pi, b.rem.length === 1 ? b.rem[0] : -1, p, ok ? ru[k] : null, false); k++; }));
  });
  const vocab = Array.from(postings.keys()).sort();
  const post = vocab.map(v => SC.encodeList(postings.get(v)));

  // --- рубрики «Клініка»: ступені, злиття форм за стемами, ієрархія
  const nosMap = new Map();            // ключ (сортовані стеми) → { forms: Map(form→count), r: Map(remedy→grade), stems: Set }
  const nosTermsByRemedy = new Map();  // remedy id → [terms] (для вирівнювання між мовами)
  function splitTerms(p) {
    const out = [];
    for (let term of p.replace(/\*\*|_/g, '').split(/[.;]\s+|\.$/)) {
      term = term.replace(/^[\s•\-–—]+|[\s.]+$/g, '').trim();
      if (term.length >= 3 && term.length <= 70) out.push(term);
    }
    return out;
  }
  const gradeDist = [0, 0, 0, 0];
  remedyDocs.forEach((doc, i) => {
    const sec = doc.sections.find(s => s.title === clinic);
    if (!sec) return;
    const terms = [];
    const sents = remSentences[i];
    for (const p of sec.paras) for (const term of splitTerms(p)) {
      terms.push(term);
      const st = Array.from(new Set(SC.stems(term, lang).filter(s => s.length >= 2)));
      const key = st.length ? st.slice().sort().join(' ') : term.toLowerCase();
      let e = nosMap.get(key);
      if (!e) { e = { forms: new Map(), r: new Map(), stems: new Set(st) }; nosMap.set(key, e); }
      e.forms.set(term, (e.forms.get(term) || 0) + 1);
      let count = 0;
      if (st.length) for (const s of sents) { let all = true; for (const x of st) if (!s.has(x)) { all = false; break; } if (all && ++count >= 4) break; }
      const g = 1 + (count >= 1 ? 1 : 0) + (count >= 4 ? 1 : 0);
      gradeDist[g]++;
      if (!e.r.has(i) || e.r.get(i) < g) e.r.set(i, g);
    }
    nosTermsByRemedy.set(doc.id, terms);
  });
  const rubrics = [];
  const collator = new Intl.Collator(lang === 'ua' ? 'uk' : 'ru');
  const nosEntries = Array.from(nosMap.values()).map(e => {
    const forms = Array.from(e.forms.entries()).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
    const rIdx = Array.from(e.r.keys()).sort((a, b) => a - b);
    return { t: forms[0][0], al: forms.slice(1).map(f => f[0]), r: rIdx, g: rIdx.map(i => e.r.get(i)), stems: e.stems };
  }).sort((a, b) => collator.compare(a.t.toLowerCase(), b.t.toLowerCase()));
  let merged = 0;
  for (const e of nosEntries) {
    const rb = { k: 'nos', t: e.t, r: e.r, g: e.g };
    if (e.al.length) { rb.al = e.al; merged += e.al.length; }
    rubrics.push(rb);
  }
  // ієрархія: батько = рубрика, стеми якої є підмножиною стемів дитини (найдовший збіг)
  const withStems = nosEntries.map((e, i) => ({ i, st: e.stems, n: e.stems.size, nr: e.r.length })).filter(x => x.n >= 1);
  let links = 0;
  for (const child of withStems) {
    if (child.n < 2) continue;
    let best = null;
    for (const par of withStems) {
      if (par.i === child.i || par.n >= child.n) continue;
      if (!(par.n >= 2 || child.n <= 3)) continue;
      let sub = true;
      for (const s of par.st) if (!child.st.has(s)) { sub = false; break; }
      if (!sub) continue;
      if (!best || par.n > best.n || (par.n === best.n && par.nr > best.nr)) best = par;
    }
    if (best) { const prb = rubrics[best.i]; (prb.ch = prb.ch || []).push(child.i); links++; }
  }
  articles.forEach((a, i) => { if (a.rem.length >= 2 && a.group === 'lechebnik') rubrics.push({ k: 'art', t: a.title, a: i, r: a.rem }); });
  for (const lr of lineRubrics) rubrics.push(lr);
  // модальності та етіологія (мовно-незалежні ключі, підписи з таблиць)
  const modLabel = new Map(MOD_CATS.map(([k, , ru, ua]) => [k, lang === 'ua' ? ua : ru]));
  const etioLabel = new Map(ETIO_CATS.map(([k, , ru, ua]) => [k, lang === 'ua' ? ua : ru]));
  for (const d of ['w', 'b']) for (const [k] of MOD_CATS) {
    const set = modRubrics.get(d + '.' + k);
    if (!set || !set.size) continue;
    const rIdx = Array.from(set.keys()).sort((a, b) => a - b);
    rubrics.push({ k: 'mod', key: d + '.' + k, t: DIR_LABEL[lang][d] + ': ' + modLabel.get(k), r: rIdx, g: rIdx.map(x => set.get(x)) });
  }
  for (const [k] of ETIO_CATS) {
    const set = etioRubrics.get(k);
    if (!set || !set.size) continue;
    rubrics.push({ k: 'etio', key: k, t: ETIO_LABEL[lang] + ': ' + etioLabel.get(k), r: Array.from(set).sort((a, b) => a - b) });
  }

  // --- запис
  const out = path.join(OUT, lang);
  fs.mkdirSync(path.join(out, 'remedies'), { recursive: true });
  fs.mkdirSync(path.join(out, 'articles'), { recursive: true });
  const catalog = {
    lang, built: new Date().toISOString().slice(0, 10), remedies, articles, rubrics,
    stats: { remedies: remedies.filter(r => !r.ext).length, ext: remedies.filter(r => r.ext).length, articles: articles.length, rubrics: rubrics.length, units: nUnits, paras: pd.length, vocab: vocab.length },
  };
  fs.writeFileSync(path.join(out, 'catalog.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ v: 3, lang, docs, pd, ps, pp, pr, pn, vocab, post }));
  for (const doc of remedyDocs) fs.writeFileSync(path.join(out, 'remedies', doc.id + '.json'), JSON.stringify(doc));
  for (const doc of articleDocs) fs.writeFileSync(path.join(out, 'articles', doc.id + '.json'), JSON.stringify(doc));

  const cnt = k => rubrics.filter(r => r.k === k).length;
  rep.push(`[${lang}] remedies: ${catalog.stats.remedies} (+${catalog.stats.ext} без сторінки); articles: ${articles.length}; rubrics: ${rubrics.length} (nos ${cnt('nos')}, art ${cnt('art')}, line ${cnt('line')}, mod ${cnt('mod')}, etio ${cnt('etio')})`);
  rep.push(`[${lang}] nos: merged forms ${merged}; hierarchy links ${links}; grade distribution 1/2/3: ${gradeDist[1]}/${gradeDist[2]}/${gradeDist[3]}`);
  rep.push(`[${lang}] index: paragraphs ${pd.length}; sentence units ${nUnits}; vocab ${vocab.length}; index.json ${(fs.statSync(path.join(out, 'index.json')).size / 1e6).toFixed(2)} MB; catalog.json ${(fs.statSync(path.join(out, 'catalog.json')).size / 1e6).toFixed(2)} MB` +
    (ruParas ? `; aligned with ru: ${aligned} docs, misaligned ${misaligned}; sentence counts equal: ${sentAligned}/${sentTotal} paras; modality clause lists aligned: ${clauseAligned}/${clauseTotal} remedies` : ''));
  if (lang === 'ru') {
    rep.push(`[ru] modality coverage: ${modStats.assigned}/${modStats.clauses} clauses (${(100 * modStats.assigned / modStats.clauses).toFixed(1)}%); etiology coverage: ${etioStats.assigned}/${etioStats.clauses} (${(100 * etioStats.assigned / etioStats.clauses).toFixed(1)}%); relations: ${relResolved}/${relNames} names resolved`);
    rep.push(`[ru] mined modalities (phase 2): ${mineStats.items} items from ${mineStats.marked}/${mineStats.sentences} sentences; remedies with mined ${mineStats.remedies}, of them with a category the modality section lacks ${mineStats.newCats}`);
  } else {
    rep.push(`[${lang}] mined modalities: sentence text carried over for ${mineStats.aligned}/${mineStats.total} items`);
  }
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
  return { catalog, paras, topicById, nosTermsByRemedy, modsById, etioById, relById, minedById, rep };
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
  const formMap = cat => { const m = new Map(); for (const r of cat.rubrics) if (r.k === 'nos') for (const f of [r.t].concat(r.al || [])) if (!m.has(f.toLowerCase())) m.set(f.toLowerCase(), r); return m; };
  const ruForms = formMap(ru.catalog), uaForms = formMap(ua.catalog);
  let linked = 0;
  for (const rb of ru.catalog.rubrics) {
    if (rb.k !== 'nos') continue;
    for (const f of [rb.t].concat(rb.al || [])) {
      const t = ru2ua.get(f.toLowerCase());
      const other = t && uaForms.get(t.toLowerCase());
      if (other) { rb.x = other.t; linked++; break; }
    }
  }
  for (const rb of ua.catalog.rubrics) {
    if (rb.k !== 'nos') continue;
    for (const f of [rb.t].concat(rb.al || [])) {
      const t = ua2ru.get(f.toLowerCase());
      const other = t && ruForms.get(t);
      if (other) { rb.x = other.t; break; }
    }
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
// Обсяг data/<lang> — його показує кнопка «Зберегти довідник для офлайну» (app.js). Рахуємо
// останнім, коли всі файли мови вже на місці; запис catalog.json додає до себе ж кілька байтів,
// для оцінки в мегабайтах це неважливо.
const dirBytes = d => fs.readdirSync(d, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? dirBytes(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
for (const b of [ru, ua]) {
  if (!b) continue;
  const dir = path.join(OUT, b.catalog.lang);
  b.catalog.stats.bytes = dirBytes(dir);
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(b.catalog));
  report.push(`[${b.catalog.lang}] data: ${(b.catalog.stats.bytes / 1e6).toFixed(2)} MB`);
}
fs.writeFileSync(path.join(OUT, 'langs.json'), JSON.stringify({ langs: ua ? ['ua', 'ru'] : ['ru'] }));
fs.writeFileSync(path.join(ROOT, 'tools', 'build-report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
