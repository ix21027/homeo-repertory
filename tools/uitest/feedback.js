/*
 * feedback.js — сценарії дрібних покращень інтерфейсу в headless-браузері: пункт меню
 * «Повідомити про помилку» (посилання на issues з адресою сторінки й виділеним текстом),
 * розмір шрифту (меню «Шрифт», localStorage, переживає перезавантаження), клавіша «/»
 * (фокус у поле пошуку й фільтра), вкладені підказки (дочірні рубрики після батьківської).
 * Запуск: node tools/uitest/feedback.js (сайт має бути піднятий — див. run.sh).
 * Змінні середовища: BASE, CHROME, SHOTS, PUPPETEER (див. README.md у цій теці).
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || '/home/ubuntu/node_modules/puppeteer');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/homeo-repertory/';
const CHROME = process.env.CHROME || '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const OUT = path.join(process.env.SHOTS || path.join(__dirname, 'shots'), 'feedback');
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
  // завжди свіже відкриття: перехід за хешем не перезавантажує сторінку, тож меню могло
  // лишитись відкритим з попереднього кроку, а посилання оновлюється саме на відкритті
  const openMenu = async () => {
    if (!(await page.$eval('#menu', e => e.hidden))) {
      await page.click('#menuBtn');
      await page.waitForFunction(() => document.querySelector('#menu').hidden, { timeout: 3000 });
    }
    await page.click('#menuBtn');
    await page.waitForSelector('#menu:not([hidden])');
  };
  const fbHref = () => page.$eval('#feedbackLink', e => e.getAttribute('href'));
  // текст першого <span> рядка підказки без лічильника «+N»
  const suggItems = () => page.$$eval('#repSugg li', ls => ls.map(l => ({
    t: (l.querySelector('span') ? l.querySelector('span').textContent : '').replace(/\s*\+\d+\s*$/, '').trim(),
    cls: l.className,
  })));

  await step('меню: пункт «Повідомити про помилку» веде на issues/new з адресою сторінки', async () => {
    await page.goto(BASE + '#/ua/rep', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#repInput');
    const title = await page.$eval('#menuFeedbackTitle', e => e.textContent);
    if (!/Зв.язок/.test(title)) throw new Error('заголовок секції: ' + title);
    await openMenu();
    const href = await fbHref();
    if (!/^https:\/\/github\.com\/ix21027\/homeo-repertory\/issues\/new\?/.test(href)) throw new Error(href);
    if (!href.includes(encodeURIComponent('#/ua/rep'))) throw new Error('немає закодованого хеша: ' + href);
    const attrs = await page.$eval('#feedbackLink', e => e.target + '|' + e.rel + '|' + e.textContent);
    if (attrs !== '_blank|noopener|Повідомити про помилку') throw new Error('атрибути: ' + attrs);
    const body = decodeURIComponent((href.split('&body=')[1] || '').replace(/\+/g, ' '));
    if (!/Мова: ua/.test(body)) throw new Error('немає мови: ' + body);
    if (!/Збірка: \d{4}-\d{2}-\d{2}/.test(body)) throw new Error('немає дати збірки: ' + body);
    if (!/Що не так:/.test(body)) throw new Error('немає порожнього рядка «Що не так»: ' + body);
    await shot('01-menu-feedback');
  });

  await step('меню: виділений текст потрапляє в посилання (клік по меню його знімає)', async () => {
    await page.goto(BASE + '#/ru/rep', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#picker summary');
    const sel = await page.evaluate(() => {
      const el = document.querySelector('#picker summary');
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
      return (s.rangeCount ? s.getRangeAt(0).toString() : String(s)).trim();
    });
    if (!sel) throw new Error('нічого не виділилось');
    await wait(100);
    await openMenu();
    const href = await fbHref();
    if (!href.includes(encodeURIComponent(sel))) throw new Error('виділення не в посиланні: ' + href);
    if (!href.includes(encodeURIComponent('#/ru/rep'))) throw new Error('немає хеша ru-сторінки: ' + href);
    const body = decodeURIComponent((href.split('&body=')[1] || '').replace(/\+/g, ' '));
    if (!/Выделенный текст/.test(body)) throw new Error('ru-підпис виділення: ' + body);
  });

  await step('шрифт: «Більший» збільшує базовий розмір, зберігається й переживає перезавантаження', async () => {
    await page.goto(BASE + '#/ua/rep', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#repInput');
    await openMenu();
    const opts = await page.$$eval('#fontOpts button', b => b.map(x => x.dataset.font + ':' + x.textContent));
    if (opts.join('|') !== 's:Менший|:Звичайний|l:Більший') throw new Error('варіанти: ' + opts.join('|'));
    const before = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    await page.click('#fontOpts button[data-font="l"]');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-font') === 'l', { timeout: 3000 });
    await page.waitForFunction(() => document.querySelector('#menu').hidden, { timeout: 3000 });
    const after = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    if (!(after > before)) throw new Error(`розмір ${before} → ${after}`);
    const bodyFs = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    if (Math.abs(bodyFs - after) > 0.5) throw new Error('body не масштабується: ' + bodyFs + ' проти ' + after);
    const saved = await page.evaluate(() => localStorage.getItem('font'));
    if (saved !== 'l') throw new Error('localStorage font=' + saved);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#repInput');
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-font'));
    const after2 = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    if (attr !== 'l' || after2 !== after) throw new Error('після перезавантаження: ' + attr + ' ' + after2);
    await openMenu();
    const active = await page.$eval('#fontOpts button.active', e => e.dataset.font);
    if (active !== 'l') throw new Error('активна кнопка: ' + active);
    await shot('02-font-large');
    await page.click('#fontOpts button[data-font="s"]');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-font') === 's', { timeout: 3000 });
    const small = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    if (!(small < before)) throw new Error(`менший: ${small} проти ${before}`);
    await openMenu();
    await page.click('#fontOpts button[data-font=""]');
    await page.waitForFunction(() => !document.documentElement.getAttribute('data-font'), { timeout: 3000 });
    const back = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    if (back !== before) throw new Error('повернення до звичайного: ' + back);
    const cleared = await page.evaluate(() => localStorage.getItem('font'));
    if (cleared !== null) throw new Error('localStorage font=' + cleared);
  });

  await step('клавіша «/» фокусує поле пошуку й поле фільтра, у полі — не перехоплюється', async () => {
    await page.goto(BASE + '#/ua/rep', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#repInput');
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press('/');
    const id = await page.evaluate(() => document.activeElement.id);
    if (id !== 'repInput') throw new Error('фокус на ' + id);
    const v = await page.$eval('#repInput', e => e.value);
    if (v !== '') throw new Error('«/» потрапила в поле: ' + JSON.stringify(v));
    await page.keyboard.press('/');
    const v2 = await page.$eval('#repInput', e => e.value);
    if (v2 !== '/') throw new Error('у полі «/» має вводитись: ' + JSON.stringify(v2));
    await page.keyboard.press('Backspace');
    await page.goto(BASE + '#/ua/remedies', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#remFilter');
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press('/');
    const id2 = await page.evaluate(() => document.activeElement.id);
    if (id2 !== 'remFilter') throw new Error('фокус на ' + id2);
  });

  await step('підказки: дочірні рубрики йдуть одразу після батьківської з класом .sub (ru «головная боль»)', async () => {
    await page.goto(BASE + '#/ru/rep', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#repInput');
    await page.type('#repInput', 'головная боль');
    await page.waitForFunction(() => document.querySelectorAll('#repSugg li').length > 3, { timeout: 10000 });
    await wait(200);
    const items = await suggItems();
    const at = t => items.findIndex(x => x.t === t && !/free/.test(x.cls));
    const parent = at('Головная боль');
    const kid = at('Головная боль у школьников');
    const grand = at('Головная боль, в том числе у школьников');
    if (parent < 0 || kid < 0 || grand < 0) throw new Error('підказки: ' + items.map(x => x.t + '[' + x.cls + ']').join(' | '));
    if (/\bsub\b/.test(items[parent].cls)) throw new Error('батьківська рубрика з відступом');
    if (!/\bsub\b/.test(items[kid].cls) || kid !== parent + 1) throw new Error(`дочірня: ${kid} проти батька ${parent}, клас «${items[kid].cls}»`);
    if (!/\bsub2\b/.test(items[grand].cls) || grand !== kid + 1) throw new Error(`онучна: ${grand} проти ${kid}, клас «${items[grand].cls}»`);
    const pad = await page.$$eval('#repSugg li', ls => ls.map(l => parseFloat(getComputedStyle(l).paddingLeft)));
    if (!(pad[grand] > pad[kid] && pad[kid] > pad[parent])) throw new Error('відступи: ' + pad.join(','));
    await shot('03-sugg-nested');
    const lis = await page.$$('#repSugg li');
    await lis[kid].click();
    await page.waitForFunction(() => document.querySelectorAll('.chip').length === 1, { timeout: 5000 });
    const chip = await page.$eval('.chip', e => e.textContent);
    if (!/Головная боль у школьников/.test(chip)) throw new Error('додалась не та рубрика: ' + chip);
  });

  await step('підказки: те саме українською («головний біль»)', async () => {
    await page.goto(BASE + '#/ua/rep', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#repInput');
    await page.type('#repInput', 'головний біль');
    await page.waitForFunction(() => document.querySelectorAll('#repSugg li').length > 3, { timeout: 10000 });
    await wait(200);
    const items = await suggItems();
    const at = t => items.findIndex(x => x.t === t && !/free/.test(x.cls));
    const parent = at('Головний біль');
    const kid = at('Головний біль у школярів');
    if (parent < 0 || kid < 0) throw new Error('підказки: ' + items.map(x => x.t + '[' + x.cls + ']').join(' | '));
    if (!/\bsub\b/.test(items[kid].cls) || kid !== parent + 1) throw new Error(`дочірня: ${kid} проти батька ${parent}, клас «${items[kid].cls}»`);
  });

  console.log('console errors:', errors.length ? errors : 'none');
  console.log('failed requests:', failed.length ? failed : 'none');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
