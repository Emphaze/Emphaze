"""Combine authored vanilla code into a portable HTML file. No npm dependencies."""
from pathlib import Path
import base64
import re

ROOT = Path(__file__).resolve().parent.parent
FONT_RANGES = {
    'cyrillic': 'U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
    'latin': 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
}
fonts = []
for subset, unicode_range in FONT_RANGES.items():
    for weight in (400, 500, 600):
        file = ROOT / 'src/fonts' / f'golos-text-{subset}-{weight}-normal.woff2'
        encoded = base64.b64encode(file.read_bytes()).decode('ascii')
        fonts.append(f"@font-face{{font-family:'Golos Text';font-style:normal;font-display:swap;font-weight:{weight};src:url(data:font/woff2;base64,{encoded}) format('woff2');unicode-range:{unicode_range};}}")
css = '\n'.join(fonts) + '\n' + (ROOT / 'src/style.css').read_text()
parts = []
for name in ('icons.js', 'catalog.js', 'model.js', 'main.js'):
    code = (ROOT / 'src' / name).read_text()
    code = re.sub(r'^import[^\n]*\n', '', code, flags=re.MULTILINE)
    code = re.sub(r'^export ', '', code, flags=re.MULTILINE)
    parts.append(f'// --- {name} ---\n{code}')
js = "(() => {\n'use strict';\n" + '\n\n'.join(parts) + '\n})();'
# Keep generated code inside its HTML raw-text element if user-entered catalog
# wording ever contains a closing script/style tag.
js = re.sub(r'</script', r'<\\/script', js, flags=re.IGNORECASE)
css = re.sub(r'</style', r'<\\/style', css, flags=re.IGNORECASE)
html = '''<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#10131f">
  <meta name="description" content="Космический корабль Генезис — прогресс альянсов, ресурсы и исследования лагерной смены.">
  <title>Космический корабль Генезис</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2040%2040%22%3E%3Crect%20width%3D%2240%22%20height%3D%2240%22%20rx%3D%2210%22%20fill%3D%22%23171e2b%22%2F%3E%3Cg%20transform%3D%22translate%288%208%29%22%20fill%3D%22none%22%20stroke%3D%22%23b8c9e9%22%20stroke-width%3D%221.6%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M14%204c3-2%207-1%207-1s1%204-1%207l-6%207-7-7ZM7%2010%203%2011v6l4-1m7%201-1%204h6l1-4M7%2018l-3%203m1-5-3%203m6%201-3%203%22%2F%3E%3Ccircle%20cx%3D%2216%22%20cy%3D%228%22%20r%3D%222%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E">
  <!-- Standalone site: all styles, fonts, artwork and logic are included. -->
  <style>
''' + css + '''
  </style>
</head>
<body>
  <div id="app"></div>
  <noscript><p style="padding:24px;color:#e7e9f1">Для работы прогресса, покупок и крафта включите JavaScript в браузере.</p></noscript>
  <script>
''' + js + '''
  </script>
</body>
</html>
'''
license_text = (ROOT / 'src/fonts/LICENSE').read_text().replace('--', '—')
html = html.replace('<!-- Standalone site:', '<!-- Bundled Golos Text font license:\n' + license_text + '\n-->\n  <!-- Standalone site:')
(ROOT / 'index.html').write_text(html)
(ROOT / 'dist').mkdir(exist_ok=True)
(ROOT / 'dist/index.html').write_text(html)
print(f'Created standalone index.html: {len(html.encode()):,} bytes; no external assets.')
