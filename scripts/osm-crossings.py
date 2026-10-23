#!/usr/bin/env python3
"""Build review candidates from a local OSM extract, never closure evidence.

Requires osmium, shapely >= 2 and pyproj. Outputs are deliberately separate from
dist/data.js and the authoritative workbook. Run once per regional extract.
"""
import argparse
import csv
import gzip
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import osmium
from pyproj import CRS, Transformer, Geod
from shapely import transform as transform_geometry
from shapely.geometry import Point, LineString, mapping
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
MAJOR = {'motorway', 'trunk', 'primary', 'secondary'}
MAIN = {'motorway', 'trunk', 'primary'}
MINOR = {'tertiary', 'unclassified', 'residential', 'service', 'living_street', 'track'}
ROADS = MAJOR | MINOR | {v + '_link' for v in MAJOR | {'tertiary'}}
PLACES = {'city', 'town', 'village', 'hamlet'}


def transform(function, geometry):
    return transform_geometry(geometry, function, interleaved=False)


def normal(value):
    value = ''.join(c for c in unicodedata.normalize('NFKD', str(value)).casefold() if not unicodedata.combining(c))
    return re.sub(r'[^\w]+', ' ', value).strip()


def source(item):
    return {'osm_type': item.type_str(), 'osm_id': item.id, 'osm_version': item.version,
            'osm_timestamp': str(item.timestamp), 'tags': dict(item.tags),
            'osm_url': f'https://www.openstreetmap.org/{dict(n="node", w="way", r="relation")[item.type_str()]}/{item.id}'}


def country_code_of(tags):
    value = tags.get('ISO3166-1:alpha2', tags.get('ISO3166-1', ''))
    return value if re.fullmatch(r'[A-Z]{2}', value) else ''


class Boundaries(osmium.SimpleHandler):
    def __init__(self, country_code):
        super().__init__()
        self.country_code = country_code
        self.relations = {}
        self.way_relations = defaultdict(set)
        self.country_relations = defaultdict(list)
        self.country_ways = defaultdict(set)
        self.study_ways = set()

    def relation(self, item):
        tags = dict(item.tags)
        if tags.get('boundary') != 'administrative' or tags.get('admin_level') != '2':
            return
        code = country_code_of(tags)
        entry = {**source(item), 'member_way_ids': [], 'nested_boundary_members': []}
        self.relations[item.id] = entry
        if code:
            self.country_relations[code].append(item.id)
        for member in item.members:
            if member.role not in ('', 'outer', 'inner'):
                continue
            if member.type == 'r':
                entry['nested_boundary_members'].append(member.ref)
            if member.type == 'w':
                self.way_relations[member.ref].add(item.id)
                entry['member_way_ids'].append(member.ref)
                if code:
                    self.country_ways[code].add(member.ref)
                if code == self.country_code:
                    self.study_ways.add(member.ref)


