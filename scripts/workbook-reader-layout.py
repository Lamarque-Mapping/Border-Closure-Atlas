#!/usr/bin/env python3
"""Add the artifact-authored reader guide and reversible navigation metadata.

Run after the existing 55-sheet presentation assembler. The original worksheet
names, identities, cell payloads, formulas, caches and relationships are retained.
Only the new guide, tab order/visibility, active view and historical-column
visibility are added. GitHub Actions uses Python's standard library only.
"""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import posixpath
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]
RESOURCE=ROOT/'source/workbook-reader-layout.json'
MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
DOCREL='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKGREL='http://schemas.openxmlformats.org/package/2006/relationships'
CONTENT='http://schemas.openxmlformats.org/package/2006/content-types'
M='{'+MAIN+'}'
RID='{'+DOCREL+'}id'
GUIDE='Start here'
PART='xl/worksheets/sheet56.xml'
READER_RID='rIdAtlasReaderGuide'
VISIBLE=[GUIDE,'Register','Chronology phases','Durations','Rationale coding','Source index']
HISTORICAL_COLUMNS=set(range(11,16))|set(range(19,24))
ET.register_namespace('x',MAIN)
ET.register_namespace('r',DOCREL)


def read_package(path):
    with ZipFile(path) as z:
        assert z.testzip() is None
        return z.infolist(),{i.filename:z.read(i) for i in z.infolist()},z.comment


def encoded(node): return ET.tostring(node,encoding='utf-8',xml_declaration=True)
def canonical(node): return ET.tostring(node,encoding='unicode')


def mapping(contents):
    workbook=ET.fromstring(contents['xl/workbook.xml'])
    rels={r.get('Id'):r for r in ET.fromstring(contents['xl/_rels/workbook.xml.rels'])}
    sheets=list(workbook.find(M+'sheets'))
    paths={s.get('name'):posixpath.normpath(posixpath.join('xl',rels[s.get(RID)].get('Target'))).lstrip('/') for s in sheets}
    return workbook,sheets,paths


def text_value(cell,strings):
    if cell is None:return None
    value=cell.find(M+'v')
    if cell.get('t')=='s':return strings[int(value.text)]
    if cell.get('t')=='inlineStr':return ''.join(cell.find(M+'is').itertext())
    return value.text if value is not None else None


def export_model(source,destination):
    _,contents,_=read_package(source)
    _,sheets,paths=mapping(contents)
    assert len(sheets)==55 and GUIDE not in paths
    strings=[''.join(s.itertext()) for s in ET.fromstring(contents['xl/sharedStrings.xml'])] if 'xl/sharedStrings.xml' in contents else []
    root=ET.fromstring(contents[paths['Register']])
    records=[]
    for row in root.find(M+'sheetData'):
        if int(row.get('r'))<=5:continue
        cells={re.sub(r'\d+$','',c.get('r')):c for c in row}
        if text_value(cells.get('A'),strings):records.append(cells)
    included=sum(text_value(row.get('D'),strings)=='Included' for row in records)
    assert len(records)==701 and included==697
    Path(destination).write_text(json.dumps({'originalSheets':[s.get('name') for s in sheets],
        'recordCount':len(records),'includedCount':included},indent=2)+'\n')


def extract_resources(artifact,manifest,destination):
    _,contents,_=read_package(artifact)
    _,_,paths=mapping(contents)
    meta=json.loads(Path(manifest).read_text())
    guide=ET.fromstring(contents[paths[GUIDE]])
    strings=ET.fromstring(contents['xl/sharedStrings.xml']) if 'xl/sharedStrings.xml' in contents else []
    for cell in guide.findall('.//'+M+'c'):
        if cell.get('t')=='s':
            raw=cell.find(M+'v'); item=deepcopy(strings[int(raw.text)]);item.tag=M+'is'
            cell.remove(raw);cell.append(item);cell.set('t','inlineStr')
    # Artifact Tool preserves the native HYPERLINK formula but returns its
    # unsupported-function notice as a string result. The friendly label is
    # explicitly authored in the same formula; restore only that known cache.
    # No research-sheet formula or cache is calculated or edited here.
    cells={c.get('r'):c for c in guide.findall('.//'+M+'c')}
    for link in meta['links']:
        cell=cells[link['cell']];formula=cell.find(M+'f')
        assert formula is not None and formula.text==link['formula'].lstrip('=')
        result=cell.find(M+'v')
        assert result is not None and (result.text==link['label'] or result.text.startswith('HYPERLINK is not implemented.'))
        cell.set('t','str');result.text=link['label']
    assert not guide.findall('.//'+M+'c[@t="e"]'),'Artifact guide contains a formula error'
    assert guide.find(M+'tableParts') is None
    assert all(c.find(M+'f') is None or c.find(M+'f').text.startswith('HYPERLINK(') for c in guide.findall('.//'+M+'c'))
    resource={'schema':1,'author':meta['author'],'builder':meta['builder'],'original_sheets':meta['originalSheets'],
              'visible_sheets':VISIBLE,'historical_register_columns':['K:O','S:W'],
              'guide':canonical(guide),'styles':contents['xl/styles.xml'].decode(),'links':meta['links']}
    Path(destination).write_text(json.dumps(resource,ensure_ascii=False,indent=2)+'\n')


