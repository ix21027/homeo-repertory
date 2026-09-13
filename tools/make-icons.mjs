#!/usr/bin/env node
/*
 * make-icons.mjs — PNG-іконки застосунку з тієї самої фігури, що й SVG-фавіконка в index.html
 * (коло кольору теми з літерою R). PIL/ImageMagick тут немає, тож малюємо в headless-Chromium.
 *
 *   icons/icon-192.png, icons/icon-512.png                   — purpose "any": коло на прозорому тлі
 *   icons/icon-maskable-192.png, icons/icon-maskable-512.png — purpose "maskable": суцільний квадрат,
 *       літера вкладається у безпечну зону 80 %, бо систем­на маска зрізає краї
 *
 *   node tools/make-icons.mjs
 *
 * Змінні середовища CHROME і PUPPETEER — ті самі, що в tools/uitest (див. tools/uitest/README.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER || '/home/ubuntu/node_modules/puppeteer');
const CHROME = process.env.CHROME || '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'icons');
const BG = '#1d4d3f';

// Коло як у фавіконці: радіус 15 із 32 (94 % полотна).
const round = `<circle cx="256" cy="256" r="240" fill="${BG}"/>` +
  `<text x="256" y="352" font-size="272" font-family="Georgia,'Times New Roman',serif" text-anchor="middle" fill="#fff">R</text>`;
// Маскована: тло на весь квадрат, літера менша — вона має вміститись у коло діаметром 80 %.
const masked = `<rect width="512" height="512" fill="${BG}"/>` +
  `<text x="256" y="344" font-size="232" font-family="Georgia,'Times New Roman',serif" text-anchor="middle" fill="#fff">R</text>`;

const page512 = shape => '<style>html,body{margin:0;padding:0;background:transparent}</style>' +
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${shape}</svg>`;

const browser = await puppeteer.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
fs.mkdirSync(OUT, { recursive: true });
for (const [name, shape] of [['icon', round], ['icon-maskable', masked]]) {
  for (const size of [192, 512]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(page512(shape).replace('width="512" height="512"', `width="${size}" height="${size}"`), { waitUntil: 'load' });
    const file = path.join(OUT, `${name}-${size}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: size, height: size }, omitBackground: true });
    console.log(file, fs.statSync(file).size, 'B');
  }
}
await browser.close();
