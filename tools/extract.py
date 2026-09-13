#!/usr/bin/env python3
"""
extract.py — перетворює архів сайту «Сам себе гомеопат» (hom.zip) на чистий Markdown.

    python3 tools/extract.py ~/.moshi/uploads/hom.zip [--out content]

Результат:
    content/remedies/<slug>.md   — препарати Materia Medica Дж. Г. Кларка (в архіві 296 із 341)
    content/articles/<slug>.md   — статті «Домашнього лікувальника», квіткові настої Баха, про гомеопатію
    tools/report.txt             — що відкинуто, нерозпізнані заголовки, дублікати

Лише стандартна бібліотека Python 3.
"""
import argparse
import collections
import difflib
import html
import io
import json
import os
import re
import sys
import zipfile
from html.parser import HTMLParser

# ----------------------------------------------------------------------------
# 1. Канонічні розділи Materia Medica
# ----------------------------------------------------------------------------
SECTIONS = [
    ("ХАРАКТЕРИСТИКА", "Характеристика"),
    ("ТИП", "Тип"),
    ("ТРОПНОСТЬ", "Тропность"),
    ("КЛИНИКА", "Клиника"),
    ("ПСИХИКА", "Психика"),
    ("ГОЛОВА", "Голова"),
    ("ГОЛОВА СНАРУЖИ", "Голова снаружи"),
    ("ГОЛОВОКРУЖЕНИЕ", "Головокружение"),
    ("ГЛАЗА", "Глаза"),
    ("УШИ", "Уши"),
    ("НОС", "Нос"),
    ("ЛИЦО", "Лицо"),
    ("РОТ", "Рот"),
    ("ЗУБЫ", "Зубы"),
    ("ГОРЛО", "Горло"),
    ("ГОРТАНЬ", "Гортань"),
    ("ТРАХЕЯ", "Трахея"),
    ("ГОРТАНЬ. ТРАХЕЯ", "Гортань. Трахея"),
    ("ПИЩЕВОД", "Пищевод"),
    ("АППЕТИТ", "Аппетит"),
    ("ЖЕЛУДОК", "Желудок"),
    ("ЖИВОТ", "Живот"),
    ("ЖЕЛУДОЧНО-КИШЕЧНЫЙ ТРАКТ", "Желудочно-кишечный тракт"),
    ("АНУС И ПРЯМАЯ КИШКА", "Анус и прямая кишка"),
    ("МОЧЕВЫДЕЛИТЕЛЬНАЯ СИСТЕМА", "Мочевыделительная система"),
    ("МУЖСКИЕ", "Мужские"),
    ("ЖЕНСКИЕ", "Женские"),
    ("МЕНСТРУАЦИЯ", "Менструация"),
    ("БЕРЕМЕННОСТЬ. РОДЫ", "Беременность. Роды"),
    ("МОЛОЧНЫЕ ЖЕЛЕЗЫ", "Молочные железы"),
    ("ДЫХАТЕЛЬНАЯ СИСТЕМА", "Дыхательная система"),
    ("КАШЕЛЬ", "Кашель"),
    ("ГРУДНАЯ КЛЕТКА", "Грудная клетка"),
    ("СЕРДЦЕ И КРОВООБРАЩЕНИЕ", "Сердце и кровообращение"),
    ("ШЕЯ", "Шея"),
    ("СПИНА", "Спина"),
    ("ШЕЯ. СПИНА", "Шея. Спина"),
    ("ПОЗВОНОЧНИК", "Позвоночник"),
    ("КОНЕЧНОСТИ", "Конечности"),
    ("СУСТАВЫ", "Суставы"),
    ("МЫШЦЫ", "Мышцы"),
    ("КОСТИ", "Кости"),
    ("НЕРВНАЯ СИСТЕМА", "Нервная система"),
    ("ЭНДОКРИННАЯ СИСТЕМА", "Эндокринная система"),
    ("ЛИМФАТИЧЕСКИЕ ЖЕЛЕЗЫ", "Лимфатические железы"),
    ("СОН", "Сон"),
    ("ЛИХОРАДКА", "Лихорадка"),
    ("ПОТ", "Пот"),
    ("КОЖА", "Кожа"),
    ("ИНФЕКЦИИ", "Инфекции"),
    ("ОБЩИЕ СИМПТОМЫ", "Общие симптомы"),
    ("ДЕТИ", "Дети"),
    ("СКЛОННОСТИ", "Склонности"),
    ("МОДАЛЬНОСТИ", "Модальности"),
    ("ЭТИОЛОГИЯ", "Этиология"),
    ("ВЗАИМОСВЯЗИ", "Взаимосвязи"),
    ("РЕКОМЕНДАЦИИ", "Рекомендации"),
    ("ОСЛОЖНЕНИЯ ГИРУДОТЕРАПИИ", "Осложнения гирудотерапии"),
]
SECTION_ALIASES = {
    "НОЗОЛОГИИ": "КЛИНИКА",
    "ВЗАИМООТНОШЕНИЯ": "ВЗАИМОСВЯЗИ",
    "ГРУДЬ": "ГРУДНАЯ КЛЕТКА",
    "ПРЯМАЯ КИШКА": "АНУС И ПРЯМАЯ КИШКА",
    "ЛИМФАТИЧЕСКАЯ СИСТЕМА": "ЛИМФАТИЧЕСКИЕ ЖЕЛЕЗЫ",
    "СЕРДЕЧНО-СОСУДИСТАЯ СИСТЕМА": "СЕРДЦЕ И КРОВООБРАЩЕНИЕ",
    "ДЕТСКИЕ": "ДЕТИ",
    "ЖЕЛУДОЧНО – КИШЕЧНЫЙ ТРАКТ": "ЖЕЛУДОЧНО-КИШЕЧНЫЙ ТРАКТ",
}
SECTION_DISPLAY = dict(SECTIONS)
SECTION_KEYS = [k for k, _ in SECTIONS]

