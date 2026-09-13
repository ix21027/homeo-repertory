#!/usr/bin/env python3
"""
import_boericke.py — описи препаратів із суспільного надбання для «ext»-назв каталогу.

Джерело: William Boericke. «Pocket Manual of Homoeopathic Materia Medica», 9-те видання, 1927.
HTML-транскрипція: http://www.homeoint.org/books/boericmm/ (Médi-T). Текст Boericke — суспільне
надбання (США, публікація 1927; автор помер 1929); знімки сторінок зберігаються в sources/boericke/.

    python3 tools/import_boericke.py --fetch-index   # завантажити покажчики (remedies.htm, a.htm…z.htm)
    python3 tools/import_boericke.py --dry-run       # таблиця зіставлення 136 ext-назв із Boericke
    python3 tools/import_boericke.py --fetch         # довантажити сторінки зіставлених препаратів
    python3 tools/import_boericke.py --dump-segments DIR   # англійські абзаци шматками для перекладачів
    python3 tools/import_boericke.py                 # розібрати, перекласти EN→RU і EN→UK, записати .md

Ручні перевизначення зіставлення — tools/boericke-map.json:
    {"<ext-назва>": "<ABBREV>"}  або  {"<ext-назва>": null}  щоб пропустити.

Переклад. Спершу дивимось у tools/boericke-llm.json (у git) — переклад моделлю з глосарієм:
    {"<seg_key(англійський абзац)>": {"en": "…", "ru": "…", "ua": "…"}}
Чого там немає — доперекладає Google (translatepy) у кеш tools/boericke-cache.json (не в git);
про кожен такий абзац друкується попередження. seg_key — sha1 англійського рядка ПІСЛЯ
expand_abbrev і ПЕРЕД protect(), тобто рівно того, що бачить перекладач у --dump-segments.

У sources/boericke/*.htm виправлено очевидні помилки розпізнавання самого джерела (11 місць у
9 файлах: «Professor yon Jaksch»→«von», «Psorisis»→«Psoriasis», «Heper»→«Hepar», «Spiræea»→
«Spiræa», «Salycyl»→«Salicyl», «Climateric»→«Climacteric», «micturation»→«micturition»,
«Prumus padus»→«Prunus padus», «phlyctemular»→«phlyctenular», «direst contact»→«direct contact»,
«lumber region»→«lumbar region»). Видалення знімка й повторний --fetch їх затре.
"""
import argparse
import hashlib
import html
import json
import os
import re
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "sources", "boericke")
MAP_FILE = os.path.join(ROOT, "tools", "boericke-map.json")
CACHE_FILE = os.path.join(ROOT, "tools", "boericke-cache.json")
LLM_FILE = os.path.join(ROOT, "tools", "boericke-llm.json")
CATALOG = os.path.join(ROOT, "data", "ru", "catalog.json")
BASE_URL = "http://www.homeoint.org/books/boericmm/"
SOURCE_LINE = {
    "ru": "William Boericke. Pocket Manual of Homoeopathic Materia Medica, 9th ed., 1927 (машинный перевод с английского)",
    "ua": "William Boericke. Pocket Manual of Homoeopathic Materia Medica, 9th ed., 1927 (машинний переклад з англійської)",
}

# ---------------------------------------------------------------------------
# 1. Мережа: знімки сторінок у sources/boericke/ (ідемпотентно, без повторних запитів)
# ---------------------------------------------------------------------------
UA_HEADER = {"User-Agent": "Mozilla/5.0 (homeo-repertory import_boericke.py)"}


def fetch(rel_url, fname, force=False):
    """Завантажує сторінку джерела в sources/boericke/<fname>, якщо її ще немає."""
    path = os.path.join(SRC_DIR, fname)
    if os.path.exists(path) and not force:
        return open(path, encoding="cp1252").read()
    os.makedirs(SRC_DIR, exist_ok=True)
    req = urllib.request.Request(BASE_URL + rel_url, headers=UA_HEADER)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                raw = r.read()
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise RuntimeError(f"fetch failed {rel_url}: {e}")
            time.sleep(2 * (attempt + 1))
    text = raw.decode("cp1252", errors="replace")
    open(path, "w", encoding="cp1252", errors="replace").write(text)
    time.sleep(0.3)
    return text


# ---------------------------------------------------------------------------
# 2. Покажчики: абревіатура → (повна назва + синоніми) та абревіатура → шлях сторінки
# ---------------------------------------------------------------------------
LETTERS = "abcdefghijklmnopqrstuvwxyz"


def load_url_map(force=False):
    """a.htm…z.htm → {ABBREV: 'a/abies-c.htm'}."""
    urls = {}
    for ch in LETTERS:
        page = fetch(ch + ".htm", "index-" + ch + ".htm", force)
        for m in re.finditer(r'href="(' + ch + r'/([a-z0-9\-]+)\.htm)"', page, re.I):
            urls.setdefault(m.group(2).upper(), m.group(1))
    return urls


def load_name_map(force=False):
    """remedies.htm → [(ABBREV, [назва, синонім, …])]; синоніми — з дужок і через дефіс."""
    page = fetch("remedies.htm", "remedies.htm", force)
    text = re.sub(r"<[^>]+>", " ", page)
    text = html.unescape(text).replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    out = []
    # «ABBREV ------> ПОВНА НАЗВА (СИНОНІМ)» до наступної абревіатури або кінця
    for m in re.finditer(r"([A-Z][A-Z0-9\-]*) -+> (.+?)(?= [A-Z][A-Z0-9\-]* -+> |$)", text):
        abbrev, full = m.group(1), m.group(2).strip()
        names = []
        base = re.sub(r"\([^)]*\)", " ", full)
        for paren in re.findall(r"\(([^)]*)\)", full):
            names.extend(split_alt(paren))
        names = split_alt(base) + names
        seen, uniq = set(), []
        for n in names:
            # останній запис кожної літери підбирає навігаційне посилання на наступну («PYROGENIUM Q»)
            n = re.sub(r"\s+[A-Z]$", "", n.strip(" -.,")).strip(" -.,")
            if n and n.lower() not in seen:
                seen.add(n.lower())
                uniq.append(n)
        if uniq:
            out.append((abbrev, uniq))
    return out


