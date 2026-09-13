#!/usr/bin/env python3
"""
fix_homoglyphs.py — кириличні гомогліфи в латинських назвах препаратів → латиниця.

    python3 tools/fix_homoglyphs.py                      # content/ru і content/ua, з правкою
    python3 tools/fix_homoglyphs.py --dry-run            # лише порахувати, нічого не писати
    python3 tools/fix_homoglyphs.py content/ru/remedies  # довільні теки або файли

Навіщо. У вихідному архіві сайту латинські назви подекуди набрані впереміш із кирилицею:
«Вryonia» (кирилична В), «Hyoscуamus» (кирилична у), «Кali», «асidum». Око різниці не бачить,
а пошук і перехресні посилання на препарат — бачать: «Вryonia» і «Bryonia» для програми різні
рядки, тож назва випадає з індексу й не резолвиться у зв'язках.

Правило (навмисно вузьке, щоб не зачепити суто кириличні слова).
Токен — суцільний рядок літер. Замінюємо в ньому гомогліфи, лише якщо:
  1) більшість літер токена — латиниця (у «Симеонова» з латинською C більшість кирилична —
     не чіпаємо; таке слово треба лікувати у зворотний бік, і це окрема задача);
  2) у токені є хоч одна ОДНОЗНАЧНО латинська літера (b d f g j l q v w z — у них немає
     кириличних двійників) АБО поспіль ≥3 латинські літери. Без цієї умови під заміну
     потрапляло б будь-яке коротке кириличне слово з випадковою латинською літерою.

Карта — стандартні візуальні двійники (Unicode confusables). Кириличні «г», «и» сюди НЕ
входять: на латиницю вони не схожі (плутанина «Вгуonia», «Миrех» — з курсивного OCR, це
інший клас і окреме рішення).

Той самий виклик стоїть у tools/extract.py (write_md), щоб повторне вилучення з архіву давало
вже чистий текст і не доводилось ганяти цей скрипт після кожного extract.
"""
import argparse
import os
import re
import sys

# кирилиця → латиниця; лише візуальні двійники (див. заголовок)
HOMOGLYPHS = {
    "А": "A", "В": "B", "Е": "E", "І": "I", "К": "K", "М": "M", "Н": "H",
    "О": "O", "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X",
    "а": "a", "в": "b", "е": "e", "і": "i", "к": "k", "м": "m", "н": "h",
    "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
}
_TRANS = str.maketrans(HOMOGLYPHS)

TOKEN = re.compile(r"[A-Za-zЀ-ӿԀ-ԯ]+")
LAT_RUN3 = re.compile(r"[A-Za-z]{3}")
# літери без кириличних двійників: одна така в токені — достатній доказ, що слово латинське
UNAMBIGUOUS = set("bdfgjlqvwzBDFGJLQVWZ")


def _is_latin_token(tok):
    """Токен — зіпсоване латинське слово, яке можна нормалізувати?"""
    lat = sum(1 for c in tok if "A" <= c <= "Z" or "a" <= c <= "z")
    if lat * 2 <= len(tok):          # більшості латиниці немає — не наше слово
        return False
    return any(c in UNAMBIGUOUS for c in tok) or bool(LAT_RUN3.search(tok))


def fix_homoglyphs(text):
    """Текст → текст із нормалізованими латинськими назвами (ідемпотентно)."""
    def rep(m):
        tok = m.group(0)
        return tok.translate(_TRANS) if _is_latin_token(tok) else tok
    return TOKEN.sub(rep, text)


# ------------------------------------------------------------------ звіряння з каталогом назв
# Карта двійників сліпа: у ній немає «г» та «и», бо на латиницю вони не схожі (їх дає курсивний
# OCR: «Bгyonia», «Cиprum», «Миrех»), а розширити карту не можна — «Cиprum» стало б «Ciprum»
# замість «Cuprum». Тому другим кроком беремо НАЗВУ З КАТАЛОГУ: якщо нормалізований токен не є
# відомою назвою, шукаємо назву тієї самої довжини на відстані однієї заміни. Це й лагодить
# літери без двійників, і не дає зіпсувати кириличне слово: «міхураNash» (латиниці менше
# половини) жодній назві не відповідає — лишається як є, і його правлять поштучно.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CYR_RE = re.compile(r"[Ѐ-ӿԀ-ԯ]")
_names = None


def catalog_names(root=None):
    """{назва в нижньому регістрі: канонічний запис} з data/<lang>/catalog.json і boericke-map."""
    global _names
    if _names is not None:
        return _names
    _names = {}
    root = root or _ROOT
    import json
    srcs = [(os.path.join(root, "data", "ru", "catalog.json"), "catalog"),
            (os.path.join(root, "tools", "boericke-map.json"), "boericke")]
    for path, kind in srcs:
        try:
            data = json.load(open(path, encoding="utf-8"))
        except Exception:                      # data/ — продукт збірки, його може не бути
            continue
        keys = []
        if kind == "catalog":
            for r in data.get("remedies", []):
                keys += [r.get("latin") or "", r.get("alt") or ""]
        else:
            keys = [k for k in data if not k.startswith("_")]
        for key in keys:
            for w in re.split(r"[\s/,()]+", key):
                w = w.strip("-.")
                if len(w) >= 4 and re.fullmatch(r"[A-Za-z-]+", w):
                    _names.setdefault(w.lower(), w)
    return _names


