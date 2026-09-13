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