def split_alt(s):
    """«ABIES CANADENSIS-PINUS CANADENSIS» → обидві назви; одиночне слово з дефісом не ріжемо."""
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return []
    parts = [p.strip() for p in re.split(r"\s*-\s*(?=[A-Z])", s) if p.strip()]
    return parts if len(parts) > 1 else [s]


# ---------------------------------------------------------------------------
# 3. Нормалізація латинських назв — те саме, що normName/REPL у tools/build.mjs
# ---------------------------------------------------------------------------
REPL = [
    (r"\bsulfur", "sulphur"), (r"\bsulfuric", "sulphuric"), (r"\bsulphuris\b", "sulphur"), (r"\bnatrum\b", "natrium"),
    (r"\bkalium\b", "kali"), (r"\bmagnesia\b", "magnesium"), (r"\bcalcium\b", "calcarea"), (r"\bcarbonica\b", "carbonicum"),
    (r"\bphosphorica\b", "phosphoricum"), (r"\bmuriatica\b", "muriaticum"), (r"\bsulphurica\b", "sulphuricum"),
    (r"\bfluorica\b", "fluoricum"), (r"\biodata\b", "iodatum"), (r"\bjodatum\b", "iodatum"), (r"\barsenicosa\b", "arsenicosum"),
    (r"\bacida\b", "acidum"), (r"\bmuriatic\b", "muriaticum"), (r"\bcarbonic\b", "carbonicum"), (r"\bacidum ([a-z]+)", r"\1 acidum"),
    (r"\bgraphytes\b", "graphites"), (r"\bcinchona\b", "china"), (r"\bcocculus indicus\b", "cocculus"), (r"\bactaea\b", "actea"),
    (r"\bmercurius solubilis hahnemanni\b", "mercurius solubilis"), (r"\bhepar sulphur( calcareum)?\b", "hepar sulphur"),
    (r"\brhus tox\b", "rhus toxicodendron"), (r"\bnux vom\b", "nux vomica"),
]
# Додаткові правила саме для Boericke: латиною там ті самі речовини під іншим правописом.
REPL_EXTRA = [
    (r"\bjod", "iod"), (r"\bbijodatus\b", "biniodatus"), (r"\bnatrium\b", "natrium"), (r"\bmuriaticus\b", "muriaticum"),
    (r"\btaninum\b", "tannicum"), (r"\btannicum acidum\b", "tannicum"), (r"\bnitrosum\b", "nitrosum"),
]