def _catalog_hit(tok):
    """Назва з каталогу, що відрізняється від токена рівно однією літерою (якщо вона єдина)."""
    low = tok.lower()
    names = catalog_names()
    hit = None
    for name, canon in names.items():
        if len(name) != len(low) or sum(1 for a, b in zip(name, low) if a != b) != 1:
            continue
        if hit is not None and hit.lower() != canon.lower():
            return None                        # кандидатів кілька — не вгадуємо
        hit = canon
    return hit


def _repair(tok):
    """Зіпсована латинська назва → правильна; None, якщо це не вона (або не знаємо, як лагодити)."""
    lat = sum(1 for c in tok if "A" <= c <= "Z" or "a" <= c <= "z")
    if lat < 1 or not CYR_RE.search(tok):
        return None
    cat_only = lat < 2                         # одна латинська літера — то, найпевніше, кирилиця
    if cat_only and not (tok[0].isupper() and len(tok) >= 4):
        return None                            # «носa», «серa», «oт» — не назви, віддаємо як є
    norm = tok.translate(_TRANS)
    pure = not CYR_RE.search(norm)
    if pure and norm.lower() in catalog_names():
        return norm                            # двійники все пояснили, і це відома назва
    hit = _catalog_hit(norm)                   # лишились «г»/«и»/«ш» або назва не та: «Ciprum»
    if hit:
        return hit[0].upper() + hit[1:] if tok[0].isupper() else hit[0].lower() + hit[1:]
    if pure and not cat_only and _is_latin_token(tok):
        return norm                            # давнє правило: латиниці більшість — назва не з каталогу
    return None


def fix_latin_names(text):
    """Те саме, що fix_homoglyphs, плюс звіряння з каталогом назв (ідемпотентно).

    Окрема функція, а не розширення fix_homoglyphs: ту викликає tools/extract.py на content/ru,
    а будь-яка зміна content/ru розриває ключі term-fixes.json (див. README)."""
    if not re.search(r"[A-Za-z]", text):
        return text
    def rep(m):
        tok = m.group(0)
        return _repair(tok) or (tok.translate(_TRANS) if _is_latin_token(tok) else tok)
    return TOKEN.sub(rep, text)


def count_mixed(text):
    """→ (усього змішаних токенів, з них таких, що їх нормалізує fix_homoglyphs)."""
    mixed = fixable = 0
    for m in TOKEN.finditer(text):
        tok = m.group(0)
        if not (re.search(r"[A-Za-z]", tok) and re.search(r"[Ѐ-ԯ]", tok)):
            continue
        mixed += 1
        if _is_latin_token(tok) and tok.translate(_TRANS) != tok:
            fixable += 1
    return mixed, fixable


def md_files(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
            continue
        for dirpath, _, names in os.walk(p):
            for n in sorted(names):
                if n.endswith(".md"):
                    yield os.path.join(dirpath, n)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*", help="теки або .md-файли (типово content/ru і content/ua)")
    ap.add_argument("--dry-run", action="store_true", help="порахувати, нічого не писати")
    args = ap.parse_args()
    paths = args.paths or [os.path.join(root, "content", "ru"), os.path.join(root, "content", "ua")]

    total = {"files": 0, "changed": 0, "mixed_before": 0, "fixable": 0, "mixed_after": 0, "tokens": 0}
    left = {}
    for path in md_files(paths):
        src = open(path, encoding="utf-8").read()
        mixed, fixable = count_mixed(src)
        out = fix_homoglyphs(src)
        after, _ = count_mixed(out)
        total["files"] += 1
        total["mixed_before"] += mixed
        total["fixable"] += fixable
        total["mixed_after"] += after
        if out != src:
            total["changed"] += 1
            total["tokens"] += sum(1 for a, b in zip(TOKEN.finditer(src), TOKEN.finditer(out))
                                   if a.group(0) != b.group(0))
            if not args.dry_run:
                open(path, "w", encoding="utf-8").write(out)
        for m in TOKEN.finditer(out):
            tok = m.group(0)
            if re.search(r"[A-Za-z]", tok) and re.search(r"[Ѐ-ԯ]", tok):
                left[tok] = left.get(tok, 0) + 1

    print("файлів: %d, змінено: %d%s" % (total["files"], total["changed"], "  (--dry-run)" if args.dry_run else ""))
    print("змішаних токенів: було %d, лишилось %d (нормалізовано %d)"
          % (total["mixed_before"], total["mixed_after"], total["fixable"]))
    if left:
        print("поза картою (кирилиця, що не має латинського двійника, або кирилична більшість):")
        for tok, n in sorted(left.items(), key=lambda x: -x[1])[:20]:
            print("   %4d  %s" % (n, tok))
        if len(left) > 20:
            print("   … ще %d різних токенів" % (len(left) - 20))
    return 0


if __name__ == "__main__":
    sys.exit(main())