class Geography(osmium.SimpleHandler):
    def __init__(self, boundary_ids, road_scope='main', exception_ids=(), include_nonroad=False,
                 context_borders=None, context_buffer_m=1500, boundary_only=False):
        super().__init__()
        self.boundary_ids = boundary_ids
        self.boundaries = []
        self.routes = []
        self.controls = []
        self.places = []
        self.incomplete_ways = []
        self.loaded_boundary_ids = set()
        self.maritime_boundary_ids = set()
        self.routes_inspected = 0
        self.boundary_only = boundary_only
        self.context_tree = STRtree(context_borders) if context_borders else None
        max_lat = max(abs(v) for b in context_borders for v in (b.bounds[1], b.bounds[3])) if context_borders else 0
        self.metres_per_degree_lower_bound = 100000 * math.cos(math.radians(max_lat))
        self.context_buffer_m = context_buffer_m
        self.context_envelope = unary_union(context_borders).bounds if context_borders else None
        self.road_classes = (ROADS if road_scope == 'all' else
                             MAJOR | {v + '_link' for v in MAJOR} if road_scope == 'major' else
                             MAIN | {v + '_link' for v in MAIN})
        self.exception_ids = set(exception_ids)
        self.include_nonroad = include_nonroad

    def node(self, item):
        if self.boundary_only or not item.location.valid():
            return
        tags = item.tags
        control = tags.get('barrier') == 'border_control' or tags.get('amenity') == 'customs'
        place = tags.get('place') in PLACES and tags.get('name')
        if control or place:
            point = Point(item.location.lon, item.location.lat)
            if self.context_tree is not None:
                radius = (5000 if control else 20000) / self.metres_per_degree_lower_bound
                if not len(self.context_tree.query(point, predicate='dwithin', distance=radius)):
                    return
            entry = {**source(item), 'geometry': point}
            if control:
                self.controls.append(entry)
            if place:
                self.places.append(entry)

    def way(self, item):
        tags = item.tags
        boundary = item.id in self.boundary_ids
        if boundary:
            self.loaded_boundary_ids.add(item.id)
            if tags.get('maritime') == 'yes':
                self.maritime_boundary_ids.add(item.id)
                boundary = False
        if self.boundary_only and not boundary:
            return
        highway = tags.get('highway', '')
        mode = ('road' if not self.boundary_only and highway in ROADS
                else 'rail' if self.include_nonroad and tags.get('railway') in {'rail', 'narrow_gauge', 'light_rail'}
                else 'ferry' if self.include_nonroad and tags.get('route') == 'ferry' else None)
        eligible = mode != 'road' or highway in self.road_classes or item.id in self.exception_ids
        if mode:
            self.routes_inspected += 1
        control = not self.boundary_only and (tags.get('barrier') == 'border_control' or tags.get('amenity') == 'customs')
        if not (boundary or mode or control):
            return
        coordinates, node_ids = [], []
        for node in item.nodes:
            if not node.location.valid():
                self.incomplete_ways.append(item.id)
                return
            coordinates.append((node.lon, node.lat))
            node_ids.append(node.ref)
        if len(coordinates) < 2:
            self.incomplete_ways.append(item.id)
            return
        radius = (5000 if control else self.context_buffer_m) / self.metres_per_degree_lower_bound
        if not boundary and self.context_envelope is not None:
            xs, ys = zip(*coordinates)
            a, b, c, d = self.context_envelope
            if max(xs) < a-radius or min(xs) > c+radius or max(ys) < b-radius or min(ys) > d+radius:
                return
        geometry = LineString(coordinates)
        near = self.context_tree is None or bool(len(self.context_tree.query(geometry, predicate='dwithin', distance=radius)))
        if not boundary and not near:
            return
        # Construct the expensive metadata only for retained frontier context.
        entry = {**source(item), 'geometry': geometry, 'nodes': node_ids}
        if boundary:
            self.boundaries.append(entry)
        if mode and near:
            self.routes.append({**entry, 'mode': mode, 'highway': highway, 'candidate_eligible': eligible,
                                'road_tier': 'major' if highway.replace('_link', '') in MAJOR else 'other'})
        if control:
            self.controls.append({**entry, 'geometry': geometry.interpolate(.5, normalized=True),
                                  'position_method': 'representative point on tagged way'})


def point_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Point':
        return [geometry]
    if geometry.geom_type in ('MultiPoint', 'GeometryCollection'):
        return [p for child in geometry.geoms for p in point_parts(child)]
    return []


def cluster_contacts(contacts, radius=75):
    """Group colocated lane/way contacts, retaining every raw contact and ID."""
    if not contacts:
        return []
    tree = STRtree([v['point'] for v in contacts])
    groups, used = [], set()
    for i, item in enumerate(contacts):
        if i in used:
            continue
        # Anchor radius rather than transitive chaining keeps groups compact.
        def restricted(contact):
            tags = contact['route'].get('tags', {})
            return any(tags.get(key) in {'private', 'no'} for key in ('access', 'vehicle', 'motor_vehicle'))

        group = [int(j) for j in tree.query(item['point'].buffer(radius))
                 if int(j) not in used and contacts[int(j)]['mode'] == item['mode']
                 and contacts[int(j)]['pair'] == item['pair']
                 and restricted(contacts[int(j)]) == restricted(item)
                 and contacts[int(j)]['point'].distance(item['point']) <= radius]
        # The representative must be the actual search anchor. STRtree query
        # order is not a distance order. Keep restricted tracks separate from
        # unrestricted/unspecified-access routes even when they are adjacent.
        group = [i] + sorted(j for j in group if j != i)
        used.update(group)
        groups.append([contacts[j] for j in group])
    return groups


