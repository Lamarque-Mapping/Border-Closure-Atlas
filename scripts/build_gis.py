#!/usr/bin/env python3
"""Build a portable GIS atlas from the compiled, replaceable map JSON.

Only Python's standard library is required. Coordinates and intervals are never
inferred here. See GIS_README.txt for the native QGIS validation limitation.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import shutil
import sqlite3
import struct
import xml.etree.ElementTree as ET

WKT4326 = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]'
TYPES = {'Point':1,'LineString':2,'Polygon':3,'MultiPoint':4,'MultiLineString':5,'MultiPolygon':6,'GeometryCollection':7}

def q(name):
    return '"' + name.replace('"','""') + '"'

def flatten(coords):
    if coords and isinstance(coords[0], (int,float)):
        if len(coords) != 2:
            raise ValueError('Only 2-D coordinates are supported')
        yield tuple(coords)
    else:
        for child in coords:
            yield from flatten(child)

def points(geom):
    if geom['type'] == 'GeometryCollection':
        for child in geom['geometries']:
            yield from points(child)
    else:
        yield from flatten(geom['coordinates'])

def bbox(geom):
    ps = list(points(geom))
    if not ps:
        raise ValueError('Empty geometries are not accepted')
    for x,y in ps:
        if not math.isfinite(x) or not math.isfinite(y) or not (-180.000001<=x<=180.000001 and -90.000001<=y<=90.000001):
            raise ValueError(f'Invalid longitude/latitude {x}, {y}')
    xs,ys = zip(*ps)
    return min(xs),max(xs),min(ys),max(ys)

def wkb(geom):
    t = geom['type']; cs = geom.get('coordinates')
    result = struct.pack('<BI',1,TYPES[t])
    if t == 'Point':
        return result + struct.pack('<dd',*cs)
    if t == 'LineString':
        if len(cs)<2: raise ValueError('LineString has fewer than two vertices')
        return result + struct.pack('<I',len(cs)) + b''.join(struct.pack('<dd',*xy) for xy in cs)
    if t == 'Polygon':
        if any(len(r)<4 or r[0]!=r[-1] for r in cs): raise ValueError('Invalid polygon ring')
        return result + struct.pack('<I',len(cs)) + b''.join(struct.pack('<I',len(r)) + b''.join(struct.pack('<dd',*xy) for xy in r) for r in cs)
    if t in ('MultiPoint','MultiLineString','MultiPolygon'):
        child_type = t[5:]
        return result + struct.pack('<I',len(cs)) + b''.join(wkb({'type':child_type,'coordinates':part}) for part in cs)
    if t == 'GeometryCollection':
        children=geom['geometries']
        return result + struct.pack('<I',len(children)) + b''.join(wkb(g) for g in children)
    raise ValueError(t)

def gpb(geom):
    # Version 0; little-endian; nonempty; standard geometry; XY envelope.
    return b'GP' + bytes([0,3]) + struct.pack('<i',4326) + struct.pack('<dddd',*bbox(geom)) + wkb(geom)

def coerce(geom,kind):
    if geom['type'].upper() == kind: return geom
    expected = {'MULTIPOLYGON':'Polygon','MULTILINESTRING':'LineString','MULTIPOINT':'Point'}.get(kind)
    if geom['type'] == expected:
        return {'type':'Multi'+expected,'coordinates':[geom['coordinates']]}
    raise ValueError(f"Geometry {geom['type']} cannot be stored as {kind}")

def value(v):
    if isinstance(v,(dict,list)):return json.dumps(v,ensure_ascii=False,separators=(',',':'))
    if isinstance(v,bool):return int(v)
    return v

def infer_type(name,values):
    nonnull=[v for v in values if v is not None]
    if name in ('start_dt','end_dt'):return 'DATETIME'
    if nonnull and all(isinstance(v,(bool,int)) for v in nonnull):return 'INTEGER'
    if nonnull and all(isinstance(v,(bool,int,float)) for v in nonnull):return 'REAL'
    return 'TEXT'

def initialise(db):
    db.execute('PRAGMA application_id=1196444487')
    db.execute('PRAGMA user_version=10300')
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
      CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL,srs_id INTEGER NOT NULL PRIMARY KEY,organization TEXT NOT NULL,organization_coordsys_id INTEGER NOT NULL,definition TEXT NOT NULL,description TEXT);
      CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY,data_type TEXT NOT NULL,identifier TEXT UNIQUE,description TEXT DEFAULT '',last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),min_x DOUBLE,min_y DOUBLE,max_x DOUBLE,max_y DOUBLE,srs_id INTEGER,FOREIGN KEY(srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
      CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL,column_name TEXT NOT NULL,geometry_type_name TEXT NOT NULL,srs_id INTEGER NOT NULL,z TINYINT NOT NULL,m TINYINT NOT NULL,PRIMARY KEY(table_name,column_name),FOREIGN KEY(table_name) REFERENCES gpkg_contents(table_name),FOREIGN KEY(srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
    ''')
    db.executemany('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)',[
      ('Undefined Cartesian SRS',-1,'NONE',-1,'undefined','Undefined Cartesian coordinate reference system'),
      ('Undefined geographic SRS',0,'NONE',0,'undefined','Undefined geographic coordinate reference system'),
      ('WGS 84 geodetic',4326,'EPSG',4326,WKT4326,'Longitude, latitude in decimal degrees')])

def add_table(db,name,rows,description,kind=None):
    # Store complete property sets with typed scalar fields, nested values as JSON.
    props=[r['properties'] for r in rows] if kind else rows
    source_fields=list(dict.fromkeys(k for p in props for k in p if k.casefold() not in ('fid','geom')))
    if kind and not source_fields:
        source_fields=['event_id','location_id','title','start_dt','end_dt'] if name.startswith(('event_','interval_')) else ['location_id','label']
    # SQLite identifiers are case-insensitive; preserve both NAME and name
    # without dropping either property's values from heterogeneous gazetteers.
    column_map={};used={'fid','geom'}
    for original in source_fields:
        column=original;suffix=2
        while column.casefold() in used:
            column=original+'__'+str(suffix);suffix+=1
        column_map[original]=column;used.add(column.casefold())
    fields=[column_map[k] for k in source_fields]
    types={column_map[k]:infer_type(k,[p.get(k) for p in props]) for k in source_fields}
    columns=['fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL']
    if kind:columns.append('geom '+kind)
    columns += [q(k)+' '+types[k] for k in fields]
    db.execute('CREATE TABLE '+q(name)+' ('+', '.join(columns)+')')
    now=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    extents=[]
    for p in rows:
        if kind:
            geom=coerce(p['geometry'],kind)
            extents.append(bbox(geom)); vals=[gpb(geom)]+[value(p['properties'].get(k)) for k in source_fields]
        else:vals=[value(p.get(k)) for k in source_fields]
        cs=(['geom'] if kind else [])+fields
        if cs:db.execute('INSERT INTO '+q(name)+' ('+','.join(q(c) for c in cs)+') VALUES ('+','.join('?' for _ in vals)+')',vals)
        else:db.execute('INSERT INTO '+q(name)+' DEFAULT VALUES')
    b=(min(x[0] for x in extents),min(x[2] for x in extents),max(x[1] for x in extents),max(x[3] for x in extents)) if extents else (None,None,None,None)
    db.execute('INSERT INTO gpkg_contents VALUES (?,?,?,?,?,?,?,?,?,?)',(name,'features' if kind else 'attributes',name,description,now,*b,4326 if kind else None))
    if kind:db.execute('INSERT INTO gpkg_geometry_columns VALUES (?,?,?,?,?,?)',(name,'geom',kind,4326,0,0))
    for field in ('event_id','location_id'):
        if field in fields:db.execute('CREATE INDEX '+q(name+'_'+field+'_idx')+' ON '+q(name)+' ('+q(field)+')')
    return {'table':name,'kind':kind,'fields':types,'source_field_columns':column_map,'count':len(rows),'description':description,'bounds':b}

def child(parent,tag,text=None,**attrs):
    node=ET.SubElement(parent,tag,{k:str(v) for k,v in attrs.items()})
    if text is not None:node.text=str(text)
    return node

def add_crs(parent):
    s=child(parent,'spatialrefsys',nativeFormat='Wkt')
    for tag,text in [('wkt',WKT4326),('proj4','+proj=longlat +datum=WGS84 +no_defs'),('srsid',3452),('srid',4326),('authid','EPSG:4326'),('description','WGS 84'),('projectionacronym','longlat'),('ellipsoidacronym','EPSG:7030'),('geographicflag','true')]:child(s,tag,text)

def add_extent(parent,b=(-180,-60,180,85)):
    ext=child(parent,'extent')
    for k,v in zip(('xmin','ymin','xmax','ymax'),b):child(ext,k,v)

def rgba(hexstr):
    h=hexstr.lstrip('#');return ','.join(str(int(h[i:i+2],16)) for i in (0,2,4))+',255'

def layer_spec(table,kind):
    """One explicit visual contract shared with the native QGIS regeneration."""
    temporal=table.startswith('interval_');context='_context_' in table
    family='temporal' if temporal else 'locations' if table.startswith('location_') else 'all' if table.startswith('event_') else 'base' if kind else 'tables'
    if context and family in ('all','temporal'):family+='Context'
    names={'countries':'Countries — Natural Earth reference','borders':'Land boundaries — Natural Earth reference','disputed':'Disputed boundaries — reference, not closures'}
    if table in names:label=names[table]
    elif table=='approved_phase_points':label='Approved approximate phase markers — inspect scope and date evidence'
    elif kind:
        prefix='Exact operational phases at approved approximate markers' if temporal else 'Reference gazetteer' if family=='locations' else 'Register geography references'
        suffix='crossing areas' if table.endswith('_points') else 'frontier context, not closure extent' if context and kind=='MULTILINESTRING' else 'country context, not closure extent' if context else 'sourced crossing/policy references'
        label=prefix+' — '+suffix+(' (temporal)' if temporal else ' (all dates)' if family.startswith('all') else '')
    else:label=table.replace('_',' ').capitalize()
    # Match the atlas's line-only default. Point layers remain inspectable but
    # must be deliberately enabled, including approved approximate markers.
    visible=table in ('countries','borders','disputed') or table.startswith('event_') and kind in ('MULTILINESTRING','MULTIPOLYGON')
    color='#B47735' if context else '#147D87'
    if kind=='POINT':
        style={'name':'circle','color':rgba(color),'outline_color':'255,255,255,255','outline_style':'solid','outline_width':'0.35','outline_width_unit':'MM','size':'3.2' if temporal else '2.6','size_unit':'MM','angle':'0','scale_method':'diameter'}
    elif kind=='MULTILINESTRING':
        if table=='borders':color='#BBB8B0'
        if table=='disputed':color='#989A96'
        style={'line_color':rgba(color),'line_width':'0.18' if table=='borders' else '0.22' if table=='disputed' else '0.38' if context else '0.8','line_width_unit':'MM','line_style':'solid' if table=='borders' else 'dash','joinstyle':'round','capstyle':'round','use_custom_dash':'0'}
    elif kind=='MULTIPOLYGON':
        style={'color':'180,119,53,15' if context else '236,233,225,255','style':'solid','outline_color':'180,119,53,200' if context else '255,255,255,255','outline_style':'dash' if context else 'solid','outline_width':'0.25' if context else '0.08','outline_width_unit':'MM','joinstyle':'bevel'}
    else:style=None
    return {'label':label,'group':family,'visible':bool(visible),'temporal':temporal,'style':style}

def add_renderer(layer,kind,spec):
    renderer=child(layer,'renderer-v2',type='singleSymbol',symbollevels=0,enableorderby=0,forceraster=0)
    syms=child(renderer,'symbols')
    symtype={'POINT':'marker','MULTILINESTRING':'line','MULTIPOLYGON':'fill'}[kind]
    sym=child(syms,'symbol',name=0,type=symtype,alpha=1,clip_to_extent=1,force_rhr=0)
    symbol_class={'POINT':'SimpleMarker','MULTILINESTRING':'SimpleLine','MULTIPOLYGON':'SimpleFill'}[kind]
    sub=child(sym,'layer',**{'class':symbol_class,'enabled':1,'locked':0,'pass':0})
    opt=child(sub,'Option',type='Map')
    for k,v in spec['style'].items():child(opt,'Option',name=k,type='QString',value=v)

def make_qgs(path,descriptors,meta,gpkg_name):
    root=ET.Element('qgis',{'version':'3.44.0-Solothurn','projectname':'Border closures — full register atlas','saveUser':'','saveUserFull':''})
    child(root,'homePath',path='')
    child(root,'title','Border closures — full register atlas')
    crs=child(root,'projectCrs');add_crs(crs)
    canvas=child(root,'mapcanvas');child(canvas,'units','degrees');add_extent(canvas);child(canvas,'rotation',0)
    crs=child(canvas,'destinationsrs');add_crs(crs)
    child(canvas,'rendermaptile',0)
    tree=child(root,'layer-tree-group',name='',checked='Qt::Checked',expanded=1)
    child(tree,'customproperties')
    layers=child(root,'projectlayers')
    draw=[d for d in descriptors if d['kind']]
    # Keep every point above contextual geography, including when families overlap.
    ordered=['interval_points','approved_phase_points','event_points','location_points','event_lines','location_lines','event_context_lines','location_context_lines','event_context_polygons','location_context_polygons','disputed','borders','countries']
    draw.sort(key=lambda d:ordered.index(d['table']) if d['table'] in ordered else len(ordered))
    layer_order=[]
    for d in draw:
        name=d['table']; lid=name+'_'+hashlib.sha1(name.encode()).hexdigest()[:12]
        visible=d['visible'];label=d['label']
        ds='./'+gpkg_name+'|layername='+name
        node=child(tree,'layer-tree-layer',id=lid,name=label,source=ds,providerKey='ogr',checked='Qt::Checked' if visible else 'Qt::Unchecked',expanded=0)
        child(node,'customproperties')
        lyr=child(layers,'maplayer',type='vector',geometry={'POINT':'Point','MULTILINESTRING':'Line','MULTIPOLYGON':'Polygon'}[d['kind']],autoRefreshEnabled=0,autoRefreshTime=0,hasScaleBasedVisibilityFlag=0,minScale=100000000,maxScale=0,simplifyDrawingHints=1,readOnly=1,labelsEnabled=0)
        add_extent(lyr,d['bounds'] if d['count'] else (-180,-60,180,85))
        child(lyr,'id',lid);child(lyr,'datasource',ds);child(lyr,'layername',label);child(lyr,'provider','ogr',encoding='UTF-8')
        child(lyr,'layerGeometryType',{'POINT':0,'MULTILINESTRING':1,'MULTIPOLYGON':2}[d['kind']])
        srs=child(lyr,'srs');add_crs(srs)
        child(lyr,'abstract',d['description'])
        child(lyr,'displayfield','title' if name.startswith(('event','interval')) else 'label')
        temporal=child(lyr,'temporal',enabled=int(name.startswith('interval_')),mode=2,limitMode=0,startField='start_dt',endField='end_dt',startExpression='',endExpression='',durationField='',durationUnit='min',fixedDuration=0,accumulate=0)
        fixed=child(temporal,'fixedRange');child(fixed,'start');child(fixed,'end')
        add_renderer(lyr,d['kind'],d)
        child(lyr,'blendMode',0);child(lyr,'featureBlendMode',0);child(lyr,'layerOpacity',1)
        layer_order.append(lid)
    order=child(root,'layerorder')
    for lid in layer_order:child(order,'layer',id=lid)
    props=child(root,'properties');paths=child(props,'Paths');child(paths,'Absolute','false',type='bool')
    gui=child(props,'Gui');child(gui,'CanvasColorRedPart',247,type='int');child(gui,'CanvasColorGreenPart',248,type='int');child(gui,'CanvasColorBluePart',247,type='int')
    paths=child(props,'SpatialRefSys');child(paths,'ProjectCrs','EPSG:4326',type='QString');child(paths,'ProjectionsEnabled',1,type='int')
    ET.indent(root,space='  ')
    path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE qgis PUBLIC "http://mrcc.com/qgis.dtd" "SYSTEM">\n'+ET.tostring(root,encoding='unicode'),encoding='utf8')

def read_wkb(data,pos=0):
    start=pos
    endian='<' if data[pos]==1 else '>';pos+=1
    typ=struct.unpack_from(endian+'I',data,pos)[0];pos+=4
    if typ==1:
        xy=struct.unpack_from(endian+'dd',data,pos);return pos+16,[xy],typ
    count=struct.unpack_from(endian+'I',data,pos)[0];pos+=4;pts=[]
    if typ==2:
        for _ in range(count):pts.append(struct.unpack_from(endian+'dd',data,pos));pos+=16
    elif typ==3:
        for _ in range(count):
            n=struct.unpack_from(endian+'I',data,pos)[0];pos+=4;ring=[]
            for __ in range(n):ring.append(struct.unpack_from(endian+'dd',data,pos));pos+=16
            if len(ring)<4 or ring[0]!=ring[-1]:raise ValueError('WKB ring closure failed')
            pts.extend(ring)
    elif typ in (4,5,6,7):
        for _ in range(count):
            pos,pp,tt=read_wkb(data,pos);pts.extend(pp)
            if typ<7 and tt!=typ-3:raise ValueError('WKB collection subtype mismatch')
    else:raise ValueError(f'Unsupported WKB type {typ} at {start}')
    return pos,pts,typ

def validate(gpkg,qgs):
    db=sqlite3.connect(gpkg);checks={}
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    assert db.execute('PRAGMA application_id').fetchone()[0]==1196444487
    for table,column,kind,srs,z,m in db.execute('SELECT * FROM gpkg_geometry_columns').fetchall():
        n=0
        for raw, in db.execute('SELECT geom FROM '+q(table)):
            assert raw[:4]==b'GP\0\x03'
            assert struct.unpack_from('<i',raw,4)[0]==4326
            envelope=struct.unpack_from('<dddd',raw,8)
            end,pts,typ=read_wkb(raw,40)
            assert end==len(raw) and typ==TYPES[kind.title().replace('Multipolygon','MultiPolygon').replace('Multilinestring','MultiLineString')]
            xs,ys=zip(*pts);actual=(min(xs),max(xs),min(ys),max(ys));assert actual==envelope
            n+=1
        checks[table]=n
    r=ET.parse(qgs).getroot()
    for ds in r.findall('projectlayers/maplayer/datasource'):
        filepart,tablepart=ds.text.split('|layername=')
        assert not Path(filepart).is_absolute()
        assert (qgs.parent/filepart).resolve()==gpkg.resolve()
        assert tablepart in checks
    db.close()
    return {'sqlite_integrity':'ok','foreign_keys':'ok','geometry_headers_and_wkb':'all decoded and envelopes reconciled','relative_project_paths':'all verified','layer_feature_counts':checks,'native_qgis_validation':'NOT RUN: QGIS/GDAL are not installed in the build environment'}

def approved_phase_features(events):
    """Keep source-approved point bindings separate from general record geometry.

    The native temporal subset is intentionally strict: exact positive operational
    intervals, explicit observed reopening and an explicitly exclusive endpoint.
    All other dates and binding decisions remain in the attribute tables.
    """
    approved=[]; intervals=[]; seen=set()
    for event in events:
        if event.get('inclusion_status')!='Included' or event.get('excluded_from_map'):
            continue
        for phase in event.get('duration_periods',[]):
            for binding in phase.get('location_bindings',[]):
                if binding.get('Binding decision')!='approved_approximate':continue
                lat=binding.get('Latitude (approx.)');lon=binding.get('Longitude (approx.)')
                if not isinstance(lat,(int,float)) or not isinstance(lon,(int,float)):
                    raise ValueError('Approved phase marker lacks numeric coordinates: '+phase['period_id'])
                key=(event['id'],phase['period_id'],binding.get('Location / marker'),lon,lat)
                if key in seen:continue
                seen.add(key)
                geom={'type':'Point','coordinates':[lon,lat]};bbox(geom)
                attrs=dict(phase,event_id=event['id'],title=event['title'],region=event['region'],
                    rationales=event.get('rationales',[]),location_label=binding.get('Location / marker'),
                    binding_decision=binding['Binding decision'],binding=binding,
                    geometry_precision='Approved approximate published marker; not a surveyed gate or closure footprint.',
                    display_role='approved_approximate_phase_reference',start_dt=None,end_dt=None)
                approved.append({'type':'Feature','properties':attrs,'geometry':geom})
                raw=phase.get('source_phase',{})
                a=raw.get('Start earliest');b=raw.get('Endpoint earliest')
                exact=(a and b and a==raw.get('Start latest') and b==raw.get('Endpoint latest'))
                if not (exact and phase.get('exact_complete_operational') and not phase.get('contested')
                        and phase.get('measure_type')=='operational_spell'
                        and phase.get('calculation_rule')=='calendar_bounds'
                        and phase.get('observed_reopening')=='Yes'
                        and phase.get('endpoint_inclusion')=='Exclusive'
                        and binding.get('Temporal display rule')=='scoped_interval_with_endpoint_uncertainty'):
                    continue
                if dt.date.fromisoformat(b)<=dt.date.fromisoformat(a):
                    raise ValueError('Non-positive exact operational phase: '+phase['period_id'])
                temporal=dict(attrs,start_dt=a+'T00:00:00.000Z',end_dt=b+'T00:00:00.000Z',interval_eligible=True)
                intervals.append({'type':'Feature','properties':temporal,'geometry':geom})
    return approved,intervals

def build(data,out):
    out.mkdir(parents=True,exist_ok=True)
    gpkg=out/'border_closures_atlas.gpkg';qgs=out/'border_closures_atlas.qgs'
    if gpkg.exists():gpkg.unlink()
    db=sqlite3.connect(gpkg);initialise(db);ds=[]
    desc='Generalized modern Natural Earth reference geometry; not a historical claim about all frontiers.'
    ds.append(add_table(db,'countries',data['countries']['features'],desc,'MULTIPOLYGON'))
    ds.append(add_table(db,'borders',data['borders']['features'],desc,'MULTILINESTRING'))
    if data.get('disputed'):
        ds.append(add_table(db,'disputed',data['disputed']['features'],'Natural Earth disputed boundary reference lines, separate from closure evidence. Modern generalized reference; not a history of control, endorsement of a claim, or evidence of a closure.','MULTILINESTRING'))
    # Additional display-only context is separate in the compiled data. Keep
    # original events and links intact while making the context available to GIS.
    source_locations=data['locations']['features']
    context_locations=(data.get('context_locations') or {}).get('features',[])
    locations=source_locations+context_locations
    byid={f['properties']['location_id']:f for f in locations}
    if len(byid)!=len(locations):raise ValueError('Duplicate location_id')
    events=data['events'];evmap={e['id']:e for e in events}
    if len(evmap)!=len(events):raise ValueError('Duplicate event IDs')
    valid_ids={e['id'] for e in events if e.get('inclusion_status')=='Included' and not e.get('excluded_from_map')}
    for feature in locations:
        if feature.get('geometry') and feature['geometry']['type'] not in ('Point','LineString','MultiLineString','Polygon','MultiPolygon'):
            raise ValueError('Location geometry requires an explicit mapping rule: '+feature['geometry']['type'])
        role=feature['properties'].get('display_role')
        if feature.get('geometry') and feature['geometry']['type'] in ('Polygon','MultiPolygon') and role!='country_context':
            raise ValueError('Location polygons must be explicitly country_context: '+feature['properties']['location_id'])
    links=data.get('links') or [{'event_id':e['id'],'location_id':lid} for e in events if e['id'] in valid_ids for lid in e.get('location_ids',[])]
    context_by_crossing={}
    for relation in data.get('crossing_contexts') or []:
        crossing_id=relation['location_id'];context_id=relation['context_location_id']
        if crossing_id in context_by_crossing and context_by_crossing[crossing_id]!=context_id:
            raise ValueError('Conflicting display context for crossing '+crossing_id)
        if crossing_id not in byid or context_id not in byid:
            raise ValueError('Unresolved crossing display-context relationship')
        if byid[crossing_id].get('geometry',{}).get('type')!='Point':
            raise ValueError('Crossing display context must refer to a point')
        if byid[context_id]['properties'].get('display_role')!='frontier_context':
            raise ValueError('Crossing display context must target frontier_context')
        context_by_crossing[crossing_id]=context_id
    original_pairs={(link['event_id'],link['location_id']) for link in links}
    added_context={}
    for link in links:
        crossing_id=link['location_id'];context_id=context_by_crossing.get(crossing_id)
        if not context_id or link['event_id'] not in valid_ids:continue
        key=(link['event_id'],context_id)
        # Existing source-context joins take precedence and are never duplicated.
        if key in original_pairs:continue
        if key not in added_context:
            added_context[key]={'event_id':key[0],'location_id':key[1],
                'coverage_role':'display context',
                'join_role':'crossing_frontier_display_context',
                'context_for_location_ids':[],
                'geography_note':'Frontier shown beneath a named crossing for geographic context. This display join does not alter the source classification or establish a whole-frontier closure or historical obstruction footprint.'}
        if crossing_id not in added_context[key]['context_for_location_ids']:
            added_context[key]['context_for_location_ids'].append(crossing_id)
    geometry_links=[(link,False) for link in links]+[(link,True) for link in added_context.values()]
    seen=set();eventfeatures=[];accepted_links=[];accepted_display_links=[]
    for link,is_display_context in geometry_links:
        key=(link['event_id'],link['location_id'])
        if key in seen:continue
        seen.add(key)
        if key[0] not in evmap or key[1] not in byid:raise ValueError(f'Unresolved event-location link {key}')
        e=evmap[key[0]];loc=byid[key[1]]
        if key[0] not in valid_ids or not loc.get('geometry'):continue
        if is_display_context:accepted_display_links.append(link)
        else:accepted_links.append(link)
        p=dict(e);p['event_id']=e['id'];p['location_id']=key[1];p['location_label']=loc['properties'].get('label',loc['properties'].get('name',''));p['geometry_precision']=loc['properties'].get('precision');p['geometry_source']=loc['properties'].get('source_url');p['geometry_note']=link.get('geography_note') or e.get('geography_note') or loc['properties'].get('review_note')
        p['display_role']=loc['properties'].get('display_role','crossing_reference')
        p['display_context_only']=True
        p['phase_geometry_approved']=False
        p['display_join_role']='crossing_frontier_display_context' if is_display_context else 'record_geography_reference'
        p['context_for_location_ids']=link.get('context_for_location_ids',[]) if is_display_context else []
        p['continents_text']='|'+'|'.join(e.get('continents') or [])+'|'
        p['start_dt']=None;p['end_dt']=None
        eventfeatures.append({'type':'Feature','properties':p,'geometry':loc['geometry']})
        # Generalized parent references never acquire phase intervals. A binding
        # is admitted only by the current workbook's separate Phase locations.
    approvedfeatures,intervalfeatures=approved_phase_features(events)
    rules=[('points','POINT',('Point',),False),('lines','MULTILINESTRING',('LineString','MultiLineString'),False),('context_lines','MULTILINESTRING',('LineString','MultiLineString'),True),('context_polygons','MULTIPOLYGON',('Polygon','MultiPolygon'),True)]
    for family,features in [('location',locations),('event',eventfeatures)]:
        for suffix,kind,allowed,contextual in rules:
            rows=[f for f in features if f.get('geometry') and f['geometry']['type'] in allowed and (f['properties'].get('display_role') in ('frontier_context','country_context'))==contextual]
            text='Reusable reference cartography; not an approved phase binding or closure footprint.' if family=='location' else 'Static record-geography references only, never approved phase geometry. Count distinct event_id; repeated geometries are not independent events.'
            if contextual:text+=' CONTEXT ONLY: the line or country outline locates recorded geography, not the extent of a closure. Generalized references are not time-active phase features.'
            ds.append(add_table(db,family+'_'+suffix,rows,text,kind))
    ds.append(add_table(db,'approved_phase_points',approvedfeatures,'Only current approved_approximate phase bindings. A marker is approximate and applies solely to the phase scope, traffic and direction. Static display does not assert a current or continuous closure. Hidden by default.','POINT'))
    ds.append(add_table(db,'interval_points',intervalfeatures,'Exact complete operational phases at approved approximate markers only; explicit observed reopening and exclusive endpoint required. Midnight is a calendar-date display convention, not a measured hour. All other evidence remains in chronology_phases. Hidden by default.','POINT'))
    ds.append(add_table(db,'events',[dict(e,event_id=e['id'],continents_text='|'+'|'.join(e.get('continents') or [])+'|') for e in events],'All normalized register rows, including excluded rows and rows without mapped geometry. Continents may be multiple; do not sum continent counts as a world total.'))
    ds.append(add_table(db,'chronology_phases',[dict(p,parent_included=e['id'] in valid_ids) for e in events for p in e.get('duration_periods',[])],'All current workbook phases, including missing dates, observations, held evidence and excluded-parent phases. Preserve explicit reopening and endpoint inclusion; do not add a day automatically or invent intervals. Never sum overlapping phases.'))
    for name,rows in (data.get('workbook_geography') or {}).items():
        ds.append(add_table(db,'workbook_'+name,rows,'Exact current workbook '+name.replace('_',' ')+' rows, including rejected and unlocated decisions.'))
    for name,rows in (data.get('workbook_review') or {}).items():
        ds.append(add_table(db,name,rows,'Current workbook '+name.replace('_',' ')+' rows. Initial/historical findings do not override subsequent corrections.'))
    ds.append(add_table(db,'event_location_links',accepted_links,'Generalized record-geography reference relationships for included records. These are not approved phase-coordinate bindings.'))
    ds.append(add_table(db,'event_display_context_links',accepted_display_links,'Display-only crossing-to-frontier joins, deduplicated against source event_location_links. These do not revise event scope or source evidence classifications.'))
    ds.append(add_table(db,'crossing_frontier_contexts',data.get('crossing_contexts') or [],'Reviewed location-to-frontier display relationships. Independent of event IDs; compiled only while geometry/country identity guards remain current.'))
    ds.append(add_table(db,'gazetteer',[dict(f['properties'],geometry_json=f.get('geometry')) for f in locations],'Reusable location registry and full provenance. Context geometries are distinguished explicitly from sourced crossing references.'))
    urls=[]
    for e in events:
        for source in e.get('sources',[]):urls.append(dict(source,event_id=e['id']))
    ds.append(add_table(db,'event_sources',urls,'Current record–URL source entries with complete labelled access histories. Shared reporting origins are not independent confirmations.'))
    ds.append(add_table(db,'release_metadata',[{'key':k,'value':v} for k,v in data['meta'].items()],'Release metadata, scope and audit summary.'))
    db.commit();db.close()
    for d in ds:d.update(layer_spec(d['table'],d['kind']))
    make_qgs(qgs,ds,data['meta'],gpkg.name)
    manifest={'meta':data['meta'],'gpkg':gpkg.name,'layers':ds,'qgs':qgs.name,'validation_note':'QGS XML and GeoPackage checked structurally; native QGIS rendering not run.'}
    (out/'gis_manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf8')
    report=validate(gpkg,qgs)
    report['register_records']=len(events);report['mapped_records']=len({f['properties']['event_id'] for f in eventfeatures});report['excluded_records']=len(events)-len(valid_ids)
    report['interval_mapped_records']=len({f['properties']['event_id'] for f in intervalfeatures})
    report['approved_phase_markers']=len(approvedfeatures)
    report['temporal_phase_features']=len(intervalfeatures)
    report['generalized_references_have_no_temporal_spans']=all(f['properties']['start_dt'] is None and f['properties']['end_dt'] is None for f in eventfeatures)
    assert report['generalized_references_have_no_temporal_spans']
    report['excluded_geometry_ids']=sorted({f['properties']['event_id'] for f in eventfeatures}-valid_ids)
    assert not report['excluded_geometry_ids']
    report['unique_event_location_pairs']=len(accepted_links)==len({(l['event_id'],l['location_id'])for l in accepted_links})
    report['added_display_context_joins']=len(accepted_display_links)
    report['display_context_deduplicated_against_source']=not ({(l['event_id'],l['location_id'])for l in accepted_links}&{(l['event_id'],l['location_id'])for l in accepted_display_links})
    report['source_event_location_joins']=len(accepted_links)
    report['crossing_frontier_display_relationships']=len(context_by_crossing)
    assert report['display_context_deduplicated_against_source']
    report['continent_filter']='continents_text LIKE %|Africa|% (substitute continent; memberships overlap)'
    (out/'gis_validation.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    for filename in ('GIS_README.txt',):
        shutil.copy2(Path(__file__).parent/filename,out/filename)
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('map_json',type=Path);parser.add_argument('output_directory',type=Path);args=parser.parse_args()
    data=json.loads(args.map_json.read_text(encoding='utf8'))
    print(json.dumps(build(data,args.output_directory),indent=2))