def norm_name(s):
    n = s.lower()
    n = re.sub(r"[()«»\"“”,.;:]", " ", n)
    n = re.sub(r"[^a-z\- ]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    for pat, to in REPL:
        n = re.sub(pat, to, n)
    for pat, to in REPL_EXTRA:
        n = re.sub(pat, to, n)
    return re.sub(r"\s+", " ", n).strip()


def lev(a, b):
    if abs(len(a) - len(b)) > 2:
        return 99
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[len(b)]


def slugify(name):
    """id файлу — простий слаг латинської назви, без нормалізації правопису (щоб URL збігався з назвою)."""
    s = re.sub(r"[^a-z]+", "-", name.lower())
    return re.sub(r"-+", "-", s).strip("-")


def latin_case(name):
    """«ABIES CANADENSIS» → «Abies canadensis» — правопис латинських назв у каталозі."""
    w = re.sub(r"\s+", " ", name.strip()).lower().split(" ")
    if not w or not w[0]:
        return name.strip()
    return " ".join([w[0][0].upper() + w[0][1:]] + w[1:])


# ---------------------------------------------------------------------------
# 4. Зіставлення ext-назв із заголовками Boericke
# ---------------------------------------------------------------------------
def ext_names():
    """Назви без сторінки Materia Medica: «ext» із каталогу плюс ті, що вже покриті імпортом.

    Другий доданок робить запуск ідемпотентним: після збірки з content/*/boericke ті назви
    вже не «ext», і без нього повторний запуск знайшов би лише залишок.
    """
    cat = json.load(open(CATALOG, encoding="utf-8"))
    out = [r["latin"] for r in cat["remedies"] if r.get("ext")]
    seen = {norm_name(x) for x in out}
    done = os.path.join(ROOT, "content", "ru", "boericke")
    for f in sorted(os.listdir(done)) if os.path.isdir(done) else []:
        if not f.endswith(".md"):
            continue
        fm = open(os.path.join(done, f), encoding="utf-8").read().split("---")[1]
        for line in fm.split("\n"):
            if line.startswith("latin:") or line.startswith("alt_latin:"):
                for n in line.split(":", 1)[1].split(";"):
                    n = n.strip()
                    if n and norm_name(n) not in seen:
                        seen.add(norm_name(n))
                        out.append(n)
    return out


def build_match(verbose=False):
    """→ (matches, missing); matches: [{ext:[назви], abbrev, url, boericke:[назви]}]"""
    names = load_name_map()
    urls = load_url_map()
    overrides = json.load(open(MAP_FILE, encoding="utf-8")) if os.path.exists(MAP_FILE) else {}
    overrides = {k: v for k, v in overrides.items() if not k.startswith("_")}

    by_norm = {}          # нормалізована назва Boericke → ABBREV
    by_first = {}         # перше слово → set(ABBREV)
    full_of = {}          # ABBREV → [назви]
    for abbrev, forms in names:
        full_of[abbrev] = forms
        for f in forms:
            n = norm_name(f)
            if n:
                by_norm.setdefault(n, abbrev)
                by_first.setdefault(n.split(" ")[0], set()).add(abbrev)

    matched, missing = {}, []
    for ext in ext_names():
        if ext in overrides:
            ab = overrides[ext]
            if ab is None:
                missing.append((ext, "пропущено вручну"))
                continue
            if ab not in full_of:
                missing.append((ext, f"перевизначення {ab}: немає такої абревіатури"))
                continue
            matched.setdefault(ab, []).append((ext, "map"))
            continue
        n = norm_name(ext)
        how, ab = None, None
        if n in by_norm:
            ab, how = by_norm[n], "точно"
        else:
            fw = by_first.get(n.split(" ")[0])
            if fw and len(fw) == 1 and len(n.split(" ")) == 1:
                ab, how = next(iter(fw)), "перше слово"
        if ab is None and len(n) >= 6:
            best, best_d = None, 3
            for k, v in by_norm.items():
                if k[0] != n[0]:
                    continue
                d = lev(k, n)
                if d < best_d:
                    best_d, best = d, v
            if best:
                ab, how = best, f"лев≤{best_d}"
        if ab is None:
            missing.append((ext, "немає в Boericke"))
            continue
        matched.setdefault(ab, []).append((ext, how))

    out = []
    for ab, exts in matched.items():
        url = urls.get(ab)
        if not url:
            for e, _ in exts:
                missing.append((e, f"{ab}: немає сторінки в покажчику"))
            continue
        out.append({"abbrev": ab, "url": url, "boericke": full_of[ab], "ext": exts})
    out.sort(key=lambda x: x["boericke"][0])
    if verbose:
        print(f"{'ext-назва':<28} {'спосіб':<12} {'ABBREV':<12} Boericke")
        for r in out:
            for e, how in r["ext"]:
                print(f"{e:<28} {how:<12} {r['abbrev']:<12} {' = '.join(r['boericke'])}")
        print(f"\nЗіставлено {sum(len(r['ext']) for r in out)} ext-назв → {len(out)} сторінок Boericke")
        if missing:
            print(f"\nНе зіставлено ({len(missing)}):")
            for e, why in missing:
                print(f"  {e:<28} {why}")
    return out, missing


# ---------------------------------------------------------------------------
# 5. Розбір сторінки препарату
# ---------------------------------------------------------------------------
# Заголовок розділу Boericke → канонічний розділ (ru, ua). Ключі — SECTIONS із tools/extract.py,
# українські — SECTION_UA з tools/translate.py; «Dose» додано окремо.
SEC_RU = {
    "mind": "Психика", "head": "Голова", "vertigo": "Головокружение", "eyes": "Глаза", "eye": "Глаза",
    "ears": "Уши", "ear": "Уши", "nose": "Нос", "face": "Лицо", "mouth": "Рот", "teeth": "Зубы",
    "tongue": "Рот", "throat": "Горло", "throat externally": "Горло", "appetite": "Аппетит",
    "stomach": "Желудок", "abdomen": "Живот", "liver": "Живот", "rectum": "Анус и прямая кишка",
    "stool": "Анус и прямая кишка", "rectum and stool": "Анус и прямая кишка", "anus": "Анус и прямая кишка",
    "urine": "Мочевыделительная система", "urinary": "Мочевыделительная система", "urinary organs": "Мочевыделительная система",
    "bladder": "Мочевыделительная система", "kidneys": "Мочевыделительная система", "male": "Мужские",
    "female": "Женские", "menses": "Менструация", "breasts": "Молочные железы",
    "respiratory": "Дыхательная система", "respiratory organs": "Дыхательная система", "cough": "Кашель",
    "chest": "Грудная клетка", "larynx": "Гортань", "larynx and trachea": "Гортань. Трахея", "trachea": "Трахея",
    "voice": "Гортань", "heart": "Сердце и кровообращение", "pulse": "Сердце и кровообращение",
    "blood": "Сердце и кровообращение", "circulatory": "Сердце и кровообращение", "neck": "Шея", "back": "Спина",
    "neck and back": "Шея. Спина", "extremities": "Конечности", "limbs": "Конечности", "joints": "Суставы",
    "bones": "Кости", "nerves": "Нервная система", "nervous system": "Нервная система", "sleep": "Сон",
    "dreams": "Сон", "fever": "Лихорадка", "chill": "Лихорадка", "perspiration": "Пот", "sweat": "Пот",
    "skin": "Кожа", "hair": "Кожа", "nails": "Кожа", "generalities": "Общие симптомы", "general": "Общие симптомы",
    "children": "Дети", "glands": "Лимфатические железы", "tissues": "Общие симптомы", "eruptions": "Кожа",
    "modalities": "Модальности", "relationship": "Взаимосвязи", "antidotes": "Взаимосвязи",
    "compare": "Взаимосвязи", "dose": "Дозы", "doses": "Дозы", "clinical": "Клиника", "aggravation": "Модальности",
    "amelioration": "Модальности", "oesophagus": "Пищевод", "esophagus": "Пищевод", "gums": "Рот",
    "taste": "Рот", "external throat": "Горло", "pregnancy": "Беременность. Роды", "labor": "Беременность. Роды",
    "gastric": "Желудок", "mental": "Психика", "spleen": "Живот", "alimentary canal": "Желудочно-кишечный тракт",
    "respiration": "Дыхательная система", "stools": "Анус и прямая кишка", "uses": "Рекомендации",
    "non homeopathic uses": "Рекомендации", "caution": "Рекомендации",
}
SEC_UA = {
    "Характеристика": "Характеристика", "Клиника": "Клініка", "Психика": "Психіка", "Голова": "Голова",
    "Головокружение": "Запаморочення", "Глаза": "Очі", "Уши": "Вуха", "Нос": "Ніс", "Лицо": "Обличчя",
    "Рот": "Рот", "Зубы": "Зуби", "Горло": "Горло", "Гортань": "Гортань", "Трахея": "Трахея",
    "Гортань. Трахея": "Гортань. Трахея", "Пищевод": "Стравохід", "Аппетит": "Апетит", "Желудок": "Шлунок",
    "Живот": "Живіт", "Анус и прямая кишка": "Анус і пряма кишка", "Мочевыделительная система": "Сечовидільна система",
    "Мужские": "Чоловічі", "Женские": "Жіночі", "Менструация": "Менструація", "Беременность. Роды": "Вагітність. Пологи",
    "Молочные железы": "Молочні залози", "Дыхательная система": "Дихальна система", "Кашель": "Кашель",
    "Грудная клетка": "Грудна клітка", "Сердце и кровообращение": "Серце і кровообіг", "Шея": "Шия", "Спина": "Спина",
    "Шея. Спина": "Шия. Спина", "Конечности": "Кінцівки", "Суставы": "Суглоби", "Кости": "Кістки",
    "Нервная система": "Нервова система", "Лимфатические железы": "Лімфатичні залози", "Сон": "Сон",
    "Лихорадка": "Гарячка", "Пот": "Піт", "Кожа": "Шкіра", "Общие симптомы": "Загальні симптоми", "Дети": "Діти",
    "Модальности": "Модальності", "Взаимосвязи": "Взаємозв’язки", "Рекомендации": "Рекомендації",
    "Желудочно-кишечный тракт": "Шлунково-кишковий тракт", "Дозы": "Дози",
}
# Порядок розділів у файлі — як у SECTIONS (tools/extract.py)
SEC_ORDER = [
    "Характеристика", "Клиника", "Психика", "Голова", "Головокружение", "Глаза", "Уши", "Нос", "Лицо", "Рот", "Зубы",
    "Горло", "Гортань", "Трахея", "Гортань. Трахея", "Пищевод", "Аппетит", "Желудок", "Живот", "Анус и прямая кишка",
    "Желудочно-кишечный тракт", "Мочевыделительная система", "Мужские", "Женские", "Менструация", "Беременность. Роды", "Молочные железы",
    "Дыхательная система", "Кашель", "Грудная клетка", "Сердце и кровообращение", "Шея", "Спина", "Шея. Спина",
    "Конечности", "Суставы", "Кости", "Нервная система", "Лимфатические железы", "Сон", "Лихорадка", "Пот", "Кожа",
    "Общие симптомы", "Дети", "Модальности", "Взаимосвязи", "Рекомендации", "Дозы",
]
# Підписи зв'язків: англійський заголовок → російський (потрапляє під REL_KINDS у tools/modalities.mjs)
REL_LABEL = [
    (re.compile(r"^complement", re.I), ("Дополняющие", "Доповнювальні")),
    (re.compile(r"^incompatib", re.I), ("Несовместимые", "Несумісні")),
    (re.compile(r"^antidot", re.I), ("Антидоты", "Антидоти")),
    (re.compile(r"^follow(s|ed)? well by|^followed well by", re.I), ("После него хорошо следуют", "Після нього добре йдуть")),
    (re.compile(r"^follows? well", re.I), ("Следует после", "Слідує після")),
    (re.compile(r"^compare|^similar|^analog", re.I), ("Сравнить", "Порівняти")),
]


def strip_tags(s):
    s = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    s = s.replace("\u0153", "oe").replace("\u0152", "Oe").replace("\u00e6", "ae").replace("\u00c6", "Ae")
    return re.sub(r"\s+", " ", s).strip()


def parse_page(text):
    """HTML сторінки Boericke → {'latin', 'common', 'paras': [(англ. заголовок|None, текст)]}."""
    body = text
    m = re.search(r'<a name="[^"]*"></a>', body)
    if m:
        head_start = m.end()
    else:
        head_start = 0
    body = body[head_start:]
    body = re.split(r"Copyright\s*(?:&copy;|©|\x99|\xa9)?\s*M", body)[0]

    # заголовок: перший <p align="CENTER"> із великим шрифтом
    latin, common = "", ""
    hm = re.search(r'(?is)<font size="5"[^>]*>(.*?)</font>(.*?)</p>', text[head_start:])
    if hm:
        latin = strip_tags(hm.group(1)).strip(" -")
        common = strip_tags(hm.group(2)).strip(" -")
    paras = []
    for pm in re.finditer(r"(?is)<p[^>]*>(.*?)(?:</p>|(?=<p[^>]*>))", body):
        raw = pm.group(1)
        txt = strip_tags(raw)
        if not txt or txt in ("&nbsp;", "-"):
            continue
        if latin and txt.startswith(latin):
            continue
        hm2 = re.match(r"^([A-Za-z][A-Za-z \.,&'()-]{0,42}?)\s*\.?-{2,}\s*(.*)$", txt)
        if hm2 and len(hm2.group(1)) <= 42:
            paras.append((hm2.group(1).strip(" .,"), hm2.group(2).strip()))
        else:
            paras.append((None, txt))
    return {"latin": latin, "common": common, "paras": paras}


def section_of(label):
    """Англійський заголовок Boericke → канонічний розділ; None якщо невідомий."""
    key = re.sub(r"[^a-z ]", " ", label.lower())
    key = re.sub(r"\s+", " ", key).strip()
    if key in SEC_RU:
        return SEC_RU[key]
    for part in re.split(r" and |, |/", key):
        part = part.strip()
        if part in SEC_RU:
            return SEC_RU[part]
    for k, v in SEC_RU.items():
        if key.startswith(k + " ") or key.endswith(" " + k):
            return v
    return None


def split_modalities(text):
    """«Worse, motion; better, rest» → ([гірші фрази], [кращі фрази]); порядок довільний."""
    worse, better = [], []
    cur = None
    pos, chunks = 0, []
    for m in re.finditer(r"(?i)(?<![A-Za-z])(worse|better|aggravation|amelioration|agg|amel)\b[\s,.;:—-]*", text):
        if m.start() > pos:
            chunks.append((cur, text[pos:m.start()]))
        cur = "w" if m.group(1).lower() in ("worse", "aggravation", "agg") else "b"
        pos = m.end()
    chunks.append((cur, text[pos:]))
    for d, chunk in chunks:
        chunk = chunk.strip(" ,.;:-—")
        if not chunk:
            continue
        (worse if d == "w" else better if d == "b" else worse).append(chunk)
    return worse, better


def split_relations(text):
    """«Compare: Acon; Bry. Antidote: Camph.» → [(англ. підпис, тіло)]."""
    out = []
    idx = [(m.start(), m.end(), m.group(1)) for m in
           re.finditer(r"(?:^|[.;]\s+|\s—\s)([A-Z][A-Za-z ]{2,30}?)\s*[:.]-{0,2}\s+(?=[A-Z(])", text)]
    known = [(s, e, lab) for s, e, lab in idx if any(r.match(lab) for r, _ in REL_LABEL)]
    if not known:
        return [(None, text)]
    if known[0][0] > 0:
        out.append((None, text[:known[0][0]].strip()))
    for i, (s, e, lab) in enumerate(known):
        end = known[i + 1][0] if i + 1 < len(known) else len(text)
        out.append((lab, text[e:end].strip()))
    return [(l, b) for l, b in out if b]


def rel_label(lab, lang):
    for r, (ru, ua) in REL_LABEL:
        if r.match(lab):
            return ru if lang == "ru" else ua
    return lab


# ---------------------------------------------------------------------------
# 6. Переклад EN→RU і EN→UK (окремо, translatepy Google — як у tools/translate.py)
# ---------------------------------------------------------------------------
lock = threading.Lock()
cache = json.load(open(CACHE_FILE, encoding="utf-8")) if os.path.exists(CACHE_FILE) else {}
# Переклад моделлю з глосарієм: {seg_key: {"en","ru","ua"}}. Немає файла — усе йде в Google, як раніше.
llm = json.load(open(LLM_FILE, encoding="utf-8")) if os.path.exists(LLM_FILE) else {}
DEST = {"ru": "Russian", "ua": "Ukrainian"}
_translator = None


def seg_key(en):
    """Ключ абзацу в tools/boericke-llm.json — sha1 англійського рядка, який бачить перекладач.

    Рахується ПІСЛЯ expand_abbrev і ПЕРЕД protect(): маркери Qzz у ключ не потрапляють, тож
    ключ не залежить від того, як саме ми ховаємо назви від Google.
    """
    return hashlib.sha1(en.encode("utf-8")).hexdigest()


def llm_get(en, lang):
    """Готовий переклад абзацу з tools/boericke-llm.json або None."""
    rec = llm.get(seg_key(en))
    if not isinstance(rec, dict):
        return None
    out = (rec.get(lang) or "").strip()
    return out or None


def get_translator():
    global _translator
    if _translator is None:
        from translatepy.translators.google import GoogleTranslate
        _translator = GoogleTranslate()
    return _translator


def save_cache():
    with lock:
        tmp = CACHE_FILE + ".tmp"
        json.dump(cache, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
        os.replace(tmp, CACHE_FILE)


def google(text, lang):
    last = None
    for attempt in range(5):
        try:
            r = get_translator().translate(text, DEST[lang], "English")
            out = str(r.result)
            if out.strip():
                return out
            last = RuntimeError("empty result")
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"translation failed: {last}")


def postfix(en, tr):
    s = tr.replace(" ", " ")
    s = re.sub(r"([.;:!?…»)])([А-ЯҐЄІЇа-яґєіїA-Za-z«(])", r"\1 \2", s)
    s = re.sub(r"\s+([,.;:!?)»])", r"\1", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def translate_batch(segs, lang):
    joined = "\n\n".join(segs)
    out = google(joined, lang)
    parts = [p.strip() for p in re.split(r"\n\s*\n", out)]
    if len(parts) != len(segs):
        parts = [google(s, lang).strip() for s in segs]
    return parts


NEED = re.compile(r"[A-Za-z]{2}")

# Латинські назви в дужках Google перекладає («(China)» → «(Китай)»), тому на час перекладу
# підміняємо їх маркерами Qzz<N> — маркери проходять крізь Google незмінними.
STOP = {"of", "with", "the", "in", "and", "a", "an", "at", "from", "to", "for", "is", "are", "was", "has",
        "have", "been", "be", "see", "also", "or", "on", "by", "after", "before", "when", "as", "but",
        "not", "no", "all", "left", "right", "etc", "i", "e", "g", "one", "two", "three", "four", "five"}
PAREN = re.compile(r"\(([^()]{1,80})\)")


_VOCAB = None


def latin_vocab():
    """→ (слова, префікси≥3) відомих латинських назв: boericke-map.json, каталог, покажчик Boericke.

    Потрібне _is_names(): без словника під захист від перекладу потрапляла будь-яка фраза в
    дужках, що починається з великої літери, — «(Old school dose)», «(Coff opposite)»,
    «(Antidotal)», «(Cartier)» лишались англійськими посеред перекладеного розділу.
    Префікси — бо в тексті трапляються обрізані назви, яких нема в покажчику («Ran bulb» від
    RANUNCULUS BULBOSUS, «Anthracin» від ANTHRACINUM). Файлів може не бути (як у чистій копії) —
    тоді словник менший; мережі тут не чіпаємо.
    """
    global _VOCAB
    if _VOCAB is not None:
        return _VOCAB
    words = set()

    def add(s):
        for t in re.split(r"[^A-Za-z]+", s or ""):
            if len(t) >= 2:
                words.add(t.lower())

    if os.path.exists(MAP_FILE):
        for k, v in json.load(open(MAP_FILE, encoding="utf-8")).items():
            if not k.startswith("_"):
                add(k)
                add(v or "")
    if os.path.exists(CATALOG):
        for r in json.load(open(CATALOG, encoding="utf-8")).get("remedies", []):
            add(r.get("latin", ""))
            alt = r.get("alt") or ""
            add(alt if isinstance(alt, str) else "; ".join(alt))
    if os.path.exists(os.path.join(SRC_DIR, "remedies.htm")):
        for ab, forms in load_name_map():
            add(ab)
            for f in forms:
                add(f)
    _VOCAB = (words, {w[:i] for w in words for i in range(3, len(w) + 1)})
    return _VOCAB


def _is_latin(word):
    """Слово — відома латинська назва або її початок (≥3 літери)."""
    words, prefixes = latin_vocab()
    w = word.lower()
    return w in words or w in prefixes


def _is_names(inner):
    """Дужка містить лише назви препаратів (їх перекладати не можна), а не англійський текст."""
    if not re.fullmatch(r"[A-Z][A-Za-z.'\- ]*(?:[;,][A-Za-z.'\- ]+)*", inner.strip()):
        return False
    toks = [t for t in re.split(r"[\s;,]+", inner.strip()) if t]
    if not 0 < len(toks) <= 6 or any(t.strip(".").lower() in STOP for t in toks):
        return False
    # ініціали й однобуквені хвости солей («Kali c», «Calc p») пропускаємо: судимо по словах ≥3 літер
    words = [w for t in toks for w in re.split(r"[^A-Za-z]+", t) if len(w) >= 3]
    return bool(words) and all(_is_latin(w) for w in words)


def protect(text):
    """→ (текст із маркерами, [замінені рядки]) — детерміновано, тож годиться і як ключ кешу."""
    names = []

    def rep(m):
        if not _is_names(m.group(1)):
            return m.group(0)
        names.append(m.group(1))
        return "(Qzz%d)" % len(names)
    return PAREN.sub(rep, text), names


def restore(text, names):
    return re.sub(r"Qzz(\d+)", lambda m: names[int(m.group(1)) - 1] if 0 < int(m.group(1)) <= len(names) else m.group(0), text)


def translate_all(segments, lang, workers=4, batch_chars=2800):
    # те, що вже перекладено моделлю, Google не бачить взагалі
    segments = [protect(s)[0] for s in segments if llm_get(s, lang) is None]
    todo = [s for s in dict.fromkeys(segments) if (lang + "\0" + s) not in cache and NEED.search(s)]
    for s in dict.fromkeys(segments):
        if not NEED.search(s):
            cache.setdefault(lang + "\0" + s, s)
    if not todo:
        return
    batches, cur, size = [], [], 0
    for s in todo:
        if cur and size + len(s) > batch_chars:
            batches.append(cur)
            cur, size = [], 0
        cur.append(s)
        size += len(s) + 2
    if cur:
        batches.append(cur)
    print(f"[{lang}] to translate: {len(todo)} segments, {sum(len(s) for s in todo)} chars, {len(batches)} batches", flush=True)
    done, fails, t0 = [0], [0], time.time()

    def work(batch):
        try:
            parts = translate_batch(batch, lang)
        except Exception as e:  # noqa: BLE001
            fails[0] += 1
            print("  batch failed:", e, flush=True)
            return
        with lock:
            for en, tr in zip(batch, parts):
                cache[lang + "\0" + en] = postfix(en, tr)
            done[0] += 1
        if done[0] % 25 == 0:
            el = time.time() - t0
            print(f"  [{lang}] {done[0]}/{len(batches)} batches, {el:.0f}s, eta {el / done[0] * (len(batches) - done[0]):.0f}s", flush=True)
            save_cache()

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, batches))
    save_cache()
    if fails[0]:
        print(f"[{lang}] WARNING: {fails[0]} batches failed; run again to retry", flush=True)


