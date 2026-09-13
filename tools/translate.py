#!/usr/bin/env python3
"""
translate.py — робить українську версію контенту: content/ru/**/*.md → content/ua/**/*.md.

    python3 tools/translate.py            # перекласти лише ті файли, яких ще немає в content/ua
    python3 tools/translate.py --force    # перекласти все заново (кеш сегментів усе одно використовується)

Переклад — Google Translate через бібліотеку translatepy, пакетами по ~3000 символів.
Кеш перекладених сегментів: tools/translate-cache.json (не в git; потрібен лише для відновлення перерваного запуску).
Латинські назви препаратів лишаються як є; канонічні назви розділів беруться з таблиці SECTION_UA.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "content", "ru")
DST = os.path.join(ROOT, "content", "ua")
CACHE_FILE = os.path.join(ROOT, "tools", "translate-cache.json")

SECTION_UA = {
    "Характеристика": "Характеристика", "Тип": "Тип", "Тропность": "Тропність", "Клиника": "Клініка", "Психика": "Психіка",
    "Голова": "Голова", "Голова снаружи": "Голова зовні", "Головокружение": "Запаморочення", "Глаза": "Очі", "Уши": "Вуха", "Нос": "Ніс",
    "Лицо": "Обличчя", "Рот": "Рот", "Зубы": "Зуби", "Горло": "Горло", "Гортань": "Гортань", "Трахея": "Трахея", "Гортань. Трахея": "Гортань. Трахея",
    "Пищевод": "Стравохід", "Аппетит": "Апетит", "Желудок": "Шлунок", "Живот": "Живіт", "Желудочно-кишечный тракт": "Шлунково-кишковий тракт",
    "Анус и прямая кишка": "Анус і пряма кишка", "Мочевыделительная система": "Сечовидільна система", "Мужские": "Чоловічі", "Женские": "Жіночі",
    "Менструация": "Менструація", "Беременность. Роды": "Вагітність. Пологи", "Молочные железы": "Молочні залози", "Дыхательная система": "Дихальна система",
    "Кашель": "Кашель", "Грудная клетка": "Грудна клітка", "Сердце и кровообращение": "Серце і кровообіг", "Шея": "Шия", "Спина": "Спина",
    "Шея. Спина": "Шия. Спина", "Позвоночник": "Хребет", "Конечности": "Кінцівки", "Суставы": "Суглоби", "Мышцы": "М’язи", "Кости": "Кістки",
    "Нервная система": "Нервова система", "Эндокринная система": "Ендокринна система", "Лимфатические железы": "Лімфатичні залози", "Сон": "Сон",
    "Лихорадка": "Гарячка", "Пот": "Піт", "Кожа": "Шкіра", "Инфекции": "Інфекції", "Общие симптомы": "Загальні симптоми", "Дети": "Діти",
    "Склонности": "Схильності", "Модальности": "Модальності", "Этиология": "Етіологія", "Взаимосвязи": "Взаємозв’язки", "Рекомендации": "Рекомендації",
    "Осложнения гирудотерапии": "Ускладнення гірудотерапії", "Общее": "Загальне",
}
FIXED = {"**Хуже.**": "**Гірше.**", "**Лучше.**": "**Краще.**"}

CYR = re.compile(r"[А-Яа-яЁёЇїІіЄєҐґ]")

# --------------------------------------------------------------------------- кеш
lock = threading.Lock()
cache = {}
if os.path.exists(CACHE_FILE):
    cache = json.load(open(CACHE_FILE, encoding="utf-8"))
dirty = 0


def save_cache():
    global dirty
    with lock:
        tmp = CACHE_FILE + ".tmp"
        json.dump(cache, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
        os.replace(tmp, CACHE_FILE)
        dirty = 0


# --------------------------------------------------------------------------- переклад
def fix_bold(s: str) -> str:
    """**жирний** без пробілів усередині маркерів і з пробілом після закриття перед літерою."""
    parts = s.split("**")
    if len(parts) % 2 == 0:
        return s
    out = []
    for i, p in enumerate(parts):
        if i % 2 == 1:
            out.append(p.strip())
        else:
            if i > 0 and p and not p[0].isspace() and re.match(r"[\wА-Яа-яЁёЇїІіЄєҐґ(«]", p):
                p = " " + p
            if i < len(parts) - 1 and p and not p[-1].isspace() and re.search(r"[\wА-Яа-яЁёЇїІіЄєҐґ)»,.;:]$", p):
                p = p + " "
            out.append(p)
    return "**".join(out)


def postfix(ru: str, ua: str) -> str:
    """Виправляє артефакти Google: злиті речення, пробіли біля маркерів, зіпсовану розмітку."""
    s = ua.replace(" ", " ")
    s = re.sub(r"([.;:!?…»)])([А-ЯҐЄІЇа-яґєіїA-Za-z«(_*])", r"\1 \2", s)
    s = re.sub(r"\s+([,.;:!?)»])", r"\1", s)
    s = re.sub(r"\s+", " ", s).strip()
    # розмітка: якщо кількість маркерів не збіглася — прибрати їх зовсім
    if s.count("**") != ru.count("**") or s.count("**") % 2:
        s = s.replace("**", "")
    else:
        s = fix_bold(s)
    if ru.count("_") != s.count("_"):
        s = s.replace("_", "")
    else:
        s = re.sub(r"_\s+", "_", s)
        s = re.sub(r"\s+_", "_", s)
        s = re.sub(r"(^|[\s(«])_([^_]+?)_(?=[\s.,;:)»!?]|$)", r"\1_\2_", s)
        s = re.sub(r"([^\s(«])_([^_]+?)_", r"\1 _\2_", s)
        s = re.sub(r"_([^_]+?)_(?=[^\s.,;:)»!?])", r"_\1_ ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for k, v in FIXED.items():
        if ru.startswith(k):
            s = re.sub(r"^\*\*[^*]{0,20}\*\*\s*", "", s)
            s = v + " " + s
    return s.strip()


# ---------------------------------------------------------------------------
# Пастки Google для медичних текстів. Два механізми:
#  1) protect_ru: перед перекладом замінити слово, яке Google перекладає не тим значенням,
#     на однозначний відповідник того ж роду (язык → лизык → «лізик» → язик; стул → кал/дефекация;
#     образование → формирование), щоб узгодження прикметників зробив сам перекладач;
#  2) fix_terms: після перекладу виправити слова, для яких стенд-іну немає (веко → повіка,
#     рожа → бешиха, виски → скроні, течение → перебіг) з узгодженням сусідніх прикметників.
# ---------------------------------------------------------------------------
LANG_CTX = re.compile(r"(русск|латинск|английск|немецк|французск|греческ|испанск|итальянск|иностранн|родн|литературн|разговорн|научн|украинск|польск)\w*\s+язык|язык\w*\s+(оригинал|науки|общения)|перевод|говорит на|владе\w+ язык", re.I)
CHAIR_CTX = re.compile(r"спинк\w* стул|со стула|встать со|встал со|вставани\w* со|поставлен стул|садится на стул|сидит на стул|на стуле сид|стул для|стулья|стульях|кресл", re.I)
EDU_CTX = re.compile(r"образованн|получ\w* образовани|высше\w* образовани|средне\w* образовани|медицинско\w* образовани|без образования", re.I)
LB = r"(?<![а-яёіїєґA-Za-z])"
RB = r"(?![а-яёіїєґA-Za-z])"
STOOL_ACT = re.compile(LB + r"(после|перед|до|во время|при|без|nет|нет|задержк\w*|отсутстви\w*|позыв\w*\s+(?:на|к))\s+(стул|стула|стулу|стулом|стуле)" + RB, re.I)
STOOL_ACT_FORM = {"стул": "дефекацию", "стула": "дефекации", "стулу": "дефекации", "стулом": "дефекацией", "стуле": "дефекации"}
STOOL_FORM = {"стул": "кал", "стула": "кала", "стулу": "калу", "стулом": "калом", "стуле": "кале", "стульев": "испражнений"}


def _case(src, dst):
    return dst[0].upper() + dst[1:] if src[0].isupper() else dst


def protect_ru(seg: str) -> str:
    s = seg
    if re.search(r"\bязык", s, re.I) and not LANG_CTX.search(s):
        s = re.sub(LB + r"([Яя])зык(а|у|ом|е|и|ов|ам|ами|ах)?" + RB, lambda m: ("Л" if m.group(1) == "Я" else "л") + "изык" + (m.group(2) or ""), s)
    if re.search(r"\bстул", s, re.I) and not CHAIR_CTX.search(s):
        def act(m):
            w = m.group(2)
            f = STOOL_ACT_FORM[w.lower()]
            if m.group(1).lower() in ("нет", "без") or m.group(1).lower().startswith(("задержк", "отсутств")):
                f = "дефекации"
            return m.group(1) + " " + _case(w, f)
        s = STOOL_ACT.sub(act, s)
        s = re.sub(LB + r"([Сс]тул|[Сс]тула|[Сс]тулу|[Сс]тулом|[Сс]туле|[Сс]тульев)" + RB, lambda m: _case(m.group(1), STOOL_FORM[m.group(1).lower()]), s)
    # лицо (обличчя) проти лица (особи): множина/родовий множини — люди, однина — обличчя
    if re.search(r"(?<![а-яё])лиц[оаеу]м?(?![а-яё])", s, re.I):
        def face(m):
            pre, w, post = m.group(1), m.group(2), m.group(3)
            low = w.lower()
            if low in ("лицам", "лицами", "лицах", "лиц"):
                return m.group(0)
            if low == "лица" and (re.match(r"\s*,?\s*(которые|склонные|страдающие|с\s|у\s|в возрасте|обоего|обоих|пожилого|молодого|среднего)", post, re.I) or re.search(r"(у|для|среди|молодые|пожилые|особенно у|многие|некоторые|все|такие|эти|те|нервные|полные|худые|тучные)\s*$", pre, re.I)):
                return m.group(0)
            form = {"лицо": "обличчя", "лица": "обличчя", "лице": "обличчі", "лицу": "обличчю", "лицом": "обличчям"}[low]
            return pre + _case(w, form) + post
        s = re.sub(r"(^|.{0,25}?)(?<![а-яё])([Лл]иц[оаеу]м?|[Лл]иц)(?![а-яё])((?:\s*,?\s*[а-яё]+){0,2})", lambda m: face(m) if m.group(2).lower() not in ("лиц",) else m.group(0), s)
    # стеснение (в груди) → сдавление; гложущий → грызущий; давящий → сдавливающий
    s = re.sub(r"(?<![а-яё])([Сс])теснени(е|я|ю|ем|и)(?![а-яё])", lambda m: _case(m.group(1), "с") + "давлени" + m.group(2), s)
    s = re.sub(r"(?<![а-яё])([Гг])ложущ", lambda m: _case(m.group(1), "г") + "рызущ", s)
    s = re.sub(r"(?<![а-яё])([Дд])авящ", lambda m: _case(m.group(1), "с") + "давливающ", s)
    if re.search(r"\bобразовани", s, re.I) and not EDU_CTX.search(s):
        s = re.sub(LB + r"([Оо])бразовани(е|я|ю|ем|и|ях|ям|ями)" + RB, lambda m: ("Ф" if m.group(1) == "О" else "ф") + "ормировани" + m.group(2), s)
    return s


CENTURY_CTX = re.compile(r"\b([IVXХ]{1,5}|\d{1,2})\s*-?\s*(го|м|й|х)?\s*(век|века|веке|веков|веках)\b|(прошл|нынешн|наш|нов|средн|минувш|прошедш|текущ|позапрошл|девятнадцат|двадцат|восемнадцат)\w*\s+век|век\w*\s+(назад|наук|истори)|(на протяжении|в течение|многие|многих|долгие|столько)\s+(веков|столетий|века)|(использ|примен|известн|славил|счита)\w*\s+веками|веками\s+(использ|примен|известн|счита|люди|человеч)|столети", re.I)
EYE_RU = re.compile(r"\b(век|века|веку|веком|веке|веки|векам|веками|веках|веко)\b", re.I)
EYE_SG_GEN = {"века": "повіки", "век": "повік", "веки": "повіки", "веко": "повіка"}
# прикметники ліво/право/верхньо/нижньо…: чоловічий/середній рід → жіночий, за відмінком цільового слова
ADJ_STEMS = r"(верхн|нижн|лів|прав|зовнішн|внутрішн|хвор|уражен|здоров|обидв|друг|один|одн|кожн|цьому|тому)"
ADJ_TO_FEM = {
    "повіці": {"ьому": "ій", "ому": "ій", "ім": "ій", "ім́": "ій"},
    "повіки": {"ього": "ьої", "ого": "ої"},
    "повікою": {"ім": "ьою", "им": "ою"},
    "повіка": {"є": "я", "е": "а", "ий": "а", "ій": "я", "а": "і"},
}


def _fem_adjs(text: str, noun: str) -> str:
    """Узгоджує до 2 прикметників перед noun (жіночий рід)."""
    table = ADJ_TO_FEM.get(noun)
    if not table:
        return text
    def conv(w):
        low = w.lower()
        if low == "обидва" and noun == "повіки":
            return _case(w, "обидві")
        for src, dst in table.items():
            if low.endswith(src) and re.match(ADJ_STEMS, low):
                return w[: len(w) - len(src)] + dst
        return w
    def rep(m):
        words = m.group(1).split()
        return " ".join(conv(w) for w in words) + " " + m.group(2)
    return re.sub(r"((?:[а-яіїєґ’']+\s+){1,2})(" + noun + r")\b", rep, text)


def fix_eyelids(ru: str, ua: str) -> str:
    if not re.search(r"століт|сторіч|" + LB + r"ві[кц]", ua, re.I) or not EYE_RU.search(ru):
        return ua
    ru_s = re.split(r"(?<=[.;!?])\s+", ru)
    ua_s = re.split(r"(?<=[.;!?])\s+", ua)
    aligned = len(ru_s) == len(ua_s)
    out = []
    for i, us in enumerate(ua_s):
        ctx = ru_s[i] if aligned and EYE_RU.search(ru_s[i]) else ru
        if not EYE_RU.search(ctx) or CENTURY_CTX.search(ctx) or not re.search(r"століт|сторіч|" + LB + r"ві[кц]", us, re.I):
            out.append(us)
            continue
        t = us
        t = re.sub(LB + r"([Сс])толітті" + RB, lambda m: _case(m.group(1), "повіці"), t)
        t = re.sub(LB + r"([Сс])толіттях" + RB, lambda m: _case(m.group(1), "повіках"), t)
        t = re.sub(LB + r"([Сс])толіттями" + RB, lambda m: _case(m.group(1), "повіками"), t)
        t = re.sub(LB + r"([Сс])толіттям" + RB, lambda m: _case(m.group(1), "повікою"), t)
        t = re.sub(LB + r"([Сс])толіттю" + RB, lambda m: _case(m.group(1), "повіці"), t)
        t = re.sub(LB + r"([Сс])толіть" + RB, lambda m: _case(m.group(1), "повік"), t)
        # «століття» ← века/век/веки/веко: k-та форма у російському реченні
        ru_forms = [m.group(1).lower() for m in re.finditer(r"\b(века|век|веки|веко)\b", ctx, re.I)]
        k = [0]
        def sub_sto(m):
            if k[0] < len(ru_forms):
                f = EYE_SG_GEN[ru_forms[k[0]]]
            else:
                f = "повік" if re.search(r"(набряк|тяжкість|трихіаз|заворот|спазм\w*|набряклість|кра[йя]\w*|склеюванн\w*|посмикуванн\w*|запаленн\w*|почервонінн\w*)\s*$", m.string[: m.start()], re.I) else "повіки"
            k[0] += 1
            return _case(m.group(1), f)
        t = re.sub(LB + r"([Сс])толіття" + RB, sub_sto, t)
        # «вік» як age визначаємо за російським реченням (там повіка й возраст — різні слова)
        if not re.search(r"возраст|\bлет\b|\bгод[аы]?\b|пожил|старч|старик|детск|молод|юнош|старост|подростк", ctx, re.I):
            t = re.sub(LB + r"([Вв])іком" + RB, lambda m: _case(m.group(1), "повікою"), t)
            t = re.sub(LB + r"([Вв])іками" + RB, lambda m: _case(m.group(1), "повіками"), t)
            t = re.sub(LB + r"([Вв])іках" + RB, lambda m: _case(m.group(1), "повіках"), t)
            t = re.sub(LB + r"([Вв])іці" + RB, lambda m: _case(m.group(1), "повіці"), t)
            t = re.sub(LB + r"([Вв])іку" + RB, lambda m: _case(m.group(1), "повіки"), t)
            t = re.sub(LB + r"([Вв])іки" + RB, lambda m: _case(m.group(1), "повіки"), t)
            t = re.sub(LB + r"([Вв])ік" + RB, lambda m: _case(m.group(1), "повіка"), t)
        for noun in ("повіці", "повіки", "повікою", "повіка"):
            if noun in t:
                t = _fem_adjs(t, noun)
        if "повіц" in t or "повік" in t:
            # відірвані прикметники: «на нижньому (лівому), а потім на верхній повіці», «особливо у правому.»
            t = re.sub(r"\b" + ADJ_STEMS + r"(ьому|ому)\b(?=\s*(?:[,.;:)]|\(|$))", lambda m: m.group(1) + "ій", t)
            t = re.sub(r"\b" + ADJ_STEMS + r"(ього|ого)\b(?=\s*(?:[,.;:)]|$))", lambda m: m.group(1) + ("ьої" if m.group(2) == "ього" else "ої"), t)
        out.append(t)
    return " ".join(out)


TECH_FEM2MASC = {"а": "ий", "я": "ій", "у": "ий", "ю": "ій", "ої": "ого", "ьої": "ього", "ій": "ому", "ою": "им", "ьою": "ім"}


def fix_terms(ru: str, ua: str) -> str:
    s = ua
    # лізик (стенд-ін) → язик
    s = re.sub(LB + r"([Лл])[иі]зи(к|ц)", lambda m: ("Я" if m.group(1) == "Л" else "я") + "зи" + m.group(2), s)
    s = re.sub(r"(?<=[Нн]а )[Лл][иі]зи" + RB + "|(?<=[УуВв] )[Лл][иі]зи" + RB, "язиці", s)
    # «Лизи чисті, червоні» / «Лізино набряклий» (варіанти Google для стенд-іна) → «Язик чистий, червоний»
    def lizy(m):
        words = m.group(2).split(" ")
        out = []
        stop = False
        for w in words:
            lw = w.rstrip(",;")
            tail = w[len(lw):]
            if not stop and re.match(r"[а-яіїєґ’']+[аяі]$", lw) and lw not in ("і", "та", "й", "дуже", "трохи", "інколи", "іноді", "зазвичай", "спочатку", "потім", "місцями", "особливо"):
                lw = lw[:-1] + ("ій" if lw.endswith("я") else "ий")
            elif lw in ("і", "та", "й") or not re.match(r"[а-яіїєґ’']+[аяі]$", lw):
                stop = True
            out.append(lw + tail)
        return m.group(1) + "Язик " + " ".join(out)
    s = re.sub(r"(^|[.;!?]\s+|\*\*|_)[Лл][иі]зи(?:но)? ((?:[а-яіїєґ’']+[,;]?\s?){1,4})", lizy, s)
    s = re.sub(LB + r"([Лл])[иі]зи(?:но|)" + RB, lambda m: ("Я" if m.group(1) == "Л" else "я") + "зик", s)
    # «Язика волога, обкладена» (Google дав родовий + жіночий рід) → «Язик вологий, обкладений»
    def sent_init(m):
        words = m.group(2).split(" ")
        out = []
        for w in words:
            lw = w.rstrip(",;")
            tail = w[len(lw):]
            if re.match(r"[а-яіїєґ’']+[ая]$", lw) and lw not in ("дуже", "трохи", "інколи", "іноді", "зазвичай", "спочатку", "потім", "місцями"):
                lw = lw[:-1] + ("ий" if lw.endswith("а") else "ій")
            out.append(lw + tail)
        return m.group(1) + "Язик " + " ".join(out)
    s = re.sub(r"(^|[.;!?]\s+|\*\*|_)Язика ((?:[а-яіїєґ’']+[,;]?\s?){1,4})", sent_init, s)
    # рожа → бешиха
    if re.search(LB + r"рож[аиеуоы]" + RB + "|" + LB + "рожей" + RB, ru, re.I) and re.search(LB + r"пи[кц]", s, re.I) and not re.search(r"мерещ|видит|снятся|чудится|страшные рожи|корчит", ru, re.I):
        forms = {"пика": "бешиха", "пики": "бешихи", "пиці": "бешисі", "пику": "бешиху", "пикою": "бешихою", "пик": "беших"}
        s = re.sub(LB + r"([Пп]ика|[Пп]ики|[Пп]иці|[Пп]ику|[Пп]икою|[Пп]ик)" + RB, lambda m: _case(m.group(1), forms[m.group(1).lower()]), s)
    # виски → скроні (крім віскі-напою)
    if re.search(r"\bвиск(и|ах|ов|е|ом|ами)\b", ru, re.I) and not re.search(r"желани|пить|напит|алкогол|бренди|водк|\bпив[ао]\b|\bвин[оа]\b|коньяк|ликер|спиртн", ru, re.I):
        s = re.sub(LB + r"([Вв])іскі" + RB, lambda m: _case(m.group(1), "скроні"), s)
    # течія → перебіг (з узгодженням прикметника перед і після)
    if re.search(r"\bтечени[еяюи]\b|\bтечением\b", ru, re.I) and re.search(r"\bтечі", s, re.I):
        def conv_adj(w, case_end):
            low = w.lower()
            for src, dst in TECH_FEM2MASC.items():
                if low.endswith(src) and (case_end is None or src in case_end):
                    return w[: len(w) - len(src)] + dst
            return w
        forms = {"течія": "перебіг", "течії": "перебігу", "течію": "перебіг", "течією": "перебігом"}
        ends = {"течія": ("а", "я"), "течії": ("ої", "ьої", "ій"), "течію": ("у", "ю"), "течією": ("ою", "ьою")}
        STOP = {"хоча", "сама", "сам", "ця", "та", "вся", "яка", "як", "і", "й", "а", "не", "же", "вже", "лише", "має", "була", "буде", "для", "від", "при", "після"}
        def rep(m):
            adjs = (m.group(1) or "").split()
            form = m.group(2).lower()
            out = []
            for a in adjs:
                if a.lower() == "сама":
                    out.append(_case(a, "сам"))
                elif a.lower() in STOP:
                    out.append(a)
                else:
                    out.append(conv_adj(a, ends[form]))
            return " ".join(out) + (" " if adjs else "") + _case(m.group(2), forms[form])
        s = re.sub(r"((?:[а-яіїєґ’']+\s+){0,2})([Тт]ечія|[Тт]ечії|[Тт]ечію|[Тт]ечією)" + RB, rep, s)
        # присудок після «перебіг»: «перебіг не бурхлива, а швидше млява» → «не бурхливий, а швидше млявий»
        FILL = r"(?:(?:не|дуже|швидше|досить|більш|менш|а|й|і)\s+){0,2}"
        def pred(m):
            return m.group(1) + re.sub(r"\b([а-яіїєґ’']+)([ая])\b", lambda w: w.group(0) if w.group(0) in ("а", "не", "дуже", "швидше", "досить") else w.group(1) + ("ий" if w.group(2) == "а" else "ій"), m.group(2))
        s = re.sub(r"(\bперебіг(?:\s+[а-яіїєґ’']+[иіу])?)((?:\s*,?\s*" + FILL + r"[а-яіїєґ’']+[ая]\b)+)", pred, s)
    s = fix_eyelids(ru, s)
    return fix_terms2(ru, s)


def _sub(s, pat, rep, flags=re.I):
    return re.sub(pat, rep, s, flags=flags)


def fix_terms2(ru: str, s: str) -> str:
    """Правила за підсумками вибіркової перевірки перекладу (див. README)."""
    has = lambda pat: re.search(pat, ru, re.I) is not None
    # возбуждение → порушення (якщо в оригіналі нема «нарушение»)
    if has(r"возбужден") and not has(r"нарушен") and re.search(r"порушен", s, re.I):
        s = _sub(s, r"(?<![а-яіїєґ])([Пп])орушен(ня|ий|а|е|і|о|ням|ні|нь|ого|ому|им|ої|ій|ою|их|ими)(?![а-яіїєґ])", lambda m: _case(m.group(1), "з") + "буджен" + m.group(2))
    # рожистое воспаление → бешихове запалення
    if has(r"рожист"):
        s = _sub(s, r"(?<![а-яіїєґ])([Рр])ож(?:ев|ист)(е|ий|а|ого|ому|им|ім|ої|ій|ою|і|их|ими)(?=\s+запален)", lambda m: _case(m.group(1), "б") + "ешихов" + m.group(2))
    # на фоне → на тлі
    if has(r"на фоне"):
        s = _sub(s, r"(?:\bі\s+)?натомість", "на тлі")
    # поясничная область → поперекова ділянка (Google: «ділянка нирок»)
    if has(r"поясничн") and not has(r"почек|почечн|почк"):
        s = _sub(s, r"ділянц[іи] нирок", "поперековій ділянці"); s = _sub(s, r"ділянка нирок", "поперекова ділянка"); s = _sub(s, r"ділянку нирок", "поперекову ділянку"); s = _sub(s, r"ділянки нирок", "поперекової ділянки")
    # истечение → витікання
    if has(r"истечени"):
        s = _sub(s, r"(?<![а-яіїєґ])([Зз])акінченн(я|ям|і|ю)(?![а-яіїєґ])", lambda m: _case(m.group(1), "в") + "итіканн" + m.group(2))
    # мерещится → ввижається
    if has(r"мерещ"):
        forms = {"мерехтить": "ввижається", "мерехтять": "ввижаються", "мерехтіло": "ввижалося", "мерехтіли": "ввижалися", "мерехтів": "ввижався", "мерехтіла": "ввижалася"}
        s = _sub(s, r"(?<![а-яіїєґ])([Мм])ерехт(ить|ять|іло|іли|ів|іла)(?![а-яіїєґ])", lambda m: _case(m.group(1), forms["мерехт" + m.group(2).lower()]))
    # саднящий → що саднить (не «садить»)
    if has(r"садн"):
        s = _sub(s, r"(?<![а-яіїєґ])садить(?![а-яіїєґ])", "саднить")
    # область → ділянка (не «галузь»)
    if has(r"област") and not has(r"област\w*\s+(медицин|знан|наук)"):
        s = _sub(s, r"(?<=[ууВвнНаАпПоОиИйЙ]\s)галузі(?![а-яіїєґ])", "ділянці")
        s = _sub(s, r"(?<![а-яіїєґ])галуз(і|ь|зю|ей|ям|ями|ях)(?![а-яіїєґ])", lambda m: {"і": "ділянки", "ь": "ділянка", "зю": "ділянкою", "ей": "ділянок", "ям": "ділянкам", "ями": "ділянками", "ях": "ділянках"}[m.group(1)])
    # икры → литки (не «лики»)
    if has(r"(?<![а-яё])икр"):
        s = _sub(s, r"(?<![а-яіїєґ])([Лл])ик(ах|и|ів|ам|ами)(?![а-яіїєґ])", lambda m: _case(m.group(1), "л") + {"ах": "итках", "и": "итки", "ів": "иток", "ам": "иткам", "ами": "итками"}[m.group(2).lower()])
    # тянущая боль → тягнучий біль
    s = _sub(s, r"(?<![а-яіїєґ])([Тт])ягне біль", lambda m: m.group(1) + "ягнучий біль")
    # скрофулезный → скрофульозний
    s = _sub(s, r"(?<![а-яіїєґ])([Сс])крофулезн", lambda m: m.group(1) + "крофульозн")
    # глотка → глотка (не «горлянка»)
    if has(r"глотк"):
        s = _sub(s, r"(?<![а-яіїєґ])([Гг])орлянк(а|и|у|ою|ці|ах|ам|ами)(?![а-яіїєґ])", lambda m: m.group(1) + "лотк" + {"а": "а", "и": "и", "у": "у", "ою": "ою", "ці": "ці", "ах": "ах", "ам": "ам", "ами": "ами"}[m.group(2).lower()])
    # живот → живіт (не «тварина»)
    if has(r"(?<![а-яё])живот") and not has(r"животн"):
        def belly(m):
            words = m.group(2).split(" ")
            out = []
            for w in words:
                lw = w.rstrip(",;"); tail = w[len(lw):]
                if re.match(r"[а-яіїєґ’']+[ая]$", lw) and lw not in ("і", "та", "й", "дуже", "трохи", "інколи", "іноді", "зазвичай", "спочатку", "потім", "особливо"):
                    lw = lw[:-1] + ("ій" if lw.endswith("я") else "ий")
                out.append(lw + tail)
            return m.group(1) + "Живіт " + " ".join(out)
        s = _sub(s, r"(^|[.;!?]\s+|\*\*|_)Тварина ((?:[а-яіїєґ’']+[,;]?\s?){1,4})", belly, flags=0)
        s = _sub(s, r"(?<![а-яіїєґ])([Тт])варин(а|и|у|ою|і)?(?![а-яіїєґ])", lambda m: _case(m.group(1), {"а": "живіт", "и": "живота", "у": "живіт", "ою": "животом", "і": "животі", None: "живіт"}[m.group(2).lower() if m.group(2) else None]))
    # в глазах → в очах (не «у власних очах»)
    if has(r"в глазах") and not has(r"собственн"):
        s = _sub(s, r"у власних очах", "в очах")
    # в голову (фізичне) → у голову (не «на думку»)
    if has(r"в голов[уе]") and has(r"боль|распростран|давл|ощущ|ударя|прилив|кров|отда|стрел|вдавл|винч|бьет|бросает|поднима|тяжест") and not has(r"приходит в голову|пришл[ао] в голову|мысл"):
        s = _sub(s, r"на думку", "у голову")
    # тропность → тропність
    if has(r"тропност"):
        s = _sub(s, r"(?<![а-яіїєґ])([Сс])т[еі]жніст|(?<![а-яіїєґ])([Сс])тепніст", lambda m: (m.group(1) or m.group(2)) + "тропніст"[1:] if False else _case(m.group(1) or m.group(2), "тропніст"))
    # раздражительность → дратівливість (не «подразливість»)
    if has(r"раздражит"):
        s = _sub(s, r"(?<![а-яіїєґ])([Пп])одразлив", lambda m: _case(m.group(1), "д") + "ратівлив")
    # обильный → рясний (не «рядний»)
    if has(r"обильн"):
        s = _sub(s, r"(?<![а-яіїєґ])([Рр])ядн(ий|а|е|і|ого|ому|им|ої|ій|ою|их|ими)(?![а-яіїєґ])", lambda m: m.group(1) + "ясн" + m.group(2))
    # веснушки → ластовиння
    s = _sub(s, r"(?<![а-яіїєґ])([Лл])астовинні(?![а-яіїєґ])", lambda m: m.group(1) + "астовиння")
    # російська форма «виносит» (без м’якого знака)
    s = _sub(s, r"(?<![а-яіїєґ])([Чч]и не |[Нн]е )виносит(?![а-яіїєґ])", lambda m: ("Не " if m.group(1)[0].isupper() else "не ") + "переносить")
    # скотома → скотома (не «худоба»); гонит → гоніт (не «жене»)
    if has(r"скотом"):
        s = _sub(s, r"(?<![а-яіїєґ])([Хх])удоб(а|и|у|ою|і)(?![а-яіїєґ])", lambda m: _case(m.group(1), "скотом") + {"а": "а", "и": "и", "у": "у", "ою": "ою", "і": "і"}[m.group(2).lower()])
    if has(r"(?<![а-яё])гонит(?![а-яё])") and has(r"туберкулезн|гонорейн|ревматическ|сифилитическ|хроническ|остр"):
        s = _sub(s, r"(?<![а-яіїєґ])([Жж])ене(?![а-яіїєґ])", lambda m: _case(m.group(1), "гоніт"))
    # -ит терміни, які Google обернув на дієслова
    for ru_w, bad, good in (("простатит", "Простатить", "Простатит"), ("оварит", "Оварить", "Оварит"), ("спленит", "Спленить", "Спленіт"), ("перхоть", "Лупать", "Лупа"),
                            ("остриц", "Востриці", "Гострики"), ("озноблен", "Оздоблення", "Обмороження"), ("оспоподобн", "Споподібний", "Віспоподібний"),
                            ("опоясывающ", "Поперечний лишай", "Оперізувальний лишай"), ("гнусав", "Негідність", "Гугнявість"), ("умопомешат", "Розсудливість", "Божевілля")):
        if has(ru_w):
            s = _sub(s, r"(?<![а-яіїєґ])" + bad + r"(?![а-яіїєґ])", good, flags=0)
            s = _sub(s, r"(?<![а-яіїєґ])" + bad[0].lower() + bad[1:] + r"(?![а-яіїєґ])", good[0].lower() + good[1:], flags=0)
    # зев → зів (не «позіхання»)
    if has(r"(?<![а-яё])зев(а|е|ом|у)?(?![а-яё])"):
        s = _sub(s, r"(?<![а-яіїєґ])([Пп])озіханн(я|і|ям|ю)(?![а-яіїєґ])", lambda m: _case(m.group(1), {"я": "зів", "і": "зіві", "ям": "зівом", "ю": "зіву"}[m.group(2).lower()]))
        if has(r"(?<![а-яё])зева(?![а-яё])"):
            s = _sub(s, r"(?<![а-яіїєґ])зів(?![а-яіїєґ])", "зіва")
    # «3 раза в день» → «3 рази на день» (Google: «3 десь у день»)
    s = _sub(s, r"(\d+)\s*десь (?:у|в|на) день", lambda m: m.group(1) + " рази на день")
    # російські дієслівні форми без м’якого знака: кричит → кричить
    s = _sub(s, r"(?<![а-яіїєґ])([Кк])ричит(?![а-яіїєґ])", lambda m: m.group(1) + "ричить")
    # терміни на -ит, які Google обернув на дієслова на -ить (синусит → синусить): якщо в оригіналі є те саме слово на -ит
    RU_VERBS_IT = {"кричит", "говорит", "болит", "сидит", "стоит", "лежит", "спит", "ходит", "горит", "ловит", "любит", "велит", "валит", "манит", "бежит", "дрожит", "звенит", "зудит", "саднит", "сверлит", "давит", "тошнит", "знобит", "мутит", "лихорадит", "морозит", "ломит", "пучит", "колит", "бродит", "будит", "водит", "возит", "носит", "просит", "светит", "шумит", "стучит", "трещит", "свистит", "хрипит", "сопит", "храпит", "кипит", "летит", "гудит", "бурлит", "ворчит", "урчит", "пищит", "визжит", "вопит", "молчит", "смотрит", "глядит", "держит", "терпит", "грозит", "значит", "звучит", "мучит", "ранит", "солит", "сушит", "томит", "чинит", "гонит", "жалит", "бесит", "злит", "дымит", "щемит", "язвит", "чтит", "шутит", "тупит", "торопит", "щекочет", "селит", "селится", "цедит", "точит", "варит", "парит", "пахнет", "смердит", "зловонит", "ноет", "стоит", "летит", "хранит", "ценит", "щадит", "белит", "делит", "пилит", "сорит", "тратит", "платит", "рубит", "губит", "трубит", "трудит", "мирит", "дарит", "творит", "курит", "бурит", "чертит", "крутит", "мутит", "шевелит", "тяготит", "коптит", "рябит", "тошнит"}
    ru_its = {w for w in re.findall(r"(?<![а-яё])([а-яё]{2,}ит)(?![а-яё])", ru.lower()) if w not in RU_VERBS_IT}
    if ru_its:
        s = _sub(s, r"(?<![а-яіїєґ])([а-яіїєґ]{2,})ить(?![а-яіїєґ])", lambda m: m.group(1) + "ит" if (m.group(1).lower().replace("і", "и") + "ит") in ru_its else m.group(0))
    if has(r"опеченен"):
        s = _sub(s, r"(внаслідок |після |через |до |від )[Оо]пікування", lambda m: m.group(1) + "гепатизації")
        s = _sub(s, r"(?<![а-яіїєґ])([Оо])пікування(?![а-яіїєґ])", lambda m: _case(m.group(1), "гепатизація"))
    return s


def need_translation(seg: str) -> bool:
    return bool(CYR.search(seg))


RU_ONLY = re.compile(r"[ыэъЫЭЪ]")
# Слова, які Google лишає російськими у коротких сегментах (нозології з розділу «Клиника»)
LEFTOVER_DICT = {
    "выпадение": "випадіння", "отрыжка": "відрижка", "грыжа": "грижа", "афты": "афти", "глисты": "глисти", "изъязвление": "виразкування",
    "выкидыш": "викидень", "аденоиды": "аденоїди", "гельминты": "гельмінти", "гельминтозы": "гельмінтози", "анальный": "анальний", "анальные": "анальні",
    "эпилепсия": "епілепсія", "пузырь": "міхур", "волдыри": "пухирі", "волосы": "волосся", "вывих": "вивих", "высыпание": "висипання", "высыпания": "висипання",
    "газы": "гази", "гастроэнтерит": "гастроентерит", "генитальный": "генітальний", "желчные": "жовчні", "желчный": "жовчний", "зловонный": "смердючий",
    "зрительные": "зорові", "зрительный": "зоровий", "истероэпилепсия": "істероепілепсія", "кальцификаты": "кальцифікати", "клык": "ікло",
    "комковатым": "грудкуватим", "комковатыми": "грудкуватими", "кондиломы": "кондиломи", "конъюнктивит": "кон'юнктивіт", "ленточные": "стрічкові",
    "ложные": "несправжні", "миндалины": "мигдалини", "молочный": "молочний", "мочевые": "сечові", "несвертывающейся": "що не згортається",
    "новорожденный": "новонароджений", "носовые": "носові", "белый": "білий", "бородавчатый": "бородавчастий", "аскариды": "аскариди",
    "дизентерийный": "дизентерійний", "антипсоричных": "антипсоричних", "Носоглоточный": "Носоглотковий", "Приступообразные": "Нападоподібні",
    "Родимые": "Родимі", "Скрофулезные": "Скрофульозні", "Гостры": "Гострі", "родимые": "родимі", "тугоподвижны": "тугорухливі",
    "псоричных": "псоричних", "языке": "язиці", "плюсневых": "плеснових", "позывах": "позивах", "нехарактерны": "нехарактерні",
}


def retry_leftovers():
    """Сегменти, у яких переклад лишив російські літери ы/э/ъ: повторний переклад поодинці, потім словничок."""
    todo = [k for k, v in cache.items() if need_translation(k) and RU_ONLY.search(v)]
    if not todo:
        return
    print(f"leftovers with russian letters: {len(todo)}", flush=True)
    fixed = 0
    for k in todo:
        v = cache[k]
        if len(k) <= 120:
            try:
                v2 = postfix(k, google(k).strip())
                if v2 and not RU_ONLY.search(v2):
                    cache[k] = v2
                    fixed += 1
                    continue
                v = v2 or v
            except Exception:  # noqa: BLE001
                pass
        words = re.findall(r"[А-Яа-яЁёІіЇїЄєҐґ']+", v)
        for w in words:
            if RU_ONLY.search(w):
                rep = LEFTOVER_DICT.get(w) or LEFTOVER_DICT.get(w.lower())
                if rep:
                    if w[0].isupper() and rep[0].islower():
                        rep = rep[0].upper() + rep[1:]
                    v = re.sub(r"\b" + re.escape(w) + r"\b", rep, v)
        cache[k] = v
    save_cache()
    left = sum(1 for k, v in cache.items() if need_translation(k) and RU_ONLY.search(v))
    print(f"leftovers fixed online: {fixed}; still with russian letters: {left}", flush=True)


_translator = None


def get_translator():
    global _translator
    if _translator is None:
        from translatepy.translators.google import GoogleTranslate
        _translator = GoogleTranslate()
    return _translator


def google(text: str) -> str:
    last = None
    for attempt in range(5):
        try:
            r = get_translator().translate(text, "Ukrainian", "Russian")
            out = str(r.result)
            if out.strip():
                return out
            last = RuntimeError("empty result")
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"translation failed: {last}")


def translate_batch(segs):
    """Перекладає список сегментів одним запитом; якщо межі абзаців зламались — по одному."""
    joined = "\n\n".join(segs)
    out = google(joined)
    parts = [p.strip() for p in re.split(r"\n\s*\n", out)]
    if len(parts) != len(segs):
        parts = [google(s).strip() for s in segs]
    return parts


def translate_all(segments, workers=4, batch_chars=2800):
    """Перекладає унікальні сегменти, яких немає в кеші."""
    todo = [s for s in dict.fromkeys(protect_ru(x) for x in segments) if s not in cache and need_translation(s)]
    for s in dict.fromkeys(segments):
        if not need_translation(s):
            cache.setdefault(s, s)
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
    total_chars = sum(len(s) for s in todo)
    print(f"to translate: {len(todo)} segments, {total_chars} chars, {len(batches)} batches", flush=True)
    done = [0]
    fails = [0]
    t0 = time.time()

    def work(batch):
        global dirty
        try:
            parts = translate_batch(batch)
        except Exception as e:  # noqa: BLE001
            fails[0] += 1
            print("  batch failed:", e, flush=True)
            return
        with lock:
            for ru, ua in zip(batch, parts):
                cache[ru] = postfix(ru, ua)
            dirty += len(batch)
            done[0] += 1
        if done[0] % 25 == 0:
            el = time.time() - t0
            print(f"  {done[0]}/{len(batches)} batches, {el:.0f}s, eta {el / done[0] * (len(batches) - done[0]):.0f}s", flush=True)
            save_cache()

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, batches))
    save_cache()
    if fails[0]:
        print(f"WARNING: {fails[0]} batches failed; run again to retry", flush=True)


# --------------------------------------------------------------------------- розбір md
def parse_md(text):
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    fm = []
    for line in m.group(1).split("\n"):
        k, _, v = line.partition(":")
        fm.append((k.strip(), v.strip()))
    body = m.group(2)
    return fm, body


HEADER3_RE = re.compile(r"^### (.+)$")
HEADER2_RE = re.compile(r"^## (.+)$")


def header3_parts(title):
    """Розбиває «Aconitum (Аконитум) — борец» на латинські та кириличні шматки; повертає список (text, translate?)."""
    parts = []
    pos = 0
    for m in re.finditer(r"[А-Яа-яЁёЇїІіЄєҐґ][^()—–]*[А-Яа-яЁёЇїІіЄєҐґ]|[А-Яа-яЁёЇїІіЄєҐґ]", title):
        if m.start() > pos:
            parts.append((title[pos:m.start()], False))
        parts.append((m.group(0), True))
        pos = m.end()
    if pos < len(title):
        parts.append((title[pos:], False))
    return parts


def collect_segments(fm, body, kind):
    segs = []
    for k, v in fm:
        if k in ("title", "common", "transliteration", "source", "author") and v and (kind == "article" or k != "title"):
            if k == "transliteration":
                for part in v.split(" = "):
                    segs.append(part.strip())
            else:
                segs.append(v)
    in_clinic = False
    for line in body.split("\n"):
        if not line.strip():
            continue
        h2 = HEADER2_RE.match(line)
        if h2:
            t = h2.group(1).strip()
            in_clinic = t == "Клиника"
            if t not in SECTION_UA:
                segs.append(t)
            continue
        h3 = HEADER3_RE.match(line)
        if h3:
            for text, tr in header3_parts(h3.group(1).strip()):
                if tr:
                    segs.append(text.strip())
            continue
        if in_clinic:
            for term in split_terms(line):
                segs.append(term)
            continue
        segs.append(line[2:] if line.startswith("- ") else line)
    return segs


def split_terms(line):
    terms = []
    for t in re.split(r"[.;]\s+|\.$", line.replace("**", "").replace("_", "")):
        t = re.sub(r"^[\s•\-–—]+|[\s.]+$", "", t).strip()
        if t:
            terms.append(t)
    return terms


# Точні відповідники для окремих сегментів (переважно терміни «Клініки»), де Google дає безглуздя
SEG_FIX = {
    "Дурнота": "Дурнота", "Возбуждение": "Збудження", "Возбужденное состояние половых органов": "Збуджений стан статевих органів",
    "Гнусавость": "Гугнявість", "Умопомешательство": "Божевілля", "Перхоть": "Лупа", "Острицы": "Гострики", "Ознобления": "Обмороження",
    "Опеченение легких": "Гепатизація легень", "Опоясывающий лишай": "Оперізувальний лишай", "Оспоподобная сыпь": "Віспоподібний висип",
    "Оварит": "Оварит", "Простатит": "Простатит", "Спленит": "Спленіт", "Гноетечение из десен": "Гноєтеча з ясен", "Десневой свищ": "Ясенна нориця",
    "Заглоточный абсцесс": "Заглотковий абсцес", "Стеснение в груди": "Стиснення в грудях", "Центральная скотома": "Центральна скотома",
    "Туберкулезный гонит": "Туберкульозний гоніт", "Имбецильность": "Імбецильність", "Киста широкой связки матки": "Кіста широкої зв’язки матки",
    "Герпес на срамных губах": "Герпес на соромітних губах", "Паралич глотки": "Параліч глотки", "Кокцикодиния": "Кокцигодинія",
    "Остеосаркома": "Остеосаркома", "Стеатома": "Стеатома", "Цинга": "Цинга", "Легочные кровотечения": "Легеневі кровотечі",
    "Скрофулезное воспаление глаз": "Скрофульозне запалення очей", "Скрофулезное воспаление носа": "Скрофульозне запалення носа",
    "Дерматоз с отрубевидным шелушением": "Дерматоз із висівкоподібним лущенням", "Тропность к гортани": "Тропність до гортані",
}


# Виправлення заперечень, які Google губить (див. tools/check_negation.mjs і README).
# Кожен запис: {ru: <RU-речення>, bad: <UA-речення як його дав перекладач>, good: <правильне UA>}.
# Правило спрацьовує, коли RU-речення є в сегменті, а зіпсоване UA-речення — у результаті.
NEG_FIXES_FILE = os.path.join(ROOT, "tools", "negation-fixes.json")
NEG_FIXES = json.load(open(NEG_FIXES_FILE, encoding="utf-8")) if os.path.exists(NEG_FIXES_FILE) else []


def _loose(s: str):
    """Той самий текст, але стійкий до розділових знаків і пробілів між словами."""
    return re.compile(r"[\s\W_]*".join(re.escape(w) for w in re.findall(r"[^\W_]+", s)))


def _word_span(s: str):
    w = list(re.finditer(r"[^\W_]+", s))
    return (w[0].start(), w[-1].end()) if w else (0, len(s))


def apply_negation_fixes(seg: str, out: str) -> str:
    for fx in NEG_FIXES:
        if fx["ru"] not in seg:
            continue
        if fx["good"] in out:
            continue                                   # вже правильно (те саме речення в іншому місці)
        if fx["bad"] in out:
            out = out.replace(fx["bad"], fx["good"])
            continue
        m = _loose(fx["bad"]).search(out)               # інші пост-правила могли трохи змінити текст
        if m:
            a, b = _word_span(fx["good"])
            out = out[:m.start()] + fx["good"][a:b] + out[m.end():]
            continue
        print(f"negation fix not applied: {fx['ru'][:70]}", file=sys.stderr)
    return out


def tr(seg):
    if seg in SEG_FIX:
        return SEG_FIX[seg]
    # жирні списки латинських назв (переліки препаратів у статтях) Google обрізає — лишаємо як є
    if re.match(r"^\*\*[^*]{20,}\*\*$", seg.strip()):
        lat = len(re.findall(r"[A-Za-z]", seg)); cyr = len(re.findall(r"[а-яёА-ЯЁ]", seg))
        if lat >= 4 * max(cyr, 1):
            return re.sub(r"\s+и\s+", " і ", seg)
    key = protect_ru(seg)
    if key not in cache:
        return seg
    out = fix_terms(key, cache[key])
    if seg[:1].isupper() and out[:1].islower():
        out = out[0].upper() + out[1:]
    return apply_negation_fixes(seg, out)


def render_ua(fm, body, kind):
    out_fm = []
    latin = alt = ""
    for k, v in fm:
        if k == "latin":
            latin = v
        if k == "alt_latin":
            alt = v
    for k, v in fm:
        if k == "sections":
            v = "; ".join(SECTION_UA.get(x.strip(), x.strip()) for x in v.split(";"))
        elif k == "transliteration":
            v = " = ".join(tr(p.strip()) for p in v.split(" = "))
        elif k in ("common", "source", "author"):
            v = tr(v)
        elif k == "title":
            if kind == "article":
                v = tr(v)
            else:
                translit = " = ".join(tr(p.strip()) for p in dict(fm).get("transliteration", "").split(" = ")) if dict(fm).get("transliteration") else ""
                common = tr(dict(fm).get("common", "")) if dict(fm).get("common") else ""
                v = latin + (f" ({alt})" if alt else "") + (f" ({translit})" if translit else "") + (f" — {common}" if common else "")
        elif k in ("lang", "keywords"):
            continue
        out_fm.append((k, v))
    out_fm.insert(1, ("lang", "ua"))
    lines = []
    in_clinic = False
    for line in body.split("\n"):
        if not line.strip():
            lines.append("")
            continue
        h2 = HEADER2_RE.match(line)
        if h2:
            t = h2.group(1).strip()
            in_clinic = t == "Клиника"
            lines.append("## " + SECTION_UA.get(t, tr(t)))
            continue
        h3 = HEADER3_RE.match(line)
        if h3:
            lines.append("### " + "".join(tr(text.strip()) if t else text for text, t in header3_parts(h3.group(1).strip())))
            continue
        if in_clinic:
            terms = [tr(t) for t in split_terms(line)]
            lines.append(". ".join(t.rstrip(".") for t in terms) + ("." if terms else ""))
            continue
        if line.startswith("- "):
            lines.append("- " + tr(line[2:]))
        else:
            lines.append(tr(line))
    fm_text = "---\n" + "\n".join(f"{k}: {v}" for k, v in out_fm if v) + "\n---\n"
    return fm_text + "\n".join(lines).rstrip() + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    files = []
    for sub in ("remedies", "articles"):
        os.makedirs(os.path.join(DST, sub), exist_ok=True)
        for fn in sorted(os.listdir(os.path.join(SRC, sub))):
            if not fn.endswith(".md"):
                continue
            dst = os.path.join(DST, sub, fn)
            if os.path.exists(dst) and not args.force:
                continue
            files.append((sub, fn))
    print(f"files to translate: {len(files)}", flush=True)
    parsed = {}
    all_segs = []
    for sub, fn in files:
        text = open(os.path.join(SRC, sub, fn), encoding="utf-8").read()
        fm, body = parse_md(text)
        kind = "article" if sub == "articles" else "remedy"
        parsed[(sub, fn)] = (fm, body, kind)
        all_segs.extend(collect_segments(fm, body, kind))
    translate_all(all_segs, workers=args.workers)
    retry_leftovers()
    missing = 0
    for (sub, fn), (fm, body, kind) in parsed.items():
        segs = collect_segments(fm, body, kind)
        if any(need_translation(s) and protect_ru(s) not in cache for s in segs):
            missing += 1
            continue
        open(os.path.join(DST, sub, fn), "w", encoding="utf-8").write(render_ua(fm, body, kind))
    print(f"written: {len(parsed) - missing}, skipped (untranslated segments remain): {missing}", flush=True)


if __name__ == "__main__":
    main()
