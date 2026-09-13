/* app.js — інтерфейс реперторію (без залежностей; хеш-маршрутизація для GitHub Pages) */
(function () {
  'use strict';
  const R = window.Repertory, SC = window.SearchCore;
  const $ = (sel, root) => (root || document).querySelector(sel);

  const SECTIONS = ['Психика', 'Голова', 'Головокружение', 'Глаза', 'Уши', 'Нос', 'Лицо', 'Рот', 'Зубы', 'Горло', 'Аппетит', 'Желудок', 'Живот',
    'Анус и прямая кишка', 'Мочевыделительная система', 'Мужские', 'Женские', 'Менструация', 'Беременность. Роды', 'Молочные железы', 'Дыхательная система',
    'Кашель', 'Грудная клетка', 'Сердце и кровообращение', 'Шея', 'Спина', 'Конечности', 'Суставы', 'Мышцы', 'Кости', 'Нервная система', 'Сон', 'Лихорадка',
    'Пот', 'Кожа', 'Общие симптомы', 'Модальности', 'Этиология', 'Характеристика', 'Тип', 'Клиника', 'Взаимосвязи'];
  const TOPIC_ORDER = ['Дихання, горло, ніс, вуха', 'Травлення', 'Серце і судини', 'Психіка, сон, нервова система', 'Шкіра, волосся, нігті', 'Суглоби, м’язи, травми',
    'Сечостатева сфера', 'Вагітність, пологи, годування', 'Немовлята й діти', 'Синдром хронічної втоми', 'Різне', 'Квіткові настої д-ра Баха', 'Про гомеопатію'];
  const KIND_LABEL = { free: 'Текст', nos: 'Клініка', art: 'Стаття', line: 'Рубрика' };

  const state = { catalog: null, index: null, indexPromise: null, docs: new Map(), rubrics: [], shown: 60, open: new Set(), nameRe: null, nameMap: null };

  // ---------------------------------------------------------------- утиліти
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  async function fetchJson(rel) {
    const res = await fetch(rel, { cache: 'force-cache' });
    if (!res.ok) throw new Error(rel + ': ' + res.status);
    return res.json();
  }
  function getDoc(kind, id) {
    const key = kind + '/' + id;
    if (!state.docs.has(key)) state.docs.set(key, fetchJson('data/' + kind + '/' + encodeURIComponent(id) + '.json'));
    return state.docs.get(key);
  }
  function loadIndex() {
    if (!state.indexPromise) state.indexPromise = fetchJson('data/index.json').then(j => { state.index = R.makeIndex(j); return state.index; });
    return state.indexPromise;
  }
  function remedyName(r) { return r.latin + (r.translit ? ' (' + r.translit.split(' = ')[0] + ')' : ''); }
  function remedyLink(i, cls) {
    const r = state.catalog.remedies[i];
    if (r.ext) return '<span class="' + (cls || '') + '">' + esc(r.latin) + ' <span class="ext">без сторінки</span></span>';
    return '<a class="' + (cls || '') + '" href="#/remedy/' + encodeURIComponent(r.id) + '">' + esc(r.latin) + '</a>';
  }

  // ---------------------------------------------------------------- тема
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
    try { if (t) localStorage.setItem('theme', t); else localStorage.removeItem('theme'); } catch (e) { /* ignore */ }
  }
  function initTheme() {
    let t = null;
    try { t = localStorage.getItem('theme'); } catch (e) { /* ignore */ }
    if (t) applyTheme(t);
    $('#themeBtn').addEventListener('click', () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      applyTheme(dark ? 'light' : 'dark');
    });
  }

  // ---------------------------------------------------------------- розмітка тексту
  function buildNameLinker() {
    const names = [];
    const map = new Map();
    const first = new Map();
    state.catalog.remedies.forEach((r, i) => {
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
    state.nameMap = map;
    state.nameRe = new RegExp('(^|[^A-Za-z>/])(' + names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![A-Za-z])', 'g');
  }
  function linkNames(html, selfIdx) {
    if (!state.nameRe) return html;
    return html.replace(state.nameRe, (m, pre, name) => {
      const i = state.nameMap.get(name);
      if (i === undefined || i === selfIdx) return m;
      return pre + '<a href="#/remedy/' + encodeURIComponent(state.catalog.remedies[i].id) + '">' + name + '</a>';
    });
  }
  function highlightHtml(html, stems) {
    if (!stems || !stems.length) return html;
    const pats = stems.filter(s => s.length >= 3).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]'));
    if (!pats.length) return html;
    const re = new RegExp('(^|[^а-яёa-z])(' + pats.join('|') + ')([а-яёa-z]*)', 'gi');
    return html.split(/(<[^>]+>)/).map(part => part.startsWith('<') ? part : part.replace(re, '$1<mark>$2$3</mark>')).join('');
  }
  // Вікно навколо першого збігу для довгих абзаців у підставах
  function snippet(md, stems) {
    if (md.length <= 420) return md;
    const plain = md.replace(/\*\*|_/g, '');
    const low = plain.toLowerCase();
    let pos = -1;
    for (const st of stems || []) { if (st.length < 3) continue; const i = low.indexOf(st.replace(/е/g, 'е')); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
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
    const { seg, params } = parseHash();
    const view = $('#view');
    try {
      if (!seg.length || seg[0] === 'rep') { setNav('rep'); await viewRepertory(view, params); }
      else if (seg[0] === 'remedies') { setNav('remedies'); viewRemedies(view, params); }
      else if (seg[0] === 'remedy' && seg[1]) { setNav('remedies'); await viewRemedy(view, seg[1], params); }
      else if (seg[0] === 'articles') { setNav('articles'); viewArticles(view); }
      else if (seg[0] === 'article' && seg[1]) { setNav('articles'); await viewArticle(view, seg[1], params); }
      else { view.innerHTML = '<p class="error">Сторінку не знайдено.</p>'; }
    } catch (e) {
      console.error(e);
      view.innerHTML = '<p class="error">Не вдалося завантажити дані: ' + esc(e.message) + '</p>';
    }
    if (!params.get('r') || seg[0] !== 'rep') window.scrollTo(0, 0);
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
    const cat = state.catalog;
    if (k === 'f:') { const t = body.indexOf('~'); return makeFreeRubric(body.slice(t + 1), body.slice(0, t)); }
    if (k === 'n:') { const i = cat.rubrics.findIndex(r => r.k === 'nos' && r.t === body); return i >= 0 ? makeCatRubric(i) : null; }
    if (k === 'a:') { const i = cat.rubrics.findIndex(r => r.k === 'art' && cat.articles[r.a].id === body); return i >= 0 ? makeCatRubric(i) : null; }
    if (k === 'l:') { const i = cat.rubrics.findIndex(r => r.k === 'line' && r.t === body); return i >= 0 ? makeCatRubric(i) : null; }
    return null;
  }
  function makeCatRubric(i) {
    const rb = state.catalog.rubrics[i];
    const r = { kind: rb.k, text: rb.t, catIdx: i, remedies: new Map(rb.r.map(x => [x, 2])), label: rb.t };
    if (rb.k === 'art') { r.articleId = state.catalog.articles[rb.a].id; r.articleIdx = rb.a; }
    if (rb.k === 'line') { r.articleIdx = rb.a; r.articleId = state.catalog.articles[rb.a].id; }
    return r;
  }
  function makeFreeRubric(text, section) {
    text = text.trim();
    if (!text) return null;
    const r = { kind: 'free', text, section: section || '', remedies: null, label: text + (section ? ' · ' + section : ''), pending: true };
    r.promise = loadIndex().then(idx => {
      r.res = R.freeText(idx, text, r.section);
      r.remedies = new Map(Array.from(r.res.byRemedy, ([k, v]) => [k, v.hits]));
      r.pending = false;
      return r;
    });
    return r;
  }
  function writeHash() {
    const specs = state.rubrics.map(rubricSpec).join('|');
    const h = '#/rep' + (specs ? '?r=' + encodeURIComponent(specs) : '');
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
    const cat = state.catalog;
    view.innerHTML = `
      <div class="home-intro">
        <h1>Підбір препаратів за симптомами</h1>
        <p class="muted">Додайте один або кілька симптомів чи хвороб. Підказки пропонують рубрики з розділу «Клиника» Materia Medica Кларка та зі статей лікувальника; можна шукати і будь-який текст. У таблиці препарати впорядковано за кількістю покритих рубрик.</p>
      </div>
      <form class="rep-search" id="repForm" autocomplete="off">
        <div class="box">
          <input type="search" id="repInput" placeholder="Симптом, хвороба або рубрика…" aria-label="Симптом або хвороба">
          <ul class="dropdown" id="repSugg" hidden></ul>
        </div>
        <select id="repSection" aria-label="Розділ для текстового пошуку">
          <option value="">Усі розділи</option>
          ${SECTIONS.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('')}
        </select>
        <button class="btn" type="submit">Додати</button>
      </form>
      <div class="chips" id="chips"></div>
      <div id="results"></div>`;
    // відновити рубрики з URL
    const spec = params.get('r');
    if (spec) {
      const specs = spec.split('|');
      const same = specs.length === state.rubrics.length && specs.every((s, i) => rubricSpec(state.rubrics[i]) === s);
      if (!same) {
        state.rubrics = specs.map(rubricFromSpec).filter(Boolean);
        state.open.clear();
        for (const rb of state.rubrics) if (rb.pending) rb.promise.then(() => { renderChips(); renderResults(); });
      }
    } else if (!params.has('keep')) {
      state.rubrics = [];
    }
    renderChips(); renderResults();

    const input = $('#repInput'), sugg = $('#repSugg'), sel = $('#repSection');
    let items = [], active = -1;
    function closeSugg() { sugg.hidden = true; sugg.innerHTML = ''; items = []; active = -1; }
    function openSugg() {
      const q = input.value.trim();
      if (q.length < 2) { closeSugg(); return; }
      const found = R.suggest(cat, q, 10);
      items = [{ free: true, q }].concat(found);
      active = -1;
      sugg.innerHTML = items.map((it, i) => it.free
        ? '<li class="free" data-i="' + i + '"><span>Шукати в текстах: «' + esc(it.q) + '»' + (sel.value ? ' · ' + esc(sel.value) : '') + '</span><span class="kind">повнотекстово</span></li>'
        : '<li data-i="' + i + '"><span>' + esc(it.rb.t) + '</span><span class="cnt">' + it.rb.r.length + ' <span class="kind">' + esc(KIND_LABEL[it.rb.k]) + '</span></span></li>').join('');
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
    if (!state.rubrics.length) {
      box.innerHTML = '<span class="muted small">Приклади: ' +
        [['страх смерти', 'f:~страх смерти'], ['Астма', 'n:Астма'], ['головная боль хуже от движения', 'f:~головная боль хуже от движения'], ['Бронхит (стаття)', 'a:bronhit']]
          .map(([t, s]) => '<a href="#/rep?r=' + encodeURIComponent(s) + '">' + esc(t) + '</a>').join(' · ') + '</span>';
      return;
    }
    box.innerHTML = state.rubrics.map((rb, k) => {
      const n = rb.pending ? '…' : rb.error ? 'помилка' : (rb.remedies ? rb.remedies.size : 0);
      return '<span class="chip' + (rb.pending ? ' pending' : '') + '"><span class="k">' + esc(KIND_LABEL[rb.kind]) + '</span> ' + esc(rb.label) +
        ' <span class="n">' + n + '</span><button type="button" data-k="' + k + '" title="Прибрати" aria-label="Прибрати рубрику">×</button></span>';
    }).join('') + (state.rubrics.length > 1 ? ' <button type="button" class="btn secondary small" id="clearAll">Очистити</button>' : '');
    box.querySelectorAll('button[data-k]').forEach(b => b.addEventListener('click', () => removeRubric(+b.dataset.k)));
    const c = $('#clearAll'); if (c) c.addEventListener('click', () => { state.rubrics = []; state.open.clear(); writeHash(); renderChips(); renderResults(); });
  }

  function renderResults() {
    const box = $('#results');
    if (!box) return;
    const cat = state.catalog;
    const ready = state.rubrics.filter(r => r.remedies);
    if (!state.rubrics.length) { box.innerHTML = ''; return; }
    if (!ready.length) { box.innerHTML = '<p class="muted">Завантаження індексу…</p>'; return; }
    const rows = R.repertorize(state.rubrics);
    if (!rows.length) { box.innerHTML = '<p class="muted">Нічого не знайдено. Спробуйте інше формулювання або коротше слово.</p>'; return; }
    const shown = rows.slice(0, state.shown);
    const head = '<tr><th>Препарат</th>' + state.rubrics.map(rb => '<th class="rub g" title="' + esc(rb.label) + '">' + esc(rb.label.length > 28 ? rb.label.slice(0, 26) + '…' : rb.label) + '</th>').join('') +
      (state.rubrics.length > 1 ? '<th class="g" title="Покрито рубрик / сума балів">Σ</th>' : '') + '</tr>';
    const body = shown.map(row => {
      const r = cat.remedies[row.r];
      const cells = row.grades.map((g, k) => '<td class="g g' + g + '">' + (g ? '<span title="' + row.hits[k] + ' зб.">' + (state.rubrics[k].kind === 'free' ? row.hits[k] : '●') + '</span>' : '') + '</td>').join('');
      const sum = state.rubrics.length > 1 ? '<td class="sum">' + row.cover + '/' + state.rubrics.length + '</td>' : '';
      const name = '<td class="rem">' + remedyLink(row.r) + (r.translit ? ' <span class="ru">' + esc(r.translit.split(' = ')[0]) + '</span>' : '') + '</td>';
      const open = state.open.has(row.r);
      return '<tr class="row' + (open ? ' open' : '') + '" data-r="' + row.r + '">' + name + cells + sum + '</tr>' +
        (open ? '<tr class="detail" data-r="' + row.r + '"><td colspan="' + (state.rubrics.length + 2) + '"><div class="detail-box">Завантаження…</div></td></tr>' : '');
    }).join('');
    box.innerHTML = '<p class="muted small">Знайдено препаратів: ' + rows.length + '. Натисніть на рядок, щоб побачити підстави.</p>' +
      '<div class="table-wrap"><table class="rep"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      (rows.length > shown.length ? '<div class="more-row"><button type="button" class="btn secondary" id="moreBtn">Показати ще</button></div>' : '') + '</div>';
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
    const cat = state.catalog;
    const r = cat.remedies[rIdx];
    const box = $('.detail-box', tr);
    const parts = [];
    for (let k = 0; k < state.rubrics.length; k++) {
      const rb = state.rubrics[k];
      if (!row.hits[k]) continue;
      let html = '<div class="evid"><h4>' + esc(KIND_LABEL[rb.kind]) + ': ' + esc(rb.label) + '</h4>';
      if (rb.kind === 'nos') {
        html += '<p>У розділі «Клиника» Materia Medica: <b>' + esc(rb.text) + '</b>' + (r.ext ? '' : ' — <a href="#/remedy/' + encodeURIComponent(r.id) + '?sec=Клиника">відкрити</a>') + '</p>';
      } else if (rb.kind === 'art') {
        html += '<p>Препарат описано у статті <a href="#/article/' + encodeURIComponent(rb.articleId) + '?r=' + rIdx + '">«' + esc(rb.text) + '»</a>.</p>';
      } else if (rb.kind === 'line') {
        html += '<p>Рубрика зі статті <a href="#/article/' + encodeURIComponent(rb.articleId) + '?r=' + rIdx + '">«' + esc(cat.articles[rb.articleIdx].title) + '»</a>: ' + esc(rb.text.slice(rb.text.indexOf(': ') + 2)) + '</p>';
      } else if (rb.kind === 'free' && rb.res) {
        const idx = state.index;
        const units = rb.res.byRemedy.get(rIdx).units;
        const remUnits = units.filter(u => idx.docs[idx.ud[u]].t === 'r').slice(0, 5);
        const artUnits = units.filter(u => idx.docs[idx.ud[u]].t === 'a').slice(0, 3);
        try {
          if (remUnits.length) {
            const doc = await getDoc('remedies', r.id);
            for (const u of remUnits) {
              const si = idx.us[u], pi = idx.up[u];
              const sec = doc.sections[si];
              html += '<p><span class="sec">' + esc(sec.title) + ':</span> ' + renderPara(snippet(sec.paras[pi], rb.res.stems), { hl: rb.res.stems, selfIdx: rIdx }).slice(3, -4) + '</p>';
            }
            if (units.filter(u => idx.docs[idx.ud[u]].t === 'r').length > 5) html += '<p class="muted small">… та ще ' + (units.filter(u => idx.docs[idx.ud[u]].t === 'r').length - 5) + ' — <a href="#/remedy/' + encodeURIComponent(r.id) + '?hl=' + encodeURIComponent(rb.text) + '">переглянути препарат</a></p>';
          }
          for (const u of artUnits) {
            const d = idx.docs[idx.ud[u]];
            const a = cat.articles[d.a];
            const doc = await getDoc('articles', a.id);
            const bi = idx.us[u], pi = idx.up[u];
            html += '<p><span class="sec">Стаття «<a href="#/article/' + encodeURIComponent(a.id) + '?r=' + rIdx + '">' + esc(a.title) + '</a>»:</span> ' + renderPara(snippet(doc.blocks[bi].paras[pi], rb.res.stems), { hl: rb.res.stems }).slice(3, -4) + '</p>';
          }
        } catch (e) { html += '<p class="error">' + esc(e.message) + '</p>'; }
      }
      parts.push(html + '</div>');
    }
    if (!tr.isConnected) return;
    box.innerHTML = parts.join('') || '<p class="muted">Немає даних.</p>';
  }

  // ---------------------------------------------------------------- препарати
  function viewRemedies(view, params) {
    const cat = state.catalog;
    const list = cat.remedies.map((r, i) => ({ r, i })).filter(x => !x.r.ext);
    view.innerHTML = '<h1>Препарати</h1><p class="muted">Materia Medica Дж. Г. Кларка — ' + list.length + ' препаратів. Латинська назва, транслітерація, звичайна назва.</p>' +
      '<input type="search" class="filter" id="remFilter" placeholder="Фільтр за назвою…" aria-label="Фільтр препаратів"><div id="remList"></div>';
    const box = $('#remList');
    function render(q) {
      const f = q ? R.foldForMatch(q) : '';
      let items = list;
      if (f) items = list.filter(x => R.foldForMatch([x.r.latin, x.r.alt, x.r.translit, x.r.common].join(' ')).includes(f));
      let html = '', letter = '';
      html += '<div class="cols"><ul class="list">';
      for (const x of items) {
        const L = x.r.latin[0].toUpperCase();
        if (L !== letter) { letter = L; html += '<li class="letter">' + L + '</li>'; }
        html += '<li><a href="#/remedy/' + encodeURIComponent(x.r.id) + '">' + esc(x.r.latin) + '</a>' + (x.r.alt ? ' <span class="muted small">= ' + esc(x.r.alt) + '</span>' : '') +
          '<span class="sub">' + esc([x.r.translit.split(' = ')[0], x.r.common].filter(Boolean).join(' — ')) + '</span></li>';
      }
      html += '</ul></div>';
      box.innerHTML = items.length ? html : '<p class="muted">Нічого не знайдено.</p>';
    }
    render('');
    $('#remFilter').addEventListener('input', e => render(e.target.value.trim()));
  }

  async function viewRemedy(view, id, params) {
    const cat = state.catalog;
    const rIdx = cat.remedies.findIndex(r => r.id === id);
    if (rIdx < 0) { view.innerHTML = '<p class="error">Препарат не знайдено.</p>'; return; }
    view.innerHTML = '<p class="muted">Завантаження…</p>';
    const doc = await getDoc('remedies', id);
    const hl = params.get('hl') ? Array.from(new Set(SC.stems(params.get('hl')))) : null;
    const secId = s => 'sec-' + s.replace(/[^\wа-яё]+/gi, '-').toLowerCase();
    const inArticles = cat.articles.map((a, i) => ({ a, i })).filter(x => x.a.rem.includes(rIdx));
    let html = '<div class="doc-head"><h1>' + esc(doc.latin) + (doc.alt ? ' <span class="muted">(' + esc(doc.alt) + ')</span>' : '') + '</h1>' +
      '<div class="sub">' + esc([doc.translit, doc.common].filter(Boolean).join(' — ')) + '</div>' +
      (doc.source ? '<div class="meta">Джерело: ' + esc(doc.source) + '</div>' : '') + '</div>';
    html += '<nav class="toc" aria-label="Розділи">' + doc.sections.map(s => '<a href="#' + secId(s.title) + '" data-sec="' + esc(s.title) + '">' + esc(s.title) + '</a>').join('') + '</nav>';
    html += '<div class="doc">';
    for (const s of doc.sections) {
      html += '<h2 id="' + secId(s.title) + '">' + esc(s.title) + '</h2>';
      if (s.title === 'Клиника') {
        const terms = [];
        for (const p of s.paras) for (const t of p.replace(/\*\*|_/g, '').split(/[.;]\s+|\.$/)) { const x = t.replace(/^[\s•\-–—]+|[\s.]+$/g, ''); if (x.length >= 3 && x.length <= 70) terms.push(x); }
        html += '<div class="tags">' + terms.map(t => '<a href="#/rep?r=' + encodeURIComponent('n:' + t) + '" title="Додати рубрику до реперторію">' + esc(t) + '</a>').join('') + '</div>';
      } else {
        html += s.paras.map(p => renderPara(p, { hl, selfIdx: rIdx })).join('');
      }
    }
    html += '</div>';
    if (inArticles.length) {
      html += '<div class="aside"><h2>Згадується у статтях</h2><ul class="list">' + inArticles.map(x => '<li><a href="#/article/' + encodeURIComponent(x.a.id) + '?r=' + rIdx + '">' + esc(x.a.title) + '</a> <span class="muted small">' + esc(x.a.topic) + '</span></li>').join('') + '</ul></div>';
    }
    if (doc.origin) html += '<p class="src">Оригінал: <a href="' + esc(doc.origin) + '" rel="nofollow noopener">' + esc(doc.origin) + '</a></p>';
    view.innerHTML = html;
    view.querySelectorAll('.toc a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const t = document.getElementById(a.getAttribute('href').slice(1)); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    const sec = params.get('sec');
    if (sec) { const t = document.getElementById(secId(sec)); if (t) setTimeout(() => t.scrollIntoView({ block: 'start' }), 0); }
    else if (hl) { const m = view.querySelector('mark'); if (m) setTimeout(() => m.scrollIntoView({ block: 'center' }), 0); }
  }

  // ---------------------------------------------------------------- статті
  function viewArticles(view) {
    const cat = state.catalog;
    const groups = new Map();
    cat.articles.forEach((a, i) => { if (!groups.has(a.topic)) groups.set(a.topic, []); groups.get(a.topic).push({ a, i }); });
    const order = TOPIC_ORDER.filter(t => groups.has(t)).concat(Array.from(groups.keys()).filter(t => !TOPIC_ORDER.includes(t)));
    let html = '<h1>Статті</h1><p class="muted">Домашній гомеопатичний лікувальник за хворобами (Варшавський, Кьолер, Симеонова, Петерс, Роуз, Юз та ін.), квіткові настої д-ра Баха, про гомеопатію. У кожній статті — перелік препаратів із показаннями.</p>';
    for (const t of order) {
      const items = groups.get(t).sort((x, y) => x.a.title.localeCompare(y.a.title, 'ru'));
      html += '<h2 class="group-title">' + esc(t) + ' <span class="muted small">' + items.length + '</span></h2><div class="cols"><ul class="list">' +
        items.map(x => '<li><a href="#/article/' + encodeURIComponent(x.a.id) + '">' + esc(x.a.title) + '</a>' + (x.a.rem.length ? '<span class="sub">' + x.a.rem.length + ' препаратів</span>' : '') + '</li>').join('') + '</ul></div>';
    }
    view.innerHTML = html;
  }

  async function viewArticle(view, id, params) {
    const cat = state.catalog;
    const aIdx = cat.articles.findIndex(a => a.id === id);
    if (aIdx < 0) { view.innerHTML = '<p class="error">Статтю не знайдено.</p>'; return; }
    view.innerHTML = '<p class="muted">Завантаження…</p>';
    const doc = await getDoc('articles', id);
    const a = cat.articles[aIdx];
    const focus = params.has('r') ? +params.get('r') : -1;
    let html = '<div class="doc-head"><h1>' + esc(doc.title) + '</h1><div class="meta">' + esc(a.topic) +
      (doc.author ? ' · Автор: ' + esc(doc.author) : '') + (doc.source ? ' · Джерело: ' + esc(doc.source) : '') + '</div></div>';
    if (a.rem.length) {
      html += '<div class="tags">' + a.rem.map(i => cat.remedies[i].ext ? '<span class="muted small">' + esc(cat.remedies[i].latin) + '</span>' : '<a href="#/remedy/' + encodeURIComponent(cat.remedies[i].id) + '">' + esc(cat.remedies[i].latin) + '</a>').join('') + '</div>';
      if (a.group === 'lechebnik' && a.rem.length >= 2) html += '<p class="small"><a href="#/rep?r=' + encodeURIComponent('a:' + a.id) + '">Додати статтю як рубрику до реперторію</a></p>';
    }
    html += '<div class="doc">';
    doc.blocks.forEach((b, bi) => {
      const isFocus = focus >= 0 && b.rem.includes(focus);
      if (b.kind === 'remedy') {
        const links = b.rem.filter(i => !cat.remedies[i].ext);
        const title = links.length ? '<a href="#/remedy/' + encodeURIComponent(cat.remedies[links[0]].id) + '">' + esc(b.title) + '</a>' : esc(b.title);
        html += '<div class="block' + (isFocus ? ' hl' : '') + '" id="blk-' + bi + '"><h3>' + title + '</h3>' + b.paras.map(p => renderPara(p)).join('') + '</div>';
      } else if (b.kind === 'sub') {
        html += '<h2 id="blk-' + bi + '">' + esc(b.title) + '</h2>' + b.paras.map(p => renderPara(p)).join('');
      } else {
        html += b.paras.map(p => renderPara(p)).join('');
      }
    });
    html += '</div>';
    if (doc.origin) html += '<p class="src">Оригінал: <a href="' + esc(doc.origin) + '" rel="nofollow noopener">' + esc(doc.origin) + '</a></p>';
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
      if (q.length < 2) { close(); return; }
      items = R.matchRemedies(state.catalog, q, 8);
      if (!items.length) { close(); return; }
      list.innerHTML = items.map((m, i) => '<li data-i="' + i + '"><span>' + esc(m.r.latin) + '</span><span class="kind">' + esc(m.r.translit.split(' = ')[0] || m.r.common) + '</span></li>').join('');
      list.hidden = false;
    }
    function go(i) { const m = items[i]; if (!m) return; input.value = ''; close(); location.hash = '#/remedy/' + encodeURIComponent(m.r.id); }
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
      state.catalog = await fetchJson('data/catalog.json');
    } catch (e) {
      $('#view').innerHTML = '<p class="error">Не вдалося завантажити каталог: ' + esc(e.message) + '</p>';
      return;
    }
    buildNameLinker();
    const s = state.catalog.stats;
    $('#footStats').textContent = 'Препаратів: ' + s.remedies + ' · статей: ' + s.articles + ' · рубрик: ' + s.rubrics + ' · абзаців у пошуковому індексі: ' + s.units + ' · дані зібрано ' + state.catalog.built + '.';
    initQuick();
    window.addEventListener('hashchange', route);
    route();
  }
  init();
})();