# ----------------------------------------------------------------------------
# 2. Сторінки поза індексами, які теж беремо
# ----------------------------------------------------------------------------
EXTRA_ARTICLES = {
    # нормалізований заголовок -> (group, slug)
    "цветочные настои д-ра бака": ("bach", "cvetochnye-nastoi-baha"),
    "rescue remedy - \"спасительное средство\", средство для чрезвычайных, критических ситуаций": ("bach", "rescue-remedy"),
    "средства от апатии": ("bach", "sredstva-ot-apatii"),
    "средства от страха": ("bach", "sredstva-ot-straha"),
    "средства от неуверенности или проблем с принятием решений": ("bach", "sredstva-ot-neuverennosti"),
    "средства от разочарования, упадка духа, уныния и отчаяния": ("bach", "sredstva-ot-razocharovaniya"),
    "средства от чувства одиночества и чрезмерного индивидуализма": ("bach", "sredstva-ot-odinochestva"),
    "средства при излишнем альтруизме, чрезмерной заботе о благе окружающих": ("bach", "sredstva-pri-altruizme"),
    "что представляет собой гомеопатия": ("about", "chto-takoe-gomeopatiya"),
    "гомеопатические дозы. гомеопатические разведения.": ("about", "gomeopaticheskie-dozy"),
    "различные методы гомеопатической практики": ("about", "metody-gomeopaticheskoj-praktiki"),
    "сам себе гомеопат": ("about", "sam-sebe-gomeopat"),
}

# ----------------------------------------------------------------------------
# 3. Утиліти
# ----------------------------------------------------------------------------
PUA_RE = re.compile(r"[-]")
HOMOGLYPHS = str.maketrans({
    "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "К": "K", "М": "M", "О": "O", "Р": "P", "Т": "T", "Х": "X",
    "а": "a", "с": "c", "е": "e", "о": "o", "р": "p", "х": "x", "у": "y",
})
LATIN_HOMOGLYPHS_TO_CYR = str.maketrans({"X": "Х", "A": "А", "C": "С", "E": "Е", "H": "Н", "K": "К", "M": "М", "O": "О", "P": "Р", "T": "Т",
                                          "a": "а", "c": "с", "e": "е", "o": "о", "p": "р", "x": "х", "y": "у"})


def norm_title(s: str) -> str:
    s = html.unescape(s)
    s = PUA_RE.sub("|", s).split("|")[0]
    s = s.replace("\xa0", " ").replace("–", "-").replace("—", "-").replace("«", '"').replace("»", '"')
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def norm_key(s: str) -> str:
    s = norm_title(s)
    s = re.sub(r"[^\w\s]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_header(s: str) -> str:
    s = s.translate(LATIN_HOMOGLYPHS_TO_CYR)
    s = s.replace("\xa0", " ")
    s = re.sub(r"\s*[–—-]\s*", "-", s)
    s = re.sub(r"\s+", " ", s).strip().strip(".:;").strip()
    return s.upper()


def match_section(text: str):
    """Повертає канонічний ключ розділу або None."""
    n = norm_header(text)
    if not n or len(n) < 3 or len(n) > 40:
        return None
    if n in SECTION_ALIASES:
        return SECTION_ALIASES[n]
    if n in SECTION_DISPLAY:
        return n
    n2 = n.rstrip(".")
    if n2 in SECTION_DISPLAY:
        return n2
    if len(n) >= 5 and not re.search(r"\d", n):
        m = difflib.get_close_matches(n, SECTION_KEYS, n=1, cutoff=0.86)
        if m:
            return m[0]
    return None


TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "j",
    "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
    "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "і": "i", "ї": "yi", "є": "ye", "ґ": "g",
}


def slugify(s: str) -> str:
    s = norm_title(s)
    s = "".join(TRANSLIT.get(ch, ch) for ch in s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:70].strip("-")