def crosses_frontier(group):
    """Require road samples on both sides of a local boundary tangent.

    GEOS line.crosses(line) also accepts a V-shaped road touching a boundary at
    an interior vertex. Sampling both sides keeps those contacts qualified.
    """
    for contact in group:
        point, border = contact['point'], contact['border']['projected']
        distance = border.project(point)
        a = border.interpolate(max(0, distance - 2))
        b = border.interpolate(min(border.length, distance + 2))
        dx, dy = b.x - a.x, b.y - a.y
        length = (dx * dx + dy * dy) ** .5
        if length < .01:
            continue
        signs = []
        for route in {c['route']['osm_id']: c['route'] for c in group}.values():
            line = route['projected']
            if line.distance(point) > .25:
                continue
            along = line.project(point)
            for sample in (line.interpolate(max(0, along - 3)), line.interpolate(min(line.length, along + 3))):
                signs.append((dx * (sample.y - point.y) - dy * (sample.x - point.x)) / length)
        if signs and min(signs) < -.1 and max(signs) > .1:
            return True
    return False


def names(entry):
    tags = entry['tags']
    return sorted({v.strip() for key in ('name', 'name:en', 'alt_name', 'official_name', 'short_name')
                   for v in tags.get(key, '').split(';') if v.strip()})


