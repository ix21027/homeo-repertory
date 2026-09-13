/*
 * cases.js — збережені випадки і друк у headless-браузері: збереження випадку з міні-рядка,
 * localStorage, відновлення з меню, оновлення (зміна кількості рубрик), видалення,
 * режим друку (схована шапка, блок .print-only, усі рядки без пагінації, сторінка препарату).
 * Запуск: node tools/uitest/cases.js (сайт має бути піднятий — див. run.sh).
 * Змінні середовища: BASE, CHROME, SHOTS, PUPPETEER (див. README.md у цій теці).
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || '/home/ubuntu/node_modules/puppeteer');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/homeo-repertory/';
const CHROME = process.env.CHROME || '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const OUT = path.join(process.env.SHOTS || path.join(__dirname, 'shots'), 'cases');
fs.mkdirSync(OUT, { recursive: true });

const NAME = 'Тестовий випадок';

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
  const chips = n => page.waitForFunction(k => document.querySelectorAll('.chip').length === k, { timeout: 30000 }, n);
  const rowCount = () => page.$$eval('table.rep tr.row', r => r.length);
  const foundN = () => page.$eval('#results .results-head', e => +(e.textContent.match(/\d+/) || [0])[0]);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cases') || '[]'));
  const caseBtn = () => page.$eval('#caseBtn', e => e.textContent.trim());
  const openMenu = async () => { await page.click('#menuBtn'); await page.waitForSelector('#menu:not([hidden])'); };
  const display = sel => page.$eval(sel, e => getComputedStyle(e).display);
  const selectAll = async sel => {
    await page.focus(sel);
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  };

  await step('порожній стан: меню «Випадки» без записів', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#repInput');
    await page.evaluate(() => localStorage.removeItem('cases'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#repInput');
    await openMenu();
    const title = await page.$eval('#menuCasesTitle', e => e.textContent);
    if (!/Випадки/.test(title)) throw new Error('заголовок секції: ' + title);
    const empty = await page.$eval('#casesList', e => e.textContent);
    if (!/Немає збережених випадків/.test(empty)) throw new Error('порожній стан: ' + empty);
    await page.keyboard.press('Escape');
  });

  await step('зберегти випадок із 2 рубрик під власною назвою; localStorage містить його', async () => {
    await page.goto(BASE + '#/ua/rep?r=' + encodeURIComponent('n:Пронос|m:w.night'), { waitUntil: 'networkidle0' });
    await rows();
    await chips(2);
    if (await caseBtn() !== 'Зберегти випадок') throw new Error('кнопка: ' + await caseBtn());
    await page.click('#caseBtn');
    await page.waitForSelector('#caseForm:not([hidden])');
    const def = await page.$eval('#caseNameIn', e => e.value);
    if (!/Пронос/.test(def)) throw new Error('типова назва: ' + def);
    await selectAll('#caseNameIn');
    await page.keyboard.type(NAME);
    await shot('01-save-form');
    await page.click('#caseOk');
    await page.waitForFunction(() => document.querySelector('#caseBtn') && /Оновити випадок/.test(document.querySelector('#caseBtn').textContent), { timeout: 5000 });
    const list = await stored();
    if (list.length !== 1) throw new Error('записів: ' + list.length);
    const cs = list[0];
    if (cs.name !== NAME) throw new Error('назва: ' + cs.name);
    if (cs.n !== 2) throw new Error('n: ' + cs.n);
    if (cs.lang !== 'ua') throw new Error('lang: ' + cs.lang);
    if (!/Пронос/.test(decodeURIComponent(cs.hash)) || !/m:w\.night/.test(decodeURIComponent(cs.hash))) throw new Error('хеш: ' + cs.hash);
    if (!cs.id || !cs.ts) throw new Error('немає id/ts: ' + JSON.stringify(cs));
    const nm = await page.$eval('#caseName', e => e.textContent);
    if (nm !== NAME) throw new Error('рядок над чіпами: ' + nm);
  });

  await step('інший запит → меню → клік по випадку → чіпи відновлено, назву показано', async () => {
    await page.goto(BASE + '#/ua/rep?r=' + encodeURIComponent('n:Кашель'), { waitUntil: 'networkidle0' });
    await rows();
    await chips(1);
    const hiddenName = await page.$eval('#caseName', e => e.hidden);
    if (!hiddenName) throw new Error('назва випадку висить на чужому запиті');
    await openMenu();
    const item = await page.$eval('#casesList .case-open', e => e.textContent);
    if (!item.includes(NAME) || !/2 рубрики/.test(item)) throw new Error('рядок меню: ' + item);
    await shot('02-menu');
    await page.click('#casesList .case-open');
    await chips(2);
    await rows();
    const labels = await page.$$eval('.chip', c => c.map(x => x.textContent));
    if (!labels.some(x => /Пронос/.test(x)) || !labels.some(x => /вночі/.test(x))) throw new Error('чіпи: ' + labels.join(' | '));
    const nm = await page.$eval('#caseName', e => e.textContent);
    if (nm !== NAME) throw new Error('назва: ' + nm);
    if (await page.$eval('#menu', e => e.hidden) !== true) throw new Error('меню не закрилось');
  });

  await step('«Оновити випадок» після додавання рубрики змінює n', async () => {
    const before = await stored();
    await page.click('#picker summary');
    await page.waitForSelector('#pickerBody .picker-group:last-child button.pick');
    await page.click('#pickerBody .picker-group:last-child button.pick');
    await chips(3);
    await rows();
    if (await caseBtn() !== 'Оновити випадок') throw new Error('кнопка: ' + await caseBtn());
    await page.click('#caseBtn');
    await page.waitForSelector('#caseForm:not([hidden])');
    const val = await page.$eval('#caseNameIn', e => e.value);
    if (val !== NAME) throw new Error('назва в полі: ' + val);
    await page.click('#caseOk');
    await page.waitForFunction(() => document.querySelector('#caseForm') && document.querySelector('#caseForm').hidden, { timeout: 5000 });
    const list = await stored();
    if (list.length !== 1) throw new Error('записів: ' + list.length);
    if (list[0].id !== before[0].id) throw new Error('id змінився: ' + before[0].id + ' → ' + list[0].id);
    if (list[0].n !== 3) throw new Error('n: ' + list[0].n + ' (було ' + before[0].n + ')');
    if (list[0].hash === before[0].hash) throw new Error('хеш не оновився');
    await openMenu();
    const item = await page.$eval('#casesList .case-open', e => e.textContent);
    if (!/3 рубрики/.test(item)) throw new Error('рядок меню: ' + item);
    await page.keyboard.press('Escape');
  });

  await step('видалення: «×» → «видалити?» → запис зник', async () => {
    await openMenu();
    await page.click('#casesList .case-del');
    const ask = await page.$eval('#casesList .case-del', e => e.textContent);
    if (!/видалити\?/.test(ask)) throw new Error('підтвердження: ' + ask);
    if ((await stored()).length !== 1) throw new Error('видалено з першого кліку');
    await page.click('#casesList .case-del');
    await page.waitForFunction(() => /Немає збережених випадків/.test(document.querySelector('#casesList').textContent), { timeout: 5000 });
    const list = await stored();
    if (list.length) throw new Error('лишилось записів: ' + list.length);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#caseBtn') && /Зберегти випадок/.test(document.querySelector('#caseBtn').textContent), { timeout: 5000 });
  });

  await step('друк: шапка схована, .print-only видимий, усі рядки без пагінації, прапорці словами', async () => {
    await page.goto(BASE + '#/ua/rep?r=' + encodeURIComponent('n2:Головний біль'), { waitUntil: 'networkidle0' });
    await rows();
    const found = await foundN();
    if (!(found > 60)) throw new Error('замало рядків для перевірки пагінації: ' + found);
    const paged = await rowCount();
    if (paged !== 60) throw new Error('сторінка не 60 рядків: ' + paged);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.waitForFunction(n => document.querySelectorAll('table.rep tr.row').length === n, { timeout: 15000 }, found);
    await page.emulateMediaType('print');
    if (await display('.site-header') !== 'none') throw new Error('шапка видима у друці');
    if (await display('.menu-wrap') !== 'none') throw new Error('меню видиме у друці');
    if (await display('.rep-search') !== 'none') throw new Error('форма пошуку видима у друці');
    if (await display('#toggleAll') !== 'none') throw new Error('кнопки видимі у друці');
    if (await display('.results-head .sort') !== 'none') throw new Error('селект сортування видимий у друці');
    if (await display('.chip .ctl') !== 'none') throw new Error('керування чіпами видиме у друці');
    if (await display('.print-only') === 'none') throw new Error('.print-only схований у друці');
    if (await display('.chip-flags') === 'none') throw new Error('прапорці рубрики не друкуються');
    const flags = await page.$eval('.chip-flags', e => e.textContent);
    if (!/×2/.test(flags)) throw new Error('прапорці: ' + flags);
    const pos = await page.$eval('table.rep thead th', e => getComputedStyle(e).position);
    if (pos !== 'static') throw new Error('sticky-шапка таблиці у друці: ' + pos);
    const ov = await page.$eval('.table-wrap', e => getComputedStyle(e).overflowX);
    if (ov !== 'visible') throw new Error('overflow таблиці у друці: ' + ov);
    const date = await page.$eval('.print-only .print-date', e => e.textContent);
    if (!/\d{4}/.test(date)) throw new Error('дата: ' + date);
    await shot('03-print');
    await page.emulateMediaType('screen');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.waitForFunction(() => document.querySelectorAll('table.rep tr.row').length === 60, { timeout: 10000 });
  });

  await step('друк: збережений випадок дає назву у блоці .print-only', async () => {
    await page.goto(BASE + '#/ua/rep?r=' + encodeURIComponent('n:Пронос|m:w.night'), { waitUntil: 'networkidle0' });
    await rows();
    await page.click('#caseBtn');
    await page.waitForSelector('#caseForm:not([hidden])');
    await selectAll('#caseNameIn');
    await page.keyboard.type(NAME);
    await page.click('#caseOk');
    await page.waitForFunction(() => document.querySelector('.print-only .print-case'), { timeout: 5000 });
    const title = await page.$eval('.print-only .print-case', e => e.textContent);
    if (title !== NAME) throw new Error('назва у друці: ' + title);
    await page.evaluate(() => localStorage.removeItem('cases'));
  });

  await step('друк сторінки препарату: без шапки й навігації, текст читабельний', async () => {
    await page.goto(BASE + '#/ua/remedy/aconitum-napellus', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc h2');
    await page.emulateMediaType('print');
    if (await display('.site-header') !== 'none') throw new Error('шапка видима');
    if (await display('.toc') !== 'none') throw new Error('навігація розділів видима');
    const box = await page.$eval('.doc', e => ({ h: e.getBoundingClientRect().height, color: getComputedStyle(e).color, bg: getComputedStyle(document.body).backgroundColor }));
    if (!(box.h > 200)) throw new Error('текст не видно: ' + JSON.stringify(box));
    if (box.color !== 'rgb(0, 0, 0)') throw new Error('колір тексту: ' + box.color);
    if (box.bg !== 'rgb(255, 255, 255)') throw new Error('тло: ' + box.bg);
    await shot('04-print-remedy');
    await page.emulateMediaType('screen');
  });

  await step('друк у темній темі теж світлий', async () => {
    await page.goto(BASE + '#/ua/rep?r=' + encodeURIComponent('n:Пронос'), { waitUntil: 'networkidle0' });
    await rows();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.emulateMediaType('print');
    const bg = await page.$eval('body', e => getComputedStyle(e).backgroundColor);
    if (bg !== 'rgb(255, 255, 255)') throw new Error('тло у друці: ' + bg);
    const th = await page.$eval('table.rep thead th', e => getComputedStyle(e).backgroundColor);
    if (th !== 'rgb(255, 255, 255)') throw new Error('тло шапки таблиці: ' + th);
    await page.emulateMediaType('screen');
    await page.evaluate(() => { document.documentElement.removeAttribute('data-theme'); try { localStorage.removeItem('theme'); } catch (e) { /* ignore */ } });
  });

  console.log('console errors:', errors.length ? errors : 'none');
  console.log('failed requests:', failed.length ? failed : 'none');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
