/*
 * sw.js — офлайн-режим. Область дії = тека, з якої відданий цей файл (сайт живе в підтеці
 * GitHub Pages, тому всі шляхи відносні).
 *
 * Стратегія — network-first для всіх same-origin GET:
 *   є мережа   → віддаємо свіжу відповідь і кладемо її в runtime-кеш (онлайн ніхто ніколи
 *                не бачить застарілих app.js чи data/, оновлення сайту доходить одразу);
 *   немає      → беремо з кешу; для навігацій — оболонку index.html (маршрути хешеві, тож
 *                одна оболонка обслуговує всі сторінки).
 *
 * Кешів два:
 *   SHELL   — оболонка, перекешується при install і version-ується: стара версія видаляється;
 *   RUNTIME — усе відвідане плюс збережений вручну довідник (кнопка «Зберегти» в меню).
 *             Ім'я БЕЗ версії навмисне: підняття версії sw.js не має стирати 16 МБ,
 *             які користувач свідомо зберіг. Дані й так освіжаються network-first.
 *
 * RUNTIME-ім'я продубльоване в app.js (константа CACHE_RUNTIME) — кнопка «Зберегти» пише
 * в кеш напряму через Cache API. Збіг імен перевіряє tools/uitest/pwa.js.
 */
const VERSION = '2026-09-13a';
const SHELL = 'homeo-shell-' + VERSION;
const RUNTIME = 'homeo-runtime';
const KEEP = [SHELL, RUNTIME];

// Оболонка: усе, без чого сторінка не намалюється. Дані (data/) сюди не входять — вони
// потрапляють у RUNTIME при відвідуванні або через кнопку «Зберегти».
const SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './repertory.js',
  './search-core.js',
  './style.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(names => Promise.all(names.filter(n => n.startsWith('homeo-') && !KEEP.includes(n)).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

// Кешувати можна лише свої успішні відповіді: 404 і 206 зроблять кеш отруєним,
// непрозорі (opaque) відповіді чужих доменів не мають ані статусу, ані вмісту.
function cacheable(res) {
  return res && res.status === 200 && res.type === 'basic';
}

// Порядок пошуку: спершу RUNTIME — там найсвіжіше з мережі; прекеш оболонки лише запасний,
// бо перезбирається тільки з підйомом VERSION і може відставати від сайту. (caches.match()
// шукає в порядку створення кешів, тобто сам по собі віддав би саме застарілу оболонку.)
async function fromCache(request) {
  const rt = await caches.open(RUNTIME);
  return (await rt.match(request)) || (await caches.match(request));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        if (cacheable(res)) {
          const copy = res.clone();
          caches.open(RUNTIME).then(c => c.put(req, copy)).catch(() => { /* квота — не привід валити відповідь */ });
        }
        return res;
      })
      .catch(async () => await fromCache(req)
        // Маршрути хешеві, тож будь-яка навігація без мережі обслуговується оболонкою.
        || (req.mode === 'navigate' ? await fromCache('./index.html') : null)
        || Response.error())
  );
});
