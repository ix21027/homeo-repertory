#!/usr/bin/env node
/*
 * check_negation.mjs — шукає загублені заперечення в машинному перекладі content/ru → content/ua.
 *
 * Google час від часу викидає заперечення («не может лежать на левом боку» → «може лежати на лівому
 * боці»). Для медичного тексту це інверсія змісту, тому потрібен детектор, який працює по всьому
 * корпусу, а не вибірково.
 *
 * Як воно вирівнюється. render_ua у tools/translate.py іде по рядках тіла один-в-один: порожній →
 * порожній, «## …» → «## …», «- x» → «- tr(x)», решта → tr(рядок). Тому i-й рядок тіла RU відповідає
 * i-му рядку тіла UA, і саме рядок (без «- ») — це той сегмент, який бачить tr(). Усередині рядка
 * речення ділить splitSentences зі search-core.js (той самий код, що й у build.mjs); якщо кількість
 * речень збіглася — порівнюємо 1:1, якщо ні — пропорційним відображенням, як addPara у build.mjs,
 * і тоді вимагаємо, щоб втрата була видна ще й на рівні всього рядка (інакше це шум відображення).
 *
 * Кандидат = у вирівняному UA-реченні менше САМОСТІЙНИХ маркерів заперечення, ніж у RU
 * (корелятивні «ни … ни» ↔ «ні … ні» рахуються окремо, див. marks/lost нижче).
 *
 *   node tools/check_negation.mjs                     # JSONL у stdout, зведення у stderr
 *   node tools/check_negation.mjs --out cand.jsonl    # JSONL у файл
 *   node tools/check_negation.mjs --no-strip          # без правил зняття ідіом (для калібрування)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SC = require(path.join(ROOT, 'search-core.js'));
const CONTENT = path.join(ROOT, 'content');

// ---------------------------------------------------------------------------
// Маркери заперечення. У JS \b не працює з кирилицею, тому межі слова — лукараунди
// з \p{L} і прапорцем u. Списки навмисно асиметричні: українська передає російське
// заперечення й одним словом («нет сил» → «немає сил», «без сознания» → «непритомний»,
// «не хватает» → «бракує», «не обильные» → «нерясні», «делает невозможным» →
// «унеможливлює»), тож UA-список ширший. Порядок альтернатив — від довшого до
// коротшого, щоб «немає» не лічилось як «не».
// ---------------------------------------------------------------------------
const RU_MARK = new RegExp(
  '(?<!\\p{L})(?:' + [
    'никогда', 'никако\\p{L}*', 'никаки\\p{L}*', 'нисколько', 'ничего', 'ничто', 'ничем', 'ничему',
    'никому', 'никого', 'никем', 'никто', 'нигде', 'никуда', 'ниоткуда', 'никак\\p{L}*',
    'невозможн\\p{L}*', 'неспособ\\p{L}*', 'нельзя', 'негде', 'некуда', 'отсутств\\p{L}*',
    'лишен\\p{L}*', 'нехватк\\p{L}*', 'нету', 'нет', 'без', 'безо', 'не', 'ни',
  ].join('|') + ')(?!\\p{L})', 'giu');

const UA_MARK = new RegExp(
  '(?<!\\p{L})(?:' + [
    'ніколи', 'ніяк\\p{L}*', 'нічого', 'нічому', 'нічим', 'ніщо', 'нікому', 'нікого', 'ніким',
    'ніхто', 'ніде', 'нікуди', 'нізвідки', 'жодн\\p{L}*', 'жоден', 'неможлив\\p{L}*',
    'унеможлив\\p{L}*', 'нездатн\\p{L}*', 'неспроможн\\p{L}*', 'непритомн\\p{L}*',
    'позбавлен\\p{L}*', 'відсутн\\p{L}*', 'брак\\p{L}*', 'нестач\\p{L}*', 'анітрохи',
    'аніскільки', 'нітрохи', 'немає', 'нема', 'ані', 'ні', 'не', 'без', 'безо',
  ].join('|') + ')(?!\\p{L})', 'giu');

// «ни … ни» / «ні … ні» — це ОДНЕ заперечення, розтягнуте на однорідні члени. Google
// часто губить одну ланку ланцюжка, не чіпаючи змісту («не може ні читати, ні працювати»
// → «не може читати, ні працювати»). Тому цей клас лічимо окремо від ядра (див. marks/lost).
const RU_NI = /^ни$/iu;
const UA_NI = /^(?:ні|ані)$/iu;

// ---------------------------------------------------------------------------
// Ідіоми, де «не»/«ни»/«без» не заперечують зміст симптому, або де українська
// передає заперечення словом без маркера («без труда» → «легко», «практически не
// ощущается» → «мало відчувається»). Пара [RU, UA] спрацьовує ЛИШЕ тоді, коли
// збіглися ОБИДВА боки: якщо Google викинув зворот зовсім, пара не спрацює і
// кандидат лишиться. Третій елемент true — зняти лише з RU (сталий зворот-модальність).
// ---------------------------------------------------------------------------
const STRIP = [
  // тем не менее → проте; не менее/не более → щонайменше/щонайбільше
  [/тем\s+не\s+менее/giu, null, true],
  [/(?<!\p{L})не\s+мен(?:ее|ьш\p{L}*)(?!\p{L})/giu, /(?:щонайменше|(?<!\p{L})не\s+менш\p{L}*)(?!\p{L})/giu],
  [/(?<!\p{L})не\s+бол(?:ее|ьш\p{L}*)(?!\p{L})/giu, /(?:щонайбільше|(?<!\p{L})не\s+більш\p{L}*)(?!\p{L})/giu],
  // не только … но и
  [/(?<!\p{L})не\s+только(?!\p{L})/giu, null, true],
  // не раз, не однажды = багато разів
  [/(?<!\p{L})не\s+(?:раз|однажды|однократно)(?!\p{L})/giu, /(?<!\p{L})(?:не\s+раз|неодноразово|багато\s+разів)(?!\p{L})/giu],
  // чуть не, едва не = ледве не
  [/(?<!\p{L})(?:чуть|едва)\s+(?:ли\s+)?не(?!\p{L})/giu, /(?<!\p{L})(?:ледве|мало|трохи|чи\s+не)\s+не(?!\p{L})/giu],
  // не что иное, как
  [/(?<!\p{L})не\s+(?:что|кто|чем|ком)\p{L}*\s+ин(?:ое|ой|ым|ем)(?!\p{L})/giu, /(?<!\p{L})не\s+(?:що|хто|чим|ким)\p{L}*\s+інш\p{L}*(?!\p{L})/giu],
  // ни в коем случае → у жодному разі
  [/(?<!\p{L})ни\s+в\s+коем\s+случае(?!\p{L})/giu, /(?<!\p{L})(?:у|в)\s+жодному\s+разі(?!\p{L})/giu],
  // несмотря ни на что → незважаючи ні на що
  [/(?<!\p{L})не\s*смотря\s+ни\s+на\s+что(?!\p{L})/giu, /(?<!\p{L})незважаючи\s+ні\s+на\s+що(?!\p{L})/giu],
  // пока … не = доки; «не» тут плеонастичне, Google його штатно викидає («доки виступить піт»)
  [/(?<!\p{L})пока(?:\s+\p{L}+){0,4}\s+не(?!\p{L})/giu, /(?<!\p{L})(?:доки|поки)(?!\p{L})/giu],
  // без труда → легко
  [/(?<!\p{L})без\s+труда(?!\p{L})/giu, /(?<!\p{L})легко(?!\p{L})/giu],
  // практически не → мало
  [/(?<!\p{L})практическ\p{L}*\s+не(?!\p{L})/giu, /(?<!\p{L})мало(?!\p{L})/giu],
  // чтобы не было / обойтись без → щоб уникнути
  [/(?<!\p{L})чтобы\s+не\s+был\p{L}*(?!\p{L})/giu, /(?<!\p{L})щоб\s+уникнут\p{L}*(?!\p{L})/giu],
  [/(?<!\p{L})обойтись\s+без(?!\p{L})/giu, /(?<!\p{L})уникнут\p{L}*(?!\p{L})/giu],
  // не обильные / не длительные → злиті українські форми (нерясні, невеликі, нетривалі)
  [/(?<!\p{L})не\s+обильн\p{L}*(?!\p{L})/giu, /(?<!\p{L})(?:нерясн|невелик|небагат)\p{L}*(?!\p{L})/giu],
  [/(?<!\p{L})не\s+(?:длительн|продолжительн)\p{L}*(?!\p{L})/giu, /(?<!\p{L})нетривал\p{L}*(?!\p{L})/giu],
  // не приходится удивляться → годі дивуватися
  [/(?<!\p{L})не\s+приходится\s+удивляться(?!\p{L})/giu, /(?<!\p{L})годі\s+дивуватися(?!\p{L})/giu],
  // друкарська помилка в оригіналі: «мозоли не подушечках» = «на подушечках»
  [/(?<!\p{L})не\s+подушечк\p{L}*(?!\p{L})/giu, /(?<!\p{L})на\s+подушечк\p{L}*(?!\p{L})/giu],
  // «со снижением слуха или без него» → «чи ні»
  [/(?<!\p{L})или\s+без\s+\p{L}+(?!\p{L})/giu, /(?<!\p{L})(?:чи|або)\s+ні(?!\p{L})/giu],
  // сталі звороти-модальності: заперечення не стосується симптому
  [/(?<!\p{L})без\s+сомнени\p{L}*(?!\p{L})/giu, null, true],
  [/(?<!\p{L})как\s+нельзя\s+\p{L}+(?!\p{L})/giu, /(?<!\p{L})якнай\p{L}+(?!\p{L})/giu],
];

// «какой бы то ни было», «как бы ни» — поступка, а не заперечення: «ни» знімаємо завжди.
const RU_CONCESSIVE = /(?<!\p{L})(?:бы(?:\s+то)?(?:\s+\p{L}+){0,3}?|как|что|сколько|куда|где|кто|чем)\s+ни(?!\p{L})/giu;
// «никак не» / «ніяк не» — підсилювач при «не», а не другий маркер.
const RU_INTENS = /(?<!\p{L})никак(?=\s+(?:не|нельзя)(?!\p{L}))/giu;
const UA_INTENS = /(?<!\p{L})ніяк(?=\s+не(?!\p{L}))/giu;

function prepare(ruText, uaText, on) {
  let r = ruText, u = uaText;
  if (!on) return [r, u];
  r = r.replace(RU_CONCESSIVE, ' ').replace(RU_INTENS, ' ');
  u = u.replace(UA_INTENS, ' ');
  for (const [rr, ur, ruOnly] of STRIP) {
    rr.lastIndex = 0;
    if (!rr.test(r)) continue;
    if (!ruOnly) {
      ur.lastIndex = 0;
      if (!ur.test(u)) continue;       // UA-бік звороту не знайдено — це може бути справжня втрата
      u = u.replace(ur, ' ');
    }
    r = r.replace(rr, ' ');
  }
  return [r, u];
}

// Розділяємо маркери на «ядро» (самостійне заперечення) і корелятивні «ни»/«ні»/«ані».
// Втратою вважаємо лише падіння ЯДРА: «не може ні читати, ні працювати» → «не може читати,
// ні працювати» — це вада стилю, а не змісту, бо «не» на місці. Якщо ж ядра в оригіналі
// взагалі не було, дивимось на корелятиви.
function marks(text, re, niRe) {
  re.lastIndex = 0;
  const all = text.match(re) || [];
  const core = [], ni = [];
  for (const x of all) (niRe.test(x) ? ni : core).push(x);
  return { core, ni, all };
}

// RU «нет» у переліках і еліпсисі («или нет» → «чи ні», «а у Thuja — нет» → «— ні») дає
// українське САМОСТІЙНЕ «ні», а не ланку «ні … ні». Переносимо стільки UA-«ні» з корелятивів
// у ядро, скільки «нет» є в ядрі оригіналу.
const RU_NET = /^нету?$/iu;
function pairNet(rm, um) {
  let n = rm.core.filter(x => RU_NET.test(x)).length;
  while (n-- > 0 && um.ni.length) um.core.push(um.ni.shift());
  return um;
}

function lost(rm, um) {
  if (rm.core.length > um.core.length) return true;
  return rm.core.length === 0 && rm.ni.length > um.ni.length;
}

// ---------------------------------------------------------------------------
// Розбір файлу: тіло без фронтматера, рядок у рядок
// ---------------------------------------------------------------------------
function bodyLines(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('no frontmatter: ' + file);
  const lines = m[2].split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  // скільки рядків з'їв фронтматер — щоб номер у звіті збігався з номером у файлі
  const skip = raw.slice(0, raw.length - m[2].length).split('\n').length - 1;
  return { lines, skip };
}

const H2 = /^##\s+(.+)$/;
const H3 = /^###\s+(.+)$/;
const CLINIC = { ru: 'Клиника', ua: 'Клініка' };

function main() {
  const argv = process.argv.slice(2);
  const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
  const useStrip = !argv.includes('--no-strip');
  const out = [];
  const stat = {
    files: 0, fileMismatch: 0, paras: 0, sents: 0,
    linesAligned: 0, linesRagged: 0, cand: 0, candAligned: 0, candRagged: 0, clinic: 0,
  };
  const byMark = new Map();   // який RU-маркер лишився без пари → скільки разів

  for (const sub of ['remedies', 'articles']) {
    const dir = path.join(CONTENT, 'ru', sub);
    for (const fn of fs.readdirSync(dir).sort()) {
      if (!fn.endsWith('.md')) continue;
      const uaFile = path.join(CONTENT, 'ua', sub, fn);
      if (!fs.existsSync(uaFile)) { process.stderr.write(`НЕМА UA: ${sub}/${fn}\n`); continue; }
      stat.files++;
      const ru = bodyLines(path.join(dir, fn));
      const ua = bodyLines(uaFile);
      if (ru.lines.length !== ua.lines.length) {
        stat.fileMismatch++;
        process.stderr.write(`РЯДКИ РОЗІЙШЛИСЬ: ${sub}/${fn}: ru=${ru.lines.length} ua=${ua.lines.length}\n`);
        continue;
      }
      let inClinic = false, para = 0;
      for (let i = 0; i < ru.lines.length; i++) {
        const rawRu = ru.lines[i], rawUa = ua.lines[i];
        if (!rawRu.trim()) continue;
        const h2 = H2.exec(rawRu);
        if (h2) { inClinic = h2[1].trim() === CLINIC.ru; continue; }
        if (H3.test(rawRu)) continue;
        para++;
        stat.paras++;
        const ruLine = rawRu.startsWith('- ') ? rawRu.slice(2) : rawRu;
        const uaLine = rawUa.startsWith('- ') ? rawUa.slice(2) : rawUa;
        const [ruLineP, uaLineP] = prepare(ruLine, uaLine, useStrip);
        const ruLineM = marks(ruLineP, RU_MARK, RU_NI);
        if (!ruLineM.all.length) continue;            // у рядку взагалі нема заперечень
        const uaLineM = pairNet(ruLineM, marks(uaLineP, UA_MARK, UA_NI));
        const ruLineN = ruLineM.all.length, uaLineN = uaLineM.all.length;

        const rs = SC.splitSentences(ruLine);
        const us = SC.splitSentences(uaLine);
        const aligned = rs.length === us.length;
        if (aligned) stat.linesAligned++; else stat.linesRagged++;
        stat.sents += rs.length;
        // ragged: довіряємо лише рівню рядка — пропорційне відображення саме по собі дає хибні пари
        if (!aligned && !lost(ruLineM, uaLineM)) continue;

        for (let k = 0; k < rs.length; k++) {
          const ruSent = rs[k];
          let uaSent;
          if (aligned) {
            uaSent = us[k];
          } else {
            // те саме пропорційне відображення, що в addPara (build.mjs), але в інший бік:
            // збираємо всі UA-речення, які лягають на k-те RU-речення
            const picked = us.filter((_, j) => (us.length === rs.length ? j : Math.min(rs.length - 1, Math.floor(j * rs.length / us.length))) === k);
            uaSent = picked.join(' ');
            if (!uaSent) continue;
          }
          const [ruP, uaP] = prepare(ruSent, uaSent, useStrip);
          const rm = marks(ruP, RU_MARK, RU_NI);
          if (!rm.all.length) continue;
          const um = pairNet(rm, marks(uaP, UA_MARK, UA_NI));
          if (!lost(rm, um)) continue;
          stat.cand++;
          if (aligned) stat.candAligned++; else stat.candRagged++;
          if (inClinic) stat.clinic++;
          const key = rm.all.map(x => x.toLowerCase()).sort().join('+') + ' → ' + (um.all.map(x => x.toLowerCase()).sort().join('+') || '∅');
          byMark.set(key, (byMark.get(key) || 0) + 1);
          out.push({
            file: `content/ru/${sub}/${fn}`, para, ru: ruSent, ua: uaSent,
            line: ru.skip + i + 1, sent: k, aligned, clinic: inClinic,
            ruN: rm.all.length, uaN: um.all.length, lineRuN: ruLineN, lineUaN: uaLineN,
            ruMarks: rm.all, uaMarks: um.all, ruLine, uaLine,
          });
        }
      }
    }
  }

  const jsonl = out.map(o => JSON.stringify(o)).join('\n') + (out.length ? '\n' : '');
  if (outPath) fs.writeFileSync(outPath, jsonl); else process.stdout.write(jsonl);

  const s = [];
  s.push(`файлів: ${stat.files}, розбіжних за рядками: ${stat.fileMismatch}`);
  s.push(`абзаців: ${stat.paras}, речень у них: ${stat.sents}; рядків із запереченням: рівних ${stat.linesAligned}, нерівних ${stat.linesRagged}`);
  s.push(`кандидатів: ${stat.cand} (рівних ${stat.candAligned}, нерівних ${stat.candRagged}; з «Клініки» ${stat.clinic})`);
  s.push('розклад «маркери RU → маркери UA»:');
  for (const [k, v] of Array.from(byMark.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40)) s.push(`  ${String(v).padStart(4)}  ${k}`);
  process.stderr.write(s.join('\n') + '\n');
}

main();