def tr(text, lang):
    out = llm_get(text, lang)
    if out is not None:
        return out
    prot, names = protect(text)
    out = cache.get(lang + "\0" + prot)
    return restore(out, names) if out is not None else text


def llm_report(segments, limit=40):
    """Попередження про абзаци, яких немає в tools/boericke-llm.json (їх доперекладе Google)."""
    if not llm:
        print("\n%s: немає — усе перекладає Google (як раніше)" % os.path.relpath(LLM_FILE, ROOT))
        return
    uniq = list(dict.fromkeys(segments))
    for lang in ("ru", "ua"):
        miss = [s for s in uniq if llm_get(s, lang) is None]
        if not miss:
            print("[%s] tools/boericke-llm.json покриває всі %d абзаців" % (lang, len(uniq)))
            continue
        print("\n[%s] УВАГА: %d із %d абзаців немає в tools/boericke-llm.json — переклад Google:"
              % (lang, len(miss), len(uniq)), flush=True)
        for s in miss[:limit]:
            print("    %s  %s" % (seg_key(s)[:12], s[:90]))
        if len(miss) > limit:
            print("    … ще %d (повний перелік — --dump-segments)" % (len(miss) - limit))


# ---------------------------------------------------------------------------
# 7. Складання документа: сторінка Boericke → розділи з абзацами (англійською)
# ---------------------------------------------------------------------------
def build_doc(page, abbrev_names):
    """→ {'latin','common','intro':[...], 'sections': {розділ: [абзац]}, 'mods': (w,b), 'rels': [(lab, body)]}"""
    secs = {}
    unknown = []
    cur = "Характеристика"
    mods_w, mods_b, rels = [], [], []
    for label, text in page["paras"]:
        text = expand_abbrev(text, abbrev_names)
        if label is None:
            if cur == "Взаимосвязи":
                # продовження розділу зв'язків без власного заголовка («Antidotes: Arnica;
                # Camphor.» окремим абзацом). Розбираємо так само, як абзац із міткою:
                # підписи підуть у rels (і їх побачить parseRelations у tools/modalities.mjs),
                # решта лишиться абзацом розділу. Раніше такі рядки клались у secs і зникали.
                for lab, body in split_relations(text):
                    if lab:
                        rels.append((lab, body))
                    else:
                        secs.setdefault(cur, []).append(body)
                continue
            secs.setdefault(cur, []).append(text)
            continue
        sec = section_of(label)
        if sec is None:
            unknown.append(label)
            secs.setdefault(cur, []).append(label + ". " + text)
            continue
        cur = sec
        if sec == "Модальности":
            w, b = split_modalities(text)
            mods_w += w
            mods_b += b
            secs.setdefault(sec, [])
        elif sec == "Взаимосвязи":
            rels += split_relations(text)
            secs.setdefault(sec, [])
        else:
            secs.setdefault(sec, []).append(text)
    return {"latin": page["latin"], "common": page["common"], "sections": secs,
            "mods": (mods_w, mods_b), "rels": rels, "unknown": unknown}


