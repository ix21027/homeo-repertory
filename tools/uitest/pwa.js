/*
 * pwa.js — офлайн-режим у headless-браузері: реєстрація service worker, маніфест та іконки,
 * робота без мережі (відвідане і збережене), кнопки «Зберегти довідник для офлайну» / «Видалити».
 * Запуск: node tools/uitest/pwa.js (сайт має бути піднятий — див. run.sh).
 * Змінні середовища: BASE, CHROME, SHOTS, PUPPETEER (див. README.md у цій теці).
 *
 * Важливо: page.setOfflineMode() гасить мережу лише сторінці, а запити йдуть через воркер —
 * це окрема ціль DevTools. Тому режим вимкненої мережі ставимо і воркерові, а перед кожною
 * офлайн-перевіркою переконуємось, що незакешована адреса справді НЕ вантажиться: інакше
 * тест «працює офлайн» проходив би на живій мережі.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || '/home/ubuntu/node_modules/puppeteer');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/homeo-repertory/';
const CHROME = process.env.CHROME || '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const OUT = path.join(process.env.SHOTS || path.join(__dirname, 'shots'), 'pwa');
const ROOT = path.resolve(__dirname, '..', '..');
fs.mkdirSync(OUT, { recursive: true });

const VISITED = 'aconitum-napellus';   // цю сторінку відкриваємо до офлайну
const UNVISITED = 'zincum-metallicum'; // цю — ні: до збереження має бути недоступна, після — доступна

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

  // --- мережа: гасимо і сторінці, і воркерові (сесію тримаємо відкритою — від'єднання скидає емуляцію)
  let swSession = null;
  const swCdp = async () => {
    if (swSession && !swSession.detached) return swSession;
    const t = browser.targets().find(x => x.type() === 'service_worker' && x.url().indexOf('sw.js') > 0);
    if (!t) return null;
    swSession = await t.createCDPSession();
    await swSession.send('Network.enable');
    return swSession;
  };
  const setOffline = async on => {
    await page.setOfflineMode(on);
    try {
      const s = await swCdp();
      if (s) await s.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    } catch (e) { swSession = null; }
  };
  // Контроль офлайну з двох боків: закешоване має віддаватись (інакше емуляція ріже запити
  // ще до воркера і «працює офлайн» нічого не доводить), незакешоване — провалюватись
  // (інакше воркер ходить у живу мережу і тест проходить намарно).
  const assertReallyOffline = async url => {
    const ok = await page.evaluate(() => fetch('style.css').then(r => r.ok).catch(() => false));
    if (!ok) throw new Error('офлайн ріже й кеш: style.css не віддається з прекешу');
    const r = await page.evaluate(u => fetch(u).then(x => 'status ' + x.status).catch(() => 'ERR'), url);
    if (r !== 'ERR') throw new Error('мережа жива попри офлайн: ' + url + ' → ' + r);
  };
  const swReady = () => page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(r => (r.active ? r.active.state : 'no-active') + ' ' + r.scope),
    new Promise(res => setTimeout(() => res('TIMEOUT'), 20000)),
  ]));
  const cacheKeys = name => page.evaluate(n => caches.open(n).then(c => c.keys()).then(k => k.map(r => r.url)), name);
  // Переходи хешем не перезавантажують документ, тож меню лишається відкритим з минулого кроку.
  const openMenu = async () => {
    if (await page.$eval('#menu', e => e.hidden)) await page.click('#menuBtn');
    await page.waitForSelector('#menu:not([hidden])');
  };

  await step('SW реєструється, маніфест та іконки віддаються', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#repInput');
    const ready = await swReady();
    if (!/^activated /.test(ready)) throw new Error('serviceWorker.ready → ' + ready);
    if (ready.indexOf(BASE) < 0) throw new Error('чужа область дії: ' + ready);
    const urls = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png'];
    const codes = await page.evaluate(us => Promise.all(us.map(u => fetch(u).then(r => r.status).catch(() => 0))), urls);
    const bad = urls.filter((u, i) => codes[i] !== 200);
    if (bad.length) throw new Error('не 200: ' + bad.join(', '));
    const man = await page.evaluate(() => fetch('manifest.webmanifest').then(r => r.json()));
    if (man.start_url !== './' || man.scope !== './') throw new Error('start_url/scope не відносні');
    if (man.display !== 'standalone') throw new Error('display ' + man.display);
    if (!man.icons.some(i => i.purpose === 'maskable')) throw new Error('немає maskable-іконки');
    if (!(await page.$('link[rel="manifest"]'))) throw new Error('немає <link rel=manifest>');
    if (!(await page.$('link[rel="apple-touch-icon"]'))) throw new Error('немає apple-touch-icon');
  });

  await step('оболонка прекешована, ім’я runtime-кешу однакове в sw.js і app.js', async () => {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const a = (sw.match(/const RUNTIME = '([^']+)'/) || [])[1];
    const b = (app.match(/const CACHE_RUNTIME = '([^']+)'/) || [])[1];
    if (!a || !b) throw new Error('не знайдено константи кешу: sw=' + a + ' app=' + b);
    if (a !== b) throw new Error('імена кешів розійшлись: ' + a + ' ≠ ' + b);
    const names = await page.evaluate(() => caches.keys());
    const shell = names.filter(n => /^homeo-shell-/.test(n));
    if (!shell.length) throw new Error('немає shell-кешу: ' + names.join(', '));
    const keys = await cacheKeys(shell[0]);
    for (const f of ['index.html', 'app.js', 'repertory.js', 'search-core.js', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png']) {
      if (!keys.some(k => k.endsWith('/' + f))) throw new Error('оболонка без ' + f);
    }
    if (!keys.some(k => k === BASE)) throw new Error('оболонка без кореневої адреси ' + BASE);
  });

  await step('офлайн: оболонка і відвідана сторінка препарату працюють', async () => {
    // Друге завантаження — уже під керуванням воркера (перше проходить повз нього).
    await page.goto(BASE + '#/ua/remedy/' + VISITED, { waitUntil: 'networkidle0' });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc h2');
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) throw new Error('воркер не керує сторінкою');
    await setOffline(true);
    await assertReallyOffline('data/ua/remedies/' + UNVISITED + '.json');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.doc h2', { timeout: 20000 });
    const h1 = await page.$eval('.doc-head h1', e => e.textContent);
    if (!/Aconitum/.test(h1)) throw new Error('заголовок ' + h1);
    const toc = await page.$$eval('.toc a', a => a.length);
    if (toc < 5) throw new Error('розділів у змісті ' + toc);
    await shot('01-offline-visited-remedy');
  });

  await step('офлайн до збереження: невідвідана сторінка недоступна (контроль)', async () => {
    await page.goto(BASE + '#/ua/remedy/' + UNVISITED, { waitUntil: 'load' });
    await page.waitForFunction(() => !!document.querySelector('#view .error') || !!document.querySelector('.doc h2'), { timeout: 20000 });
    if (await page.$('.doc h2')) throw new Error('сторінка відкрилась без мережі й без збереження');
  });

  await step('кнопка «Зберегти довідник для офлайну» проходить до кінця', async () => {
    await setOffline(false);
    await page.goto(BASE + '#/ua/rep', { waitUntil: 'networkidle0' });
    await swReady();
    await openMenu();
    const label = await page.$eval('#offSave', e => e.textContent);
    if (!/Зберегти довідник для офлайну \(≈\d+,\d+ МБ\)/.test(label)) throw new Error('підпис кнопки: ' + label);
    await shot('02-menu-offline');
    await page.click('#offSave');
    // Меню має лишатись розгорнутим: інакше користувач не бачить ані поступу, ані підсумку.
    if (await page.$eval('#menu', e => e.hidden)) throw new Error('меню згорнулось одразу після натискання');
    let seenProgress = null;
    const t0 = Date.now();
    for (;;) {
      const txt = await page.$eval('#offState', e => e.textContent).catch(() => '');
      if (/^\d+\/\d+$/.test(txt)) seenProgress = txt;
      if (/^Збережено \(UA\)/.test(txt)) break;
      if (Date.now() - t0 > 240000) throw new Error('не завершилось за 240 с, стан: ' + txt);
      await wait(120);
    }
    const txt = await page.$eval('#offState', e => e.textContent);
    const m = txt.match(/^Збережено \(UA\): (\d+) файл\S*, ([\d,]+) МБ, \d\d\.\d\d\.\d{4}$/);
    if (!m) throw new Error('підсумок: ' + txt);
    const files = +m[1];
    if (files < 480) throw new Error('файлів збережено ' + files);
    if (await page.$eval('#menu', e => e.hidden)) throw new Error('меню згорнулось до кінця збереження');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('offline') || 'null'));
    if (!saved || !saved.ua || saved.ua.files !== files) throw new Error('стан у localStorage: ' + JSON.stringify(saved));
    if (saved.ua.bytes < 10e6) throw new Error('обсяг ' + saved.ua.bytes);
    console.log('     збережено:', txt, '| проміжний поступ:', seenProgress || 'не спіймано (швидко)');
    await shot('03-menu-saved');
  });

  await step('офлайн після збереження: невідвідана сторінка і пошук у реперторії', async () => {
    await setOffline(true);
    await assertReallyOffline('data/ru/remedies/' + UNVISITED + '.json'); // збережено лише UA
    await page.goto(BASE + '#/ua/remedy/' + UNVISITED, { waitUntil: 'load' });
    await page.waitForSelector('.doc h2', { timeout: 20000 });
    const h1 = await page.$eval('.doc-head h1', e => e.textContent);
    if (!/Zincum/.test(h1)) throw new Error('заголовок ' + h1);
    await shot('04-offline-unvisited-remedy');
    await page.goto(BASE + '#/ua/rep', { waitUntil: 'load' });
    await page.waitForSelector('#repInput', { timeout: 20000 });
    await page.type('#repInput', 'страх смерті');
    await wait(300);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('table.rep tr.row').length > 0, { timeout: 60000 });
    const n = await page.$$eval('table.rep tr.row', r => r.length);
    if (n < 5) throw new Error('знайдено рядків ' + n);
    await shot('05-offline-search');
  });

  await step('кнопка «Видалити» спорожняє runtime-кеш і стан', async () => {
    await setOffline(false);
    await page.goto(BASE + '#/ua/rep', { waitUntil: 'networkidle0' });
    await openMenu();
    if (!(await page.$('#offDrop'))) throw new Error('немає кнопки «Видалити» при збереженому довіднику');
    await page.click('#offDrop');
    await page.waitForFunction(() => !localStorage.getItem('offline'), { timeout: 10000 });
    if (await page.$eval('#menu', e => e.hidden)) throw new Error('меню згорнулось після «Видалити»');
    const left = await cacheKeys('homeo-runtime');
    if (left.length) throw new Error('у runtime-кеші лишилось ' + left.length + ': ' + left.slice(0, 3).join(', '));
    const txt = await page.$eval('#offState', e => e.textContent);
    if (!/^Не збережено/.test(txt)) throw new Error('стан після видалення: ' + txt);
    if (await page.$('#offDrop')) throw new Error('кнопка «Видалити» лишилась');
  });

  await step('ru: секція «Офлайн» перекладена', async () => {
    await page.goto(BASE + '#/ru/rep', { waitUntil: 'networkidle0' });
    // Перехід хешем не перезавантажує документ, тож networkidle0 не чекає каталогу ru:
    // до його приходу меню ще підписане попередньою мовою. Чекаємо саме перемикання
    // (applyLangChrome ставить lang і тут же перемальовує секцію «Офлайн»).
    await page.waitForFunction(() => document.documentElement.lang === 'ru', { timeout: 30000 });
    await openMenu();
    const title = await page.$eval('#menuOfflineTitle', e => e.textContent);
    if (title !== 'Офлайн') throw new Error('заголовок секції ' + title);
    const label = await page.$eval('#offSave', e => e.textContent);
    if (!/^Сохранить справочник для офлайна/.test(label)) throw new Error('підпис кнопки ' + label);
    const stateTxt = await page.$eval('#offState', e => e.textContent);
    if (!/^Не сохранено/.test(stateTxt)) throw new Error('стан ' + stateTxt);
    // Порядок секцій меню після злиття гілок: мова · тема · шрифт · випадки · друк · офлайн · зв'язок.
    // Секцію впізнаємо за id першого елемента всередині — id самої секції є не в кожної.
    const sec = await page.$$eval('#menu .menu-section', s => s.map(x => (x.firstElementChild || {}).id || '?'));
    const want = ['menuLangTitle', 'menuThemeTitle', 'menuFontTitle', 'menuCasesTitle', 'printBtn', 'menuOfflineTitle', 'menuFeedbackTitle'];
    if (sec.join(' ') !== want.join(' ')) throw new Error('порядок секцій меню: ' + sec.join(', '));
  });

  console.log('console errors:', errors.length ? errors : 'none');
  console.log('failed requests:', failed.length ? failed : 'none');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