def json_write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def csv_write(path, rows, fields):
    with path.open('w', newline='', encoding='utf-8-sig') as file:
        writer = csv.DictWriter(file, fieldnames=fields, extrasaction='ignore', quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for row in rows:
            values = {k: json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v for k, v in row.items()}
            values = {k: "'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@')) else v for k, v in values.items()}
            writer.writerow(values)


def select_frontier(boundaries, country_code, neighbour_code=None):
    codes = [country_code] + ([neighbour_code] if neighbour_code else [])
    if neighbour_code == country_code:
        raise ValueError('Country and neighbour codes must differ')
    for code in codes:
        matches = boundaries.country_relations.get(code, [])
        if len(matches) != 1:
            raise ValueError(f'Expected one admin-level-2 country relation for {code}; found {len(matches)}')
    selected = boundaries.country_ways[country_code]
    if neighbour_code:
        selected = selected & boundaries.country_ways[neighbour_code]
    if not selected:
        raise ValueError('No shared admin-level-2 memberways for selected country pair')
    return set(selected)


def regional_projection(geometries, supplied=None):
    coords = [xy for geometry in geometries for xy in geometry.coords]
    if not coords:
        raise ValueError('No selected frontier geometry')
    if any(abs(a[0]-b[0]) > 180 for geometry in geometries for a,b in zip(geometry.coords, list(geometry.coords)[1:])):
        raise ValueError('Antimeridian-crossing geometry is unsupported; split and unwrap explicitly')
    xs, ys = zip(*coords)
    if max(xs)-min(xs) > 180 or max(abs(y) for y in ys) >= 85:
        raise ValueError('Unsupported antimeridian/polar extent; select a smaller corridor')
    centre = unary_union(geometries).envelope.centroid
    geod = Geod(ellps='WGS84')
    radius = max(geod.inv(centre.x, centre.y, x, y)[2] for x,y in coords)
    if radius > 2500000:
        raise ValueError('Selected frontier exceeds 2,500 km projection radius; split into regional corridors')
    metric = CRS.from_user_input(supplied) if supplied else CRS.from_proj4(
        f'+proj=aeqd +lat_0={centre.y} +lon_0={centre.x} +datum=WGS84 +units=m +no_defs')
    if not metric.is_projected or not metric.axis_info or any(abs(a.unit_conversion_factor-1) > 1e-9 for a in metric.axis_info):
        raise ValueError('--metric-crs must be a projected CRS with metre units')
    return metric, {'centre':[centre.x,centre.y], 'max_geodesic_radius_m':round(radius,1),
                    'projection_scope':'selected frontier geometry only','antimeridian_supported':False}


def country_info(boundaries, boundary_ids):
    values = []
    for rid in sorted({rid for bid in boundary_ids for rid in boundaries.way_relations[bid]}):
        tags = boundaries.relations[rid]['tags']
        code = country_code_of(tags)
        if code:
            values.append({'osm_relation_id':rid,'name':tags.get('name:en',tags.get('name','')),'iso2':code})
    return values


def build(args):
    extractor_sha256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    if (out / 'crossing-candidates.geojson').exists() and not getattr(args, 'allow_overwrite', False):
        raise ValueError('Output already contains an extraction; use a new snapshot directory or --allow-overwrite explicitly')
    data = json.loads(args.data.read_text().removeprefix('window.BORDER_DATA = ').rstrip().removesuffix(';'))
    records = [e for e in data['events'] if not e.get('quarantined')]
    with args.pbf.open('rb') as stream:
        actual_sha256 = hashlib.file_digest(stream, 'sha256').hexdigest()
    source_info = json.loads(args.download_manifest.read_text()) if args.download_manifest else {'file':args.pbf.name}
    if source_info.get('sha256') and source_info['sha256'] != actual_sha256:
        raise ValueError('Download manifest checksum does not match supplied extract')
    source_info['sha256'] = actual_sha256
    boundaries = Boundaries(args.country_code)
    print('Reading country boundary memberships…', flush=True)
    boundaries.apply_file(str(args.pbf), filters=[osmium.filter.EntityFilter(osmium.osm.RELATION)])
    neighbour = getattr(args, 'neighbour_code', None)
    selected_ids = select_frontier(boundaries, args.country_code, neighbour)
    road_scope = getattr(args, 'road_scope', 'main')
    exception_path = getattr(args, 'road_exceptions', None)
    exceptions = json.loads(exception_path.read_text())['exceptions'] if exception_path else []
    if any(not e.get('source_urls') or not e.get('reason') or not e.get('route_osm_ids') for e in exceptions):
        raise ValueError('Every targeted road exception needs route IDs, a reason and source URLs')
    exception_ids = {wid for e in exceptions for wid in e['route_osm_ids']}
    print('Reading selected frontier geometry and checking member coverage…', flush=True)
    boundary_geo = Geography(selected_ids, boundary_only=True)
    boundary_geo.apply_file(str(args.pbf), locations=True, idx='flex_mem', filters=[osmium.filter.EntityFilter(osmium.osm.WAY)])
    missing = sorted(selected_ids - boundary_geo.loaded_boundary_ids)
    incomplete = sorted(set(boundary_geo.incomplete_ways) & selected_ids)
    selected_relations = [rid for code in [args.country_code, neighbour] if code for rid in boundaries.country_relations[code]]
    nested = [{'country_relation_id':rid,'member_relation_ids':boundaries.relations[rid]['nested_boundary_members']}
              for rid in selected_relations if boundaries.relations[rid]['nested_boundary_members']]
    partial = bool(missing or incomplete or nested)
    coverage = {'selected_by':'shared_admin2_memberways' if neighbour else 'country_admin2_memberways',
                'country_pair':sorted([args.country_code,neighbour]) if neighbour else None,
                'expected_member_count':len(selected_ids),'loaded_member_count':len(boundary_geo.loaded_boundary_ids),
                'non_maritime_geometry_count':len(boundary_geo.boundaries),
                'excluded_maritime_member_ids':sorted(boundary_geo.maritime_boundary_ids),
                'missing_member_ids':missing,'incomplete_member_ids':incomplete,
                'unsupported_nested_boundary_members':nested,'is_partial':partial,
                'allows_frontier_completeness_claim':False,
                'status':'partial_member_geometry' if partial else 'all_selected_osm_members_loaded'}
    if partial and not getattr(args, 'allow_partial_boundary', False):
        json_write(out / 'coverage.json', coverage)
        raise ValueError('Incomplete or nested selected frontier; supply adjacent complete extracts or explicitly use --allow-partial-boundary')
    if not boundary_geo.boundaries:
        raise ValueError('No complete non-maritime selected frontier ways in extract')
    shapes = [b['geometry'] for b in boundary_geo.boundaries]
    metric, projection_info = regional_projection(shapes, args.metric_crs)
    context_buffer = getattr(args, 'context_buffer_metres', 1500)
    if context_buffer < 1500:
        raise ValueError('Connected graph context must extend at least 1,500 m from the selected frontier')
    geo = Geography(set(), road_scope, exception_ids, getattr(args, 'include_nonroad', False), shapes, context_buffer)
    print('Reading roads, boundaries, checkpoints and settlements…', flush=True)
    node_filter = osmium.filter.KeyFilter('barrier', 'amenity', 'place').enable_for(osmium.osm.NODE)
    way_keys = ['highway', 'barrier', 'amenity']
    if getattr(args, 'include_nonroad', False):
        way_keys.extend(['railway', 'route'])
    way_filter = osmium.filter.KeyFilter(*way_keys).enable_for(osmium.osm.WAY)
    geo.apply_file(str(args.pbf), locations=True, idx='flex_mem', filters=[
        osmium.filter.EntityFilter(osmium.osm.NODE | osmium.osm.WAY), node_filter, way_filter])
    # Reuse the audited first-pass boundary geometry. The road pass can then
    # filter unrelated ways in C++ without losing untagged boundary members.
    geo.boundaries = boundary_geo.boundaries
    forward = Transformer.from_crs('EPSG:4326', metric, always_xy=True).transform
    backward = Transformer.from_crs(metric, 'EPSG:4326', always_xy=True).transform
    # Intersect original OSM coordinates before projection. Reprojecting only
    # segment endpoints can separate a shared tangent/contact from its boundary.
    geographic_tree = STRtree([b['geometry'] for b in geo.boundaries])
    routes_inspected = geo.routes_inspected
    for entry in geo.boundaries + geo.routes + geo.controls + geo.places:
        entry['projected'] = transform(forward, entry['geometry'])
    border_shapes = [b['projected'] for b in geo.boundaries]
    border_tree, border_union = STRtree(border_shapes), unary_union(border_shapes)
    graph_routes = [r for r in geo.routes if r['projected'].distance(border_union) <= context_buffer]
    geo.routes = [r for r in graph_routes if r['candidate_eligible'] and len(geographic_tree.query(r['geometry'], predicate='intersects'))]
    contacts, overlaps, evidence_routes = [], [], set()

    print(f'Intersecting {len(geo.routes):,} routes meeting the boundary, from {routes_inspected:,} routes inspected…', flush=True)
    for route in geo.routes:
        for j in geographic_tree.query(route['geometry'], predicate='intersects'):
            evidence_routes.add(route['osm_id'])
            border = geo.boundaries[int(j)]
            geometry = route['geometry'].intersection(border['geometry'])
            pair = tuple(c['osm_relation_id'] for c in country_info(boundaries, [border['osm_id']]))
            if transform(forward, geometry).length > .05:
                overlaps.append({'route_osm_id': route['osm_id'], 'boundary_osm_id': border['osm_id'],
                                 'mode': route['mode'], 'reason': 'route overlaps boundary; not treated as a crossing'})
            for point in point_parts(geometry):
                contacts.append({'point': transform(forward, point), 'point_wgs84': point, 'route': route, 'border': border,
                                 'mode': route['mode'], 'pair': pair})
                evidence_routes.add(route['osm_id'])

    controls = [c for c in geo.controls if c['projected'].distance(border_union) <= 3000]
    places = [p for p in geo.places if p['projected'].distance(border_union) <= 15000]
    used_controls = set()
    candidates = []
    groups = cluster_contacts(contacts, args.cluster_metres)
    study_names = {normal(r['tags'].get('name:en', r['tags'].get('name', '')))
                   for r in boundaries.relations.values()
                   if r['tags'].get('ISO3166-1:alpha2', r['tags'].get('ISO3166-1')) == args.country_code}

    def emit(point, group, attached, kind):
        nearby_all = sorted([(point.distance(p['projected']), p) for p in places if point.distance(p['projected']) <= 10000], key=lambda pair: pair[0])
        nearest_town = next((item for item in nearby_all if item[1]['tags'].get('place') in {'city', 'town'}), None)
        nearby = nearby_all[:5]
        # Dense village naming must not push the nearest town out of the match
        # candidates, as at Malaba. Keep its identity and distance explicit.
        if nearest_town and all(p['osm_id'] != nearest_town[1]['osm_id'] for _, p in nearby):
            nearby = sorted(nearby[:4] + [nearest_town], key=lambda pair: pair[0])
        routes = {c['route']['osm_id']: c['route'] for c in group}
        borders = {c['border']['osm_id']: c['border'] for c in group}
        if not borders:
            closest = geo.boundaries[int(border_tree.nearest(point))]
            borders[closest['osm_id']] = closest
        countries = country_info(boundaries, borders)
        ll = transform(backward, point)
        osm_ids = sorted(routes) if routes else sorted(c['osm_id'] for _, c in attached)
        mode = group[0]['mode'] if group else 'checkpoint'
        fingerprint = json.dumps([mode, osm_ids, round(ll.x, 5), round(ll.y, 5)])
        candidate_id = 'osm-' + hashlib.sha256(fingerprint.encode()).hexdigest()[:16]
        label_place = nearest_town[1] if nearest_town and nearest_town[0] <= 5000 else nearby[0][1] if nearby else None
        nearest_name = label_place['tags'].get('name:en', label_place['tags'].get('name')) if label_place else ''
        label = ('Road–border contact' if mode == 'road' else 'Rail–border contact' if mode == 'rail' else 'Ferry–border contact' if mode == 'ferry' else 'Tagged checkpoint') + (' near ' + nearest_name if nearest_name else '')
        flags = ['current_reference_only', 'closure_scope_not_assigned', 'manual_review_required']
        if partial:
            flags.append('partial_frontier_coverage')
        if len(countries) != 2:
            flags.append('country_pair_incomplete_or_ambiguous')
        if any(b['tags'].get('disputed') == 'yes' or b['tags'].get('boundary') == 'disputed' for b in borders.values()):
            flags.append('disputed_boundary')
        if any(r['tags'].get('access') in {'no', 'private'} or r['tags'].get('motor_vehicle') == 'no' for r in routes.values()):
            flags.append('osm_access_restriction')
        if group and not crosses_frontier(group):
            flags.append('endpoint_or_tangent_contact')
        controls_out = [{**{k: v for k, v in c.items() if k not in ('geometry', 'projected')},
                         'distance_m': round(distance), 'coordinate': list(c['geometry'].coords)[0],
                         'association': 'proximity only; not verified as the same crossing'} for distance, c in attached]
        places_out = [{'name': p['tags'].get('name:en', p['tags'].get('name')), 'osm_id': p['osm_id'],
                       'osm_url': p['osm_url'], 'distance_m': round(distance), 'place_type': p['tags'].get('place'),
                       'coordinate': list(p['geometry'].coords)[0]} for distance, p in nearby]
        matches = []
        name_sources = [(n, 'checkpoint name') for _, c in attached for n in names(c)] + [(n, 'nearby settlement') for _, p in nearby for n in names(p)]
        for record in records:
            record_countries = {normal(c) for c in record.get('countries', [])}
            if not study_names.intersection(record_countries):
                continue
            if len(countries) == 2 and not {normal(c['name']) for c in countries}.issubset(record_countries):
                continue
            crossing_text = ' ' + normal(record.get('crossings', '')) + ' '
            matched = sorted({(name, origin) for name, origin in name_sources
                              if len(normal(name)) >= 4 and ' ' + normal(name) + ' ' in crossing_text})
            if matched:
                wording = ' '.join(str(record.get(k, '')) for k in ('title', 'crossings', 'movement')).lower()
                mode_note = 'Road-specific wording; this candidate is ' + mode if mode in {'rail', 'ferry'} and re.search(r'\b(truck|trucks|lorry|lorries|road)\b', wording) else 'Transport mode and affected movement require review'
                # A town name near a boundary is a research lead, not an event
                # location. Homonyms at Elegu and Busanza made this distinction
                # consequential in the first Uganda pilot. Accepted links are
                # built separately from sourced, reviewed crossing identities.
                matches.append({'record_id': record['id'], 'names': matched,
                                'status': 'discovery_only_not_event_link',
                                'transport_qualification': mode_note,
                                'eligible_for_automatic_acceptance': False})
        tiers = sorted({r['road_tier'] for r in routes.values() if r['mode'] == 'road'})
        properties = {'candidate_id': candidate_id, 'label': label, 'candidate_kind': kind, 'mode': mode,
                      'country_relations': countries,
                      'boundary_relation_provenance': sorted({rid for bid in borders for rid in boundaries.way_relations[bid]}),
                      'highway_classes': sorted({r['highway'] for r in routes.values() if r['highway']}),
                      'road_tiers': tiers, 'route_osm_ids': sorted(routes), 'boundary_osm_ids': sorted(borders),
                      'route_names': sorted({r['tags'].get('name', '') for r in routes.values()} - {''}),
                      'route_refs': sorted({r['tags'].get('ref', '') for r in routes.values()} - {''}),
                      'raw_contact_count': len(group), 'cluster_radius_m': args.cluster_metres,
                      'raw_contacts': [{'coordinate': list(c['point_wgs84'].coords)[0],
                                        'route_osm_id': c['route']['osm_id'], 'boundary_osm_id': c['border']['osm_id']}
                                       for c in group],
                      'checkpoints': controls_out, 'nearby_settlements': places_out,
                      'workbook_name_suggestions': matches,
                      'workbook_candidate_links': [], 'review_flags': flags,
                      'is_verified_crossing': False, 'is_closure_evidence': False,
                      'coordinate_method': 'representative raw road/border contact' if group else attached[0][1].get('position_method', 'OSM tagged node'),
                      'attribution': '© OpenStreetMap contributors', 'licence': 'ODbL 1.0'}
        candidates.append({'type': 'Feature', 'id': candidate_id, 'geometry': mapping(ll), 'properties': properties})

    for group in groups:
        point = group[0]['point']
        attached = sorted([(point.distance(c['projected']), c) for c in controls if point.distance(c['projected']) <= 1500], key=lambda pair: pair[0])
        used_controls.update((c['osm_type'], c['osm_id']) for _, c in attached)
        emit(point, group, attached, 'transport_border_intersection')
    for control in controls:
        if road_scope == 'all' and (control['osm_type'], control['osm_id']) not in used_controls:
            emit(control['projected'], [], [(0, control)], 'tagged_control_without_transport_intersection')

    candidates.sort(key=lambda f: f['id'])
    json_write(out / 'crossing-candidates.geojson', {'type': 'FeatureCollection', 'features': candidates})
    rows = []
    for feature in candidates:
        p = feature['properties']
        rows.append({**p, 'longitude': feature['geometry']['coordinates'][0], 'latitude': feature['geometry']['coordinates'][1],
                     'countries': [c['name'] for c in p['country_relations']],
                     'nearest_settlement': p['nearby_settlements'][0]['name'] if p['nearby_settlements'] else '',
                     'nearest_settlement_m': p['nearby_settlements'][0]['distance_m'] if p['nearby_settlements'] else '',
                     'discovery_record_ids': [m['record_id'] for m in p['workbook_name_suggestions']],
                     'record_ids': []})
    csv_write(out / 'crossing-candidates.csv', rows, ['candidate_id', 'label', 'mode', 'candidate_kind', 'longitude', 'latitude', 'countries', 'highway_classes', 'road_tiers', 'route_refs', 'route_osm_ids', 'boundary_osm_ids', 'nearest_settlement', 'nearest_settlement_m', 'checkpoints', 'discovery_record_ids', 'record_ids', 'review_flags'])
    csv_write(out / 'major-road-candidates.csv', [r for r in rows if 'major' in r['road_tiers']], ['candidate_id', 'label', 'longitude', 'latitude', 'countries', 'highway_classes', 'route_refs', 'route_osm_ids', 'nearest_settlement', 'nearest_settlement_m', 'discovery_record_ids', 'record_ids', 'review_flags'])
    point_features = {f['properties']['location_id']: f for f in data['locations']['features'] if f['geometry']['type'] == 'Point'}
    links = defaultdict(set)
    for link in data.get('links', []):
        links[link['event_id']].add(link['location_id'])
    audit = []
    for record in records:
        point_ids = sorted((set(record.get('location_ids', [])) | links[record['id']]) & set(point_features))
        matches = [f['id'] for f in candidates if any(m['record_id'] == record['id'] for m in f['properties']['workbook_name_suggestions'])]
        audit.append({'record_id': record['id'], 'title': record['title'], 'countries': record.get('countries', []),
                      'crossings_verbatim': record.get('crossings', ''), 'existing_point_ids': point_ids,
                      'discovery_candidate_ids': matches, 'pilot_candidate_ids': [],
                      'status': 'existing point reference retained' if point_ids else 'discovery suggestion only; source review required' if matches else 'no point reference; crossing text needs review'})
    csv_write(out / 'workbook-location-audit.csv', audit, list(audit[0]))
    json_write(out / 'boundary-overlaps.json', overlaps)
    evidence = []
    for item in geo.boundaries + [r for r in geo.routes if r['osm_id'] in evidence_routes] + controls + places:
        evidence.append({'type': 'Feature', 'geometry': mapping(item['geometry']),
                         'properties': {k: v for k, v in item.items() if k not in ('geometry', 'projected')}})
    with gzip.open(out / 'osm-reference-evidence.geojson.gz', 'wt', encoding='utf-8') as file:
        json.dump({'type': 'FeatureCollection', 'features': evidence}, file, ensure_ascii=False)
    json_write(out / 'osm-country-relations.json', boundaries.relations)
    with osmium.io.Reader(str(args.pbf)) as reader:
        header = reader.header()
        osm_timestamp = header.get('osmosis_replication_timestamp')
    graph_context = {'schema_version':2,'source_sha256':actual_sha256,'osm_timestamp':osm_timestamp,
                     'metric_crs':metric.to_string(),'buffer_m':context_buffer,
                     'country_code':args.country_code,'neighbour_code':neighbour,'coverage':coverage,
                     'routes_inspected':routes_inspected,'incomplete_way_ids':geo.incomplete_ways,
                     'routes':[{**{k:r[k] for k in ('osm_id','osm_version','osm_timestamp','tags','mode','nodes')},
                                'coordinates':list(r['geometry'].coords),'candidate_eligible':r['candidate_eligible']}
                               for r in graph_routes]}
    with gzip.open(out / 'osm-graph-context.json.gz','wt',encoding='utf-8') as file:
        json.dump(graph_context,file,ensure_ascii=False)
    json_write(out / 'coverage.json', coverage)
    summary = {'created_at': datetime.now(timezone.utc).isoformat(), 'country_code': args.country_code,
               'extractor_sha256':extractor_sha256,'neighbour_code':neighbour,'source':source_info,
               'osm_data_timestamp': osm_timestamp, 'workbook_sha256': data['meta']['source_sha256'],
               'metric_crs': metric.to_string(), 'projection':projection_info,'coverage':coverage,
               'boundary_ways_in_country_relation':len(boundaries.country_ways[args.country_code]),
               'boundary_ways_selected':len(selected_ids),'connected_context_routes':len(graph_routes),
               'boundary_ways_loaded': len(geo.boundaries), 'incomplete_way_ids': geo.incomplete_ways,
               'routes_inspected': routes_inspected, 'raw_intersection_points': len(contacts),
               'candidate_count': len(candidates), 'by_mode': dict(Counter(f['properties']['mode'] for f in candidates)),
               'major_road_candidates': sum('major' in f['properties']['road_tiers'] for f in candidates),
               'tagged_controls_near_boundary': len(controls), 'linear_overlap_cases': len(overlaps),
               'records_with_existing_points': sum(bool(r['existing_point_ids']) for r in audit),
               'schema_version': 3,
               'road_scope': road_scope, 'road_classes': sorted(geo.road_classes),
               'targeted_road_exceptions': exceptions,
               'include_nonroad': getattr(args, 'include_nonroad', False),
               'records_with_name_discovery_suggestions': sum(bool(r['discovery_candidate_ids']) for r in audit),
               'discovery_record_ids': [r['record_id'] for r in audit if r['discovery_candidate_ids']],
               'records_with_pilot_candidate_links': 0,
               'matched_record_ids': [],
               'limits': ['Coverage is restricted to selected OSM frontier geometry; loaded memberways do not establish crossing completeness.',
                          'Graph context includes minor/service roads; they become candidates only through explicit sourced exceptions.',
                          'Missing and nested boundary members require explicit partial opt-in; antimeridian/polar/overwide projections are unsupported.',
                          'Geometric contacts are candidates, not proof of a legal, operational or historical crossing.',
                          'Nearby settlement names are separate from checkpoint names.',
                          'Road-only extraction omits informal pedestrian paths; rail and ferry candidates are separate.',
                          'OSM country relations may be incomplete in extracts; unresolved country pairs are flagged.',
                          'Current OSM geometry cannot establish which crossing was affected by a historical closure.',
                          'No candidate is added to the closure register or the displayed map.']}
    json_write(out / 'summary.json', summary)
    print(json.dumps({k: v for k, v in summary.items() if k not in ('metric_crs', 'limits', 'incomplete_way_ids')}, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pbf', type=Path, required=True)
    parser.add_argument('--country-code', required=True)
    parser.add_argument('--neighbour-code', help='Select actual shared admin-level-2 country memberways')
    parser.add_argument('--allow-partial-boundary', action='store_true', help='Explicitly process available boundary members, retaining coverage qualification')
    parser.add_argument('--context-buffer-metres', type=float, default=1500)
    parser.add_argument('--data', type=Path, default=ROOT / 'dist/data.js')
    parser.add_argument('--download-manifest', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cluster-metres', type=float, default=75)
    parser.add_argument('--metric-crs')
    parser.add_argument('--allow-overwrite', action='store_true', help='Explicitly replace an existing extraction output')
    parser.add_argument('--road-scope', choices=['main', 'major', 'all'], default='main',
                        help='Default main: motorway/trunk/primary. Major adds secondary; all is legacy exploratory coverage.')
    parser.add_argument('--road-exceptions', type=Path, help='Explicit sourced road IDs for named-workbook or documented major-post exceptions')
    parser.add_argument('--include-nonroad', action='store_true', help='Opt in to separate rail/ferry reference candidates')
    build(parser.parse_args())