def hide_historical_columns(raw):
    pattern=re.compile(rb'<(?:[A-Za-z_][\w.-]*:)?col\b[^>]*/>')
    def hide(match):
        tag=match.group()
        low=int(re.search(rb'\bmin="(\d+)"',tag).group(1))
        high=int(re.search(rb'\bmax="(\d+)"',tag).group(1))
        affected=[n in HISTORICAL_COLUMNS for n in range(low,high+1)]
        assert all(affected) or not any(affected),'Formatting must establish separate column widths first'
        if not any(affected):return tag
        tag=re.sub(rb'\s+hidden="[^"]*"',b'',tag)
        return tag[:-2].rstrip()+b' hidden="1" />'
    return pattern.sub(hide,raw)


def add_guide_styles(original,authored,guide):
    styles=ET.fromstring(original); resource=ET.fromstring(authored)
    offsets={}
    for group in ['fonts','fills','borders']:
        native=styles.find(M+group);offsets[group]=len(native)
        native.extend(deepcopy(list(resource.find(M+group))));native.set('count',str(len(native)))
    xfs=styles.find(M+'cellXfs'); offset=len(xfs)
    for source in resource.find(M+'cellXfs'):
        xf=deepcopy(source)
        assert xf.get('numFmtId','0')=='0','The reader guide must not introduce date/number formats'
        for attr,group in [('fontId','fonts'),('fillId','fills'),('borderId','borders')]:xf.set(attr,str(int(xf.get(attr,0))+offsets[group]))
        xf.set('xfId','0');xfs.append(xf)
    xfs.set('count',str(len(xfs)))
    for cell in guide.findall('.//'+M+'c'):cell.set('s',str(int(cell.get('s',0))+offset))
    for col in guide.findall('.//'+M+'col'):
        if 'style' in col.attrib:col.set('style',str(int(col.get('style'))+offset))
    return encoded(styles)


def transformed(contents,resources):
    after=dict(contents)
    workbook,sheets,paths=mapping(contents)
    assert [s.get('name') for s in sheets]==resources['original_sheets']
    assert len(sheets)==55 and PART not in contents and GUIDE not in paths
    assert resources['author']=='@oai/artifact-tool' and resources['visible_sheets']==VISIBLE
    assert workbook.find(M+'definedNames') is None,'Review sheet-index definitions before changing the layout'
    assert 'xl/calcChain.xml' not in contents,'Review calculation-chain identities before changing the layout'
    guide=ET.fromstring(resources['guide'])
    views=guide.find(M+'sheetViews')
    assert views is not None and len(views)==1
    views[0].set('workbookViewId','0');views[0].set('tabSelected','1')
    after['xl/styles.xml']=add_guide_styles(contents['xl/styles.xml'],resources['styles'],guide)
    after[PART]=encoded(guide)
    native_sheets=workbook.find(M+'sheets')
    for sheet in sheets:native_sheets.remove(sheet)
    new_sheet=ET.Element(M+'sheet',{'name':GUIDE,'sheetId':str(max(int(s.get('sheetId')) for s in sheets)+1),RID:READER_RID})
    native_sheets.append(new_sheet)
    by_name={s.get('name'):s for s in sheets}
    ordered=VISIBLE[1:]+[s.get('name') for s in sheets if s.get('name') not in VISIBLE]
    for name in ordered:
        sheet=by_name[name]
        if name in VISIBLE:sheet.attrib.pop('state',None)
        else:sheet.set('state','hidden')
        native_sheets.append(sheet)
    book_views=workbook.find(M+'bookViews')
    assert book_views is None,'Review an existing workbook view before replacing it'
    book_views=ET.Element(M+'bookViews');ET.SubElement(book_views,M+'workbookView',{'activeTab':'0','firstSheet':'0','showSheetTabs':'1'})
    workbook.insert(list(workbook).index(native_sheets),book_views)
    after['xl/workbook.xml']=encoded(workbook)
    rels=ET.fromstring(contents['xl/_rels/workbook.xml.rels'])
    assert READER_RID not in {r.get('Id') for r in rels}
    ET.SubElement(rels,'{'+PKGREL+'}Relationship',{'Id':READER_RID,'Type':DOCREL+'/worksheet','Target':'worksheets/sheet56.xml'})
    after['xl/_rels/workbook.xml.rels']=encoded(rels)
    types=ET.fromstring(contents['[Content_Types].xml'])
    ET.SubElement(types,'{'+CONTENT+'}Override',{'PartName':'/'+PART,'ContentType':'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'})
    after['[Content_Types].xml']=encoded(types)
    after[paths['Register']]=hide_historical_columns(contents[paths['Register']])
    return after


