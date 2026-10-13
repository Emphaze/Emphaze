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
  <meta name="description" content="Орбита — прогресс альянсов в космической лагерной смене.">
  <title>Орбита · Космическая одиссея</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='12' fill='%23232b40'/%3E%3Ccircle cx='20' cy='20' r='8' fill='%23b2c3eb'/%3E%3Cellipse cx='20' cy='20' rx='17' ry='5' transform='rotate(-30 20 20)' fill='none' stroke='%23b2c3eb' stroke-width='2'/%3E%3C/svg%3E">
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
