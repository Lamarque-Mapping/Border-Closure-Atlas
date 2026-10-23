#!/usr/bin/env python3
"""Package the static atlas, including Analysis, as one offline HTML file."""
import argparse
import base64
import json
import re
from pathlib import Path


def bundle(web: Path) -> str:
    html = (web / 'index.html').read_text(encoding='utf-8')
    logo = base64.b64encode((web / 'assets/leverhulme-trust.jpg').read_bytes()).decode('ascii')
    html = html.replace('src="assets/leverhulme-trust.jpg"', 'src="data:image/jpeg;base64,' + logo + '"')
    analysis = json.dumps((web / 'analysis.html').read_text(encoding='utf-8'), ensure_ascii=False).replace('<', '\\u003c')
    html = html.replace('<script src="navigation.js" defer></script>',
                        '<script type="application/json" id="analysis-document">' + analysis + '</script>\n'
                        '<script src="navigation.js" defer></script>')
    # Offline files retain all evidence locally and never request record shards.
    html = re.sub(r'(?=<script src="data-loader.js")',
                  lambda _: '<script>\n' + (web / 'data.js').read_text(encoding='utf-8') + '\n</script>\n', html, count=1)
    for name in ['vendor/leaflet.css', 'style.css']:
        html = html.replace('<link rel="stylesheet" href="' + name + '">',
                            '<style>\n' + (web / name).read_text(encoding='utf-8') + '\n</style>')
    for name in ['data-loader.js', 'navigation.js', 'startup.js', 'vendor/leaflet.js', 'cartography.js',
                 'core.js', 'public-text.js', 'record-summary.js', 'export.js', 'record-export.js', 'app.js']:
        html = re.sub(r'<script src="' + re.escape(name) + r'"[^>]*></script>',
                      lambda _: '<script>\n' + (web / name).read_text(encoding='utf-8') + '\n</script>', html)
    font = base64.b64encode((web / 'vendor/AtlasSans.ttf').read_bytes()).decode('ascii')
    for quote in ["'", '"']:
        html = html.replace('url(' + quote + 'vendor/AtlasSans.ttf' + quote + ')',
                            "url('data:font/ttf;base64," + font + "')")
    # Both Methods and the embedded Analysis retain the exact source download.
    workbook = web / 'downloads/Global_Border_Closures_Register_2016_2026.xlsx'
    workbook_url = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + base64.b64encode(workbook.read_bytes()).decode('ascii')
    html = html.replace('downloads/' + workbook.name, workbook_url)
    licence = (web / 'vendor/AtlasSans-LICENSE.txt').read_text(encoding='utf-8').replace('--', '—')
    return html.replace('</head>', '<!-- Bundled font licence\n' + licence + '\n-->\n</head>')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('web', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(bundle(args.web), encoding='utf-8')
    print(f'Wrote {args.output} ({args.output.stat().st_size:,} bytes)')