def stripped_guide(root):
    root=deepcopy(root)
    for cell in root.findall('.//'+M+'c'):cell.attrib.pop('s',None)
    for col in root.findall('.//'+M+'col'):col.attrib.pop('style',None)
    for view in root.findall('.//'+M+'sheetView'):
        view.attrib.pop('tabSelected',None);view.set('workbookViewId','0')
    return canonical(root)


def guide_format(styles,style_id):
    """Resolve references so a changed guide style cannot evade validation."""
    xf=deepcopy(styles.find(M+'cellXfs')[int(style_id)])
    result={}
    for attr,group in [('fontId','fonts'),('fillId','fills'),('borderId','borders')]:
        result[group]=canonical(styles.find(M+group)[int(xf.get(attr,0))])
        xf.attrib.pop(attr,None)
    xf.attrib.pop('xfId',None)
    result['format']=canonical(xf)
    return result


def normalized_for_presentation(before,after,resources=None):
    """Prove navigation-only changes, then restore native package identities.

    The existing presentation checker can then compare every original sheet
    cell, formula, cache and number format against the immutable research file.
    This never writes the normalized package or drops data from the release.
    """
    resources=resources or json.loads(RESOURCE.read_text())
    old_workbook,old_sheets,old_paths=mapping(before)
    new_workbook,new_sheets,new_paths=mapping(after)
    assert len(old_sheets)==55 and len(new_sheets)==56
    assert set(after)==set(before)|{PART},'Unexpected new/removed package parts'
    assert [s.get('name') for s in old_sheets]==resources['original_sheets']
    expected_order=VISIBLE+[s.get('name') for s in old_sheets if s.get('name') not in VISIBLE]
    assert [s.get('name') for s in new_sheets]==expected_order,'Reader worksheet order changed'
    assert [s.get('name') for s in new_sheets if s.get('state','visible')=='visible']==VISIBLE,'Default visible worksheets changed'
    new_by_name={s.get('name'):s for s in new_sheets}
    for original in old_sheets:
        current=deepcopy(new_by_name[original.get('name')])
        assert current.get('state','visible') in {'visible','hidden'},'Supporting tabs must remain ordinarily unhideable'
        current.attrib.pop('state',None);original=deepcopy(original);original.attrib.pop('state',None)
        assert canonical(current)==canonical(original),'Original worksheet identity changed'
        assert old_paths[original.get('name')]==new_paths[original.get('name')]
    guide_node=new_sheets[0]
    assert guide_node.attrib=={'name':GUIDE,'sheetId':str(max(int(s.get('sheetId')) for s in old_sheets)+1),RID:READER_RID}
    assert new_paths[GUIDE]==PART
    normalized=deepcopy(new_workbook)
    new_sheet_list=normalized.find(M+'sheets')
    normalized.remove(new_sheet_list)
    views=normalized.find(M+'bookViews')
    assert views is not None and len(views)==1 and views[0].attrib=={'activeTab':'0','firstSheet':'0','showSheetTabs':'1'},'Guide is not the opening view'
    normalized.remove(views)
    old_list=old_workbook.find(M+'sheets')
    normalized.insert(list(old_workbook).index(old_list),deepcopy(old_list))
    assert canonical(normalized)==canonical(old_workbook),'Unapproved workbook metadata changed'
    for path,tag,key,value in [('xl/_rels/workbook.xml.rels','{'+PKGREL+'}Relationship','Id',READER_RID),('[Content_Types].xml','{'+CONTENT+'}Override','PartName','/'+PART)]:
        old_root=ET.fromstring(before[path]);new_root=ET.fromstring(after[path])
        added=[n for n in new_root if n.tag==tag and n.get(key)==value]
        assert len(added)==1
        if key=='Id':assert added[0].attrib=={'Id':READER_RID,'Type':DOCREL+'/worksheet','Target':'worksheets/sheet56.xml'}
        else:assert added[0].get('ContentType')=='application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
        new_root.remove(added[0]);assert canonical(new_root)==canonical(old_root),'Native package relationships/types changed'
    guide=ET.fromstring(after[PART]);authored_guide=ET.fromstring(resources['guide'])
    assert stripped_guide(guide)==stripped_guide(authored_guide),'Reader guide content or layout differs from the authored resource'
    assert guide.find(M+'sheetViews')[0].get('tabSelected')=='1'
    assert guide.find(M+'tableParts') is None and not guide.findall('.//'+M+'c[@t="e"]')
    cells={c.get('r'):c for c in guide.findall('.//'+M+'c')}
    authored_cells={c.get('r'):c for c in authored_guide.findall('.//'+M+'c')}
    final_styles=ET.fromstring(after['xl/styles.xml']);authored_styles=ET.fromstring(resources['styles'])
    for address,cell in cells.items():
        assert guide_format(final_styles,cell.get('s',0))==guide_format(authored_styles,authored_cells[address].get('s',0)),'Guide formatting changed: '+address
    for link in resources['links']:
        assert link['sheet'] in VISIBLE and link['sheet']!=GUIDE,'Do not link to a hidden sheet'
        cell=cells[link['cell']];formula=cell.find(M+'f')
        assert formula is not None and "#'"+link['sheet']+"'!"+link['target'] in formula.text
        assert text_value(cell,[])==link['label'],'Hyperlink cached label missing'
        assert re.fullmatch(r'[A-Z]+[1-9]\d*',link['target'])
        target=ET.fromstring(after[new_paths[link['sheet']]]).find('.//'+M+'c[@r="'+link['target']+'"]')
        assert target is not None,'Guide link does not point to an existing cell'
    columns=ET.fromstring(after[old_paths['Register']]).find(M+'cols')
    for number in range(1,26):
        column=next(c for c in columns if int(c.get('min'))<=number<=int(c.get('max')))
        assert (column.get('hidden','0')=='1')==(number in HISTORICAL_COLUMNS),'Register current/historical column visibility changed'
    normalized_parts=dict(after);del normalized_parts[PART]
    for path in ['xl/workbook.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml']:normalized_parts[path]=before[path]
    return normalized_parts,{'reader_worksheets':1,'original_worksheets':55,'visible_worksheets':VISIBLE,
        'hidden_supporting_worksheets':50,'original_names_and_identities_preserved':True,
        'historical_register_columns_hidden':['K:O','S:W'],'guide_internal_links_checked':len(resources['links'])}