ABBREV_RE = None


def expand_abbrev(text, abbrev_names):
    """«(Acon)» → «(Aconitum napellus)»: назви препаратів мають лишитись латиною, а не «Аконит»."""
    def rep(m):
        key = m.group(1).upper().replace(" ", "-").replace(".", "")
        full = abbrev_names.get(key)
        return "(" + full + ")" if full else m.group(0)
    return re.sub(r"\(([A-Z][a-z]{1,12}(?:[ -][a-z]{1,12})?)\.?\)", rep, text)


SEC_TITLE = "Название"  # у дампі — розділ підзаголовка (doc["common"]), поза SEC_ORDER


def doc_items(doc):
    """[(канонічний розділ, англійський абзац)] у порядку запису — і для перекладу, і для дампу.

    Тіла структурованих зв'язків (doc["rels"]) сюди не входять: це списки назв препаратів
    («Bry; Sulphur»), які tools/modalities.mjs резолвить у препарати, — їх не перекладають.
    Неозаголовлена проза того ж розділу лишається в doc["sections"] і перекладається.
    """
    items = []
    if doc["common"]:
        items.append((SEC_TITLE, doc["common"]))
    for sec in SEC_ORDER:
        if sec == "Модальности":
            items += [(sec, p) for p in doc["mods"][0] + doc["mods"][1]]
            continue
        items += [(sec, p) for p in doc["sections"].get(sec, [])]
    return items


