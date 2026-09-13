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
  const MODAL = { ru: 'Модальности', ua: 'Модальності' };
  const ETIOL = { ru: 'Этиология', ua: 'Етіологія' };
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
      navRep: 'Симптоми', navRemedies: 'Препарати', navArticles: 'Статті',
      kind: { free: 'Текст', nos: 'Клініка', art: 'Стаття', line: 'Рубрика', mod: 'Модальність', etio: 'Причина' },
      repPlaceholder: 'Симптом, хвороба або рубрика…', allSections: 'Усі розділи', freeSearch: 'Шукати в текстах', freeKind: 'повнотекстово',
      error: 'помилка', clear: 'Очистити', remove: 'Прибрати', removeRubric: 'Прибрати рубрику', loadingIndex: 'Завантаження індексу…',
      nothing: 'Нічого не знайдено. Спробуйте інше формулювання або коротше слово.', found: n => 'Знайдено препаратів: ' + n + '. Натисніть на рядок, щоб побачити підстави.',
      remedy: 'Препарат', sumTitle: 'Покрито рубрик / сума балів', hits: 'зб.', ext: 'без сторінки', more: 'Показати ще',
      evClinic: 'У розділі «Клініка» Materia Medica:', open: 'відкрити', evArt: 'Препарат описано у статті', evLine: 'Рубрика зі статті', evArticle: 'Стаття',
      evMore: n => '… та ще ' + n + ' — ', evOpenRemedy: 'переглянути препарат', noData: 'Немає даних.', evSub: 'через підрубрику',
      evMod: 'У розділі «Модальності»:', evEtio: 'У розділі «Етіологія»:',
      remediesTitle: 'Препарати', remediesIntro: n => 'Materia Medica Дж. Г. Кларка — ' + n + ' препаратів. Латинська назва, транслітерація, звичайна назва.',
      filter: 'Фільтр за назвою…', nothingShort: 'Нічого не знайдено.', source: 'Джерело:', sections: 'Розділи', addRubric: 'Додати рубрику до реперторію',
      inArticles: 'Згадується у статтях', noRemedy: 'Препарат не знайдено.',
      articlesTitle: 'Статті', articlesIntro: 'Домашній гомеопатичний лікувальник за хворобами (Варшавський, Кьолер, Симеонова, Петерс, Роуз, Юз та ін.), квіткові настої д-ра Баха, про гомеопатію. У кожній статті — перелік препаратів із показаннями.',
      nRemedies: n => n + ' препаратів', noArticle: 'Статтю не знайдено.', author: 'Автор:', addArticle: 'Додати статтю як рубрику до реперторію',
      notFound: 'Сторінку не знайдено.', loadFail: 'Не вдалося завантажити дані:', loading: 'Завантаження…',
      menu: 'Меню', menuLang: 'Мова', menuTheme: 'Тема', themeAuto: 'Системна', themeLight: 'Світла', themeDark: 'Темна',
      weight: 'Вага рубрики (натисніть, щоб змінити)', elim: 'Обов’язкова рубрика: показувати лише препарати, що її мають', excl: 'Виключити препарати цієї рубрики',
      sort: 'Сортувати', sortCover: 'за покриттям', sortTotal: 'за балами', sortName: 'за назвою',
      picker: 'Модальності й причини', worse: 'Гірше', better: 'Краще', causes: 'Причини',
      compare: 'Порівняти', compareSel: 'Для порівняння:', compareTitle: 'Порівняння препаратів', close: 'Закрити', cmpCheck: 'Вибрати для порівняння (до 4)',
      rel: { cmp: 'Порівняти з', ant: 'Антидоти', compl: 'Доповнюють', incompat: 'Несумісні', after: 'Добре діє після', before: 'Після нього добре діють', other: 'Інше' },
      relTitle: 'Зв’язки', maybe: 'можливо:', without: 'без:', clinicRow: 'Клініка (рубрик)', expandAll: 'Розгорнути підстави', collapseAll: 'Згорнути підстави',
      articlesOpt: 'Статті', articlesOptTitle: 'Шукати також у статтях лікувальника і показувати знайдені статті', artResults: 'Статті за запитом', artMore: 'ще', artHits: 'збігів',
      menuOffline: 'Офлайн', offSave: mb => 'Зберегти довідник для офлайну (≈' + mb + ' МБ)',
      offSaveTitle: 'Завантажити всі препарати, статті й пошуковий індекс цієї мови, щоб сайт працював без мережі',
      offFiles: ['файл', 'файли', 'файлів'], offDrop: 'Видалити', offDropTitle: 'Стерти збережене для офлайну',
      offSaved: (l, n, w, mb, d) => 'Збережено (' + l + '): ' + n + ' ' + w + ', ' + mb + ' МБ, ' + d,
      offNone: 'Не збережено. Без мережі доступне лише те, що ви вже відкривали.',
      offFail: 'Не вдалося зберегти. Перевірте зв’язок і спробуйте ще раз.',
      caseSave: 'Зберегти випадок', caseUpdate: 'Оновити випадок', caseNamePh: 'Назва випадку', caseOk: 'Зберегти', caseCancel: 'Скасувати',
      menuCases: 'Випадки', casesEmpty: 'Немає збережених випадків', caseDel: 'Видалити випадок', caseDelAsk: 'видалити?',
      caseN: n => n + ' ' + plural(n, ['рубрика', 'рубрики', 'рубрик']), flagElim: 'елімінативна', flagExcl: 'виключена', menuPrint: 'Друк',
    },
    ru: {
      title: 'Реперторий — гомеопатические препараты по симптомам', htmlLang: 'ru',
      navRep: 'Симптомы', navRemedies: 'Препараты', navArticles: 'Статьи',
      kind: { free: 'Текст', nos: 'Клиника', art: 'Статья', line: 'Рубрика', mod: 'Модальность', etio: 'Причина' },
      repPlaceholder: 'Симптом, болезнь или рубрика…', allSections: 'Все разделы', freeSearch: 'Искать в текстах', freeKind: 'полнотекстово',
      error: 'ошибка', clear: 'Очистить', remove: 'Убрать', removeRubric: 'Убрать рубрику', loadingIndex: 'Загрузка индекса…',
      nothing: 'Ничего не найдено. Попробуйте другую формулировку или более короткое слово.', found: n => 'Найдено препаратов: ' + n + '. Нажмите на строку, чтобы увидеть основания.',
      remedy: 'Препарат', sumTitle: 'Покрыто рубрик / сумма баллов', hits: 'совп.', ext: 'без страницы', more: 'Показать ещё',
      evClinic: 'В разделе «Клиника» Materia Medica:', open: 'открыть', evArt: 'Препарат описан в статье', evLine: 'Рубрика из статьи', evArticle: 'Статья',
      evMore: n => '… и ещё ' + n + ' — ', evOpenRemedy: 'открыть препарат', noData: 'Нет данных.', evSub: 'через подрубрику',
      evMod: 'В разделе «Модальности»:', evEtio: 'В разделе «Этиология»:',
      remediesTitle: 'Препараты', remediesIntro: n => 'Materia Medica Дж. Г. Кларка — ' + n + ' препаратов. Латинское название, транслитерация, обычное название.',
      filter: 'Фильтр по названию…', nothingShort: 'Ничего не найдено.', source: 'Источник:', sections: 'Разделы', addRubric: 'Добавить рубрику в реперторий',
      inArticles: 'Упоминается в статьях', noRemedy: 'Препарат не найден.',
      articlesTitle: 'Статьи', articlesIntro: 'Домашний гомеопатический лечебник по болезням (Варшавский, Кёлер, Симеонова, Петерс, Роуз, Юз и др.), цветочные настои д-ра Бака, о гомеопатии. В каждой статье — перечень препаратов с показаниями.',
      nRemedies: n => n + ' препаратов', noArticle: 'Статья не найдена.', author: 'Автор:', addArticle: 'Добавить статью как рубрику в реперторий',
      notFound: 'Страница не найдена.', loadFail: 'Не удалось загрузить данные:', loading: 'Загрузка…',
      menu: 'Меню', menuLang: 'Язык', menuTheme: 'Тема', themeAuto: 'Системная', themeLight: 'Светлая', themeDark: 'Тёмная',
      weight: 'Вес рубрики (нажмите, чтобы изменить)', elim: 'Обязательная рубрика: показывать только препараты, у которых она есть', excl: 'Исключить препараты этой рубрики',
      sort: 'Сортировать', sortCover: 'по покрытию', sortTotal: 'по баллам', sortName: 'по названию',
      picker: 'Модальности и причины', worse: 'Хуже', better: 'Лучше', causes: 'Причины',
      compare: 'Сравнить', compareSel: 'Для сравнения:', compareTitle: 'Сравнение препаратов', close: 'Закрыть', cmpCheck: 'Выбрать для сравнения (до 4)',
      rel: { cmp: 'Сравнить с', ant: 'Антидоты', compl: 'Дополняют', incompat: 'Несовместимы', after: 'Хорошо действует после', before: 'После него хорошо действуют', other: 'Прочее' },
      relTitle: 'Взаимосвязи', maybe: 'возможно:', without: 'без:', clinicRow: 'Клиника (рубрик)', expandAll: 'Показать основания', collapseAll: 'Свернуть основания',
      articlesOpt: 'Статьи', articlesOptTitle: 'Искать также в статьях лечебника и показывать найденные статьи', artResults: 'Статьи по запросу', artMore: 'ещё', artHits: 'совп.',
      menuOffline: 'Офлайн', offSave: mb => 'Сохранить справочник для офлайна (≈' + mb + ' МБ)',
      offSaveTitle: 'Загрузить все препараты, статьи и поисковый индекс этого языка, чтобы сайт работал без сети',
      offFiles: ['файл', 'файла', 'файлов'], offDrop: 'Удалить', offDropTitle: 'Стереть сохранённое для офлайна',
      offSaved: (l, n, w, mb, d) => 'Сохранено (' + l + '): ' + n + ' ' + w + ', ' + mb + ' МБ, ' + d,
      offNone: 'Не сохранено. Без сети доступно только то, что вы уже открывали.',
      offFail: 'Не удалось сохранить. Проверьте связь и попробуйте ещё раз.',
      caseSave: 'Сохранить случай', caseUpdate: 'Обновить случай', caseNamePh: 'Название случая', caseOk: 'Сохранить', caseCancel: 'Отменить',
      menuCases: 'Случаи', casesEmpty: 'Нет сохранённых случаев', caseDel: 'Удалить случай', caseDelAsk: 'удалить?',
      caseN: n => n + ' ' + plural(n, ['рубрика', 'рубрики', 'рубрик']), flagElim: 'элиминативная', flagExcl: 'исключена', menuPrint: 'Печать',
    },
  };
  const KIND_LETTER = { free: 'f', nos: 'n', art: 'a', line: 'l', mod: 'm', etio: 'e' };
  const LETTER_KIND = { f: 'free', n: 'nos', a: 'art', l: 'line', m: 'mod', e: 'etio' };

  const state = { lang: 'ua', cat: {}, idx: {}, idxPromise: {}, docs: new Map(), linker: {}, rubrics: [], shown: 60, open: new Set(), langsAvailable: null, sort: 'cover', cmp: [], cmpOpen: false, articles: true, artShowAll: false, caseId: null };
  try { if (localStorage.getItem('articles') === '0') state.articles = false; } catch (e) { /* ignore */ }
  const T = () => I18N[state.lang];
  const cat = () => state.cat[state.lang];

  // ---------------------------------------------------------------- утиліти
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  // Форма слова за числом (одна / дві-чотири / п'ять) — однакова для обох мов
  function plural(n, forms) { const a = n % 10, b = n % 100; return forms[a === 1 && b !== 11 ? 0 : (a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 1 : 2)]; }
  async function fetchJson(rel) {
    const res = await fetch(rel);
    if (!res.ok) throw new Error(rel + ': ' + res.status);
    return res.json();
  }
  function href(path) { return '#/' + state.lang + '/' + path; }
  // Невдалу обіцянку не тримаємо в пам'яті: без мережі помилка нормальна, і після повернення
  // зв'язку (або збереження для офлайну) та сама сторінка мусить відкритись без перезавантаження.
  function getDoc(kind, id) {
    const key = state.lang + '/' + kind + '/' + id;
    if (!state.docs.has(key)) {
      state.docs.set(key, fetchJson('data/' + state.lang + '/' + kind + '/' + encodeURIComponent(id) + '.json')
        .catch(e => { state.docs.delete(key); throw e; }));
    }
    return state.docs.get(key);
  }
  function loadIndex() {
    const l = state.lang;
    if (!state.idxPromise[l]) {
      state.idxPromise[l] = fetchJson('data/' + l + '/index.json')
        .then(j => { state.idx[l] = R.makeIndex(j); return state.idx[l]; })
        .catch(e => { state.idxPromise[l] = null; throw e; });
    }
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
  function catLabel(rb) { const k = rb.t.indexOf(': '); return k > 0 && (rb.k === 'mod' || rb.k === 'etio') ? rb.t.slice(k + 2) : rb.t; }
  function modLabels() {
    const l = state.lang;
    if (!state.modLabels) state.modLabels = {};
    if (!state.modLabels[l]) {
      const m = new Map();
      cat().rubrics.forEach((rb, i) => { if (rb.k === 'mod' || rb.k === 'etio') m.set((rb.k === 'mod' ? 'm:' : 'e:') + rb.key, { label: catLabel(rb), i }); });
      state.modLabels[l] = m;
    }
    return state.modLabels[l];
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

  // ---------------------------------------------------------------- випадки
  // Випадок = назва + хеш реперторію (рубрики, прапорці, сортування, порівняння) у localStorage.
  function loadCases() {
    try { const v = JSON.parse(localStorage.getItem('cases') || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function storeCases(list) { try { localStorage.setItem('cases', JSON.stringify(list)); } catch (e) { /* ignore */ } }
  function caseDate(ts) { try { return new Date(ts).toLocaleDateString(T().htmlLang); } catch (e) { return ''; } }
  // Випадок, який зараз редагується: точний збіг хеша або той, що відкрили/зберегли (state.caseId)
  function activeCase() {
    if (!state.rubrics.length) return null;
    const list = loadCases();
    const h = repHash();
    const byHash = list.find(x => x.hash === h);
    if (byHash) { state.caseId = byHash.id; return byHash; }
    const cur = state.caseId ? list.find(x => x.id === state.caseId) : null;
    return cur && cur.lang === state.lang ? cur : null;
  }
  function defaultCaseName() { return state.rubrics.slice(0, 3).map(rb => rb.label).join(', '); }
  function saveCase(name) {
    const list = loadCases();
    const cur = activeCase();
    const rec = {
      id: cur ? cur.id : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || defaultCaseName(), hash: repHash(), lang: state.lang, ts: Date.now(), n: state.rubrics.length,
    };
    const i = cur ? list.findIndex(x => x.id === cur.id) : -1;
    if (i >= 0) list[i] = rec; else list.push(rec);
    storeCases(list);
    state.caseId = rec.id;
    renderCases();
  }
  function deleteCase(id) {
    storeCases(loadCases().filter(x => x.id !== id));
    if (state.caseId === id) state.caseId = null;
    renderCases(); renderCaseName(); renderResults();
  }
  function renderCases() {
    const box = $('#casesList');
    if (!box) return;
    const t = T();
    const list = loadCases().slice().sort((a, b) => b.ts - a.ts);
    if (!list.length) { box.innerHTML = '<div class="cases-empty">' + esc(t.casesEmpty) + '</div>'; return; }
    box.innerHTML = list.map(x => '<div class="case-item">' +
      '<button type="button" class="case-open" data-id="' + esc(x.id) + '">' + esc(x.name) +
      '<span class="case-meta">' + esc(caseDate(x.ts)) + ' · ' + esc(t.caseN(x.n)) + '</span></button>' +
      '<button type="button" class="case-del" data-id="' + esc(x.id) + '" title="' + esc(t.caseDel) + '" aria-label="' + esc(t.caseDel) + '">×</button></div>').join('');
    box.querySelectorAll('button.case-open').forEach(b => b.addEventListener('click', () => {
      const x = loadCases().find(y => y.id === b.dataset.id);
      if (!x) return;
      state.caseId = x.id;
      closeMenu();
      if (location.hash === x.hash) { renderCaseName(); renderResults(); } else location.hash = x.hash;
    }));
    box.querySelectorAll('button.case-del').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.ask) { deleteCase(b.dataset.id); return; }
      box.querySelectorAll('button.case-del').forEach(o => { delete o.dataset.ask; o.textContent = '×'; o.classList.remove('ask'); });
      b.dataset.ask = '1'; b.textContent = t.caseDelAsk; b.classList.add('ask');
    }));
  }
  function renderCaseName() {
    const box = $('#caseName');
    if (!box) return;
    const cs = activeCase();
    box.textContent = cs ? cs.name : '';
    box.hidden = !cs;
  }

  // ---------------------------------------------------------------- меню
  function openMenu() { renderCases(); $('#menu').hidden = false; $('#menuBtn').setAttribute('aria-expanded', 'true'); }
  function closeMenu() { $('#menu').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); }
  function initMenu() {
    $('#menuBtn').addEventListener('click', e => { e.stopPropagation(); if ($('#menu').hidden) openMenu(); else closeMenu(); });
    const pb = $('#printBtn');
    if (pb) pb.addEventListener('click', () => { closeMenu(); window.print(); });
    document.addEventListener('click', e => { if (!e.target.closest('#menuWrap')) closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  }

  // ---------------------------------------------------------------- офлайн (PWA)
  // Ім'я runtime-кешу мусить збігатися з RUNTIME у sw.js: кнопка «Зберегти» пише в кеш напряму
  // через Cache API (надійніше за повідомлення воркерові — працює й поки він ще не керує
  // сторінкою). Збіг імен перевіряє tools/uitest/pwa.js.
  const CACHE_RUNTIME = 'homeo-runtime';
  // Оцінка обсягу для підпису кнопки; точний розмір рахуємо після збереження. Якщо збірка
  // поклала розмір у catalog.stats.bytes — беремо звідти, інакше ці числа (заміряно на збірці
  // 13.09.2026: сума catalog.json + index.json + remedies/*.json + articles/*.json).
  const OFFLINE_BYTES = { ua: 16567005, ru: 15816013 };
  const OFF_KEY = 'offline';
  let offBusy = null;

  function offSupported() { return 'serviceWorker' in navigator && typeof caches !== 'undefined'; }
  function offLoad() { try { return JSON.parse(localStorage.getItem(OFF_KEY)) || {}; } catch (e) { return {}; } }
  function offStore(s) { try { localStorage.setItem(OFF_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  function mbLabel(bytes) { return (bytes / 1e6).toFixed(1).replace('.', ','); }
  function dmy(iso) { const p = iso.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  // Повний перелік даних мови: каталог, індекс, сторінки препаратів (крім ext — їх немає)
  // і всі статті. Список мов теж, інакше після рестарту без мережі init() не знає про UA.
  function offlineUrls(lang) {
    const c = state.cat[lang];
    const urls = ['data/langs.json', 'data/' + lang + '/catalog.json', 'data/' + lang + '/index.json'];
    for (const r of c.remedies) if (!r.ext) urls.push('data/' + lang + '/remedies/' + encodeURIComponent(r.id) + '.json');
    for (const a of c.articles) urls.push('data/' + lang + '/articles/' + encodeURIComponent(a.id) + '.json');
    return urls;
  }
  function renderOffline() {
    const sec = $('#menuOfflineSec'), box = $('#offlineBox');
    if (!sec || !box) return;
    sec.hidden = !offSupported();
    if (sec.hidden) return;
    const t = T();
    $('#menuOfflineTitle').textContent = t.menuOffline;
    const c = cat();
    const est = (c && c.stats && c.stats.bytes) || OFFLINE_BYTES[state.lang] || 0;
    const saved = offLoad();
    const lines = Object.keys(saved).sort().map(l => {
      const s = saved[l];
      return esc(t.offSaved(l.toUpperCase(), s.files, plural(s.files, t.offFiles), mbLabel(s.bytes), dmy(s.date)));
    });
    box.innerHTML = '<button type="button" class="btn small" id="offSave" title="' + esc(t.offSaveTitle) + '"' + (offBusy ? ' disabled' : '') + '>' + esc(t.offSave(mbLabel(est))) + '</button>' +
      '<div class="offline-state" id="offState">' + (offBusy ? esc(offBusy.done + '/' + offBusy.total) : lines.length ? lines.join('<br>') : esc(t.offNone)) + '</div>' +
      (lines.length && !offBusy ? '<button type="button" class="btn small secondary" id="offDrop" title="' + esc(t.offDropTitle) + '">' + esc(t.offDrop) + '</button>' : '');
    // stopPropagation: перемальовування виймає кнопку з DOM ще під час кліку, і сторож
    // «клік поза меню» вважав би, що клікнули повз меню, та згортав би його з поступом разом.
    const save = $('#offSave'); if (save) save.addEventListener('click', e => { e.stopPropagation(); offlineSave(); });
    const drop = $('#offDrop'); if (drop) drop.addEventListener('click', e => { e.stopPropagation(); offlineDrop(); });
  }
  async function offlineSave() {
    if (offBusy || !offSupported()) return;
    const lang = state.lang;
    const urls = offlineUrls(lang);
    offBusy = { done: 0, total: urls.length };
    renderOffline();
    let bytes = 0, ok = 0, i = 0;
    try {
      const cache = await caches.open(CACHE_RUNTIME);
      const worker = async () => {
        while (i < urls.length) {
          const url = urls[i++];
          try {
            const res = await fetch(url);
            if (res.ok) {
              // Тіло читаємо самі: так знаємо точний обсяг і не залежимо від того,
              // чи вже перехоплює запити воркер.
              const buf = await res.arrayBuffer();
              bytes += buf.byteLength;
              ok++;
              await cache.put(url, new Response(buf, { headers: { 'Content-Type': 'application/json' } }));
            }
          } catch (e) { /* один файл не привід кидати весь довідник */ }
          offBusy.done++;
          const el = $('#offState');
          if (el) el.textContent = offBusy.done + '/' + offBusy.total;
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
    } catch (e) { /* нижче покажемо невдачу */ }
    offBusy = null;
    if (ok) {
      const s = offLoad();
      s[lang] = { date: new Date().toISOString().slice(0, 10), files: ok, bytes };
      offStore(s);
    }
    renderOffline();
    if (!ok) { const el = $('#offState'); if (el) el.textContent = T().offFail; }
  }
  async function offlineDrop() {
    try { await caches.delete(CACHE_RUNTIME); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(OFF_KEY); } catch (e) { /* ignore */ }
    renderOffline();
  }
  function initServiceWorker() {
    if (!offSupported()) return;
    // Шлях відносний: сайт живе в підтеці, область дії воркера = ця тека.
    navigator.serviceWorker.register('sw.js')
      .then(() => navigator.serviceWorker.ready)
      // Найперше завантаження проходить повз воркера (він ще не керує сторінкою), тож список мов
      // і каталог у кеш не потрапляють — кладемо їх самі, інакше після одного візиту офлайн
      // покаже порожнечу.
      .then(() => caches.open(CACHE_RUNTIME).then(c => c.addAll(['data/langs.json', 'data/' + state.lang + '/catalog.json'])))
      .catch(() => { /* офлайн — необов'язковий: жодних повідомлень користувачеві */ });
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
    $('#menuBtn').setAttribute('aria-label', t.menu);
    $('#menuBtn').setAttribute('title', t.menu);
    $('#menuLangTitle').textContent = t.menuLang;
    $('#menuThemeTitle').textContent = t.menuTheme;
    const ct = $('#menuCasesTitle'); if (ct) ct.textContent = t.menuCases;
    const pb = $('#printBtn'); if (pb) pb.textContent = t.menuPrint;
    renderCases();
    renderThemeOptions();
    renderOffline();
    document.querySelectorAll('#langBtns button').forEach(b => { b.classList.toggle('active', b.dataset.lang === state.lang); b.setAttribute('aria-pressed', b.dataset.lang === state.lang ? 'true' : 'false'); });
  }
  function switchLang(lang) {
    if (lang === state.lang || !LANGS.includes(lang)) return;
    const { seg, params } = parseHash();
    let path = seg.slice(1).map(encodeURIComponent).join('/') || 'rep';
    if (seg[1] === 'rep' || seg.length === 1) {
      const specs = state.rubrics.map(rb => {
        if (rb.kind === 'nos' || rb.kind === 'line') { const x = cat().rubrics[rb.catIdx].x; return x ? rubricSpec(rb, x) : null; }
        return rubricSpec(rb);
      }).filter(Boolean);
      const q = new URLSearchParams();
      if (specs.length) q.set('r', specs.join('|'));
      if (state.sort !== 'cover') q.set('s', state.sort);
      if (state.cmp.length) q.set('c', state.cmp.map(i => cat().remedies[i].id).join(','));
      if (!state.articles) q.set('a', '0');
      const qs = q.toString();
      path = 'rep' + (qs ? '?' + qs : '');
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
  // Фрагмент абзацу з реченнями, що містять збіг (номери речень — як у збірці індексу)
  function sentenceSnippet(md, ordinals, stems) {
    if (md.length <= 300) return md;
    const sents = SC.splitSentences(md);
    const set = new Set(ordinals);
    const pick = sents.map((s, i) => i).filter(i => set.has(i)).slice(0, 3);
    if (!pick.length) return snippet(md, stems);
    let out = '', prev = -1;
    for (const i of pick) {
      if (prev < 0 && i > 0) out += '… ';
      else if (prev >= 0 && i > prev + 1) out += ' … ';
      else if (prev >= 0) out += ' ';
      out += sents[i].length > 420 ? snippet(sents[i], stems) : sents[i];
      prev = i;
    }
    if (prev < sents.length - 1) out += ' …';
    return out.replace(/\*\*(?=\s*…|$)/g, '').replace(/…\s*…/g, '…');
  }
  function renderPara(md, opts) {
    opts = opts || {};
    const bullet = /^- /.test(md);
    let s = esc(bullet ? md.slice(2) : md);
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*\*/g, '');
    s = s.replace(/(^|[\s(«"“])_([^_]+?)_(?=[\s.,;:)»"”!?]|$)/g, '$1<i>$2</i>');
    if (opts.link !== false) s = linkNames(s, opts.selfIdx);
    if (opts.hl) s = highlightHtml(s, opts.hl);
    return '<p' + (bullet ? ' class="bullet"' : '') + '>' + (bullet ? '• ' : '') + s + '</p>';
  }
  const inner = html => html.replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '');

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
    if (seg[0] !== state.lang) { state.rubrics = []; state.cmp = []; }
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

  // ---------------------------------------------------------------- рубрики
  // Специфікація рубрики в URL: <літера виду><прапорці>:<тіло>; прапорці: ! обов'язкова, - виключна, 2/3 вага.
  function rubricSpec(rb, bodyOverride) {
    const flags = (rb.elim ? '!' : '') + (rb.excl ? '-' : '') + (rb.weight > 1 ? rb.weight : '');
    let body = bodyOverride;
    if (body == null) {
      if (rb.kind === 'free') body = (rb.section || '') + '~' + rb.text;
      else if (rb.kind === 'art') body = rb.articleId;
      else if (rb.kind === 'mod' || rb.kind === 'etio') body = rb.key;
      else body = rb.text;
    }
    return KIND_LETTER[rb.kind] + flags + ':' + body;
  }
  function rubricFromSpec(spec) {
    const m = spec.match(/^([fnalme])([!\-]*)([23]?):([\s\S]*)$/);
    if (!m) return null;
    const kind = LETTER_KIND[m[1]], body = m[4];
    const c = cat();
    let rb = null;
    if (kind === 'free') { const t = body.indexOf('~'); rb = makeFreeRubric(body.slice(t + 1), body.slice(0, t)); }
    else if (kind === 'nos') {
      let i = c.rubrics.findIndex(r => r.k === 'nos' && r.t === body);
      if (i < 0) { const low = body.toLowerCase(); i = c.rubrics.findIndex(r => r.k === 'nos' && (r.t.toLowerCase() === low || (r.al && r.al.some(a => a.toLowerCase() === low)))); }
      rb = i >= 0 ? makeCatRubric(i) : null;
    }
    else if (kind === 'art') { const i = c.rubrics.findIndex(r => r.k === 'art' && c.articles[r.a].id === body); rb = i >= 0 ? makeCatRubric(i) : null; }
    else if (kind === 'line') { const i = c.rubrics.findIndex(r => r.k === 'line' && r.t === body); rb = i >= 0 ? makeCatRubric(i) : null; }
    else { const i = c.rubrics.findIndex(r => r.k === kind && r.key === body); rb = i >= 0 ? makeCatRubric(i) : null; }
    if (!rb) return null;
    rb.elim = m[2].includes('!'); rb.excl = m[2].includes('-'); rb.weight = m[3] ? +m[3] : 1;
    return rb;
  }
  function makeCatRubric(i) {
    const rb = cat().rubrics[i];
    const r = { kind: rb.k, text: rb.t, catIdx: i, remedies: R.rubricRemedies(cat(), i), label: rb.t, weight: 1, elim: false, excl: false };
    if (rb.k === 'art' || rb.k === 'line') { r.articleIdx = rb.a; r.articleId = cat().articles[rb.a].id; }
    if (rb.k === 'mod' || rb.k === 'etio') r.key = rb.key;
    return r;
  }
  function makeFreeRubric(text, section) {
    text = text.trim();
    if (!text) return null;
    const lang = state.lang;
    const r = { kind: 'free', text, section: section || '', remedies: null, label: text + (section ? ' · ' + section : ''), pending: true, weight: 1, elim: false, excl: false };
    r.promise = loadIndex().then(async idx => {
      r.res = R.freeText(idx, text, r.section, lang, { articles: state.articles });
      // слова в лапках: індекс не має позицій слів, тому порядок перевіряємо за текстами
      if (r.res.phraseTerms.length) await confirmPhrases(idx, r.res, lang);
      r.remedies = new Map(Array.from(r.res.byRemedy, ([k, v]) => [k, { g: v.g, hits: v.hits, score: v.score }]));
      r.pending = false;
      return r;
    });
    return r;
  }
  // Фразовий пошук: вантажимо документи абзаців-кандидатів (по 8 паралельно, кеш state.docs)
  // і лишаємо тільки абзаци, де слова фрази стоять підряд. Поки триває — рубрика pending.
  async function confirmPhrases(idx, res, lang) {
    const need = new Map();
    for (const x of res.paras) {
      const d = idx.docs[idx.pd[x.p]];
      const kind = d.t === 'r' ? 'remedies' : 'articles';
      const key = kind + '/' + d.id;
      let e = need.get(key);
      if (!e) need.set(key, e = { kind, id: d.id, paras: [] });
      e.paras.push(x.p);
    }
    const list = Array.from(need.values());
    const texts = new Map();
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const e = list[next++];
        let doc;
        try { doc = await getDoc(e.kind, e.id); } catch (err) { continue; }
        const blocks = e.kind === 'remedies' ? doc.sections : doc.blocks;
        for (const p of e.paras) {
          const b = blocks[idx.ps[p]];
          const md = b && b.paras[idx.pp[p]];
          if (md != null) texts.set(p, md);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, list.length) }, worker));
    R.confirmPhrases(idx, res, lang, texts);
  }
  // Поточний стан реперторію як хеш — і для адреси, і як ключ збереженого випадку
  function repHash() {
    const q = new URLSearchParams();
    const specs = state.rubrics.map(rb => rubricSpec(rb)).join('|');
    if (specs) q.set('r', specs);
    if (state.sort !== 'cover') q.set('s', state.sort);
    if (state.cmp.length) q.set('c', state.cmp.map(i => cat().remedies[i].id).join(',') + (state.cmpOpen ? '' : '~'));
    if (!state.articles) q.set('a', '0');
    const qs = q.toString();
    return href('rep') + (qs ? '?' + qs : '');
  }
  function writeHash() {
    const h = repHash();
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function rerender() { writeHash(); renderChips(); renderResults(); }
  function addRubric(rb) {
    if (!rb) return;
    if (state.rubrics.some(x => rubricSpec(x) === rubricSpec(rb))) return;
    state.rubrics.push(rb);
    state.open.clear();
    rerender();
    if (rb.pending) rb.promise.then(() => { renderChips(); renderResults(); }).catch(err => { rb.error = err.message; rb.pending = false; renderChips(); });
  }
  function removeRubric(k) { state.rubrics.splice(k, 1); state.open.clear(); rerender(); }

  async function viewRepertory(view, params) {
    const t = T();
    const c = cat();
    view.innerHTML = `
      <form class="rep-search" id="repForm" autocomplete="off">
        <div class="box">
          <input type="search" id="repInput" placeholder="${esc(t.repPlaceholder)}" aria-label="${esc(t.repPlaceholder)}">
          <ul class="dropdown" id="repSugg" hidden></ul>
        </div>
        <select id="repSection" aria-label="${esc(t.allSections)}">
          <option value="">${esc(t.allSections)}</option>
          ${SECTIONS[state.lang].map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('')}
        </select>
        <label class="opt" title="${esc(t.articlesOptTitle)}"><input type="checkbox" id="artOpt"${state.articles ? ' checked' : ''}> ${esc(t.articlesOpt)}</label>
      </form>
      <details class="picker" id="picker"><summary>${esc(t.picker)}</summary><div class="picker-body" id="pickerBody"></div></details>
      <div class="case-name" id="caseName" hidden></div>
      <div class="chips" id="chips"></div>
      <div id="results"></div>`;
    const spec = params.get('r');
    const s = params.get('s');
    state.sort = s === 'total' || s === 'name' ? s : 'cover';
    if (params.get('a') === '0') state.articles = false;
    else if (params.get('a') === '1') state.articles = true;
    $('#artOpt').checked = state.articles;
    const cm = params.get('c');
    state.cmpOpen = !!cm && !cm.endsWith('~');
    state.cmp = cm ? cm.replace(/~$/, '').split(',').map(id => c.remedies.findIndex(r => r.id === id)).filter(i => i >= 0).slice(0, 4) : [];
    if (spec) {
      const specs = spec.split('|');
      const same = specs.length === state.rubrics.length && specs.every((s, i) => rubricSpec(state.rubrics[i]) === s);
      if (!same) {
        state.caseId = null;
        state.rubrics = specs.map(rubricFromSpec).filter(Boolean);
        state.open.clear();
        for (const rb of state.rubrics) if (rb.pending) rb.promise.then(() => { renderChips(); renderResults(); });
      }
    } else {
      state.caseId = null;
      state.rubrics = [];
    }
    renderPicker();
    renderChips(); renderResults();

    const input = $('#repInput'), sugg = $('#repSugg'), sel = $('#repSection');
    $('#artOpt').addEventListener('change', e => {
      state.articles = e.target.checked;
      try { localStorage.setItem('articles', state.articles ? '1' : '0'); } catch (err) { /* ignore */ }
      state.rubrics = state.rubrics.map(rb => {
        if (rb.kind !== 'free') return rb;
        const n = makeFreeRubric(rb.text, rb.section);
        n.weight = rb.weight; n.elim = rb.elim; n.excl = rb.excl;
        n.promise.then(() => { renderChips(); renderResults(); });
        return n;
      });
      state.open.clear();
      rerender();
    });
    let items = [], active = -1;
    function closeSugg() { sugg.hidden = true; sugg.innerHTML = ''; items = []; active = -1; }
    function openSugg() {
      const q = input.value.trim();
      if (q.length < 2) { closeSugg(); return; }
      const found = R.suggest(c, q, state.articles ? 10 : 14, state.lang).filter(it => state.articles || (it.rb.k !== 'art' && it.rb.k !== 'line')).slice(0, 10);
      items = [{ free: true, q }].concat(found);
      active = -1;
      sugg.innerHTML = items.map((it, i) => it.free
        ? '<li class="free" data-i="' + i + '"><span>' + esc(t.freeSearch) + ': «' + esc(it.q) + '»' + (sel.value ? ' · ' + esc(sel.value) : '') + '</span><span class="kind">' + esc(t.freeKind) + '</span></li>'
        : '<li data-i="' + i + '"><span>' + esc(it.rb.t) + (it.rb.ch ? ' <span class="kind">+' + it.rb.ch.length + '</span>' : '') + '</span><span class="cnt">' + it.n + ' <span class="kind">' + esc(t.kind[it.rb.k]) + '</span></span></li>').join('');
      sugg.hidden = false;
    }
    function pick(i) {
      const it = items[i];
      if (!it) return;
      if (it.free) addRubric(makeFreeRubric(it.q, sel.value)); else addRubric(makeCatRubric(it.i));
      input.value = ''; closeSugg(); input.focus();
    }
    input.addEventListener('input', openSugg);
    input.addEventListener('input', () => { loadIndex().catch(() => { /* повідомить рубрика */ }); }, { once: true });
    input.addEventListener('focus', openSugg);
    if (window.matchMedia('(hover: hover)').matches && !state.rubrics.length) input.focus();
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
      if (!q) return;
      addRubric(makeFreeRubric(q, sel.value));
      input.value = ''; closeSugg();
    });
    document.addEventListener('click', e => { if (!e.target.closest('#repForm')) closeSugg(); });
  }

  function renderPicker() {
    const body = $('#pickerBody');
    if (!body) return;
    const t = T();
    const c = cat();
    const groups = [['w', t.worse], ['b', t.better], ['e', t.causes]];
    body.innerHTML = groups.map(([g, title]) => {
      const list = c.rubrics.map((rb, i) => ({ rb, i })).filter(x => g === 'e' ? x.rb.k === 'etio' : (x.rb.k === 'mod' && x.rb.key.startsWith(g + '.'))).sort((a, b) => b.rb.r.length - a.rb.r.length);
      return '<div class="picker-group"><div class="picker-title">' + esc(title) + '</div>' + list.map(x => '<button type="button" class="pick" data-i="' + x.i + '">' + esc(catLabel(x.rb)) + ' <span class="n">' + x.rb.r.length + '</span></button>').join('') + '</div>';
    }).join('');
    body.querySelectorAll('button.pick').forEach(b => b.addEventListener('click', () => addRubric(makeCatRubric(+b.dataset.i))));
  }

  // Прапорці рубрики словами — видно лише у друці, замість кнопок керування
  function flagWords(rb) {
    const t = T();
    const f = [];
    if (rb.weight > 1) f.push('×' + rb.weight);
    if (rb.elim) f.push(t.flagElim);
    if (rb.excl) f.push(t.flagExcl);
    return f.length ? ' <span class="chip-flags">(' + esc(f.join(', ')) + ')</span>' : '';
  }
  function renderChips() {
    const box = $('#chips');
    if (!box) return;
    const t = T();
    renderCaseName();
    if (!state.rubrics.length) { box.innerHTML = ''; return; }
    box.innerHTML = state.rubrics.map((rb, k) => {
      const n = rb.pending ? '…' : rb.error ? t.error : (rb.remedies ? rb.remedies.size : 0);
      const corr = rb.res && rb.res.corrections && rb.res.corrections.length ? ' <span class="maybe">' + esc(t.maybe) + ' ' + esc(rb.res.corrections.map(x => x.to[0] + '…').join(', ')) + '</span>' : '';
      const drop = rb.res && rb.res.dropped && rb.res.dropped.length ? ' <span class="maybe">' + esc(t.without) + ' ' + esc(rb.res.dropped.join(', ')) + '</span>' : '';
      return '<span class="chip' + (rb.pending ? ' pending' : '') + (rb.excl ? ' excl' : '') + (rb.elim ? ' elim' : '') + (rb.weight > 1 ? ' weighted' : '') + '"><span class="k">' + esc(t.kind[rb.kind]) + '</span> ' + esc(rb.label) + corr + drop + flagWords(rb) +
        ' <span class="n">' + n + '</span>' +
        '<span class="ctl"><button type="button" data-k="' + k + '" data-act="w" class="' + (rb.weight > 1 ? 'on' : '') + '" title="' + esc(t.weight) + '" aria-label="' + esc(t.weight) + '">×' + rb.weight + '</button>' +
        '<button type="button" data-k="' + k + '" data-act="e" class="' + (rb.elim ? 'on' : '') + '" title="' + esc(t.elim) + '" aria-label="' + esc(t.elim) + '" aria-pressed="' + rb.elim + '">!</button>' +
        '<button type="button" data-k="' + k + '" data-act="x" class="' + (rb.excl ? 'on' : '') + '" title="' + esc(t.excl) + '" aria-label="' + esc(t.excl) + '" aria-pressed="' + rb.excl + '">−</button></span>' +
        '<button type="button" data-k="' + k + '" data-act="rm" title="' + esc(t.remove) + '" aria-label="' + esc(t.removeRubric) + '">×</button></span>';
    }).join('') + (state.rubrics.length > 1 ? ' <button type="button" class="btn secondary small" id="clearAll">' + esc(t.clear) + '</button>' : '');
    box.querySelectorAll('button[data-k]').forEach(b => b.addEventListener('click', () => {
      const k = +b.dataset.k, rb = state.rubrics[k];
      if (b.dataset.act === 'rm') { removeRubric(k); return; }
      if (b.dataset.act === 'w') rb.weight = rb.weight >= 3 ? 1 : rb.weight + 1;
      else if (b.dataset.act === 'e') { rb.elim = !rb.elim; if (rb.elim) rb.excl = false; }
      else if (b.dataset.act === 'x') { rb.excl = !rb.excl; if (rb.excl) rb.elim = false; }
      rerender();
    }));
    const c = $('#clearAll'); if (c) c.addEventListener('click', () => { state.rubrics = []; state.open.clear(); state.cmp = []; state.cmpOpen = false; state.caseId = null; rerender(); });
  }

  // Статті, що відповідають рубрикам: повнотекстові збіги + статті рубрик «Стаття»/«Рядок»
  function articleLine() {
    const t = T();
    const c = cat();
    const acc = new Map();
    const bump = (a, hits, cover) => { let e = acc.get(a); if (!e) acc.set(a, e = { a, cover: 0, hits: 0 }); e.cover += cover; e.hits += hits; };
    let nFree = 0;
    for (const rb of state.rubrics) {
      if (rb.excl) continue;
      if (rb.kind === 'free' && rb.res) { nFree++; for (const [a, e] of rb.res.byArticle) bump(a, e.hits, 1); }
      else if ((rb.kind === 'art' || rb.kind === 'line') && rb.articleIdx != null) bump(rb.articleIdx, 1, 1);
    }
    if (!acc.size) return '';
    const list = Array.from(acc.values()).sort((x, y) => y.cover - x.cover || y.hits - x.hits || x.a - y.a);
    const freeTexts = state.rubrics.filter(rb => rb.kind === 'free' && !rb.excl).map(rb => rb.text).join(' ');
    const shown = state.artShowAll ? list : list.slice(0, 6);
    const li = shown.map(x => '<a href="' + href('article/' + encodeURIComponent(c.articles[x.a].id)) + (freeTexts ? '?hl=' + encodeURIComponent(freeTexts) : '') + '">' + esc(c.articles[x.a].title) + '</a> <span class="n" title="' + esc(t.artHits) + '">' + x.hits + '</span>').join('');
    return '<div class="art-line"><span class="lbl">' + esc(t.artResults) + ' (' + list.length + '):</span> ' + li +
      (list.length > shown.length ? ' <button type="button" class="btn secondary small" id="artMore">' + esc(t.artMore) + ' ' + (list.length - shown.length) + '</button>' : '') + '</div>';
  }

  function renderResults() {
    const box = $('#results');
    if (!box) return;
    const t = T();
    const c = cat();
    const ready = state.rubrics.filter(r => r.remedies);
    if (!state.rubrics.length) { box.innerHTML = ''; return; }
    if (!ready.length) { box.innerHTML = '<p class="muted">' + esc(t.loadingIndex) + '</p>'; return; }
    const rows = R.repertorize(state.rubrics, { sort: state.sort, nameOf: i => c.remedies[i].latin });
    if (state.cmpOpen && state.cmp.length >= 2) { renderCompare(box, rows); return; }
    const sortSel = '<label class="sort">' + esc(t.sort) + ' <select id="sortSel">' + [['cover', t.sortCover], ['total', t.sortTotal], ['name', t.sortName]].map(([v, l]) => '<option value="' + v + '"' + (state.sort === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>';
    if (!rows.length) { box.innerHTML = '<p class="muted small">' + esc(t.nothing) + ' ' + sortSel + '</p>'; bindSort(box); return; }
    const cols = state.rubrics.map((rb, k) => k).filter(k => !state.rubrics[k].excl);
    const shown = rows.slice(0, state.shown);
    const head = '<tr><th>' + esc(t.remedy) + '</th>' + cols.map(k => { const rb = state.rubrics[k]; return '<th class="rub g' + (rb.elim ? ' elim' : '') + '" title="' + esc(rb.label) + '">' + esc(rb.label.length > 28 ? rb.label.slice(0, 26) + '…' : rb.label) + (rb.weight > 1 ? ' <span class="w">×' + rb.weight + '</span>' : '') + '</th>'; }).join('') +
      (cols.length > 1 ? '<th class="g" title="' + esc(t.sumTitle) + '">Σ</th>' : '') + '</tr>';
    const body = shown.map(row => {
      const r = c.remedies[row.r];
      const cells = cols.map(k => { const g = row.grades[k]; return '<td class="g g' + g + '">' + (g ? '<span title="' + row.hits[k] + ' ' + esc(t.hits) + '">' + (state.rubrics[k].kind === 'free' ? row.hits[k] : '●') + '</span>' : '') + '</td>'; }).join('');
      const sum = cols.length > 1 ? '<td class="sum">' + row.cover + '/' + cols.length + (state.sort === 'total' ? ' <span class="muted small">' + row.total + '</span>' : '') + '</td>' : '';
      const checked = state.cmp.includes(row.r);
      const open = state.open.has(row.r);
      const name = '<td class="rem"><input type="checkbox" class="cmp-box" data-r="' + row.r + '"' + (checked ? ' checked' : '') + ' title="' + esc(t.cmpCheck) + '" aria-label="' + esc(t.cmpCheck) + '"> ' +
        '<span class="chev" aria-hidden="true"></span>' + remedyLink(row.r) + (r.translit ? ' <span class="ru">' + esc(r.translit.split(' = ')[0]) + '</span>' : '') + '</td>';
      return '<tr class="row' + (open ? ' open' : '') + '" data-r="' + row.r + '">' + name + cells + sum + '</tr>' +
        (open ? '<tr class="detail" data-r="' + row.r + '"><td colspan="' + (cols.length + 2) + '"><div class="detail-box">' + esc(t.loading) + '</div></td></tr>' : '');
    }).join('');
    const artLine = state.articles ? articleLine() : '';
    const cmpBar = state.cmp.length ? '<div class="cmp-bar">' + esc(t.compareSel) + ' ' + state.cmp.map(i => remedyLink(i)).join(', ') +
      (state.cmp.length >= 2 ? ' <button type="button" class="btn small" id="cmpOpen">' + esc(t.compare) + '</button>' : '') + ' <button type="button" class="btn secondary small" id="cmpClear">' + esc(t.clear) + '</button></div>' : '';
    const allOpen = shown.every(row => state.open.has(row.r));
    const toggleAll = '<button type="button" class="btn secondary small" id="toggleAll" aria-pressed="' + allOpen + '">' + esc(allOpen ? t.collapseAll : t.expandAll) + '</button>';
    const cs = activeCase();
    const caseCtl = '<span class="case-ctl">' +
      '<button type="button" class="btn secondary small" id="caseBtn">' + esc(cs ? t.caseUpdate : t.caseSave) + '</button>' +
      '<span class="case-form" id="caseForm" hidden><input type="text" id="caseNameIn" placeholder="' + esc(t.caseNamePh) + '" aria-label="' + esc(t.caseNamePh) + '">' +
      '<button type="button" class="btn small" id="caseOk">' + esc(t.caseOk) + '</button>' +
      '<button type="button" class="btn secondary small" id="caseCancel">' + esc(t.caseCancel) + '</button></span></span>';
    const printHead = '<div class="print-only">' + (cs ? '<div class="print-case">' + esc(cs.name) + '</div>' : '') +
      '<div class="print-date">' + esc(caseDate(Date.now())) + '</div></div>';
    box.innerHTML = '<p class="muted small results-head">' + esc(t.found(rows.length)) + ' ' + toggleAll + '<span class="head-right">' + sortSel + caseCtl + '</span></p>' + artLine + cmpBar + printHead +
      '<div class="table-wrap"><table class="rep"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      (rows.length > shown.length ? '<div class="more-row"><button type="button" class="btn secondary" id="moreBtn">' + esc(t.more) + '</button></div>' : '') + '</div>';
    bindSort(box);
    box.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('a') || e.target.closest('input')) return;
      const r = +tr.dataset.r;
      if (state.open.has(r)) state.open.delete(r); else state.open.add(r);
      renderResults();
    }));
    box.querySelectorAll('input.cmp-box').forEach(cb => cb.addEventListener('change', () => {
      const r = +cb.dataset.r;
      if (cb.checked) { if (state.cmp.length >= 4) { cb.checked = false; return; } if (!state.cmp.includes(r)) state.cmp.push(r); }
      else state.cmp = state.cmp.filter(x => x !== r);
      writeHash(); renderResults();
    }));
    box.querySelectorAll('tr.detail').forEach(tr => renderDetail(tr, +tr.dataset.r, rows.find(x => x.r === +tr.dataset.r)));
    const more = $('#moreBtn'); if (more) more.addEventListener('click', () => { state.shown += 60; renderResults(); });
    const ta = $('#toggleAll'); if (ta) ta.addEventListener('click', () => { if (allOpen) state.open.clear(); else shown.forEach(row => state.open.add(row.r)); renderResults(); });
    const am = $('#artMore'); if (am) am.addEventListener('click', () => { state.artShowAll = true; renderResults(); });
    const co = $('#cmpOpen'); if (co) co.addEventListener('click', () => { state.cmpOpen = true; writeHash(); renderResults(); });
    const cc = $('#cmpClear'); if (cc) cc.addEventListener('click', () => { state.cmp = []; state.cmpOpen = false; writeHash(); renderResults(); });
    const cb = $('#caseBtn'); if (cb) cb.addEventListener('click', () => {
      const inp = $('#caseNameIn');
      inp.value = cs ? cs.name : defaultCaseName();
      $('#caseForm').hidden = false; cb.hidden = true;
      inp.focus(); inp.select();
    });
    const cok = $('#caseOk'); if (cok) cok.addEventListener('click', () => { saveCase($('#caseNameIn').value.trim()); renderCaseName(); renderResults(); });
    const ccl = $('#caseCancel'); if (ccl) ccl.addEventListener('click', () => { $('#caseForm').hidden = true; $('#caseBtn').hidden = false; });
    const cin = $('#caseNameIn'); if (cin) cin.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); $('#caseOk').click(); }
      else if (e.key === 'Escape') { e.preventDefault(); $('#caseCancel').click(); }
    });
  }
  function bindSort(box) {
    const s = $('#sortSel', box);
    if (s) s.addEventListener('change', () => { state.sort = s.value; writeHash(); renderResults(); });
  }

  // Підстави повнотекстової рубрики для препарату: [{sec, html}] (речення зі збігом)
  async function freeEvidence(rb, rIdx, max) {
    const idx = state.idx[state.lang];
    const c = cat();
    const e = rb.res.byRemedy.get(rIdx);
    const out = [];
    if (!e) return out;
    const list = e.paras.map(k => rb.res.paras[k]).sort((a, b) => (b.strong - a.strong) || (a.p - b.p));
    const rem = list.filter(x => idx.docs[idx.pd[x.p]].t === 'r');
    const art = list.filter(x => idx.docs[idx.pd[x.p]].t === 'a').slice(0, 3);
    const r = c.remedies[rIdx];
    if (rem.length && !r.ext) {
      const doc = await getDoc('remedies', r.id);
      for (const x of rem.slice(0, max)) {
        const sec = doc.sections[idx.ps[x.p]];
        const md = sec.paras[idx.pp[x.p]];
        const ords = x.units.map(u => u - idx.pstart[x.p]);
        out.push({ sec: sec.title, html: inner(renderPara(sentenceSnippet(md, ords, rb.res.stems), { hl: rb.res.stems, selfIdx: rIdx })), strong: x.strong });
      }
    }
    for (const x of art) {
      const d = idx.docs[idx.pd[x.p]];
      const a = c.articles[d.a];
      const doc = await getDoc('articles', a.id);
      const md = doc.blocks[idx.ps[x.p]].paras[idx.pp[x.p]];
      const ords = x.units.map(u => u - idx.pstart[x.p]);
      out.push({ article: a, html: inner(renderPara(sentenceSnippet(md, ords, rb.res.stems), { hl: rb.res.stems })), strong: x.strong });
    }
    return { items: out, moreRem: Math.max(0, rem.length - max) };
  }
  function modClauses(doc, rb) {
    const key = rb.key;
    if (rb.kind === 'mod') { const d = key[0], cid = key.slice(2); return (doc.mods || []).filter(m => m.d === d && m.c.includes(cid)).map(m => m.t).filter(Boolean); }
    return (doc.etio || []).filter(e => e.c.includes(key)).map(e => e.t).filter(Boolean);
  }

  async function renderDetail(tr, rIdx, row) {
    const t = T();
    const c = cat();
    const r = c.remedies[rIdx];
    const box = $('.detail-box', tr);
    const parts = [];
    let doc = null;
    for (let k = 0; k < state.rubrics.length; k++) {
      const rb = state.rubrics[k];
      if (!row.hits[k]) continue;
      let html = '<div class="evid"><h4>' + esc(t.kind[rb.kind]) + ': ' + esc(rb.label) + '</h4>';
      try {
        if (rb.kind === 'nos') {
          const v = rb.remedies.get(rIdx);
          const via = v && v.child != null ? ' <span class="muted small">(' + esc(t.evSub) + ' «' + esc(c.rubrics[v.child].t) + '»)</span>' : '';
          html += '<p>' + esc(t.evClinic) + ' <b>' + esc(v && v.child != null ? c.rubrics[v.child].t : rb.text) + '</b>' + via + (r.ext ? '' : ' — <a href="' + href('remedy/' + encodeURIComponent(r.id)) + '?sec=' + encodeURIComponent(CLINIC[state.lang]) + '">' + esc(t.open) + '</a>') + '</p>';
        } else if (rb.kind === 'art') {
          html += '<p>' + esc(t.evArt) + ' <a href="' + href('article/' + encodeURIComponent(rb.articleId)) + '?r=' + rIdx + '">«' + esc(rb.text) + '»</a>.</p>';
        } else if (rb.kind === 'line') {
          html += '<p>' + esc(t.evLine) + ' <a href="' + href('article/' + encodeURIComponent(rb.articleId)) + '?r=' + rIdx + '">«' + esc(c.articles[rb.articleIdx].title) + '»</a>: ' + esc(rb.text.slice(rb.text.indexOf(': ') + 2)) + '</p>';
        } else if (rb.kind === 'mod' || rb.kind === 'etio') {
          if (!doc && !r.ext) doc = await getDoc('remedies', r.id);
          const cl = doc ? modClauses(doc, rb) : [];
          const sec = rb.kind === 'mod' ? MODAL[state.lang] : ETIOL[state.lang];
          html += '<p>' + esc(rb.kind === 'mod' ? t.evMod : t.evEtio) + ' ' + (cl.length ? cl.map(x => '<b>' + esc(x) + '</b>').join('; ') : esc(rb.label)) + (r.ext ? '' : ' — <a href="' + href('remedy/' + encodeURIComponent(r.id)) + '?sec=' + encodeURIComponent(sec) + '">' + esc(t.open) + '</a>') + '</p>';
        } else if (rb.kind === 'free' && rb.res) {
          const ev = await freeEvidence(rb, rIdx, 5);
          for (const it of ev.items) {
            html += it.article
              ? '<p><span class="sec">' + esc(t.evArticle) + ' «<a href="' + href('article/' + encodeURIComponent(it.article.id)) + '?r=' + rIdx + '">' + esc(it.article.title) + '</a>»:</span> ' + it.html + '</p>'
              : '<p><span class="sec">' + esc(it.sec) + ':</span> ' + it.html + '</p>';
          }
          if (ev.moreRem > 0) html += '<p class="muted small">' + esc(t.evMore(ev.moreRem)) + '<a href="' + href('remedy/' + encodeURIComponent(r.id)) + '?hl=' + encodeURIComponent(rb.text) + '">' + esc(t.evOpenRemedy) + '</a></p>';
        }
      } catch (e) { html += '<p class="error">' + esc(e.message) + '</p>'; }
      parts.push(html + '</div>');
    }
    if (!r.ext) {
      try {
        if (!doc) doc = await getDoc('remedies', r.id);
        const rel = relHtml(doc, rIdx);
        if (rel) parts.push('<div class="evid"><h4>' + esc(t.relTitle) + '</h4>' + rel + '</div>');
      } catch (e) { /* ignore */ }
    }
    if (!tr.isConnected) return;
    box.innerHTML = parts.join('') || '<p class="muted">' + esc(t.noData) + '</p>';
  }
  function relHtml(doc, selfIdx) {
    const t = T();
    if (!doc.rel || !doc.rel.length) return '';
    const byKind = new Map();
    for (const x of doc.rel) { if (!byKind.has(x.k)) byKind.set(x.k, new Set()); x.r.forEach(i => { if (i !== selfIdx) byKind.get(x.k).add(i); }); }
    const order = ['compl', 'after', 'before', 'ant', 'incompat', 'cmp', 'other'];
    return order.filter(k => byKind.has(k) && byKind.get(k).size).map(k => '<p class="rel"><span class="sec">' + esc(t.rel[k]) + ':</span> ' + Array.from(byKind.get(k)).slice(0, 14).map(i => remedyLink(i)).join(', ') + (byKind.get(k).size > 14 ? ' …' : '') + '</p>').join('');
  }

  // ---------------------------------------------------------------- порівняння
  async function renderCompare(box, rows) {
    const t = T();
    const c = cat();
    const ids = state.cmp.slice();
    box.innerHTML = '<p class="muted">' + esc(t.loading) + '</p>';
    const docs = await Promise.all(ids.map(i => c.remedies[i].ext ? null : getDoc('remedies', c.remedies[i].id).catch(() => null)));
    const rowOf = new Map(rows.map(r => [r.r, r]));
    const cols = state.rubrics.map((rb, k) => k).filter(k => !state.rubrics[k].excl);
    let html = '<div class="cmp-head"><h2>' + esc(t.compareTitle) + '</h2><button type="button" class="btn secondary small" id="cmpClose">' + esc(t.close) + '</button></div>';
    html += '<div class="table-wrap"><table class="rep cmp"><thead><tr><th></th>' + ids.map(i => '<th>' + remedyLink(i) + '</th>').join('') + '</tr></thead><tbody>';
    for (const k of cols) {
      const rb = state.rubrics[k];
      const cells = [];
      for (let j = 0; j < ids.length; j++) {
        const i = ids[j];
        const row = rowOf.get(i);
        const g = row ? row.grades[k] : 0;
        let ev = '';
        if (g) {
          const v = rb.remedies.get(i);
          if (rb.kind === 'nos') ev = esc(v && v.child != null ? c.rubrics[v.child].t : rb.text);
          else if (rb.kind === 'mod' || rb.kind === 'etio') ev = docs[j] ? modClauses(docs[j], rb).map(esc).join('; ') : '';
          else if (rb.kind === 'art' || rb.kind === 'line') ev = '<a href="' + href('article/' + encodeURIComponent(rb.articleId)) + '?r=' + i + '">' + esc(c.articles[rb.articleIdx].title) + '</a>';
          else if (rb.kind === 'free' && rb.res) { try { const e = await freeEvidence(rb, i, 2); ev = e.items.map(x => (x.sec ? '<span class="sec">' + esc(x.sec) + ':</span> ' : '') + x.html).join('<br>'); } catch (e) { ev = ''; } }
        }
        cells.push('<td class="c' + (g ? ' g' + g : '') + '">' + (g ? '<span class="dot g' + g + '" title="' + g + '">' + (rb.kind === 'free' ? row.hits[k] : '●') + '</span> ' : '') + ev + '</td>');
      }
      html += '<tr><th class="lbl">' + esc(t.kind[rb.kind]) + ': ' + esc(rb.label) + '</th>' + cells.join('') + '</tr>';
    }
    if (cols.length > 1) html += '<tr><th class="lbl">Σ</th>' + ids.map(i => { const row = rowOf.get(i); return '<td class="c"><b>' + (row ? row.cover + '/' + cols.length + ' · ' + row.total : '0') + '</b></td>'; }).join('') + '</tr>';
    const labels = modLabels();
    const modRow = (dir, title) => '<tr><th class="lbl">' + esc(title) + '</th>' + ids.map((i, j) => {
      const d = docs[j]; if (!d) return '<td class="c"></td>';
      const cats = new Map();
      for (const m of (d.mods || [])) if (m.d === dir) for (const cid of m.c) { const L = labels.get('m:' + dir + '.' + cid); if (L && !cats.has(cid)) cats.set(cid, L); }
      return '<td class="c">' + Array.from(cats.values()).map(L => '<a class="tag" href="' + href('rep') + '?r=' + encodeURIComponent('m:' + dir + '.' + Array.from(cats.keys())[Array.from(cats.values()).indexOf(L)]) + '">' + esc(L.label) + '</a>').join(' ') + '</td>';
    }).join('') + '</tr>';
    html += modRow('w', t.worse) + modRow('b', t.better);
    html += '<tr><th class="lbl">' + esc(t.causes) + '</th>' + ids.map((i, j) => {
      const d = docs[j]; if (!d) return '<td class="c"></td>';
      const cats = new Map();
      for (const e of (d.etio || [])) for (const cid of e.c) { const L = labels.get('e:' + cid); if (L && !cats.has(cid)) cats.set(cid, L); }
      return '<td class="c">' + Array.from(cats, ([cid, L]) => '<a class="tag" href="' + href('rep') + '?r=' + encodeURIComponent('e:' + cid) + '">' + esc(L.label) + '</a>').join(' ') + '</td>';
    }).join('') + '</tr>';
    html += '<tr><th class="lbl">' + esc(t.relTitle) + '</th>' + ids.map((i, j) => '<td class="c">' + (docs[j] ? relHtml(docs[j], i) : '') + '</td>').join('') + '</tr>';
    html += '</tbody></table></div>';
    if (!$('#results')) return;
    box.innerHTML = html;
    $('#cmpClose').addEventListener('click', () => { state.cmpOpen = false; writeHash(); renderResults(); });
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
    const hl = params.get('hl') ? Array.from(new Set(SC.queryTerms(params.get('hl'), state.lang).inc.flatMap(x => x.alts))) : null;
    const secId = s => 'sec-' + s.replace(/[^\wа-яёіїєґ]+/gi, '-').toLowerCase();
    const inArticles = c.articles.map((a, i) => ({ a, i })).filter(x => x.a.rem.includes(rIdx));
    const labels = modLabels();
    let html = '<div class="doc-head"><h1>' + esc(doc.latin) + (doc.alt ? ' <span class="muted">(' + esc(doc.alt) + ')</span>' : '') + '</h1>' +
      '<div class="sub">' + esc([doc.translit, doc.common].filter(Boolean).join(' — ')) + '</div>' +
      (doc.source ? '<div class="meta">' + esc(t.source) + ' ' + esc(doc.source) + '</div>' : '') + '</div>';
    html += '<nav class="toc" aria-label="' + esc(t.sections) + '">' + doc.sections.map(s => '<a href="#' + secId(s.title) + '">' + esc(s.title) + '</a>').join('') + '</nav>';
    html += '<div class="doc">';
    const tagLinks = (dir, kind) => {
      const seen = new Map();
      const items = kind === 'mod' ? (doc.mods || []).filter(m => m.d === dir) : (doc.etio || []);
      for (const it of items) for (const cid of it.c) { const key = kind === 'mod' ? 'm:' + dir + '.' + cid : 'e:' + cid; const L = labels.get(key); if (L && !seen.has(key)) seen.set(key, L.label); }
      return Array.from(seen, ([key, L]) => '<a href="' + href('rep') + '?r=' + encodeURIComponent(key) + '" title="' + esc(t.addRubric) + '">' + esc(L) + '</a>').join('');
    };
    for (const s of doc.sections) {
      html += '<h2 id="' + secId(s.title) + '">' + esc(s.title) + '</h2>';
      if (s.title === CLINIC[state.lang]) {
        const terms = [];
        for (const p of s.paras) for (const x of p.replace(/\*\*|_/g, '').split(/[.;]\s+|\.$/)) { const y = x.replace(/^[\s•\-–—]+|[\s.]+$/g, ''); if (y.length >= 3 && y.length <= 70) terms.push(y); }
        html += '<div class="tags">' + terms.map(x => '<a href="' + href('rep') + '?r=' + encodeURIComponent('n:' + x) + '" title="' + esc(t.addRubric) + '">' + esc(x) + '</a>').join('') + '</div>';
      } else {
        html += s.paras.map(p => renderPara(p, { hl, selfIdx: rIdx })).join('');
        if (s.title === MODAL[state.lang]) {
          const w = tagLinks('w', 'mod'), b = tagLinks('b', 'mod');
          if (w) html += '<div class="tags mod"><span class="lbl">' + esc(t.worse) + ':</span>' + w + '</div>';
          if (b) html += '<div class="tags mod"><span class="lbl">' + esc(t.better) + ':</span>' + b + '</div>';
        } else if (s.title === ETIOL[state.lang]) {
          const e = tagLinks(null, 'etio');
          if (e) html += '<div class="tags mod">' + e + '</div>';
        }
      }
    }
    html += '</div>';
    if (inArticles.length) {
      html += '<div class="aside"><h2>' + esc(t.inArticles) + '</h2><ul class="list">' + inArticles.map(x => '<li><a href="' + href('article/' + encodeURIComponent(x.a.id)) + '?r=' + rIdx + '">' + esc(x.a.title) + '</a> <span class="muted small">' + esc(TOPIC[state.lang][x.a.topic] || x.a.topic) + '</span></li>').join('') + '</ul></div>';
    }
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
    const hl = params.get('hl') ? Array.from(new Set(SC.queryTerms(params.get('hl'), state.lang).inc.flatMap(x => x.alts))) : null;
    let html = '<div class="doc-head"><h1>' + esc(doc.title) + '</h1><div class="meta">' + esc(TOPIC[state.lang][a.topic] || a.topic) +
      (doc.author ? ' · ' + esc(t.author) + ' ' + esc(doc.author) : '') + (doc.source ? ' · ' + esc(t.source) + ' ' + esc(doc.source) : '') + '</div></div>';
    if (a.rem.length) {
      const mobile = window.matchMedia('(max-width: 640px)').matches;
      html += '<details class="tagbox"' + (mobile ? '' : ' open') + '><summary>' + esc(t.nRemedies(a.rem.length)) + '</summary><div class="tags">' + a.rem.map(i => c.remedies[i].ext ? '<span class="muted small">' + esc(c.remedies[i].latin) + '</span>' : '<a href="' + href('remedy/' + encodeURIComponent(c.remedies[i].id)) + '">' + esc(c.remedies[i].latin) + '</a>').join('') + '</div></details>';
      if (a.group === 'lechebnik' && a.rem.length >= 2) html += '<p class="small"><a href="' + href('rep') + '?r=' + encodeURIComponent('a:' + a.id) + '">' + esc(t.addArticle) + '</a></p>';
    }
    html += '<div class="doc">';
    doc.blocks.forEach((b, bi) => {
      const isFocus = focus >= 0 && b.rem.includes(focus);
      if (b.kind === 'remedy') {
        const links = b.rem.filter(i => !c.remedies[i].ext);
        const title = links.length ? '<a href="' + href('remedy/' + encodeURIComponent(c.remedies[links[0]].id)) + '">' + esc(b.title) + '</a>' : esc(b.title);
        html += '<div class="block' + (isFocus ? ' hl' : '') + '" id="blk-' + bi + '"><h3>' + title + '</h3>' + b.paras.map(p => renderPara(p, { hl })).join('') + '</div>';
      } else if (b.kind === 'sub') {
        html += '<h2 id="blk-' + bi + '">' + esc(b.title) + '</h2>' + b.paras.map(p => renderPara(p, { hl })).join('');
      } else {
        html += b.paras.map(p => renderPara(p, { hl })).join('');
      }
    });
    html += '</div>';
    view.innerHTML = html;
    const f = view.querySelector('.block.hl');
    if (f) setTimeout(() => f.scrollIntoView({ block: 'start' }), 0);
    else if (hl) { const m = view.querySelector('mark'); if (m) setTimeout(() => m.scrollIntoView({ block: 'center' }), 0); }
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
    // На друк — усі знайдені рядки, після друку повертаємо сторінкове обмеження
    let shownBeforePrint = null;
    window.addEventListener('beforeprint', () => {
      if (shownBeforePrint != null) return;
      shownBeforePrint = state.shown;
      state.shown = Infinity;
      renderResults();
    });
    window.addEventListener('afterprint', () => {
      if (shownBeforePrint == null) return;
      state.shown = shownBeforePrint;
      shownBeforePrint = null;
      renderResults();
    });
    window.addEventListener('hashchange', route);
    route();
    initServiceWorker();
  }
  init();
})();
