#!/usr/bin/env bash
# run.sh — прогін усіх трьох наборів тестів на локальному сервері.
#
#   tools/uitest/run.sh [ПОРТ] [BASE]
#
# Піднімає `python3 -m http.server ПОРТ --bind 127.0.0.1` з кореня репозиторію (шляхи в сайті
# відносні, тож корінь працює як адреса сайту), чекає готовності, запускає unit.js, basic.js,
# features.js, друкує підсумок і зупиняє сервер. Код виходу ≠ 0, якщо хоч щось провалилось.
#
# Для живого сайту сервер не потрібен:
#   BASE=https://ix21027.github.io/homeo-repertory/ node tools/uitest/basic.js

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${1:-${PORT:-8765}}"
BASE="${2:-${BASE:-http://127.0.0.1:$PORT/}}"
LOGS="$(mktemp -d)"

cleanup() { pkill -f "http[.]server $PORT" >/dev/null 2>&1; }
trap cleanup EXIT INT TERM

if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  echo "Порт $PORT уже зайнято — зупиніть той процес або вкажіть інший порт." >&2
  exit 2
fi

cd "$ROOT" || exit 2
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &

for _ in $(seq 1 50); do
  curl -fs -o /dev/null "http://127.0.0.1:$PORT/index.html" && break
  sleep 0.2
done
if ! curl -fsS -o /dev/null "http://127.0.0.1:$PORT/index.html"; then
  echo "Сервер на порту $PORT не піднявся." >&2
  exit 2
fi
echo "Сайт: $BASE (корінь $ROOT)"

rc=0
for suite in unit basic features; do
  echo
  echo "=== $suite ==="
  BASE="$BASE" node "$ROOT/tools/uitest/$suite.js" 2>&1 | tee "$LOGS/$suite.log"
  [ "${PIPESTATUS[0]}" -eq 0 ] || rc=1
done

echo
echo "=== підсумок ==="
for suite in unit basic features; do
  ok=$(grep -c '^OK' "$LOGS/$suite.log" 2>/dev/null || true)
  bad=$(grep -c '^FAIL' "$LOGS/$suite.log" 2>/dev/null || true)
  printf '%-9s OK %-3s FAIL %s\n' "$suite" "${ok:-0}" "${bad:-0}"
done
rm -rf "$LOGS"
[ "$rc" -eq 0 ] && echo "усе пройшло" || echo "є провали"
exit "$rc"
