#!/bin/sh
# Escribe ?v=<huella del contenido> en los <link>/<script> de app/index.html.
#
# GitHub Pages deja cada archivo en caché del navegador ~10 minutos. Sin
# versión en la URL, justo después de publicar un usuario puede quedar con el
# HTML nuevo y el JS viejo (o al revés) y la app falla de formas raras. Con
# la huella en la URL, cambiar un archivo cambia su URL y el navegador lo
# vuelve a pedir en vez de usar la copia vieja.
#
# Se ejecuta solo en cada commit (hook pre-commit); también se puede correr a
# mano:  sh scripts/versionar.sh

cd "$(dirname "$0")/.." || exit 0
HTML=app/index.html
[ -f "$HTML" ] || exit 0

for rel in css/styles.css js/firebase-config.js js/app.js; do
  f="app/$rel"
  [ -f "$f" ] || continue
  h=$(shasum "$f" | cut -c1-8)
  sed -E "s#((href|src)=\"$rel)(\?v=[0-9a-f]+)?\"#\1?v=$h\"#" "$HTML" > "$HTML.tmp" && mv "$HTML.tmp" "$HTML"
done