def doc_segments(doc):
    """Усі англійські рядки документа, що підлягають перекладу (в тому ж порядку, що й запис)."""
    return [en for _, en in doc_items(doc)]


def render(doc, lang, ext_names_all, origin):
    """Документ + мова → текст .md у форматі content/<lang>/remedies/*.md."""
    latin = doc["latin"]
    common = tr(doc["common"], lang) if doc["common"] else ""
    sec_name = (lambda s: s) if lang == "ru" else (lambda s: SEC_UA.get(s, s))
    titles, body = [], []
    for sec in SEC_ORDER:
        if sec == "Модальности":
            w, b = doc["mods"]
            if not (w or b):
                continue
            titles.append(sec_name(sec))
            body.append("## " + sec_name(sec))
            lbl = {"ru": ("Хуже", "Лучше"), "ua": ("Гірше", "Краще")}[lang]
            if w:
                body.append("**• " + lbl[0] + ".** " + "; ".join(tr(x, lang).rstrip(".") for x in w) + ".")
            if b:
                body.append("**• " + lbl[1] + ".** " + "; ".join(tr(x, lang).rstrip(".") for x in b) + ".")
            continue
        if sec == "Взаимосвязи":
            # окрім структурованих зв'язків, у розділі буває проза без підпису — вона лежить
            # у doc["sections"]; поки її тут не друкували, абзаци джерела зникали безслідно
            rest = doc["sections"].get(sec, [])
            if not (doc["rels"] or rest):
                continue
            titles.append(sec_name(sec))
            body.append("## " + sec_name(sec))
            for lab, txt in doc["rels"]:
                if lab is None:
                    body.append(txt)
                else:
                    body.append("**" + rel_label(lab, lang) + ":** " + txt)
            for p in rest:
                body.append(tr(p, lang))
            continue
        paras = doc["sections"].get(sec, [])
        if not paras:
            continue
        titles.append(sec_name(sec))
        body.append("## " + sec_name(sec))
        for p in paras:
            body.append(tr(p, lang))
    title = latin + (" — " + common if common else "")
    fm = ["---", "id: " + doc["id"], "type: remedy"]
    if lang == "ua":
        fm.insert(2, "lang: ua")
    fm.append("latin: " + latin)
    if doc["alt"]:
        fm.append("alt_latin: " + "; ".join(doc["alt"]))
    if common:
        fm.append("common: " + common)
    fm += ["title: " + title, "source: " + SOURCE_LINE[lang], "origin: " + origin, "src: boericke",
           "sections: " + "; ".join(titles), "---", ""]
    return "\n".join(fm) + "\n" + "\n\n".join(body) + "\n"


