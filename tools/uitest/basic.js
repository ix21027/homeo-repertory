/*
 * basic.js — базові двомовні сценарії в headless-браузері: мова за замовчуванням, пошук,
 * підказки рубрик, перемикач UA/RU, сторінки препаратів і статей, тема, мобільна ширина.
 * Запуск: node tools/uitest/basic.js (сайт має бути піднятий — див. run.sh).
 * Змінні середовища: BASE, CHROME, SHOTS, PUPPETEER (див. README.md у цій теці).
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || '/home/ubuntu/node_modules/puppeteer');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/homeo-repertory/';
const CHROME = process.env.CHROME || '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const OUT = path.join(process.env.SHOTS || path.join(__dirname, 'shots'), 'basic');
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

  await step('default → ua', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#repInput');
    const hash = await page.evaluate(() => location.hash);
    if (!/^#\/ua\//.test(hash)) throw new Error('hash ' + hash);
    const ph = await page.$eval('#repInput', e => e.placeholder);
    if (!/Симптом, хвороба/.test(ph)) throw new Error(ph);
    if (await page.$('h1')) throw new Error('h1 present on repertory page');
    const lang = await page.evaluate(() => document.documentElement.lang);
    if (lang !== 'uk') throw new Error('lang ' + lang);
    await shot('01-ua-home');
  });

  await step('ua: free text "страх смерті" + UA stemmer', async () => {
    await page.type('#repInput', 'страх смерті');
    await wait(300);
    await page.keyboard.press('Enter');
    await rows();
    const first = await page.$eval('table.rep tr.row .rem a', e => e.textContent);
    if (!/Aconitum|Arsenicum/.test(first)) throw new Error('first ' + first);
    await page.click('table.rep tr.row');
    await page.waitForFunction(() => document.querySelectorAll('tr.detail mark').length > 0, { timeout: 15000 });
    const txt = await page.$eval('tr.detail .detail-box', e => e.textContent);
    if (/[ыэъ]/.test(txt)) throw new Error('russian text in UA evidence: ' + txt.slice(0, 120));
    await shot('02-ua-search');
  });

  await step('ua: nosology suggestion "нудота"', async () => {
    await page.type('#repInput', 'нудота');
    await wait(300);
    const texts = await page.$$eval('#repSugg li', ls => ls.map(l => l.textContent));
    if (!texts.some(t => /^Нудота/.test(t))) throw new Error(texts.join(' | '));
    const lis = await page.$$('#repSugg li');
    await lis[texts.findIndex(t => /^Нудота/.test(t))].click();
    await page.waitForFunction(() => document.querySelectorAll('.chip').length === 2, { timeout: 5000 });
  });

  await step('switch ua → ru keeps rubrics (nos cross-linked)', async () => {
    await page.click('#menuBtn');
    await page.waitForSelector('#menu:not([hidden])');
    await shot('03a-menu-open');
    await page.click('#langBtns button[data-lang="ru"]');
    await page.waitForFunction(() => document.querySelector('#menu').hidden, { timeout: 5000 });
    await page.waitForFunction(() => location.hash.startsWith('#/ru/') && Array.from(document.querySelectorAll('.chip')).some(c => /Тошнота/.test(c.textContent)), { timeout: 30000 });
    await rows();
    const chips = await page.$$eval('.chip', c => c.map(x => x.textContent));
    if (!chips.some(c => /Тошнота/.test(c))) throw new Error('chips ' + chips.join(' | '));
    const ph = await page.$eval('#repInput', e => e.placeholder);
    if (!/Симптом, болезнь/.test(ph)) throw new Error(ph);
    const lang = await page.evaluate(() => document.documentElement.lang);
    if (lang !== 'ru') throw new Error('lang ' + lang);
    await shot('03-ru-after-switch');
  });

  await step('ru: remedy page in Russian, ua: same remedy translated', async () => {
    await page.goto(BASE + '#/ru/remedy/aconitum-napellus', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc h2');
    const ru = await page.$eval('.doc', e => e.textContent.slice(0, 3000));
    if (!/Психика/.test(ru)) throw new Error('ru sections missing');
    await page.click('#menuBtn');
    await page.waitForSelector('#menu:not([hidden])');
    await page.click('#langBtns button[data-lang="ua"]');
    await page.waitForFunction(() => location.hash === '#/ua/remedy/aconitum-napellus', { timeout: 10000 });
    await page.waitForFunction(() => /Психіка/.test(document.querySelector('.doc') ? document.querySelector('.doc').textContent : ''), { timeout: 15000 });
    const ua = await page.$eval('.doc', e => e.textContent.slice(0, 3000));
    if (/[ыэъ]/.test(ua)) throw new Error('russian letters in UA remedy: ' + ua.match(/.{0,30}[ыэъ].{0,30}/)[0]);
    const tags = await page.$$eval('.tags a', a => a.length);
    if (tags < 20) throw new Error('clinic tags ' + tags);
    await shot('04-ua-remedy');
  });

  await step('ua: MT term fixes on remedy page (повіка, язик, кал)', async () => {
    await page.goto(BASE + '#/ua/remedy/ferrum-phosphoricum', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc h2');
    const txt = await page.$eval('.doc', e => e.textContent);
    if (!/на верхній повіці/.test(txt)) throw new Error('eyelid not fixed: ' + (txt.match(/.{0,40}столітт.{0,20}/) || [''])[0]);
    if (/столітт/.test(txt)) throw new Error('століття remains: ' + txt.match(/.{0,40}столітт.{0,20}/)[0]);
    if (/стілец|стільц/.test(txt)) throw new Error('стілець remains');
    if (/\bмов[аиуі]\b/.test(txt)) throw new Error('мова remains: ' + txt.match(/.{0,30}\bмов[аиуі]\b.{0,30}/)[0]);
    await page.goto(BASE + '#/ua/remedy/hypericum-perfoliatum', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc h2');
    const t3 = await page.$eval('.doc', e => e.textContent);
    if (!/на лівій нижній повіці/.test(t3)) throw new Error('hypericum eyelid: ' + (t3.match(/.{0,30}(віці|повіці).{0,10}/) || [''])[0]);
    await page.goto(BASE + '#/ua/remedy/aconitum-napellus', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc h2');
    const t2 = await page.$eval('.doc', e => e.textContent);
    if (!/Язик/.test(t2)) throw new Error('no Язик on aconitum');
    if (/\bМова (обкладена|суха|покрита|біла)/.test(t2)) throw new Error('мова as tongue remains');
  });

  await step('ua: article + articles list', async () => {
    await page.goto(BASE + '#/ua/articles', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.group-title');
    const g = await page.$$eval('.group-title', x => x.map(e => e.textContent));
    if (!g.some(t => /Травлення/.test(t))) throw new Error(g.join('|'));
    await page.goto(BASE + '#/ua/article/golovnaya-bol', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc h3');
    const h1 = await page.$eval('h1', e => e.textContent);
    if (!/Головний біль/.test(h1)) throw new Error(h1);
    const n = await page.$$eval('.doc h3', h => h.length);
    if (n < 80) throw new Error('blocks ' + n);
    await shot('05-ua-article');
  });

  await step('ru: search "страх смерти" still works; ua query via thesaurus on ru', async () => {
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('f:~страх смерти|n:Астма'), { waitUntil: 'networkidle0' });
    await rows();
    const first = await page.$eval('table.rep tr.row .rem a', e => e.textContent);
    if (!/Aconitum/.test(first)) throw new Error('first ' + first);
    await page.goto(BASE + '#/ru/rep?r=' + encodeURIComponent('f:~нудота вранці'), { waitUntil: 'networkidle0' });
    await rows();
  });

  await step('ua: query with ua-only words hits ua stems ("запаморочення вранці")', async () => {
    await page.goto(BASE + '#/ua/rep?r=' + encodeURIComponent('f:~запаморочення вранці'), { waitUntil: 'networkidle0' });
    await rows();
    const n = await page.$eval('#results p.muted.small', e => e.textContent);
    console.log('     ', n);
  });

  await step('theme via menu: dark, then system', async () => {
    await page.click('#menuBtn');
    await page.waitForSelector('#menu:not([hidden])');
    await page.click('#themeOpts button[data-theme="dark"]');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', { timeout: 3000 });
    const closed = await page.evaluate(() => document.querySelector('#menu').hidden);
    if (!closed) throw new Error('menu still open');
    await shot('05b-dark');
    await page.click('#menuBtn');
    await page.waitForSelector('#menu:not([hidden])');
    await page.click('#themeOpts button[data-theme=""]');
    await page.waitForFunction(() => !document.documentElement.getAttribute('data-theme'), { timeout: 3000 });
    // Escape closes, outside click closes
    await page.click('#menuBtn'); await page.waitForSelector('#menu:not([hidden])');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#menu').hidden, { timeout: 3000 });
    await page.click('#menuBtn'); await page.waitForSelector('#menu:not([hidden])');
    await page.click('#repInput');
    await page.waitForFunction(() => document.querySelector('#menu').hidden, { timeout: 3000 });
  });

  await step('mobile ua + menu', async () => {
    await page.setViewport({ width: 390, height: 800, isMobile: true });
    await page.goto('about:blank');
    await page.goto(BASE + 'index.html#/ua/rep?r=' + encodeURIComponent('f:~страх смерті|n:Астма'), { waitUntil: 'networkidle0' });
    await rows();
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > 395) throw new Error('overflow ' + w);
    await page.click('#menuBtn');
    await page.waitForSelector('#menu:not([hidden])');
    const box = await page.$eval('#menu', e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: window.innerWidth }; });
    if (box.l < 0 || box.r > box.w) throw new Error('menu off-screen ' + JSON.stringify(box));
    await shot('06-mobile-ua-menu');
  });

  console.log('console errors:', errors.length ? errors : 'none');
  console.log('failed requests:', failed.length ? failed : 'none');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
