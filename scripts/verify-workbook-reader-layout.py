#!/usr/bin/env python3
"""Verify the actual workbook's reader navigation and its preservation boundary."""
import argparse
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
from zipfile import ZipFile
from release_common import READER_PATH,load_json,DATA_PATH,validate_reader

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('reader_layout',ROOT/'scripts/workbook-reader-layout.py')
READER=importlib.util.module_from_spec(spec);spec.loader.exec_module(READER)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbook',type=Path,default=READER_PATH)
    args=parser.parse_args()
    if args.workbook.resolve()==READER_PATH.resolve():
        print(json.dumps(validate_reader(path=args.workbook,release=load_json(DATA_PATH)),indent=2))
        return
    original=subprocess.run(['git','show','HEAD:source/Global_Border_Closures_Register_2016_2026.xlsx'],cwd=ROOT,check=True,capture_output=True).stdout
    with ZipFile(io.BytesIO(original)) as package:before={name:package.read(name) for name in package.namelist()}
    _,after,_=READER.read_package(args.workbook)
    resources=json.loads(READER.RESOURCE.read_text())
    _,report=READER.normalized_for_presentation(before,after,resources)
    faults=[]
    def rejects(label,part,edit):
        changed=dict(after);root=ET.fromstring(changed[part]);edit(root);changed[part]=READER.encoded(root)
        try:READER.normalized_for_presentation(before,changed,resources)
        except (AssertionError,KeyError,IndexError,StopIteration):faults.append(label)
        else:raise AssertionError('Invalid reader layout accepted: '+label)
    M=READER.M
    rejects('current Register hidden','xl/workbook.xml',lambda root:root.find(M+'sheets/'+M+'sheet[@name="Register"]').set('state','hidden'))
    rejects('supporting history not ordinarily unhideable','xl/workbook.xml',lambda root:root.find(M+'sheets/'+M+'sheet[@name="Claim checks"]').set('state','veryHidden'))
    rejects('opens on another sheet','xl/workbook.xml',lambda root:root.find(M+'bookViews/'+M+'workbookView').set('activeTab','1'))
    rejects('original worksheet identity changed','xl/workbook.xml',lambda root:root.find(M+'sheets/'+M+'sheet[@name="Register"]').set('sheetId','999'))
    rejects('historical Register columns exposed','xl/worksheets/sheet1.xml',lambda root:root.find(M+'cols/'+M+'col[@min="11"]').set('hidden','0'))
    rejects('current corrections hidden','xl/worksheets/sheet1.xml',lambda root:root.find(M+'cols/'+M+'col[@min="25"]').set('hidden','1'))
    rejects('wrong correction-link target',READER.PART,lambda root:setattr(root.find('.//'+M+'c[@r="B7"]/'+M+'f'),'text','HYPERLINK("#\'Register\'!S5","Read current corrections")'))
    rejects('link pretends to open hidden sheet',READER.PART,lambda root:setattr(root.find('.//'+M+'c[@r="B14"]/'+M+'f'),'text','HYPERLINK("#\'Claim checks\'!A1","Source index")'))
    rejects('unsupported hyperlink result retained',READER.PART,lambda root:setattr(root.find('.//'+M+'c[@r="B6"]/'+M+'v'),'text','HYPERLINK is not implemented.'))
    rejects('guide style replaced',READER.PART,lambda root:root.find('.//'+M+'c[@r="B2"]').set('s','0'))
    report.update({'navigation_mutation_regressions':faults,'native_excel_tested':False,
                   'original_research_preservation_gate':'verify-workbook-presentation.py'})
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