# ---------------------------------------------------------------------------
# 8. Вивантаження англійських абзаців для перекладачів (--dump-segments)
# ---------------------------------------------------------------------------
def dump_segments(out_dir, docs, chunks=8):
    """Усі абзаци, що підлягають перекладу, → DIR/chunk01.json…chunkNN.json + manifest.json."""
    groups, seen, occurrences, sec_count = [], set(), 0, {}
    for d in docs:
        extra = set(d["sections"]) - set(SEC_ORDER)
        if extra:  # розділ поза SEC_ORDER ніде не друкується — той самий клас помилки, що й «Взаимосвязи»
            raise RuntimeError("%s: розділи поза SEC_ORDER: %s" % (d["id"], ", ".join(sorted(extra))))
        items = []
        for sec, en in doc_items(d):
            occurrences += 1
            sec_count[sec] = sec_count.get(sec, 0) + 1
            k = seg_key(en)
            if k in seen:  # той самий абзац у двох препаратах — ключ один, перекладається раз
                continue
            seen.add(k)
            items.append({"key": k, "slug": d["id"], "latin": d["latin"], "section": sec, "en": en})
        if items:
            groups.append(items)

    total = sum(len(it["en"]) for g in groups for it in g)
    bounds = [total * (i + 1) / chunks for i in range(chunks)]
    parts, cur, acc = [], [], 0
    for g in groups:
        cur += g
        acc += sum(len(it["en"]) for it in g)
        if len(parts) < chunks - 1 and acc >= bounds[len(parts)]:
            parts.append(cur)
            cur = []
    parts.append(cur)

    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    for i, part in enumerate(parts, 1):
        name = "chunk%02d.json" % i
        json.dump(part, open(os.path.join(out_dir, name), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        manifest.append({"file": name, "segments": len(part), "chars": sum(len(it["en"]) for it in part),
                         "remedies": len({it["slug"] for it in part}),
                         "first": part[0]["latin"] if part else None,
                         "last": part[-1]["latin"] if part else None})
    meta = {
        "source": "William Boericke. Pocket Manual of Homoeopathic Materia Medica, 9th ed., 1927",
        "made_by": "tools/import_boericke.py --dump-segments",
        "key": "sha1(utf-8) англійського абзацу — рівно поля \"en\"",
        "target": "tools/boericke-llm.json: {\"<key>\": {\"en\": …, \"ru\": …, \"ua\": …}}",
        "order": "препарат за препаратом, розділи в порядку документа; «%s» — підзаголовок препарату" % SEC_TITLE,
        "remedies": len(groups), "segments": len(seen), "occurrences": occurrences, "chars": total,
        "sections": dict(sorted(sec_count.items(), key=lambda x: -x[1])), "chunks": manifest,
    }
    json.dump(meta, open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("\n%s: %d препаратів, %d абзаців (%d входжень), %d символів, %d шматків"
          % (out_dir, len(groups), len(seen), occurrences, total, len(parts)))
    for m in manifest:
        print("  %s  %4d абз.  %6d симв.  %3d преп.  %s … %s"
              % (m["file"], m["segments"], m["chars"], m["remedies"], m["first"], m["last"]))


# ---------------------------------------------------------------------------
# 9. Точка входу
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch-index", action="store_true", help="лише покажчики (remedies.htm, a.htm…z.htm)")
    ap.add_argument("--dry-run", action="store_true", help="таблиця зіставлення, нічого не писати")
    ap.add_argument("--fetch", action="store_true", help="довантажити сторінки зіставлених препаратів і вийти")
    ap.add_argument("--no-translate", action="store_true", help="не звертатись до Google (для перевірки розбору)")
    ap.add_argument("--dump-segments", metavar="DIR", help="вивантажити англійські абзаци шматками і вийти")
    args = ap.parse_args()

    if args.fetch_index:
        load_name_map()
        load_url_map()
        print("покажчики в", SRC_DIR)
        return

    matches, missing = build_match(verbose=not args.dump_segments)
    if args.dry_run:
        return

    # сторінки препаратів
    pages = {}
    for r in matches:
        fname = r["abbrev"].lower() + ".htm"
        pages[r["abbrev"]] = fetch(r["url"], fname)
    print(f"\nсторінок у sources/boericke: {len(pages)}")
    if args.fetch:
        return

    names = load_name_map()
    abbrev_names = {a: latin_case(f[0]) for a, f in names}

    # розбір
    docs = []
    all_unknown = {}
    used_ids = set()
    for r in matches:
        page = parse_page(pages[r["abbrev"]])
        doc = build_doc(page, abbrev_names)
        doc["latin"] = latin_case(r["boericke"][0])
        # alt_latin: лише ті написання з каталогу, які інакше не резолвляться (ручне зіставлення),
        # і власні синоніми Boericke. Одруки, що їх build.mjs бере сам (лев≤2, унікальне перше слово),
        # сюди не потрапляють — вони нічого не додають, зате видно на сторінці препарату.
        seen = {norm_name(doc["latin"])}
        alt = []
        for cand in [e for e, how in r["ext"] if how == "map"] + [latin_case(b) for b in r["boericke"][1:]]:
            n = norm_name(cand)
            if n and n not in seen:
                seen.add(n)
                alt.append(cand)
        doc["alt"] = alt
        did = slugify(doc["latin"])
        while did in used_ids:
            did += "-b"
        used_ids.add(did)
        doc["id"] = did
        doc["url"] = BASE_URL + r["url"]
        for u in doc["unknown"]:
            all_unknown[u] = all_unknown.get(u, 0) + 1
        docs.append(doc)
    if all_unknown:
        print("\nневідомі заголовки розділів:", ", ".join(f"{k}×{v}" for k, v in sorted(all_unknown.items(), key=lambda x: -x[1])))

    if args.dump_segments:
        dump_segments(args.dump_segments, docs)
        return

    # id не мають збігатися з наявними препаратами
    for lang in ("ru", "ua"):
        exist = {f[:-3] for f in os.listdir(os.path.join(ROOT, "content", lang, "remedies"))}
        clash = exist & used_ids
        if clash:
            print("КОНФЛІКТ id з content/%s/remedies: %s" % (lang, ", ".join(sorted(clash))), file=sys.stderr)
            sys.exit(1)

    segs = []
    for d in docs:
        segs += doc_segments(d)
    print(f"\nсегментів до перекладу: {len(segs)} ({sum(len(s) for s in segs)} символів)")
    llm_report(segs)
    if not args.no_translate:
        t0 = time.time()
        for lang in ("ru", "ua"):
            translate_all(segs, lang)
        print(f"переклад: {time.time() - t0:.0f}s")

    for lang in ("ru", "ua"):
        out = os.path.join(ROOT, "content", lang, "boericke")
        os.makedirs(out, exist_ok=True)
        for f in os.listdir(out):
            if f.endswith(".md"):
                os.remove(os.path.join(out, f))
        for d in docs:
            open(os.path.join(out, d["id"] + ".md"), "w", encoding="utf-8").write(render(d, lang, None, d["url"]))
        print(f"[{lang}] записано {len(docs)} файлів у content/{lang}/boericke")
    if missing:
        print(f"\nне зіставлено: {len(missing)}")


if __name__ == "__main__":
    main()