# ----------------------------------------------------------------------------
# 4. HTML -> рядки з мінімальною розміткою
# ----------------------------------------------------------------------------
BLOCK_TAGS = {"div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "table", "ul", "ol", "blockquote", "br", "hr", "td", "th"}
SKIP_TAGS = {"script", "style", "noscript", "img", "amp-img", "ins", "iframe", "svg", "form", "input", "button"}


class Seg:
    __slots__ = ("text", "bold", "ital", "color")

    def __init__(self, text, bold, ital, color):
        self.text, self.bold, self.ital, self.color = text, bold, ital, color


class LineParser(HTMLParser):
    """Перетворює HTML-фрагмент на список рядків; кожен рядок — список сегментів."""

    def __init__(self, class_colors):
        super().__init__(convert_charrefs=True)
        self.class_colors = class_colors
        self.lines = []          # list[list[Seg]]
        self.cur = []
        self.stack = []          # (tag, bold, ital, color)
        self.bold = 0
        self.ital = 0
        self.color = []
        self.skip = 0
        self.last_was_br = False
        self.breaks = set()      # індекси рядків, що є явними порожніми рядками (подвійний <br>)

    def _style_color(self, attrs):
        d = dict(attrs)
        st = d.get("style", "") or ""
        m = re.search(r"color:\s*#?([0-9a-fA-F]{6})", st)
        if m:
            return m.group(1).lower()
        m = re.search(r"color:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)", st)
        if m:
            return "%02x%02x%02x" % tuple(int(x) for x in m.groups())
        for c in (d.get("class", "") or "").split():
            if c in self.class_colors:
                return self.class_colors[c]
        col = d.get("color")
        if col:
            return col.lstrip("#").lower()
        return None

    def flush(self):
        self.lines.append(self.cur)
        self.cur = []

    def _cur_blank(self):
        return not "".join(seg.text for seg in self.cur).strip()

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            if tag not in ("img", "amp-img", "input", "hr"):
                self.skip += 1
            return
        if tag == "br":
            if self.last_was_br and self._cur_blank():
                self.breaks.add(len(self.lines))
            self.flush()
            self.last_was_br = True
            return
        if tag in BLOCK_TAGS:
            self.flush()
            self.last_was_br = False
        b = i = False
        col = None
        if tag in ("strong", "b"):
            b = True
            self.bold += 1
        elif tag in ("em", "i", "u"):
            i = True
            self.ital += 1
        if tag in ("span", "font", "strong", "b", "em", "i", "u", "a", "p", "div", "h1", "h2", "h3", "h4", "li", "td"):
            col = self._style_color(attrs)
            if col:
                self.color.append(col)
        self.stack.append((tag, b, i, bool(col)))

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS:
            if tag not in ("img", "amp-img", "input", "hr") and self.skip > 0:
                self.skip -= 1
            return
        # pop stack to matching tag
        for k in range(len(self.stack) - 1, -1, -1):
            t, b, i, c = self.stack[k]
            if t == tag:
                for _ in range(len(self.stack) - k):
                    t2, b2, i2, c2 = self.stack.pop()
                    if b2:
                        self.bold -= 1
                    if i2:
                        self.ital -= 1
                    if c2 and self.color:
                        self.color.pop()
                break
        if tag in BLOCK_TAGS and tag != "br":
            self.flush()

    def handle_data(self, data):
        if self.skip:
            return
        if not data:
            return
        if data.strip():
            self.last_was_br = False
        self.cur.append(Seg(data, self.bold > 0, self.ital > 0, self.color[-1] if self.color else None))


def parse_class_colors(doc: str) -> dict:
    colors = {}
    for st in re.finditer(r"<style[^>]*>(.*?)</style>", doc, re.S):
        for m in re.finditer(r"\.([\w-]+)\s*\{([^}]*)\}", st.group(1)):
            cm = re.search(r"(?<![\w-])color:\s*#?([0-9a-fA-F]{6})", m.group(2))
            if cm:
                colors[m.group(1)] = cm.group(1).lower()
    return colors


def body_segment(doc: str):
    for start, ends in [
        ('<div id="text">', ['<div id="ad">', '<div id="footer"']),
        ('<div class="amp-wp-article-content">', ['<footer class="amp-wp-article-footer">', '<div class="amp-wp-meta amp-wp-tax-category">']),
        ('<div class="td-post-content', ['<div class="td-post-source-tags', '<div class="td-post-sharing']),
    ]:
        i = doc.find(start)
        if i >= 0:
            js = [doc.find(e, i) for e in ends]
            js = [j for j in js if j > 0]
            return doc[i:min(js)] if js else doc[i:]
    return None


BLUE = {"0000cd", "0000ff", "000080", "1f497d"}
GREEN = {"006400", "008000"}
PURPLE = {"800080", "7030a0"}


def clean_text(s: str) -> str:
    s = s.replace("\xa0", " ").replace("­", "").replace("¬", "")
    s = PUA_RE.sub("", s)
    s = s.replace(" ", " ").replace("​", "")
    s = re.sub(r"[ \t\r\n\f\v]+", " ", s)
    return s


class Line:
    __slots__ = ("segs", "text", "bold_all", "color", "empty", "spacer")

    def __init__(self, segs, forced_break=False):
        self.segs = segs
        raw = "".join(s.text for s in segs)
        self.text = clean_text(raw).strip()
        self.empty = not self.text
        # явний порожній рядок (&nbsp; або подвійний <br>) = межа абзацу; міжтеговий пробіл — ні
        self.spacer = self.empty and (forced_break or "\xa0" in raw)
        nonspace = [s for s in segs if clean_text(s.text).strip()]
        self.bold_all = bool(nonspace) and all(s.bold for s in nonspace)
        cols = {s.color for s in nonspace if s.color}
        self.color = cols.pop() if len(cols) == 1 and all(s.color for s in nonspace) else None


def render_inline(segs) -> str:
    """Сегменти -> markdown з **bold** та _italic_ (підкреслення/курсив)."""
    # об'єднати сусідні сегменти з однаковим стилем
    merged = []
    for s in segs:
        t = clean_text(s.text)
        if not t:
            continue
        key = (s.bold, s.ital)
        if merged and merged[-1][0] == key:
            merged[-1][1] += t
        else:
            merged.append([key, t])
    out = []
    for (b, i), t in merged:
        lead = t[: len(t) - len(t.lstrip())]
        trail = t[len(t.rstrip()):]
        core = t.strip()
        if not core:
            out.append(t)
            continue
        if b:
            core = f"**{core}**"
        if i:
            core = f"_{core}_"
        out.append(lead + core + trail)
    s = "".join(out)
    s = s.replace("****", "").replace("__", "")
    s = re.sub(r"\*\*([—–-])", r"** \1", s)
    s = re.sub(r"^\*\*\s*(•|·)\s*", "• **", s)
    s = re.sub(r"\s+", " ", s).strip()
    # пробіли перед розділовими знаками
    s = re.sub(r"\s+([,.;:!?)»”])", r"\1", s)
    s = re.sub(r"([(«“])\s+", r"\1", s)
    return s


def html_to_lines(fragment: str, class_colors: dict):
    p = LineParser(class_colors)
    p.feed(fragment)
    p.flush()
    return [Line(segs, k in p.breaks) for k, segs in enumerate(p.lines)]


# ----------------------------------------------------------------------------
# 5. Переформатування (склеювання перенесених рядків у абзаци)
# ----------------------------------------------------------------------------
TERMINAL = ".!?»”\")…"
BULLET_RE = re.compile(r"^\s*(•|•|·|-\s)")


def wrap_width(lines):
    ls = sorted(len(l.text) for l in lines if not l.empty and len(l.text) > 20)
    if not ls:
        return 80
    return ls[int(0.95 * (len(ls) - 1))]


def reflow(items, W):
    """items: список ('text', markdown_line, plain_text) | ('break',) -> список абзаців (markdown)."""
    paras = []
    buf = []          # markdown-рядки поточного абзацу
    last = ""         # plain-текст останнього доданого рядка

    def close():
        nonlocal buf, last
        if buf:
            paras.append(" ".join(buf))
        buf, last = [], ""

    for it in items:
        if it[0] == "break":
            close()
            continue
        md, plain = it[1], it[2]
        if not buf:
            buf, last = [md], plain
            continue
        if BULLET_RE.match(plain):
            close()
            buf, last = [md], plain
            continue
        starts_lower = plain[:1].islower()
        prev = last.rstrip()
        prev_long = len(prev) >= W - 12
        prev_terminal = prev[-1:] in TERMINAL if prev else False
        if prev.endswith("-") and starts_lower and len(prev) >= W - 20:
            # перенос слова через дефіс
            buf[-1] = buf[-1].rstrip()[:-1]
            buf[-1] += md
            last = prev[:-1] + plain
            continue
        if prev_long or not prev_terminal or starts_lower:
            buf.append(md)
            last = plain
        else:
            close()
            buf, last = [md], plain
    close()
    return [tidy_para(p) for p in paras if p.strip()]


def tidy_para(p: str) -> str:
    p = re.sub(r"\s+", " ", p).strip()
    p = re.sub(r"\s+([,.;:!?)»”])", r"\1", p)
    p = re.sub(r"([(«“])\s+", r"\1", p)
    p = re.sub(r"\*\*\s*\*\*", " ", p)
    p = p.replace("** **", " ")
    p = re.sub(r"\s+", " ", p).strip()
    p = re.sub(r"([а-яё»)])\.([А-ЯЁ])", r"\1. \2", p)
    # маркери списку
    m = re.match(r"^(•|•|·)\s*(.*)$", p)
    if m:
        body = m.group(2).strip()
        mm = re.match(r"^(\*\*)?(Хуже|Лучше)\.?(\*\*)?\.?\s*(.*)$", body)
        if mm:
            body = f"**{mm.group(2)}.** {mm.group(4)}".strip()
        p = "- " + body
    return p


# ----------------------------------------------------------------------------
# 6. Розбір сторінки препарату
# ----------------------------------------------------------------------------
SOURCE_RE = re.compile(r"^\s*(\*\*|_)?\s*Источник\s*:?\s*(\*\*|_)?\s*:?", re.I)
AUTHOR_RE = re.compile(r"^\s*(\*\*|_)?\s*Автор статьи\s*:?\s*(\*\*|_)?\s*:?", re.I)


def strip_md(s: str) -> str:
    return re.sub(r"[*_]{1,2}", "", s).strip()


def extract_source(lines, log):
    """Вирізає рядки «Источник: …» (+ продовження у дужках) і «Автор статьи: …»."""
    src, author = None, None
    out = []
    i = 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        t = ln.text
        if SOURCE_RE.match(t):
            s = SOURCE_RE.sub("", strip_md(render_inline(ln.segs))).strip()
            j = i + 1
            # продовження: рядок у дужках або рядок без крапки в кінці попереднього
            while j < n and j < i + 12:
                if lines[j].empty and not lines[j].spacer:
                    j += 1
                    continue
                if lines[j].empty:
                    break
                if lines[j].text.startswith("(") or re.match(r"^\d+\.\s", lines[j].text) or not s.rstrip().endswith((")", ".", "»")):
                    s += " " + strip_md(render_inline(lines[j].segs))
                    j += 1
                    continue
                break
            s = re.sub(r"\s+", " ", s).strip(" .")
            s = re.sub(r"^\d+\.\s*", "", s)
            src = (src + " " + s) if src and s not in src else (s or src)
            i = j
            continue
        if AUTHOR_RE.match(t):
            author = AUTHOR_RE.sub("", strip_md(render_inline(ln.segs))).strip(" .")
            i += 1
            continue
        out.append(ln)
        i += 1
    return out, src, author


def split_header_prefix(line):
    """Якщо рядок починається з жирного/синього заголовка розділу, а далі йде текст — розділити."""
    segs = line.segs
    head = []
    rest = []
    for k, s in enumerate(segs):
        if not clean_text(s.text).strip():
            (head if not rest else rest).append(s)
            continue
        if (s.bold or s.color in BLUE) and not rest:
            head.append(s)
        else:
            rest = segs[k:]
            break
    if head and rest:
        ht = clean_text("".join(s.text for s in head)).strip()
        key = match_section(ht)
        if key and clean_text("".join(s.text for s in rest)).strip():
            return key, Line(rest)
    return None, None


def parse_remedy(lines, log):
    W = wrap_width(lines)
    sections = []              # (key or None, [items])
    cur_key = None
    items = []
    unknown_caps = []
    for ln in lines:
        if ln.empty:
            if ln.spacer:
                items.append(("break",))
            continue
        t = ln.text
        letters = re.sub(r"[^\w]", "", t)
        is_caps = len(letters) >= 3 and letters.isupper()
        key = None
        if (ln.bold_all or is_caps) and len(t) <= 45:
            key = match_section(t)
            if key is None and is_caps and not re.search(r"[A-Za-z0-9]", letters):
                unknown_caps.append(t)
        if key is None:
            k2, rest = split_header_prefix(ln)
            if k2:
                sections.append((cur_key, items))
                cur_key, items = k2, []
                items.append(("text", render_inline(rest.segs), rest.text))
                continue
        if key:
            sections.append((cur_key, items))
            cur_key, items = key, []
            continue
        items.append(("text", render_inline(ln.segs), t))
    sections.append((cur_key, items))
    out = []
    for key, its in sections:
        paras = reflow(its, W)
        if not paras and key is None:
            continue
        out.append((key, paras))
    for u in unknown_caps:
        log.append(f"  unknown caps line: {u}")
    return out


# ----------------------------------------------------------------------------
# 7. Розбір статті
# ----------------------------------------------------------------------------
LATIN_NAME_RE = re.compile(r"^[A-Z][a-z]+(?:[ \-][a-z]+){0,3}$")


LATIN_HEAD_RE = re.compile(r"^[A-Z][a-z]+(?:[ \-][A-Za-z]+){0,3}\s*(\(|:|$|—|–)")
CYR_RE = re.compile(r"[А-Яа-яЁё]")
LAT_RE = re.compile(r"[A-Za-z]")


def looks_latin(word: str) -> bool:
    lat = len(LAT_RE.findall(word))
    cyr = len(CYR_RE.findall(word))
    return lat >= 2 and lat >= cyr


def fold_latin(text: str) -> str:
    """Замінює кириличні гомогліфи на латиницю у словах, що виглядають латинськими (Hyoscуamus -> Hyoscyamus)."""
    return " ".join(w.translate(HOMOGLYPHS) if looks_latin(w) else w for w in text.split(" "))


def is_remedy_header(line):
    """Синій або жирний рядок, що починається з латинської назви: «Aconitum (Аконитум)» — заголовок блоку препарату."""
    t = line.text
    if len(t) > 160:
        return False
    plain = strip_md(t)
    first = re.match(r"^\S+", plain)
    if not first or not looks_latin(first.group(0)) or not plain[:1].isupper():
        return False
    plain = fold_latin(plain)
    if not re.match(r"^[A-Z][a-z]", plain):
        return False
    blue = [s for s in line.segs if s.color in BLUE and clean_text(s.text).strip()]
    if blue and (line.bold_all or LATIN_HEAD_RE.match(plain)):
        return True
    if line.bold_all and LATIN_HEAD_RE.match(plain) and len(t) <= 90:
        return True
    return False


def is_sub_header(line):
    """Фіолетовий/синій жирний кириличний рядок або рядок великими літерами — підзаголовок."""
    t = line.text
    letters = re.sub(r"[^\w]", "", t)
    if len(letters) >= 3 and letters.isupper() and len(t) <= 60 and not re.search(r"[A-Za-z]", letters):
        return True
    if line.bold_all and line.color in (PURPLE | BLUE) and len(t) <= 90 and re.match(r"^[А-ЯЁ]", t):
        return True
    return False


def parse_article(lines, log):
    W = wrap_width(lines)
    blocks = []               # (kind, title, items) kind: 'intro'|'sub'|'remedy'
    cur = ("intro", None, [])
    i = 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        if ln.empty:
            if ln.spacer:
                cur[2].append(("break",))
            i += 1
            continue
        t = ln.text
        letters = re.sub(r"[^\w]", "", t)
        is_caps = len(letters) >= 3 and letters.isupper() and len(t) <= 60
        if is_remedy_header(ln):
            blocks.append(cur)
            title = fold_latin(strip_md(render_inline(ln.segs)).strip(" .:"))
            first = None
            # "Aconitum (Аконитум) Текст…" або "Carbo animalis: текст…" — заголовок і перше речення в одному рядку
            m = re.match(r"^(.{3,60}?\))\s+([А-ЯЁ].{20,})$", title)
            if m:
                title, first = m.group(1), m.group(2)
            else:
                m = re.match(r"^([^:—–]{3,45}?)\s*[:—–]\s*([А-ЯЁа-яё].{10,})$", title)
                if m and all(looks_latin(w) or w.lower() in ("и", "et", "=") for w in m.group(1).split()):
                    title, first = m.group(1).strip(), m.group(2).strip()
            cur = ("remedy", title, [("text", first, first)] if first else [])
            i += 1
            continue
        if is_sub_header(ln):
            blocks.append(cur)
            cur = ("sub", strip_md(render_inline(ln.segs)).strip(" .:"), [])
            i += 1
            continue
        cur[2].append(("text", render_inline(ln.segs), t))
        i += 1
    blocks.append(cur)
    out = []
    for kind, title, its in blocks:
        paras = reflow(its, W)
        if kind == "intro" and not paras:
            continue
        if kind == "remedy" and not paras and out and out[-1][0] == "intro" and out[-1][2] and out[-1][2][-1].startswith("**"):
            # хвіст жирного списку препаратів у вступі, помилково прийнятий за заголовок
            last = out[-1][2][-1]
            out[-1][2][-1] = last[:-2].rstrip() + " " + title + "**" if last.endswith("**") else last + " " + title
            continue
        out.append((kind, title, paras))
    return out


# ----------------------------------------------------------------------------
# 8. Заголовки препаратів з індексу Materia Medica
# ----------------------------------------------------------------------------
def parse_mm_title(title: str):
    """«Aconitum napellus (Аконитум) — борец ядовитый» -> (latin, translit, common, alt_latin)."""
    t = html.unescape(title).replace("\xa0", " ")
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"(\S)\(", r"\1 (", t)
    t = fold_latin(t)
    words = t.split(" ")
    lat = []
    for w in words:
        if w.startswith("(") or not looks_latin(w.strip("(),.")):
            break
        lat.append(w)
    latin = " ".join(lat).strip(" ,")
    rest = t[len(" ".join(lat)):].strip()
    translit, common, alt_latin = "", "", ""
    m = re.match(r"^\(?([^()]*)\)\s*(.*)$", rest)
    if m:
        inner, rest2 = m.group(1).strip(), m.group(2).strip()
        if looks_latin(inner.split(" ")[0]):
            alt_latin = inner
            m2 = re.match(r"^[-–—=]?\s*([А-ЯЁа-яё][^-–—]*?)\s*[-–—]\s*(.*)$", rest2)
            if m2:
                translit, common = m2.group(1).strip(), m2.group(2).strip()
            else:
                common = rest2.lstrip("-–—= ").strip()
        else:
            translit = inner
            m3 = re.match(r"^=\s*([A-Za-z][A-Za-z ]*?)\s*\((.*?)\)\s*(.*)$", rest2)
            if m3:
                alt_latin = m3.group(1).strip()
                translit = translit + " = " + m3.group(2).strip()
                rest2 = m3.group(3)
            common = rest2.lstrip("-–—= ").strip()
    else:
        common = rest.lstrip("-–—= ").strip()
    return latin, translit, common, alt_latin


