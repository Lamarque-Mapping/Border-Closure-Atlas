#!/usr/bin/env python3
"""Check workbook URL substitution without building the large offline atlas."""
import base64
import json
import runpy
from pathlib import Path

module = runpy.run_path(str(Path(__file__).with_name('build-standalone.py')))
filename = 'Global_Border_Closures_Register_2016_2026.xlsx'
mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
payload = b'PK\x03\x04download-check'
href = 'downloads/' + filename + '?v=' + 'f' * 64
anchor = f'<a href="{href}" download="{filename}" type="{mime}">Workbook</a>'
source = anchor + '\n' + json.dumps(anchor) + f'\n<a href="downloads/{filename}">Legacy</a>'
result = module['inline_workbook_downloads'](source, filename, payload)
expected = 'data:' + mime + ';base64,' + base64.b64encode(payload).decode('ascii')
assert result == source.replace(href, expected).replace('downloads/' + filename, expected)
assert '?v=' not in result
print('Standalone download checks passed: versioned, embedded JSON and legacy links; filename and MIME retained.')
