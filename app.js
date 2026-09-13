/* app.js — інтерфейс реперторію (без залежностей; хеш-маршрутизація #/<lang>/… для GitHub Pages) */
(function () {
  'use strict';
  const R = window.Repertory, SC = window.SearchCore;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const LANGS = ['ua', 'ru'];

  const SECTIONS = {
    ru: ['Психика', 'Голова', 'Головокружение', 'Глаза', 'Уши', 'Нос', 'Лицо', 'Рот', 'Зубы', 'Горло', 'Аппетит', 'Желудок', 'Живот',
      'Анус и прямая кишка', 'Мочевыделительная система', 'Мужские', 'Женские', 'Менструация', 'Беременность. Роды', 'Молочные железы', 'Дыхательная система',
      'Кашель', 'Грудная клетка', 'Сердце и кровообращение', 'Шея', 'Спина', 'Конечности', 'Суставы', 'Мышцы', 'Кости', 'Нервная система', 'Сон', 'Лихорадка',
      'Пот', 'Кожа', 'Общие симптомы', 'Модальности', 'Этиология', 'Характеристика', 'Тип', 'Клиника', 'Взаимосвязи'],
    ua: ['Психіка', 'Голова', 'Запаморочення', 'Очі', 'Вуха', 'Ніс', 'Обличчя', 'Рот', 'Зуби', 'Горло', 'Апетит', 'Шлунок', 'Живіт',
      'Анус і пряма кишка', 'Сечовидільна система', 'Чоловічі', 'Жіночі', 'Менструація', 'Вагітність. Пологи', 'Молочні залози', 'Дихальна система',
      'Кашель', 'Грудна клітка', 'Серце і кровообіг', 'Шия', 'Спина', 'Кінцівки', 'Суглоби', 'М’язи', 'Кістки', 'Нервова система', 'Сон', 'Гарячка',
      'Піт', 'Шкіра', 'Загальні симптоми', 'Модальності', 'Етіологія', 'Характеристика', 'Тип', 'Клініка', 'Взаємозв’язки'],
  };
  const CLINIC = { ru: 'Клиника', ua: 'Клініка' };
  const TOPIC_ORDER = ['resp', 'digest', 'heart', 'mind', 'skin', 'joints', 'urogen', 'pregnancy', 'children', 'cfs', 'other', 'bach', 'about'];
  const TOPIC = {
    ua: { pregnancy: 'Вагітність, пологи, годування', children: 'Немовлята й діти', heart: 'Серце і судини', resp: 'Дихання, горло, ніс, вуха', digest: 'Травлення',
      skin: 'Шкіра, волосся, нігті', mind: 'Психіка, сон, нервова система', cfs: 'Синдром хронічної втоми', joints: 'Суглоби, м’язи, травми', urogen: 'Сечостатева сфера',
      other: 'Різне', bach: 'Квіткові настої д-ра Баха', about: 'Про гомеопатію' },
    ru: { pregnancy: 'Беременность, роды, кормление', children: 'Младенцы и дети', heart: 'Сердце и сосуды', resp: 'Дыхание, горло, нос, уши', digest: 'Пищеварение',
      skin: 'Кожа, волосы, ногти', mind: 'Психика, сон, нервная система', cfs: 'Синдром хронической усталости', joints: 'Суставы, мышцы, травмы', urogen: 'Мочеполовая сфера',
      other: 'Разное', bach: 'Цветочные настои д-ра Бака', about: 'О гомеопатии' },
  };
  const I18N = {
    ua: {
      title: 'Реперторій — гомеопатичні препарати за симптомами', htmlLang: 'uk',
      navRep: 'Симптоми', navRemedies: 'Препарати', navArticles: 'Статті', quick: 'Назва препарату', theme: 'Тема',
      kind: { free: 'Текст', nos: 'Клініка', art: 'Стаття', line: 'Рубрика' },
      repTitle: 'Підбір препаратів за симптомами',
      repIntro: 'Додайте один або кілька симптомів чи хвороб. Підказки пропонують рубрики з розділу «Клініка» Materia Medica Кларка та зі статей лікувальника; можна шукати і будь-який текст. У таблиці препарати впорядковано за кількістю покритих рубрик.',
      repPlaceholder: 'Симптом, хвороба або рубрика…', allSections: 'Усі розділи', add: 'Додати', freeSearch: 'Шукати в текстах', freeKind: 'повнотекстово',
      examples: 'Приклади:', exampleList: [['страх смерті', 'f:~страх смерті'], ['Астма', 'n:Астма'], ['головний біль гірше від руху', 'f:~головний біль гірше від руху'], ['Бронхіт (стаття)', 'a:bronhit']],
      error: 'помилка', clear: 'Очистити', remove: 'Прибрати', removeRubric: 'Прибрати рубрику', loadingIndex: 'Завантаження індексу…',
      nothing: 'Нічого не знайдено. Спробуйте інше формулювання або коротше слово.', found: n => 'Знайдено препаратів: ' + n + '. Натисніть на рядок, щоб побачити підстави.',
      remedy: 'Препарат', sumTitle: 'Покрито рубрик / сума балів', hits: 'зб.', ext: 'без сторінки', more: 'Показати ще',
      evClinic: 'У розділі «Клініка» Materia Medica:', open: 'відкрити', evArt: 'Препарат описано у статті', evLine: 'Рубрика зі статті', evArticle: 'Стаття',
      evMore: n => '… та ще ' + n + ' — ', evOpenRemedy: 'переглянути препарат', noData: 'Немає даних.',
      remediesTitle: 'Препарати', remediesIntro: n => 'Materia Medica Дж. Г. Кларка — ' + n + ' препаратів. Латинська назва, транслітерація, звичайна назва.',
      filter: 'Фільтр за назвою…', nothingShort: 'Нічого не знайдено.', source: 'Джерело:', sections: 'Розділи', addRubric: 'Додати рубрику до реперторію',
      inArticles: 'Згадується у статтях', original: 'Оригінал:', noRemedy: 'Препарат не знайдено.',
      articlesTitle: 'Статті', articlesIntro: 'Домашній гомеопатичний лікувальник за хворобами (Варшавський, Кьолер, Симеонова, Петерс, Роуз, Юз та ін.), квіткові настої д-ра Баха, про гомеопатію. У кожній статті — перелік препаратів із показаннями.',
      nRemedies: n => n + ' препаратів', noArticle: 'Статтю не знайдено.', author: 'Автор:', addArticle: 'Додати статтю як рубрику до реперторію',
      notFound: 'Сторінку не знайдено.', loadFail: 'Не вдалося завантажити дані:', loading: 'Завантаження…',
      footer: 'Українська версія — автоматичний переклад російського оригіналу (Google Translate); оригінал доступний за перемикачем RU. Джерела: Дж. Г. Кларк, «Словарь практической Materia Medica» та «Домашний гомеопатический лечебник» за матеріалами сайту «Сам себе гомеопат». Довідник не замінює консультацію лікаря.',
      stats: s => 'Препаратів: ' + s.remedies + ' · статей: ' + s.articles + ' · рубрик: ' + s.rubrics + ' · абзаців у пошуковому індексі: ' + s.units + ' · дані зібрано ' + s.built + '.',
      mtNote: 'Текст перекладено автоматично з російського оригіналу.',
      menu: 'Меню', menuLang: 'Мова', menuTheme: 'Тема', themeAuto: 'Системна', themeLight: 'Світла', themeDark: 'Темна',
    },
    ru: {
      title: 'Реперторий — гомеопатические препараты по симптомам', htmlLang: 'ru',
      navRep: 'Симптомы', navRemedies: 'Препараты', navArticles: 'Статьи', quick: 'Название препарата', theme: 'Тема',
      kind: { free: 'Текст', nos: 'Клиника', art: 'Статья', line: 'Рубрика' },
      repTitle: 'Подбор препаратов по симптомам',
      repIntro: 'Добавьте один или несколько симптомов или болезней. Подсказки предлагают рубрики из раздела «Клиника» Materia Medica Кларка и из статей лечебника; можно искать и любой текст. В таблице препараты упорядочены по числу покрытых рубрик.',
      repPlaceholder: 'Симптом, болезнь или рубрика…', allSections: 'Все разделы', add: 'Добавить', freeSearch: 'Искать в текстах', freeKind: 'полнотекстово',
      examples: 'Примеры:', exampleList: [['страх смерти', 'f:~страх смерти'], ['Астма', 'n:Астма'], ['головная боль хуже от движения', 'f:~головная боль хуже от движения'], ['Бронхит (статья)', 'a:bronhit']],
      error: 'ошибка', clear: 'Очистить', remove: 'Убрать', removeRubric: 'Убрать рубрику', loadingIndex: 'Загрузка индекса…',
      nothing: 'Ничего не найдено. Попробуйте другую формулировку или более короткое слово.', found: n => 'Найдено препаратов: ' + n + '. Нажмите на строку, чтобы увидеть основания.',
      remedy: 'Препарат', sumTitle: 'Покрыто рубрик / сумма баллов', hits: 'совп.', ext: 'без страницы', more: 'Показать ещё',
      evClinic: 'В разделе «Клиника» Materia Medica:', open: 'открыть', evArt: 'Препарат описан в статье', evLine: 'Рубрика из статьи', evArticle: 'Статья',
      evMore: n => '… и ещё ' + n + ' — ', evOpenRemedy: 'открыть препарат', noData: 'Нет данных.',
      remediesTitle: 'Препараты', remediesIntro: n => 'Materia Medica Дж. Г. Кларка — ' + n + ' препаратов. Латинское название, транслитерация, обычное название.',
      filter: 'Фильтр по названию…', nothingShort: 'Ничего не найдено.', source: 'Источник:', sections: 'Разделы', addRubric: 'Добавить рубрику в реперторий',
      inArticles: 'Упоминается в статьях', original: 'Оригинал:', noRemedy: 'Препарат не найден.',
      articlesTitle: 'Статьи', articlesIntro: 'Домашний гомеопатический лечебник по болезням (Варшавский, Кёлер, Симеонова, Петерс, Роуз, Юз и др.), цветочные настои д-ра Бака, о гомеопатии. В каждой статье — перечень препаратов с показаниями.',
      nRemedies: n => n + ' препаратов', noArticle: 'Статья не найдена.', author: 'Автор:', addArticle: 'Добавить статью как рубрику в реперторий',
      notFound: 'Страница не найдена.', loadFail: 'Не удалось загрузить данные:', loading: 'Загрузка…',
      footer: 'Тексты приведены на языке оригинала: Дж. Г. Кларк, «Словарь практической Materia Medica» и «Домашний гомеопатический лечебник» по материалам сайта «Сам себе гомеопат». Справочник не заменяет консультацию врача.',
      stats: s => 'Препаратов: ' + s.remedies + ' · статей: ' + s.articles + ' · рубрик: ' + s.rubrics + ' · абзацев в поисковом индексе: ' + s.units + ' · данные собраны ' + s.built + '.',
      mtNote: '',
      menu: 'Меню', menuLang: 'Язык', menuTheme: 'Тема', themeAuto: 'Системная', themeLight: 'Светлая', themeDark: 'Тёмная',
    },
  };

  const state = { lang: 'ua', cat: {}, idx: {}, idxPromise: {}, docs: new Map(), linker: {}, rubrics: [], shown: 60, open: new Set(), langsAvailable: null };
  const T = () => I18N[state.lang];
  const cat = () => state.cat[state.lang];

  // ---------------------------------------------------------------- утиліти
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  async function fetchJson(rel) {
    const res = await fetch(rel);
    if (!res.ok) throw new Error(rel + ': ' + res.status);
    return res.json();
  }
  function href(path) { return '#/' + state.lang + '/' + path; }
  function getDoc(kind, id) {
    const key = state.lang + '/' + kind + '/' + id;
    if (!state.docs.has(key)) state.docs.set(key, fetchJson('data/' + state.lang + '/' + kind + '/' + encodeURIComponent(id) + '.json'));
    return state.docs.get(key);
  }
  function loadIndex() {
    const l = state.lang;
    if (!state.idxPromise[l]) state.idxPromise[l] = fetchJson('data/' + l + '/index.json').then(j => { state.idx[l] = R.makeIndex(j); return state.idx[l]; });
    return state.idxPromise[l];
  }
  async function loadCatalog(lang) {
    if (!state.cat[lang]) state.cat[lang] = await fetchJson('data/' + lang + '/catalog.json');
    return state.cat[lang];
  }
  function remedyLink(i, cls) {
    const r = cat().remedies[i];
    if (r.ext) return '<span class="' + (cls || '') + '">' + esc(r.latin) + ' <span class="ext">' + T().ext + '</span></span>';
    return '<a class="' + (cls || '') + '" href="' + href('remedy/' + encodeURIComponent(r.id)) + '">' + esc(r.latin) + '</a>';
  }

  // ---------------------------------------------------------------- тема
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
    try { if (t) localStorage.setItem('theme', t); else localStorage.removeItem('theme'); } catch (e) { /* ignore */ }
    document.querySelectorAll('#themeOpts button').forEach(b => { const on = (b.dataset.theme || '') === (t || ''); b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }
  function initTheme() {
    let t = null;
    try { t = localStorage.getItem('theme'); } catch (e) { /* ignore */ }
    if (t) applyTheme(t);
  }
  function renderThemeOptions() {
    const t = T();
    let cur = null;
    try { cur = localStorage.getItem('theme'); } catch (e) { /* ignore */ }
    $('#themeOpts').innerHTML = [['', t.themeAuto], ['light', t.themeLight], ['dark', t.themeDark]]
      .map(([v, l]) => '<button type="button" data-theme="' + v + '" class="' + ((cur || '') === v ? 'active' : '') + '" aria-pressed="' + ((cur || '') === v) + '">' + esc(l) + '</button>').join('');
    $('#themeOpts').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { applyTheme(b.dataset.theme || null); closeMenu(); }));
  }

  // ---------------------------------------------------------------- меню
  function openMenu() { $('#menu').hidden = false; $('#menuBtn').setAttribute('aria-expanded', 'true'); }
  function closeMenu() { $('#menu').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); }
  function initMenu() {
    $('#menuBtn').addEventListener('click', e => { e.stopPropagation(); if ($('#menu').hidden) openMenu(); else closeMenu(); });
    document.addEventListener('click', e => { if (!e.target.closest('#menuWrap')) closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  }

  // ---------------------------------------------------------------- мова
  function applyLangChrome() {
    const t = T();
    document.documentElement.lang = t.htmlLang;
    document.title = t.title;
    $('#nav a[data-route="rep"]').textContent = t.navRep;
    $('#nav a[data-route="remedies"]').textContent = t.navRemedies;
    $('#nav a[data-route="articles"]').textContent = t.navArticles;
    $('#nav a[data-route="rep"]').setAttribute('href', href('rep'));
    $('#nav a[data-route="remedies"]').setAttribute('href', href('remedies'));
    $('#nav a[data-route="articles"]').setAttribute('href', href('articles'));
    $('.brand').setAttribute('href', href('rep'));
    $('#quickInput').placeholder = t.quick;
    $('#quickInput').setAttribute('aria-label', t.quick);
    $('#menuBtn').setAttribute('aria-label', t.menu);
    $('#menuBtn').setAttribute('title', t.menu);
    $('#menuLangTitle').textContent = t.menuLang;
    $('#menuThemeTitle').textContent = t.menuTheme;
    renderThemeOptions();
    $('#footText').textContent = t.footer;
    const s = cat() && cat().stats;
    $('#footStats').textContent = s ? t.stats(Object.assign({ built: cat().built }, s)) : '';
    document.querySelectorAll('#langBtns button').forEach(b => { b.classList.toggle('active', b.dataset.lang === state.lang); b.setAttribute('aria-pressed', b.dataset.lang === state.lang ? 'true' : 'false'); });
  }
  function switchLang(lang) {
    if (lang === state.lang || !LANGS.includes(lang)) return;
    const { seg, params } = parseHash();
    let path = seg.slice(1).map(encodeURIComponent).join('/') || 'rep';
    if (seg[1] === 'rep' || seg.length === 1) {
      const specs = state.rubrics.map(rb => {
        if (rb.kind === 'free' || rb.kind === 'art') return rubricSpec(rb);
        const x = cat().rubrics[rb.catIdx].x;
        return x ? (rb.kind === 'nos' ? 'n:' : 'l:') + x : null;
      }).filter(Boolean);
      path = 'rep' + (specs.length ? '?r=' + encodeURIComponent(specs.join('|')) : '');
    } else {
      const q = params.toString();
      if (q && !params.has('hl') && !params.has('sec')) path += '?' + q;
    }
    try { localStorage.setItem('lang', lang); } catch (e) { /* ignore */ }
    state.rubrics = [];
    closeMenu();
    location.hash = '#/' + lang + '/' + path;
  }

  // ---------------------------------------------------------------- розмітка тексту
  function linker() {
    const l = state.lang;
    if (state.linker[l]) return state.linker[l];
    const names = [];
    const map = new Map();
    const first = new Map();
    cat().remedies.forEach((r, i) => {
      if (r.ext) return;
      for (const n of [r.latin, r.alt]) {
        if (!n) continue;
        map.set(n, i); names.push(n);
        const fw = n.split(' ')[0];
        if (!first.has(fw)) first.set(fw, new Set());
        first.get(fw).add(i);
      }
    });
    for (const [fw, set] of first) if (set.size === 1 && !map.has(fw) && fw.length > 3) { map.set(fw, Array.from(set)[0]); names.push(fw); }
    names.sort((a, b) => b.length - a.length);
    const re = new RegExp('(^|[^A-Za-z>/])(' + names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![A-Za-z])', 'g');
    state.linker[l] = { map, re };
    return state.linker[l];
  }
  function linkNames(html, selfIdx) {
    const { map, re } = linker();
    return html.replace(re, (m, pre, name) => {
      const i = map.get(name);
      if (i === undefined || i === selfIdx) return m;
      return pre + '<a href="' + href('remedy/' + encodeURIComponent(cat().remedies[i].id)) + '">' + name + '</a>';
    });
  }
  function highlightHtml(html, stems) {
    if (!stems || !stems.length) return html;
    const pats = stems.filter(s => s.length >= 3).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]'));
    if (!pats.length) return html;
    const re = new RegExp('(^|[^а-яёіїєґa-z])(' + pats.join('|') + ')([а-яёіїєґa-z]*)', 'gi');
    return html.split(/(<[^>]+>)/).map(part => part.startsWith('<') ? part : part.replace(re, '$1<mark>$2$3</mark>')).join('');
  }
  function snippet(md, stems) {
    if (md.length <= 420) return md;
    const plain = md.replace(/\*\*|_/g, '');
    const low = plain.toLowerCase();
    let pos = -1;
    for (const st of stems || []) { if (st.length < 3) continue; const i = low.indexOf(st); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
    if (pos < 0) return plain.slice(0, 400) + '…';
    const a = Math.max(0, pos - 160), b = Math.min(plain.length, pos + 260);
    return (a > 0 ? '…' : '') + plain.slice(a, b) + (b < plain.length ? '…' : '');
  }
  function renderPara(md, opts) {
    opts = opts || {};
    const bullet = /^- /.test(md);
    let s = esc(bullet ? md.slice(2) : md);
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    s = s.replace(/(^|[\s(«"“])_([^_]+?)_(?=[\s.,;:)»"”!?]|$)/g, '$1<i>$2</i>');
    if (opts.link !== false) s = linkNames(s, opts.selfIdx);
    if (opts.hl) s = highlightHtml(s, opts.hl);
    return '<p' + (bullet ? ' class="bullet"' : '') + '>' + (bullet ? '• ' : '') + s + '</p>';
  }

  // ---------------------------------------------------------------- маршрутизація
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const q = h.indexOf('?');
    const pathPart = q >= 0 ? h.slice(0, q) : h;
    const params = new URLSearchParams(q >= 0 ? h.slice(q + 1) : '');
    const seg = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    return { seg, params };
  }
  function setNav(route) {
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === route));
  }
  async function route() {
    let { seg, params } = parseHash();
    if (!LANGS.includes(seg[0])) {
      let saved = null;
      try { saved = localStorage.getItem('lang'); } catch (e) { /* ignore */ }
      const lang = LANGS.includes(saved) && state.langsAvailable.includes(saved) ? saved : state.langsAvailable[0];
      const rest = location.hash.replace(/^#\/?/, '');
      history.replaceState(null, '', '#/' + lang + '/' + (rest || 'rep'));
      ({ seg, params } = parseHash());
    }
    if (!state.langsAvailable.includes(seg[0])) seg[0] = state.langsAvailable[0];
    if (seg[0] !== state.lang) state.rubrics = [];
    state.lang = seg[0];
    try { localStorage.setItem('lang', state.lang); } catch (e) { /* ignore */ }
    const view = $('#view');
    try {
      if (!state.cat[state.lang]) view.innerHTML = '<p class="muted">' + T().loading + '</p>';
      await loadCatalog(state.lang);
      applyLangChrome();
      const p = seg[1];
      if (!p || p === 'rep') { setNav('rep'); await viewRepertory(view, params); }
      else if (p === 'remedies') { setNav('remedies'); viewRemedies(view, params); }
      else if (p === 'remedy' && seg[2]) { setNav('remedies'); await viewRemedy(view, seg[2], params); }
      else if (p === 'articles') { setNav('articles'); viewArticles(view); }
      else if (p === 'article' && seg[2]) { setNav('articles'); await viewArticle(view, seg[2], params); }
      else { view.innerHTML = '<p class="error">' + T().notFound + '</p>'; }
    } catch (e) {
      console.error(e);
      view.innerHTML = '<p class="error">' + T().loadFail + ' ' + esc(e.message) + '</p>';
    }
    if (!params.get('r') || seg[1] !== 'rep') window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- реперторій
  function rubricSpec(rb) {
    if (rb.kind === 'free') return 'f:' + (rb.section || '') + '~' + rb.text;
    if (rb.kind === 'nos') return 'n:' + rb.text;
    if (rb.kind === 'art') return 'a:' + rb.articleId;
    return 'l:' + rb.text;
  }
  function rubricFromSpec(spec) {
    const k = spec.slice(0, 2), body = spec.slice(2);
    const c = cat();
    if (k === 'f:') { const t = body.indexOf('~'); return makeFreeRubric(body.slice(t + 1), body.slice(0, t)); }
    if (k === 'n:') { const i = c.rubrics.findIndex(r => r.k === 'nos' && r.t === body); return i >= 0 ? makeCatRubric(i) : null; }
    if (k === 'a:') { const i = c.rubrics.findIndex(r => r.k === 'art' && c.articles[r.a].id === body); return i >= 0 ? makeCatRubric(i) : null; }
    if (k === 'l:') { const i = c.rubrics.findIndex(r => r.k === 'line' && r.t === body); return i >= 0 ? makeCatRubric(i) : null; }
    return null;
  }
  function makeCatRubric(i) {
    const rb = cat().rubrics[i];
    const r = { kind: rb.k, text: rb.t, catIdx: i, remedies: new Map(rb.r.map(x => [x, 2])), label: rb.t };
    if (rb.k === 'art' || rb.k === 'line') { r.articleIdx = rb.a; r.articleId = cat().articles[rb.a].id; }
    return r;
  }
  function makeFreeRubric(text, section) {
    text = text.trim();
    if (!text) return null;
    const lang = state.lang;
    const r = { kind: 'free', text, section: section || '', remedies: null, label: text + (section ? ' · ' + section : ''), pending: true };
    r.promise = loadIndex().then(idx => {
      r.res = R.freeText(idx, text, r.section, lang);
      r.remedies = new Map(Array.from(r.res.byRemedy, ([k, v]) => [k, v.hits]));
      r.pending = false;
      return r;
    });
    return r;
  }
  function writeHash() {
    const specs = state.rubrics.map(rubricSpec).join('|');
    const h = href('rep') + (specs ? '?r=' + encodeURIComponent(specs) : '');
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function addRubric(rb) {
    if (!rb) return;
    if (state.rubrics.some(x => rubricSpec(x) === rubricSpec(rb))) return;
    state.rubrics.push(rb);
    state.open.clear();
    writeHash();
    renderChips(); renderResults();
    if (rb.pending) rb.promise.then(() => { renderChips(); renderResults(); }).catch(err => { rb.error = err.message; rb.pending = false; renderChips(); });
  }
  function removeRubric(k) { state.rubrics.splice(k, 1); state.open.clear(); writeHash(); renderChips(); renderResults(); }

  async function viewRepertory(view, params) {
    const t = T();
    view.innerHTML = `
      <div class="home-intro">
        <h1>${esc(t.repTitle)}</h1>
        <p class="muted">${esc(t.repIntro)}</p>
      </div>
      <form class="rep-search" id="repForm" autocomplete="off">
        <div class="box">
          <input type="search" id="repInput" placeholder="${esc(t.repPlaceholder)}" aria-label="${esc(t.repPlaceholder)}">
          <ul class="dropdown" id="repSugg" hidden></ul>
        </div>
        <select id="repSection" aria-label="${esc(t.allSections)}">
          <option value="">${esc(t.allSections)}</option>
          ${SECTIONS[state.lang].map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('')}
        </select>
        <button class="btn" type="submit">${esc(t.add)}</button>
      </form>
      <div class="chips" id="chips"></div>
      <div id="results"></div>`;
    const spec = params.get('r');
    if (spec) {
      const specs = spec.split('|');
      const same = specs.length === state.rubrics.length && specs.every((s, i) => rubricSpec(state.rubrics[i]) === s);
      if (!same) {
        state.rubrics = specs.map(rubricFromSpec).filter(Boolean);
        state.open.clear();
        for (const rb of state.rubrics) if (rb.pending) rb.promise.then(() => { renderChips(); renderResults(); });
      }
    } else {
      state.rubrics = [];
    }
    renderChips(); renderResults();

    const input = $('#repInput'), sugg = $('#repSugg'), sel = $('#repSection');
    let items = [], active = -1;
    function closeSugg() { sugg.hidden = true; sugg.innerHTML = ''; items = []; active = -1; }
    function openSugg() {
      const q = input.value.trim();
      if (q.length < 2) { closeSugg(); return; }
      const found = R.suggest(cat(), q, 10, state.lang);
      items = [{ free: true, q }].concat(found);
      active = -1;
      sugg.innerHTML = items.map((it, i) => it.free
        ? '<li class="free" data-i="' + i + '"><span>' + esc(t.freeSearch) + ': «' + esc(it.q) + '»' + (sel.value ? ' · ' + esc(sel.value) : '') + '</span><span class="kind">' + esc(t.freeKind) + '</span></li>'
        : '<li data-i="' + i + '"><span>' + esc(it.rb.t) + '</span><span class="cnt">' + it.rb.r.length + ' <span class="kind">' + esc(t.kind[it.rb.k]) + '</span></span></li>').join('');
      sugg.hidden = false;
    }
    function pick(i) {
      const it = items[i];
      if (!it) return;
      if (it.free) addRubric(makeFreeRubric(it.q, sel.value)); else addRubric(makeCatRubric(it.i));
      input.value = ''; closeSugg(); input.focus();
    }
    input.addEventListener('input', openSugg);
    input.addEventListener('focus', openSugg);
    input.addEventListener('keydown', e => {
      if (sugg.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); }
      else if (e.key === 'Escape') { closeSugg(); return; }
      else return;
      sugg.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === active));
    });
    sugg.addEventListener('mousedown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); pick(+li.dataset.i); } });
    $('#repForm').addEventListener('submit', e => {
      e.preventDefault();
      if (!sugg.hidden && active >= 0) { pick(active); return; }
      const q = input.value.trim();
      if (q) { addRubric(makeFreeRubric(q, sel.value)); input.value = ''; closeSugg(); }
    });
    document.addEventListener('click', e => { if (!e.target.closest('#repForm')) closeSugg(); });
  }

  function renderChips() {
    const box = $('#chips');
    if (!box) return;
    const t = T();
    if (!state.rubrics.length) {
      box.innerHTML = '<span class="muted small">' + esc(t.examples) + ' ' +
        t.exampleList.map(([lbl, s]) => '<a href="' + href('rep') + '?r=' + encodeURIComponent(s) + '">' + esc(lbl) + '</a>').join(' · ') + '</span>';
      return;
    }
    box.innerHTML = state.rubrics.map((rb, k) => {
      const n = rb.pending ? '…' : rb.error ? t.error : (rb.remedies ? rb.remedies.size : 0);
      return '<span class="chip' + (rb.pending ? ' pending' : '') + '"><span class="k">' + esc(t.kind[rb.kind]) + '</span> ' + esc(rb.label) +
        ' <span class="n">' + n + '</span><button type="button" data-k="' + k + '" title="' + esc(t.remove) + '" aria-label="' + esc(t.removeRubric) + '">×</button></span>';
    }).join('') + (state.rubrics.length > 1 ? ' <button type="button" class="btn secondary small" id="clearAll">' + esc(t.clear) + '</button>' : '');
    box.querySelectorAll('button[data-k]').forEach(b => b.addEventListener('click', () => removeRubric(+b.dataset.k)));
    const c = $('#clearAll'); if (c) c.addEventListener('click', () => { state.rubrics = []; state.open.clear(); writeHash(); renderChips(); renderResults(); });
  }

  function renderResults() {
    const box = $('#results');
    if (!box) return;
    const t = T();
    const c = cat();
    const ready = state.rubrics.filter(r => r.remedies);
    if (!state.rubrics.length) { box.innerHTML = ''; return; }
    if (!ready.length) { box.innerHTML = '<p class="muted">' + esc(t.loadingIndex) + '</p>'; return; }
    const rows = R.repertorize(state.rubrics);
    if (!rows.length) { box.innerHTML = '<p class="muted">' + esc(t.nothing) + '</p>'; return; }
    const shown = rows.slice(0, state.shown);
    const head = '<tr><th>' + esc(t.remedy) + '</th>' + state.rubrics.map(rb => '<th class="rub g" title="' + esc(rb.label) + '">' + esc(rb.label.length > 28 ? rb.label.slice(0, 26) + '…' : rb.label) + '</th>').join('') +
      (state.rubrics.length > 1 ? '<th class="g" title="' + esc(t.sumTitle) + '">Σ</th>' : '') + '</tr>';
    const body = shown.map(row => {
      const r = c.remedies[row.r];
      const cells = row.grades.map((g, k) => '<td class="g g' + g + '">' + (g ? '<span title="' + row.hits[k] + ' ' + esc(t.hits) + '">' + (state.rubrics[k].kind === 'free' ? row.hits[k] : '●') + '</span>' : '') + '</td>').join('');
      const sum = state.rubrics.length > 1 ? '<td class="sum">' + row.cover + '/' + state.rubrics.length + '</td>' : '';
      const name = '<td class="rem">' + remedyLink(row.r) + (r.translit ? ' <span class="ru">' + esc(r.translit.split(' = ')[0]) + '</span>' : '') + '</td>';
      const open = state.open.has(row.r);
      return '<tr class="row' + (open ? ' open' : '') + '" data-r="' + row.r + '">' + name + cells + sum + '</tr>' +
        (open ? '<tr class="detail" data-r="' + row.r + '"><td colspan="' + (state.rubrics.length + 2) + '"><div class="detail-box">' + esc(t.loading) + '</div></td></tr>' : '');
    }).join('');
    box.innerHTML = '<p class="muted small">' + esc(t.found(rows.length)) + '</p>' +
      '<div class="table-wrap"><table class="rep"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      (rows.length > shown.length ? '<div class="more-row"><button type="button" class="btn secondary" id="moreBtn">' + esc(t.more) + '</button></div>' : '') + '</div>';
    box.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      const r = +tr.dataset.r;
      if (state.open.has(r)) state.open.delete(r); else state.open.add(r);
      renderResults();
    }));
    box.querySelectorAll('tr.detail').forEach(tr => renderDetail(tr, +tr.dataset.r, rows.find(x => x.r === +tr.dataset.r)));
    const more = $('#moreBtn'); if (more) more.addEventListener('click', () => { state.shown += 60; renderResults(); });
  }

  async function renderDetail(tr, rIdx, row) {
    const t = T();
    const c = cat();
    const r = c.remedies[rIdx];
    const box = $('.detail-box', tr);
    const parts = [];
    for (let k = 0; k < state.rubrics.length; k++) {
      const rb = state.rubrics[k];
      if (!row.hits[k]) continue;
      let html = '<div class="evid"><h4>' + esc(t.kind[rb.kind]) + ': ' + esc(rb.label) + '</h4>';
      if (rb.kind === 'nos') {
        html += '<p>' + esc(t.evClinic) + ' <b>' + esc(rb.text) + '</b>' + (r.ext ? '' : ' — <a href="' + href('remedy/' + encodeURIComponent(r.id)) + '?sec=' + encodeURIComponent(CLINIC[state.lang]) + '">' + esc(t.open) + '</a>') + '</p>';
      } else if (rb.kind === 'art') {
        html += '<p>' + esc(t.evArt) + ' <a href="' + href('article/' + encodeURIComponent(rb.articleId)) + '?r=' + rIdx + '">«' + esc(rb.text) + '»</a>.</p>';
      } else if (rb.kind === 'line') {
        html += '<p>' + esc(t.evLine) + ' <a href="' + href('article/' + encodeURIComponent(rb.articleId)) + '?r=' + rIdx + '">«' + esc(c.articles[rb.articleIdx].title) + '»</a>: ' + esc(rb.text.slice(rb.text.indexOf(': ') + 2)) + '</p>';
      } else if (rb.kind === 'free' && rb.res) {
        const idx = state.idx[state.lang];
        const units = rb.res.byRemedy.get(rIdx).units;
        const remAll = units.filter(u => idx.docs[idx.ud[u]].t === 'r');
        const remUnits = remAll.slice(0, 5);
        const artUnits = units.filter(u => idx.docs[idx.ud[u]].t === 'a').slice(0, 3);
        try {
          if (remUnits.length) {
            const doc = await getDoc('remedies', r.id);
            for (const u of remUnits) {
              const sec = doc.sections[idx.us[u]];
              html += '<p><span class="sec">' + esc(sec.title) + ':</span> ' + renderPara(snippet(sec.paras[idx.up[u]], rb.res.stems), { hl: rb.res.stems, selfIdx: rIdx }).slice(3, -4) + '</p>';
            }
            if (remAll.length > 5) html += '<p class="muted small">' + esc(t.evMore(remAll.length - 5)) + '<a href="' + href('remedy/' + encodeURIComponent(r.id)) + '?hl=' + encodeURIComponent(rb.text) + '">' + esc(t.evOpenRemedy) + '</a></p>';
          }
          for (const u of artUnits) {
            const d = idx.docs[idx.ud[u]];
            const a = c.articles[d.a];
            const doc = await getDoc('articles', a.id);
            html += '<p><span class="sec">' + esc(t.evArticle) + ' «<a href="' + href('article/' + encodeURIComponent(a.id)) + '?r=' + rIdx + '">' + esc(a.title) + '</a>»:</span> ' + renderPara(snippet(doc.blocks[idx.us[u]].paras[idx.up[u]], rb.res.stems), { hl: rb.res.stems }).slice(3, -4) + '</p>';
          }
        } catch (e) { html += '<p class="error">' + esc(e.message) + '</p>'; }
      }
      parts.push(html + '</div>');
    }
    if (!tr.isConnected) return;
    box.innerHTML = parts.join('') || '<p class="muted">' + esc(t.noData) + '</p>';
  }

  // ---------------------------------------------------------------- препарати
  function viewRemedies(view) {
    const t = T();
    const list = cat().remedies.map((r, i) => ({ r, i })).filter(x => !x.r.ext);
    view.innerHTML = '<h1>' + esc(t.remediesTitle) + '</h1><p class="muted">' + esc(t.remediesIntro(list.length)) + '</p>' +
      '<input type="search" class="filter" id="remFilter" placeholder="' + esc(t.filter) + '" aria-label="' + esc(t.filter) + '"><div id="remList"></div>';
    const box = $('#remList');
    function render(q) {
      const f = q ? R.foldForMatch(q, state.lang) : '';
      let items = list;
      if (f) items = list.filter(x => R.foldForMatch([x.r.latin, x.r.alt, x.r.translit, x.r.common].join(' '), state.lang).includes(f));
      let html = '<div class="cols"><ul class="list">', letter = '';
      for (const x of items) {
        const L = x.r.latin[0].toUpperCase();
        if (L !== letter) { letter = L; html += '<li class="letter">' + L + '</li>'; }
        html += '<li><a href="' + href('remedy/' + encodeURIComponent(x.r.id)) + '">' + esc(x.r.latin) + '</a>' + (x.r.alt ? ' <span class="muted small">= ' + esc(x.r.alt) + '</span>' : '') +
          '<span class="sub">' + esc([x.r.translit.split(' = ')[0], x.r.common].filter(Boolean).join(' — ')) + '</span></li>';
      }
      html += '</ul></div>';
      box.innerHTML = items.length ? html : '<p class="muted">' + esc(t.nothingShort) + '</p>';
    }
    render('');
    $('#remFilter').addEventListener('input', e => render(e.target.value.trim()));
  }

  async function viewRemedy(view, id, params) {
    const t = T();
    const c = cat();
    const rIdx = c.remedies.findIndex(r => r.id === id);
    if (rIdx < 0) { view.innerHTML = '<p class="error">' + esc(t.noRemedy) + '</p>'; return; }
    view.innerHTML = '<p class="muted">' + esc(t.loading) + '</p>';
    const doc = await getDoc('remedies', id);
    const hl = params.get('hl') ? Array.from(new Set(SC.queryStems(params.get('hl'), state.lang).flat())) : null;
    const secId = s => 'sec-' + s.replace(/[^\wа-яёіїєґ]+/gi, '-').toLowerCase();
    const inArticles = c.articles.map((a, i) => ({ a, i })).filter(x => x.a.rem.includes(rIdx));
    let html = '<div class="doc-head"><h1>' + esc(doc.latin) + (doc.alt ? ' <span class="muted">(' + esc(doc.alt) + ')</span>' : '') + '</h1>' +
      '<div class="sub">' + esc([doc.translit, doc.common].filter(Boolean).join(' — ')) + '</div>' +
      (doc.source ? '<div class="meta">' + esc(t.source) + ' ' + esc(doc.source) + '</div>' : '') + '</div>';
    html += '<nav class="toc" aria-label="' + esc(t.sections) + '">' + doc.sections.map(s => '<a href="#' + secId(s.title) + '">' + esc(s.title) + '</a>').join('') + '</nav>';
    html += '<div class="doc">';
    for (const s of doc.sections) {
      html += '<h2 id="' + secId(s.title) + '">' + esc(s.title) + '</h2>';
      if (s.title === CLINIC[state.lang]) {
        const terms = [];
        for (const p of s.paras) for (const x of p.replace(/\*\*|_/g, '').split(/[.;]\s+|\.$/)) { const y = x.replace(/^[\s•\-–—]+|[\s.]+$/g, ''); if (y.length >= 3 && y.length <= 70) terms.push(y); }
        html += '<div class="tags">' + terms.map(x => '<a href="' + href('rep') + '?r=' + encodeURIComponent('n:' + x) + '" title="' + esc(t.addRubric) + '">' + esc(x) + '</a>').join('') + '</div>';
      } else {
        html += s.paras.map(p => renderPara(p, { hl, selfIdx: rIdx })).join('');
      }
    }
    html += '</div>';
    if (inArticles.length) {
      html += '<div class="aside"><h2>' + esc(t.inArticles) + '</h2><ul class="list">' + inArticles.map(x => '<li><a href="' + href('article/' + encodeURIComponent(x.a.id)) + '?r=' + rIdx + '">' + esc(x.a.title) + '</a> <span class="muted small">' + esc(TOPIC[state.lang][x.a.topic] || x.a.topic) + '</span></li>').join('') + '</ul></div>';
    }
    if (t.mtNote) html += '<p class="src">' + esc(t.mtNote) + '</p>';
    if (doc.origin) html += '<p class="src">' + esc(t.original) + ' <a href="' + esc(doc.origin) + '" rel="nofollow noopener">' + esc(doc.origin) + '</a></p>';
    view.innerHTML = html;
    view.querySelectorAll('.toc a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const el = document.getElementById(a.getAttribute('href').slice(1)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    const sec = params.get('sec');
    if (sec) { const el = document.getElementById(secId(sec)); if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 0); }
    else if (hl) { const m = view.querySelector('mark'); if (m) setTimeout(() => m.scrollIntoView({ block: 'center' }), 0); }
  }

  // ---------------------------------------------------------------- статті
  function viewArticles(view) {
    const t = T();
    const c = cat();
    const groups = new Map();
    c.articles.forEach((a, i) => { if (!groups.has(a.topic)) groups.set(a.topic, []); groups.get(a.topic).push({ a, i }); });
    const order = TOPIC_ORDER.filter(k => groups.has(k)).concat(Array.from(groups.keys()).filter(k => !TOPIC_ORDER.includes(k)));
    const coll = new Intl.Collator(t.htmlLang);
    let html = '<h1>' + esc(t.articlesTitle) + '</h1><p class="muted">' + esc(t.articlesIntro) + '</p>';
    for (const k of order) {
      const items = groups.get(k).sort((x, y) => coll.compare(x.a.title, y.a.title));
      html += '<h2 class="group-title">' + esc(TOPIC[state.lang][k] || k) + ' <span class="muted small">' + items.length + '</span></h2><div class="cols"><ul class="list">' +
        items.map(x => '<li><a href="' + href('article/' + encodeURIComponent(x.a.id)) + '">' + esc(x.a.title) + '</a>' + (x.a.rem.length ? '<span class="sub">' + esc(t.nRemedies(x.a.rem.length)) + '</span>' : '') + '</li>').join('') + '</ul></div>';
    }
    view.innerHTML = html;
  }

  async function viewArticle(view, id, params) {
    const t = T();
    const c = cat();
    const aIdx = c.articles.findIndex(a => a.id === id);
    if (aIdx < 0) { view.innerHTML = '<p class="error">' + esc(t.noArticle) + '</p>'; return; }
    view.innerHTML = '<p class="muted">' + esc(t.loading) + '</p>';
    const doc = await getDoc('articles', id);
    const a = c.articles[aIdx];
    const focus = params.has('r') ? +params.get('r') : -1;
    let html = '<div class="doc-head"><h1>' + esc(doc.title) + '</h1><div class="meta">' + esc(TOPIC[state.lang][a.topic] || a.topic) +
      (doc.author ? ' · ' + esc(t.author) + ' ' + esc(doc.author) : '') + (doc.source ? ' · ' + esc(t.source) + ' ' + esc(doc.source) : '') + '</div></div>';
    if (a.rem.length) {
      html += '<div class="tags">' + a.rem.map(i => c.remedies[i].ext ? '<span class="muted small">' + esc(c.remedies[i].latin) + '</span>' : '<a href="' + href('remedy/' + encodeURIComponent(c.remedies[i].id)) + '">' + esc(c.remedies[i].latin) + '</a>').join('') + '</div>';
      if (a.group === 'lechebnik' && a.rem.length >= 2) html += '<p class="small"><a href="' + href('rep') + '?r=' + encodeURIComponent('a:' + a.id) + '">' + esc(t.addArticle) + '</a></p>';
    }
    html += '<div class="doc">';
    doc.blocks.forEach((b, bi) => {
      const isFocus = focus >= 0 && b.rem.includes(focus);
      if (b.kind === 'remedy') {
        const links = b.rem.filter(i => !c.remedies[i].ext);
        const title = links.length ? '<a href="' + href('remedy/' + encodeURIComponent(c.remedies[links[0]].id)) + '">' + esc(b.title) + '</a>' : esc(b.title);
        html += '<div class="block' + (isFocus ? ' hl' : '') + '" id="blk-' + bi + '"><h3>' + title + '</h3>' + b.paras.map(p => renderPara(p)).join('') + '</div>';
      } else if (b.kind === 'sub') {
        html += '<h2 id="blk-' + bi + '">' + esc(b.title) + '</h2>' + b.paras.map(p => renderPara(p)).join('');
      } else {
        html += b.paras.map(p => renderPara(p)).join('');
      }
    });
    html += '</div>';
    if (t.mtNote) html += '<p class="src">' + esc(t.mtNote) + '</p>';
    if (doc.origin) html += '<p class="src">' + esc(t.original) + ' <a href="' + esc(doc.origin) + '" rel="nofollow noopener">' + esc(doc.origin) + '</a></p>';
    view.innerHTML = html;
    const f = view.querySelector('.block.hl');
    if (f) setTimeout(() => f.scrollIntoView({ block: 'start' }), 0);
  }

  // ---------------------------------------------------------------- швидкий пошук назв у шапці
  function initQuick() {
    const input = $('#quickInput'), list = $('#quickList');
    let items = [];
    function close() { list.hidden = true; list.innerHTML = ''; items = []; }
    function open() {
      const q = input.value.trim();
      if (q.length < 2 || !cat()) { close(); return; }
      items = R.matchRemedies(cat(), q, 8, state.lang);
      if (!items.length) { close(); return; }
      list.innerHTML = items.map((m, i) => '<li data-i="' + i + '"><span>' + esc(m.r.latin) + '</span><span class="kind">' + esc(m.r.translit.split(' = ')[0] || m.r.common) + '</span></li>').join('');
      list.hidden = false;
    }
    function go(i) { const m = items[i]; if (!m) return; input.value = ''; close(); location.hash = href('remedy/' + encodeURIComponent(m.r.id)); }
    input.addEventListener('input', open);
    input.addEventListener('focus', open);
    list.addEventListener('mousedown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); go(+li.dataset.i); } });
    $('#quickForm').addEventListener('submit', e => { e.preventDefault(); if (items.length) go(0); });
    document.addEventListener('click', e => { if (!e.target.closest('#quickForm')) close(); });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  // ---------------------------------------------------------------- старт
  async function init() {
    initTheme();
    try {
      state.langsAvailable = (await fetchJson('data/langs.json')).langs;
    } catch (e) {
      state.langsAvailable = ['ru'];
    }
    const btns = $('#langBtns');
    btns.innerHTML = state.langsAvailable.map(l => '<button type="button" data-lang="' + l + '" aria-pressed="false">' + l.toUpperCase() + '</button>').join('');
    btns.querySelectorAll('button').forEach(b => b.addEventListener('click', () => switchLang(b.dataset.lang)));
    if (state.langsAvailable.length < 2) btns.closest('.menu-section').hidden = true;
    initMenu();
    initQuick();
    window.addEventListener('hashchange', route);
    route();
  }
  init();
})();