# ----------------------------------------------------------------------------
# 9. Головна процедура
# ----------------------------------------------------------------------------
def read_zip(path):
    z = zipfile.ZipFile(path)
    docs = {}
    for info in z.infolist():
        name = info.filename
        if not (info.flag_bits & 0x800):
            try:
                name = name.encode("cp437").decode("utf-8")
            except Exception:
                pass
        if name.endswith("/") or not name.lower().endswith(".html"):
            continue
        docs[os.path.basename(name)] = z.read(info).decode("utf-8", errors="replace")
    return docs


def page_title(doc):
    m = re.search(r"<title>(.*?)</title>", doc, re.S)
    return html.unescape(m.group(1)).strip() if m else ""


def page_keywords(doc):
    m = re.search(r'<meta name="[Kk]eywords" content="([^"]*)"', doc)
    if not m:
        return []
    kws = [k.strip().lower() for k in re.split(r"[,;]", html.unescape(m.group(1)))]
    drop = {"гомеопатический", "препарат", "гомеопатия", ""}
    out = []
    for k in kws:
        k = re.sub(r"\s+", " ", k)
        if k in drop or len(k) < 3 or k in out:
            continue
        out.append(k)
    return out


def origin_url(doc):
    m = re.search(r'<link rel="canonical" href="([^"]+)"', doc)
    if m:
        return m.group(1)
    m = re.search(r'<meta property="og:url" content="([^"]+)"', doc)
    return m.group(1) if m else ""