def apply_layout(source,destination,resources_path=RESOURCE):
    infos,before,comment=read_package(source)
    resources=json.loads(Path(resources_path).read_text())
    after=transformed(before,resources)
    with ZipFile(destination,'w') as z:
        z.comment=comment
        for info in infos:z.writestr(info,after[info.filename])
        info=ZipInfo(PART,date_time=(2026,10,24,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o600<<16
        z.writestr(info,after[PART])
    _,reopened,_=read_package(destination)
    assert reopened==after,'Saved package differs from the planned layout'
    _,report=normalized_for_presentation(before,reopened,resources)
    report.update({'input_sha256':hashlib.sha256(Path(source).read_bytes()).hexdigest(),
                   'output_sha256':hashlib.sha256(Path(destination).read_bytes()).hexdigest(),
                   'native_excel_tested':False})
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('model');p.add_argument('source');p.add_argument('output')
    p=sub.add_parser('resources');p.add_argument('artifact');p.add_argument('manifest');p.add_argument('output')
    p=sub.add_parser('apply');p.add_argument('source');p.add_argument('output');p.add_argument('--resources',default=str(RESOURCE))
    args=parser.parse_args()
    if args.command=='model':export_model(args.source,args.output)
    elif args.command=='resources':extract_resources(args.artifact,args.manifest,args.output)
    else:print(json.dumps(apply_layout(args.source,args.output,args.resources),indent=2))


if __name__=='__main__':main()
