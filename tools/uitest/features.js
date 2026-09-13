/*
 * features.js — сценарії функцій реперторію в headless-браузері: список модальностей і причин,
 * ваги/елімінативні/виключні рубрики, сортування, порівняння препаратів, підстави з речень,
 * перемикач статей, перенесення рубрик між мовами, мобільна ширина.
 * Запуск: node tools/uitest/features.js (сайт має бути піднятий — див. run.sh).
 * Змінні середовища: BASE, CHROME, SHOTS, PUPPETEER (див. README.md у цій теці).
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || '/home/ubuntu/node_modules/puppeteer');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/homeo-repertory/';
const CHROME = process.env.CHROME || '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const OUT = path.join(process.env.SHOTS || path.join(__dirname, 'shots'), 'features');
fs.mkdirSync(OUT, { recursive: true });
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
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const rows = () => page.waitForFunction(() => document.querySelectorAll('table.rep tr.row').length > 0, { timeout: 30000 });
  const rowCount = () => page.$$eval('table.rep tr.row', r => r.length);
  const firstName = () => page.$eval('table.rep tr.row .rem a', e => e.textContent);
  const foundN = () => page.$eval('#results .results-head', e => +(e.textContent.match(/\d+/) || [0])[0]);

  await step('old URL n:Астма still resolves; grades from catalog', async () => {
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('n:Астма'), { waitUntil: 'networkidle0' });
    await rows();
    const n = await rowCount();
    if (n < 50) throw new Error('rows ' + n);
    const g3 = await page.$$eval('table.rep td.g3', c => c.length);
    if (!g3) throw new Error('no grade-3 cells');
  });

  await step('alias form n:Головные боли resolves to merged rubric with children (+N)', async () => {
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('n:Головные боли'), { waitUntil: 'networkidle0' });
    await rows();
    const chip = await page.$eval('.chip', e => e.textContent);
    if (!/Головная боль/.test(chip)) throw new Error(chip);
    const n = await foundN();
    if (n < 260) throw new Error('found ' + n);
  });

  await step('picker: add modality rubric "Хуже: ночью" and etiology; hash has m:/e:', async () => {
    await page.goto(BASE + '#/ru/rep', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#picker summary');
    await page.click('#picker summary');
    await page.waitForSelector('#pickerBody button.pick');
    const btn = await page.$$('#pickerBody button.pick');
    const texts = await page.$$eval('#pickerBody button.pick', b => b.map(x => x.textContent));
    const i = texts.findIndex(x => /^ночью/.test(x));
    if (i < 0) throw new Error('no night button: ' + texts.slice(0, 5).join('|'));
    await btn[i].click();
    await rows();
    const j = texts.findIndex(x => /^испуг, шок/.test(x));
    if (j < 0) throw new Error('no fright button');
    await btn[j].click();
    await page.waitForFunction(() => document.querySelectorAll('.chip').length === 2, { timeout: 5000 });
    const hash = await page.evaluate(() => decodeURIComponent(location.hash));
    if (!/m:w\.night/.test(hash) || !/e:fright/.test(hash)) throw new Error('hash ' + hash);
    await shot('01-picker');
  });

  await step('eliminative "!" reduces rows; exclude "−" removes column and rows; weight ×2 changes Σ', async () => {
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('n:Астма|m:w.night'), { waitUntil: 'networkidle0' });
    await rows();
    const before = await foundN();
    await page.click('.chip button[data-act="e"][data-k="1"]');
    await rows();
    const after = await foundN();
    if (!(after < before)) throw new Error(`elim ${before} → ${after}`);
    if (!/m!:w\.night/.test(await page.evaluate(() => decodeURIComponent(location.hash)))) throw new Error('hash flag missing');
    await page.click('.chip button[data-act="x"][data-k="1"]');
    await rows();
    const cols = await page.$$eval('table.rep thead th.rub', h => h.length);
    if (cols !== 1) throw new Error('cols ' + cols);
    const after2 = await foundN();
    if (!(after2 < before)) throw new Error(`excl ${before} → ${after2}`);
    await page.click('.chip button[data-act="x"][data-k="1"]');
    await rows();
    await page.click('.chip button[data-act="w"][data-k="0"]');
    await rows();
    const w = await page.$eval('.chip button[data-act="w"][data-k="0"]', b => b.textContent);
    if (w !== '×2') throw new Error('weight ' + w);
    if (!/n2:Астма/.test(await page.evaluate(() => decodeURIComponent(location.hash)))) throw new Error('weight not in hash');
    await shot('02-controls');
  });

  await step('sort select: total, name', async () => {
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('n:Астма|m:w.night|f:~страх смерти'), { waitUntil: 'networkidle0' });
    await rows();
    await page.select('#sortSel', 'name');
    await rows();
    const names = await page.$$eval('table.rep tr.row .rem a', a => a.slice(0, 5).map(x => x.textContent));
    const sorted = names.slice().sort((a, b) => a.localeCompare(b));
    if (names.join() !== sorted.join()) throw new Error(names.join());
    if (!/s=name/.test(await page.evaluate(() => location.hash))) throw new Error('no s=name in hash');
    await page.select('#sortSel', 'total');
    await rows();
    const sums = await page.$$eval('table.rep tr.row td.sum', c => c.slice(0, 3).map(x => x.textContent));
    console.log('      total-sorted Σ:', sums.join(' | '));
  });

  await step('free text detail shows sentence evidence + relations; typo hint', async () => {
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('f:~страх смерти'), { waitUntil: 'networkidle0' });
    await rows();
    const first = await firstName();
    if (!/Aconitum/.test(first)) throw new Error('first ' + first);
    await page.click('table.rep tr.row');
    await page.waitForFunction(() => document.querySelectorAll('tr.detail mark').length > 0, { timeout: 15000 });
    const txt = await page.$eval('tr.detail .detail-box', e => e.textContent);
    if (!/Психика|Психіка/.test(txt)) throw new Error('no section label: ' + txt.slice(0, 100));
    if (!/Антидоты|Сравнить с|Дополняют/.test(txt)) throw new Error('no relations: ' + txt.slice(-200));
    await shot('03-detail');
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('f:~голвная боль'), { waitUntil: 'networkidle0' });
    await rows();
    const chip = await page.$eval('.chip', e => e.textContent);
    if (!/возможно/.test(chip)) throw new Error('no typo hint: ' + chip);
  });

  await step('phrase in quotes narrows results; chip keeps quotes; evidence has words side by side', async () => {
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('f:~страх смерти'), { waitUntil: 'networkidle0' });
    await rows(); const plain = await foundN();
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('f:~"страх смерти"'), { waitUntil: 'networkidle0' });
    await rows();
    // підтвердження фрази вантажить документи — чекаємо, поки в чіпі замість «…» стане число
    await page.waitForFunction(() => /^\d+$/.test((document.querySelector('.chip .n') || {}).textContent || ''), { timeout: 30000 });
    const chip = await page.$eval('.chip', e => e.textContent);
    if (!/"страх смерти"/.test(chip)) throw new Error('no quotes in chip: ' + chip);
    const n = await foundN();
    if (!(n > 0 && n < plain)) throw new Error(`phrase ${n} vs plain ${plain}`);
    if (!/Aconitum/.test(await firstName())) throw new Error('first ' + await firstName());
    await page.click('table.rep tr.row');
    await page.waitForFunction(() => document.querySelectorAll('tr.detail mark').length > 0, { timeout: 15000 });
    const txt = await page.$eval('tr.detail .detail-box', e => e.textContent);
    if (!/страх[а-яё]*\s+(?:\S+\s+)?смерт/i.test(txt)) throw new Error('no phrase in evidence: ' + txt.slice(0, 200));
    await shot('09-phrase');
    console.log('      phrase/plain:', n, '/', plain);
  });

  await step('rare-word AND relaxation: chip shows dropped word', async () => {
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('f:~страх смерти во время лихорадки ночью'), { waitUntil: 'networkidle0' });
    await rows();
    const chip = await page.$eval('.chip', e => e.textContent);
    if (!/без:/.test(chip)) throw new Error('no dropped hint: ' + chip);
    if (!/лихорадки/.test(chip)) throw new Error('dropped word missing: ' + chip);
  });

  await step('exclusion operator -слово reduces count', async () => {
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('f:~тошнота'), { waitUntil: 'networkidle0' });
    await rows(); const a = await foundN();
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('f:~тошнота -беременн'), { waitUntil: 'networkidle0' });
    await rows(); const b = await foundN();
    if (!(b < a)) throw new Error(`${a} → ${b}`);
  });

  await step('comparison: select 3 rows, open panel, rows for modalities/relations', async () => {
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('n:Астма|f:~страх смерти|m:w.night'), { waitUntil: 'networkidle0' });
    await rows();
    for (let i = 0; i < 3; i++) { const boxes = await page.$$('input.cmp-box'); await boxes[i].click(); await rows(); }
    await page.waitForSelector('#cmpOpen');
    await page.click('#cmpOpen');
    await page.waitForSelector('table.cmp', { timeout: 20000 });
    const heads = await page.$$eval('table.cmp thead th', h => h.length);
    if (heads !== 4) throw new Error('heads ' + heads);
    const labels = await page.$$eval('table.cmp th.lbl', h => h.map(x => x.textContent));
    if (!labels.some(l => /^Хуже$/.test(l)) || !labels.some(l => /Взаимосвязи/.test(l))) throw new Error(labels.join('|'));
    const hash = await page.evaluate(() => decodeURIComponent(location.hash));
    if (!/c=/.test(hash)) throw new Error('no c= in hash');
    await shot('04-compare');
    await page.click('#cmpClose');
    await rows();
    // reload with c= keeps comparison
    await page.reload({ waitUntil: 'networkidle0' });
    await rows();
    const n = await page.$$eval('input.cmp-box:checked', c => c.length);
    if (n !== 3) throw new Error('checked after reload ' + n);
  });

  await step('language switch keeps m:/e: rubrics and flags', async () => {
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('m!:w.night|e:fright|n2:Астма'), { waitUntil: 'networkidle0' });
    await rows();
    await page.click('#menuBtn');
    await page.waitForSelector('#menu:not([hidden])');
    await page.click('#langBtns button[data-lang="ua"]');
    await page.waitForFunction(() => location.hash.startsWith('#/ua/') && document.querySelectorAll('.chip').length === 3 && Array.from(document.querySelectorAll('.chip')).some(c => /Гірше/.test(c.textContent)), { timeout: 30000 });
    await rows();
    const chips = await page.$$eval('.chip', c => c.map(x => x.textContent));
    if (!chips.some(c => /Гірше: вночі/.test(c)) || !chips.some(c => /Після: переляк/.test(c)) || !chips.some(c => /Астма/.test(c))) throw new Error(chips.join(' | '));
    const hash = await page.evaluate(() => decodeURIComponent(location.hash));
    if (!/m!:w\.night/.test(hash) || !/n2:Астма/.test(hash)) throw new Error('flags lost: ' + hash);
    await shot('05-ua-switch');
  });

  await step('ua: remedy page has modality/etiology tag links; suggestion "діарея" → Понос', async () => {
    await page.goto(BASE + '#/ua/remedy/aconitum-napellus', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.tags.mod a');
    const tags = await page.$$eval('.tags.mod a', a => a.map(x => x.getAttribute('href')));
    if (!tags.some(h => /m:w\./.test(decodeURIComponent(h)))) throw new Error(tags.slice(0, 3).join());
    await page.goto(BASE + '#/ua/rep', { waitUntil: 'networkidle0' });
    await page.type('#repInput', 'діарея');
    await wait(300);
    const texts = await page.$$eval('#repSugg li', ls => ls.map(l => l.textContent));
    if (!texts.some(t => /^Пронос/.test(t))) throw new Error(texts.join(' | '));
  });

  await step('new Wayback article present (ua + ru)', async () => {
    await page.goto(BASE + '#/ru/article/ozhog', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc h3');
    const h1 = await page.$eval('h1', e => e.textContent);
    if (!/Ожог/.test(h1)) throw new Error(h1);
    await page.goto(BASE + '#/ua/article/ozhog', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc h3');
    const ua = await page.$eval('.doc', e => e.textContent.slice(0, 500));
    if (/[ыэъ]/.test(ua)) throw new Error('russian in ua article');
  });

  await step('Enter always adds full-text search; toggle-all opens/closes evidence; sticky column headers', async () => {
    await page.setViewport({ width: 1100, height: 700 });
    await page.goto('about:blank');
    await page.goto(BASE + 'index.html#/ru/rep', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#repInput');
    await page.type('#repInput', 'Астма');
    await wait(300);
    await page.keyboard.press('Enter');
    await rows();
    const kind = await page.$eval('.chip .k', e => e.textContent);
    if (!/Текст/.test(kind)) throw new Error('kind ' + kind);
    await page.click('#toggleAll');
    await page.waitForFunction(() => document.querySelectorAll('tr.detail').length > 0 && document.querySelectorAll('tr.detail').length === document.querySelectorAll('tr.row').length, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('tr.detail .evid').length >= 10, { timeout: 30000 });
    const lbl = await page.$eval('#toggleAll', e => e.textContent);
    if (!/Свернуть/.test(lbl)) throw new Error('label ' + lbl);
    await shot('07-expand-all');
    await page.click('#toggleAll');
    await page.waitForFunction(() => document.querySelectorAll('tr.detail').length === 0, { timeout: 5000 });
    await page.evaluate(() => window.scrollTo(0, 900));
    await wait(200);
    const top = await page.$eval('table.rep thead th', e => e.getBoundingClientRect().top);
    if (Math.abs(top - 67) > 3) throw new Error('thead top ' + top);
    await page.type('#repInput', 'страх смерти');
    await wait(300);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.chip').length === 2, { timeout: 10000 });
    const kinds = await page.$$eval('.chip .k', e => e.map(x => x.textContent));
    if (!/Текст/.test(kinds[1])) throw new Error('kinds ' + kinds.join('|'));
  });

  await step('articles toggle: article line, off → no articles/suggestions, a=0 in hash; article hl', async () => {
    await page.setViewport({ width: 1100, height: 700 });
    await page.goto('about:blank');
    await page.goto(BASE + 'index.html#/ru/rep?r=' + encodeURIComponent('f:~головная боль утром'), { waitUntil: 'networkidle0' });
    await rows();
    await page.waitForSelector('.art-line a');
    const n1 = await foundN();
    const arts = await page.$$eval('.art-line a', a => a.map(x => x.textContent));
    if (!arts.some(x => /Головная боль/.test(x))) throw new Error('articles: ' + arts.join('|'));
    const hrefA = await page.$eval('.art-line a', a => a.getAttribute('href'));
    if (!/hl=/.test(hrefA)) throw new Error('no hl in article link');
    await page.click('#artOpt');
    await rows();
    await page.waitForFunction(() => !document.querySelector('.art-line'), { timeout: 5000 });
    const n2 = await foundN();
    if (!(n2 <= n1)) throw new Error(`count ${n1} → ${n2}`);
    if (!/a=0/.test(await page.evaluate(() => location.hash))) throw new Error('a=0 missing');
    await page.type('#repInput', 'диарея');
    await wait(300);
    const kinds = await page.$$eval('#repSugg li .kind', k => k.map(x => x.textContent));
    if (kinds.some(k => /Статья|Рубрика/.test(k))) throw new Error('article suggestions shown while off: ' + kinds.join('|'));
    await page.click('#artOpt');
    await rows();
    await page.waitForSelector('.art-line a');
    await page.reload({ waitUntil: 'networkidle0' });
    await rows();
    const on = await page.$eval('#artOpt', e => e.checked);
    if (!on) throw new Error('toggle not persisted');
    await page.click('.art-line a');
    await page.waitForSelector('.doc mark', { timeout: 15000 });
    await shot('08-articles');
  });

  await step('mobile: controls fit', async () => {
    await page.setViewport({ width: 390, height: 800, isMobile: true });
    await page.goto('about:blank');
    await page.goto(BASE + 'index.html#/ua/rep?r=' + encodeURIComponent('n:Астма|m!:w.night|f:~страх смерті'), { waitUntil: 'networkidle0' });
    await rows();
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > 395) throw new Error('overflow ' + w);
    await page.click('table.rep tr.row td.g');
    await page.waitForFunction(() => document.querySelectorAll('tr.detail .evid').length > 0, { timeout: 15000 });
    const box = await page.$eval('tr.detail .detail-box', e => e.getBoundingClientRect());
    if (box.width > 390 || box.left < 0) throw new Error('detail box ' + JSON.stringify(box));
    await shot('06-mobile');
  });

  console.log('console errors:', errors.length ? errors : 'none');
  console.log('failed requests:', failed.length ? failed : 'none');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