def fm_escape(v: str) -> str:
    v = str(v).replace("\n", " ").strip()
    return v


def write_md(path, fm: dict, body: str):
    with open(path, "w", encoding="utf-8") as f:
        f.write("---\n")
        for k, v in fm.items():
            if v is None or v == "" or v == []:
                continue
            if isinstance(v, list):
                f.write(f"{k}: {'; '.join(fm_escape(x) for x in v)}\n")
            else:
                f.write(f"{k}: {fm_escape(v)}\n")
        f.write("---\n\n")
        f.write(body.rstrip() + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zip")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "content", "ru"))
    args = ap.parse_args()
    out_dir = args.out
    rem_dir = os.path.join(out_dir, "remedies")
    art_dir = os.path.join(out_dir, "articles")
    os.makedirs(rem_dir, exist_ok=True)
    os.makedirs(art_dir, exist_ok=True)
    for d in (rem_dir, art_dir):          # прибрати застарілі файли попереднього запуску
        for fn in os.listdir(d):
            if fn.endswith(".md"):
                os.remove(os.path.join(d, fn))
    report = []

    docs = read_zip(args.zip)
    report.append(f"HTML files in archive: {len(docs)}")

    # --- індекси
    mm_doc = next(d for n, d in docs.items() if n.startswith("Materia Medica") and '<div id="titles">' in d)
    i = mm_doc.find('<div id="titles">')
    j = mm_doc.find('<div class="flat_pm_end">', i)
    mm_index = [(h, html.unescape(re.sub(r"<[^>]+>", "", t)).strip()) for h, t in re.findall(r'<h3><a href="([^"]+)">(.*?)</a></h3>', mm_doc[i:j], re.S)]
    le_doc = next(d for n, d in docs.items() if n.startswith("Домашний_гомеопатический_лечебник") and "td-page-content" in d)
    i = le_doc.find("td-page-content")
    j = le_doc.find('<div class="td-pb-span4 td-main-sidebar', i)
    le_index = [(h, html.unescape(re.sub(r"<[^>]+>", "", t)).strip()) for h, t in re.findall(r'<h3><a href="([^"]+)">(.*?)</a></h3>', le_doc[i:j], re.S)]
    report.append(f"Materia Medica index: {len(mm_index)}; Лечебник index: {len(le_index)}")

    # --- розбір усіх сторінок
    pages = []
    for name, doc in docs.items():
        seg = body_segment(doc)
        if seg is None:
            continue
        cc = parse_class_colors(doc)
        lines = html_to_lines(seg, cc)
        plain_len = sum(len(l.text) for l in lines)
        pages.append(dict(name=name, doc=doc, title=page_title(doc), lines=lines, plen=plain_len))

    by_key = collections.defaultdict(list)
    for p in pages:
        by_key[norm_key(p["title"])].append(p)

    def latin_key(t):
        m = re.match(r"\s*([A-Za-z][A-Za-z\-]+(?:\s+[a-z][a-z\-]+)?)", html.unescape(t).translate(HOMOGLYPHS))
        return m.group(1).lower() if m else None

    by_latin = collections.defaultdict(list)
    for p in pages:
        k = latin_key(p["title"])
        if k:
            by_latin[k].append(p)

    used = set()
    # --- препарати
    remedies = []
    for href, title in mm_index:
        cands = by_key.get(norm_key(title)) or []
        if not cands:
            cands = [p for p in by_latin.get(latin_key(title) or "", []) if p["name"] not in used]
        if not cands:
            report.append(f"NO PAGE for remedy: {title}")
            continue
        best = max(cands, key=lambda p: p["plen"])
        for p in cands:
            used.add(p["name"])
        latin, translit, common, alt_latin = parse_mm_title(title)
        slug = slugify(latin)
        remedies.append(dict(href=href, title=title, latin=latin, translit=translit, common=common, alt_latin=alt_latin, slug=slug, page=best, ncopies=len(cands)))
    slugs = collections.Counter(r["slug"] for r in remedies)
    for r in remedies:
        if slugs[r["slug"]] > 1:
            report.append(f"DUPLICATE slug {r['slug']} for {r['title']}")

    n_written = 0
    for r in remedies:
        log = []
        lines, src, author = extract_source(r["page"]["lines"], log)
        sections = parse_remedy(lines, log)
        body = []
        for key, paras in sections:
            if key:
                body.append(f"## {SECTION_DISPLAY[key]}\n")
            body.append("\n\n".join(paras))
            body.append("")
        keys = [k for k, _ in sections if k]
        if len(keys) < 5:
            log.append(f"  only {len(keys)} sections recognised")
        fm = dict(
            id=r["slug"], type="remedy", latin=r["latin"], alt_latin=r["alt_latin"], transliteration=r["translit"], common=r["common"],
            title=r["title"], keywords=page_keywords(r["page"]["doc"]), source=src, origin=r["href"], sections=[SECTION_DISPLAY[k] for k in keys],
        )
        write_md(os.path.join(rem_dir, r["slug"] + ".md"), fm, "\n".join(body))
        n_written += 1
        if log:
            report.append(f"remedy {r['slug']} ({r['page']['name'][:40]}):")
            report.extend(log)
    report.append(f"Remedies written: {n_written}")

    # --- статті
    articles = []
    for href, title in le_index:
        cands = by_key.get(norm_key(title)) or []
        if not cands:
            report.append(f"NO PAGE for article: {title}")
            continue
        best = max(cands, key=lambda p: p["plen"])
        for p in cands:
            used.add(p["name"])
        articles.append(dict(href=href, title=title, group="lechebnik", slug=slugify(title), page=best))
    # додаткові
    for p in pages:
        if p["name"] in used:
            continue
        k = norm_title(p["title"]).strip()
        for ek, (group, slug) in EXTRA_ARTICLES.items():
            if k == ek or k.startswith(ek[:40]):
                cands = [q for q in pages if norm_title(q["title"]).strip() == k]
                best = max(cands, key=lambda q: q["plen"])
                for q in cands:
                    used.add(q["name"])
                if not any(a["slug"] == slug for a in articles):
                    articles.append(dict(href=origin_url(best["doc"]), title=html.unescape(best["title"]).split("|")[0].strip(), group=group, slug=slug, page=best))
                break
    slugs = collections.Counter(a["slug"] for a in articles)
    for a in articles:
        if slugs[a["slug"]] > 1:
            report.append(f"DUPLICATE article slug {a['slug']} for {a['title']}")

    n_written = 0
    for a in articles:
        log = []
        lines, src, author = extract_source(a["page"]["lines"], log)
        cut = [k for k, ln in enumerate(lines) if ln.text == "Новые материалы"]   # хвіст головної сторінки зі списком новин
        if cut:
            lines = lines[:cut[0]]
        blocks = parse_article(lines, log)
        body = []
        for kind, title, paras in blocks:
            if kind == "sub":
                body.append(f"## {title}\n")
            elif kind == "remedy":
                body.append(f"### {title}\n")
            body.append("\n\n".join(paras))
            body.append("")
        n_rem = sum(1 for k, _, _ in blocks if k == "remedy")
        fm = dict(id=a["slug"], type="article", group=a["group"], title=a["title"], source=src, author=author, origin=a["href"], remedy_blocks=n_rem)
        write_md(os.path.join(art_dir, a["slug"] + ".md"), fm, "\n".join(body))
        n_written += 1
        if log:
            report.append(f"article {a['slug']}:")
            report.extend(log)
    report.append(f"Articles written: {n_written} (lechebnik {sum(1 for a in articles if a['group']=='lechebnik')}, bach {sum(1 for a in articles if a['group']=='bach')}, about {sum(1 for a in articles if a['group']=='about')})")

    # --- відкинуте
    report.append("Dropped pages (not remedies/articles):")
    seen = set()
    for p in pages:
        if p["name"] in used:
            continue
        t = html.unescape(p["title"]).split("|")[0].strip()
        if t in seen:
            continue
        seen.add(t)
        report.append(f"  {p['plen']:6d}  {t[:90]}")

    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print("\n".join(l for l in report if not l.startswith("  ")))


if __name__ == "__main__":
    main()
