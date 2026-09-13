/*
 * modal2.js — фаза 2 модальностей у браузері: рубрика з двома ступенями (секційні клаузи
 * та видобуті з речень симптомних розділів), підстави для видобутої модальності
 * (речення + назва розділу), кількість у списку рубрик = лише секційні.
 * Запуск: node tools/uitest/modal2.js (сайт має бути піднятий — див. run.sh).
 * Змінні середовища: BASE, CHROME, SHOTS, PUPPETEER (див. README.md у цій теці).
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || '/home/ubuntu/node_modules/puppeteer');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/homeo-repertory/';
const CHROME = process.env.CHROME || '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const OUT = path.join(process.env.SHOTS || path.join(__dirname, 'shots'), 'modal2');
fs.mkdirSync(OUT, { recursive: true });

// Що саме перевіряти — беремо зі зібраних даних, а не з констант: набір препаратів у
// рубриці змінюється з кожним уточненням регексів.
const ROOT = path.resolve(__dirname, '..', '..');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const catalog = read('data/ru/catalog.json');
const iMotion = catalog.rubrics.findIndex(r => r.k === 'mod' && r.key === 'w.motion');
if (iMotion < 0) { console.log('FAIL немає рубрики m:w.motion у data/ru/catalog.json'); process.exit(1); }
const rbMotion = catalog.rubrics[iMotion];
const sectional = rbMotion.g.filter(g => g === 2).length;
// препарат, у якого «Хуже: движение, усилие» є ЛИШЕ з видобутого речення (ступінь 1)
let target = -1;
for (let k = 0; k < rbMotion.r.length; k++) {
  const i = rbMotion.r[k];
  if (rbMotion.g[k] === 1 && !catalog.remedies[i].ext) { target = i; break; }
}
if (target < 0) { console.log('FAIL у w.motion немає препарата лише з видобутою модальністю'); process.exit(1); }
const targetRem = catalog.remedies[target];
// перший видобутий елемент цієї рубрики — саме він показується в підставах першим
const mined = read('data/ru/remedies/' + targetRem.id + '.json').mods
  .find(m => m.src === 'text' && m.d === 'w' && m.c.includes('motion') && m.t);
if (!mined) { console.log('FAIL не знайдено видобутої клаузи для ' + targetRem.id); process.exit(1); }

(async () => {
  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900 });
  const errors = [], failed = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => failed.push(r.url()));
  page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
  let fails = 0;
  const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { fails++; console.log('FAIL', name, '-', e.message); } };
  const shot = n => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  const rows = () => page.waitForFunction(() => document.querySelectorAll('table.rep tr.row').length > 0, { timeout: 30000 });

  await step(`m:w.motion: ${targetRem.latin} — ступінь 1, підстави = речення + розділ`, async () => {
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('m:w.motion'), { waitUntil: 'networkidle0' });
    await rows();
    // видобуті сортуються після секційних — гортаємо, доки не з’явиться потрібний рядок
    for (let i = 0; i < 8; i++) {
      if (await page.$(`table.rep tr.row[data-r="${target}"]`)) break;
      const more = await page.$('#moreBtn');
      if (!more) break;
      await more.click();
      await rows();
    }
    const tr = await page.$(`table.rep tr.row[data-r="${target}"]`);
    if (!tr) throw new Error('немає рядка для ' + targetRem.latin);
    const cell = await page.$eval(`table.rep tr.row[data-r="${target}"] td.g`, e => e.className);
    if (!/\bg1\b/.test(cell)) throw new Error('ступінь у таблиці: ' + cell);
    await tr.click();
    await page.waitForFunction(r => {
      const d = document.querySelector(`tr.detail[data-r="${r}"] .detail-box .evid`);
      return d && d.textContent.length > 10;
    }, { timeout: 20000 }, target);
    const txt = await page.$eval(`tr.detail[data-r="${target}"] .detail-box`, e => e.textContent);
    const want = mined.t + ' (' + mined.sec + ')';
    if (!txt.includes(want)) throw new Error('у підставах немає «' + want.slice(0, 60) + '…»: ' + txt.slice(0, 200));
    await shot('01-mined-evidence');
  });

  await step(`список рубрик: біля «движение, усилие» кількість = ${sectional} (лише секційні)`, async () => {
    await page.goto(BASE + '#/ru/rep', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#picker summary');
    await page.click('#picker summary');
    await page.waitForSelector('#pickerBody button.pick');
    const btn = await page.$(`#pickerBody button.pick[data-i="${iMotion}"]`);
    if (!btn) throw new Error('немає кнопки рубрики w.motion');
    const txt = await page.evaluate(e => e.textContent, btn);
    const n = +(txt.match(/(\d+)\s*$/) || [0, 0])[1];
    if (n !== sectional) throw new Error(`у списку ${n}, секційних ${sectional} (усього в рубриці ${rbMotion.r.length})`);
    if (n >= rbMotion.r.length) throw new Error('кількість дорівнює повній рубриці — видобуті потрапили в лічильник');
    // а в таблиці рубрика дає всі препарати, разом із видобутими
    await btn.click();
    await rows();
    const found = await page.$eval('#results .results-head', e => +(e.textContent.match(/\d+/) || [0])[0]);
    if (found !== rbMotion.r.length) throw new Error(`у таблиці ${found}, у рубриці ${rbMotion.r.length}`);
    await shot('02-picker-count');
  });

  console.log('console errors:', errors.length ? errors : 'none');
  console.log('failed requests:', failed.length ? failed : 'none');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
