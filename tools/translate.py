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
    todo = [s for s in dict.fromkeys(segments) if s not in cache and need_translation(s)]
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


def tr(seg):
    return cache.get(seg, seg)


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
        if any(need_translation(s) and s not in cache for s in segs):
            missing += 1
            continue
        open(os.path.join(DST, sub, fn), "w", encoding="utf-8").write(render_ua(fm, body, kind))
    print(f"written: {len(parsed) - missing}, skipped (untranslated segments remain): {missing}", flush=True)


if __name__ == "__main__":
    main()
