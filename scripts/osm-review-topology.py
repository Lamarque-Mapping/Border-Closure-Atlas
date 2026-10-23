#!/usr/bin/env python3
"""Conservative topology review of saved OSM crossing-candidate snapshots.

This diagnoses physical connectivity, never legal crossing status or closure
evidence. Fresh regional runs consume the extraction's saved graph context;
the frozen Uganda method can also rebuild context from its original PBF.
Original candidates remain immutable; joins use actual shared OSM node IDs.
"""
import argparse
import csv
import gzip
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import osmium
from pyproj import Transformer
from shapely import contains, distance, points, prepare, transform
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import linemerge, polygonize, substring, unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
MAJOR = {'motorway', 'trunk', 'primary', 'secondary'}
ROADS = MAJOR | {'tertiary', 'unclassified', 'residential', 'service', 'living_street', 'track'}
ROADS |= {v + '_link' for v in MAJOR | {'tertiary'}}
DEFAULTS = {'boundary_band_m': 30.0, 'sample_step_m': 20.0,
            'stable_run_m': 100.0, 'max_trace_m': 1000.0,
            'context_buffer_m': 1500.0, 'max_branches': 12,
            'repeat_window_m': 5000.0, 'repeat_min_contacts': 3,
            'continuation_policy': 'all_connected_same_mode_branches'}


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def write_csv(path, rows, fields):
    with path.open('w', encoding='utf-8-sig', newline='') as fh:
        writer = csv.DictWriter(fh, fields, extrasaction='ignore', quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for row in rows:
            vals = {k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v for k, v in row.items()}
            writer.writerow({k: "'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@')) else v for k, v in vals.items()})


def point_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Point':
        return [geometry]
    if geometry.geom_type in {'MultiPoint', 'GeometryCollection'}:
        return [p for child in geometry.geoms for p in point_parts(child)]
    return []


def mode_of(tags):
    if tags.get('highway') in ROADS:
        return 'road'
    if tags.get('railway') in {'rail', 'narrow_gauge', 'light_rail'}:
        return 'rail'
    if tags.get('route') == 'ferry':
        return 'ferry'
    return None


class GraphContext(osmium.SimpleHandler):
    """Read full near-frontier ways and actual node IDs from the frozen PBF."""
    def __init__(self, borders, forward, config):
        super().__init__()
        self.border_tree = STRtree(borders)
        self.forward = forward
        self.config = config
        self.routes = []
        self.inspected = 0
        self.incomplete = []

    def way(self, way):
        mode = mode_of(way.tags)
        if not mode:
            return
        self.inspected += 1
        if len(way.nodes) < 2 or any(not n.location.valid() for n in way.nodes):
            self.incomplete.append(way.id)
            return
        ll = [(n.lon, n.lat) for n in way.nodes]
        geographic = LineString(ll)
        # Conservative degree prefilter for this bounded equatorial pilot.
        # Exact selection follows in metres. Not an antimeridian/global method.
        if not len(self.border_tree.query(geographic, predicate='dwithin', distance=.025)):
            return
        self.routes.append({'osm_id': way.id, 'osm_version': way.version,
                            'osm_timestamp': str(way.timestamp), 'tags': dict(way.tags),
                            'mode': mode, 'nodes': [n.ref for n in way.nodes],
                            'coordinates': ll})


class Topology:
    def __init__(self, polygon, borders, routes, config=None):
        self.config = {**DEFAULTS, **(config or {})}
        self.polygon = polygon
        if self.polygon is not None:
            prepare(self.polygon)
        self.borders = borders
        self.tree = STRtree(borders)
        merged = unary_union(borders)
        if merged.geom_type != 'LineString':
            merged = linemerge(merged)
        self.components = [merged] if merged.geom_type == 'LineString' else list(merged.geoms)
        self.component_tree = STRtree(self.components)
        self.active_component = None
        self.routes = {r['osm_id']: r for r in routes}
        self.node_routes = defaultdict(list)
        for route in routes:
            if 'line' not in route:
                route['line'] = LineString(route['coordinates'])
            coords = list(route['line'].coords)
            cumulative = [0.0]
            for a, b in zip(coords, coords[1:]):
                cumulative.append(cumulative[-1] + Point(a).distance(Point(b)))
            route['cumulative'] = cumulative
            for index, node in enumerate(route['nodes']):
                self.node_routes[(route['mode'], node)].append((route['osm_id'], index))

    def sides(self, coordinates):
        if not coordinates:
            return []
        pts = points(coordinates)
        indices = self.tree.nearest(pts)
        gaps = distance(pts, [self.borders[int(i)] for i in indices])
        if self.polygon is not None:
            inside = contains(self.polygon, pts)
            return [(0 if d <= self.config['boundary_band_m'] else 1 if ins else -1, float(d))
                    for d, ins in zip(gaps, inside)]
        result = []
        component_indices = self.component_tree.nearest(pts)
        for xy, gap, component_index in zip(coordinates, gaps, component_indices):
            gap, component_index = float(gap), int(component_index)
            if gap <= self.config['boundary_band_m']:
                result.append((0, gap))
                continue
            if self.active_component is not None and component_index != self.active_component:
                result.append((0, gap))
                continue
            line = self.components[component_index]
            point = Point(xy)
            at = line.project(point)
            if not line.is_ring and (at <= .01 or at >= line.length - .01):
                result.append((0, gap))
                continue
            before, after = line.interpolate(max(0, at - 2)), line.interpolate(min(line.length, at + 2))
            anchor = line.interpolate(at)
            dx, dy = after.x - before.x, after.y - before.y
            cross = dx * (point.y - anchor.y) - dy * (point.x - anchor.x)
            result.append((1 if cross > 0 else -1 if cross < 0 else 0, gap))
        return result

    def continuation_options(self, route, direction):
        node = route['nodes'][-1 if direction == 1 else 0]
        options = []
        for wid, idx in self.node_routes[(route['mode'], node)]:
            if wid == route['osm_id']:
                continue
            nxt = self.routes[wid]
            for d in (-1, 1):
                if (d < 0 and idx == 0) or (d > 0 and idx == len(nxt['nodes']) - 1):
                    continue
                options.append((wid, nxt['cumulative'][idx], d))
        # References change at international frontiers. Filtering alternatives
        # by a same-numbered approach incorrectly rejected the MEX 2 branch at
        # Santa Teresa in favour of the returning NM 136 carriageway. Modern
        # runs retain every connected same-mode branch; divergent sides stay
        # unresolved. The frozen Uganda method remains explicitly replayable.
        if self.config['continuation_policy'] == 'legacy_ref_name_preference':
            for key in ('ref', 'name'):
                value = route['tags'].get(key)
                same = [o for o in options if value and self.routes[o[0]]['tags'].get(key) == value]
                if same:
                    return same
        return options

    def interior_junction(self, route, along, direction, available):
        """Stop at a connected interior node before silently passing its fork."""
        if self.config['continuation_policy'] == 'legacy_ref_name_preference':
            return None
        choices = []
        for index, (node, at) in enumerate(zip(route['nodes'], route['cumulative'])):
            step = direction * (at - along)
            if not (1e-6 < step <= available) or index in (0, len(route['nodes']) - 1):
                continue
            if any(wid != route['osm_id'] for wid, _ in self.node_routes[(route['mode'], node)]):
                choices.append((step, index))
        return min(choices) if choices else None

    def junction_options(self, route, index, direction):
        """Keep the forward segment and every same-mode way at this OSM node."""
        options = [(route['osm_id'], route['cumulative'][index], direction)]
        node = route['nodes'][index]
        for wid, idx in self.node_routes[(route['mode'], node)]:
            if wid == route['osm_id']:
                continue
            nxt = self.routes[wid]
            for direct in (-1, 1):
                if (direct < 0 and idx == 0) or (direct > 0 and idx == len(nxt['nodes']) - 1):
                    continue
                options.append((wid, nxt['cumulative'][idx], direct))
        return options

    def trace_arm(self, route_id, start, direction):
        cfg = self.config
        queue = [(route_id, start, direction, 0., 0, 0., [], set())]
        results, expanded = [], 0
        while queue:
            wid, along, direct, travelled, run_side, run, used, visited = queue.pop(0)
            route = self.routes[wid]
            state = (wid, direct) if cfg['continuation_policy'] == 'legacy_ref_name_preference' else (wid, round(along, 6), direct)
            if state in visited:
                results.append({'side': 0, 'reason': 'loop', 'route_osm_ids': used, 'distance_m': round(travelled, 1)})
                continue
            visited = visited | {state}
            used = used + [wid]
            line = route['line']
            remaining = line.length - along if direct == 1 else along
            available = min(remaining, cfg['max_trace_m'] - travelled)
            junction = self.interior_junction(route, along, direct, available)
            if junction is not None:
                available = junction[0]
            count = max(1, int(available / cfg['sample_step_m']) + 1)
            steps = [min((i + 1) * cfg['sample_step_m'], available) for i in range(count)]
            steps += [direct * (at - along) for at in route['cumulative']
                      if 0 < direct * (at - along) < available]
            steps = sorted(set(steps))
            coords = [line.interpolate(along + direct * s).coords[0] for s in steps]
            reached = False
            previous_step = 0.
            for step, (side, gap) in zip(steps, self.sides(coords)):
                delta = step - previous_step
                previous_step = step
                # A run starts at the first clear sample; do not count the
                # preceding boundary-band interval towards clear continuation.
                run = run + delta if side and side == run_side else 0.
                run_side = side
                if run >= cfg['stable_run_m']:
                    results.append({'side': side, 'reason': 'stable_country_side',
                                    'route_osm_ids': used, 'distance_m': round(travelled + step, 1),
                                    'clear_run_m': round(run, 1), 'boundary_clearance_m': round(gap, 1)})
                    reached = True
                    break
            if reached:
                continue
            travelled += available
            if travelled >= cfg['max_trace_m'] - .01:
                results.append({'side': 0, 'reason': 'trace_limit_without_stable_side', 'route_osm_ids': used,
                                'distance_m': round(travelled, 1)})
                continue
            options = self.junction_options(route, junction[1], direct) if junction is not None else self.continuation_options(route, direct)
            if not options:
                results.append({'side': 0, 'reason': 'route_endpoint_or_extract_gap', 'route_osm_ids': used,
                                'distance_m': round(travelled, 1)})
                continue
            expanded += len(options)
            if expanded > cfg['max_branches']:
                results.append({'side': 0, 'reason': 'branch_limit', 'route_osm_ids': used, 'distance_m': round(travelled, 1)})
                continue
            for nxt, at, d in options:
                queue.append((nxt, at, d, travelled, run_side, run, used, visited))
        sides = {r['side'] for r in results}
        stable = next(iter(sides)) if len(sides) == 1 and 0 not in sides else 0
        return {'stable_side': stable, 'paths': results}

    def contact(self, route_id, point):
        route = self.routes.get(route_id)
        if not route:
            return {'status': 'unresolved', 'reason': 'source_route_missing'}
        at = route['line'].project(point)
        if self.polygon is None:
            component = int(self.component_tree.nearest(point))
            line = self.components[component]
            along = line.project(point)
            if not line.is_ring and min(along, line.length - along) <= self.config['max_trace_m']:
                return {'status': 'unresolved', 'reason': 'frontier_endpoint_or_extract_edge',
                        'route_distance_m': round(at, 3), 'arms': []}
            self.active_component = component
        try:
            arms = [self.trace_arm(route_id, at, d) for d in (-1, 1)]
        finally:
            self.active_component = None
        sides = [a['stable_side'] for a in arms]
        status = 'sustained_country_transition' if set(sides) == {-1, 1} else 'same_country_return' if sides[0] and sides[0] == sides[1] else 'unresolved'
        return {'status': status, 'route_distance_m': round(at, 3), 'arms': arms}


def reconstruct_contacts(candidates, routes, border_features, forward):
    """Exactly replay the frozen v1 grouping and check every candidate hash.

    V1 stored group[0], which could differ from its 75 m search anchor. Nearest
    reassignment would therefore corrupt some groups. Preserve original source
    order and the declared grouping algorithm instead.
    """
    expected = {f['id']: f for f in candidates}
    route_ids = {wid for f in candidates for wid in f['properties']['route_osm_ids']}
    border_pairs = {}
    for f in candidates:
        pair = tuple(sorted(c['osm_relation_id'] for c in f['properties']['country_relations']))
        for bid in f['properties']['boundary_osm_ids']:
            if bid in border_pairs and border_pairs[bid] != pair:
                raise ValueError('Inconsistent frozen country memberships')
            border_pairs[bid] = pair
    shapes = [shape(f['geometry']) for f in border_features]
    tree = STRtree(shapes)
    contacts, overlaps = [], []
    # PBF and frozen evidence order are numeric way order. Do not sort contacts
    # or tree query results before replaying the v1 clustering algorithm.
    for wid in sorted(route_ids):
        if wid not in routes:
            raise ValueError(f'Frozen source route {wid} absent from graph context')
        route = routes[wid]
        ll = LineString(route['coordinates'])
        for j in tree.query(ll, predicate='intersects'):
            bid = border_features[int(j)]['properties']['osm_id']
            intersection = ll.intersection(shapes[int(j)])
            if intersection.length:
                overlaps.append({'route_osm_id': wid, 'boundary_osm_id': bid, 'geometry': mapping(intersection)})
            for raw in point_parts(intersection):
                if bid not in border_pairs:
                    raise ValueError('Frozen boundary pair missing')
                contacts.append({'raw_contact_id': f'raw-{wid}-{bid}-{len(contacts):05d}',
                                 'route_osm_id': wid, 'boundary_osm_id': bid,
                                 'coordinate': list(raw.coords)[0],
                                 'point': transform(raw, forward, interleaved=False),
                                 'mode': route['mode'], 'pair': border_pairs[bid],
                                 'assignment_method': 'exact replay of frozen v1 75 m grouping; candidate hash checked'})
    tree = STRtree([c['point'] for c in contacts])
    used, recovered = set(), set()
    for i, item in enumerate(contacts):
        if i in used:
            continue
        indices = [int(j) for j in tree.query(item['point'].buffer(75))
                   if int(j) not in used and contacts[int(j)]['mode'] == item['mode']
                   and contacts[int(j)]['pair'] == item['pair']
                   and contacts[int(j)]['point'].distance(item['point']) <= 75]
        used.update(indices)
        group = [contacts[j] for j in indices]
        ll = group[0]['coordinate']
        fingerprint = json.dumps([item['mode'], sorted({c['route_osm_id'] for c in group}), round(ll[0], 5), round(ll[1], 5)])
        cid = 'osm-' + hashlib.sha256(fingerprint.encode()).hexdigest()[:16]
        if cid not in expected:
            raise ValueError(f'Frozen grouping hash mismatch: {cid}; check geometry engine and source order')
        if len(group) != expected[cid]['properties']['raw_contact_count']:
            raise ValueError(f'Frozen group size mismatch: {cid}')
        recovered.add(cid)
        for c in group:
            c['candidate_id'] = cid
    required = {f['id'] for f in candidates if f['properties']['route_osm_ids']}
    if recovered != required:
        raise ValueError('Not all frozen transport candidates were reconstructed')
    return contacts, overlaps


def explicit_contacts(candidates, routes, border_features, forward):
    """Read fresh stored raw contacts, verifying both original source lines.

    Validation happens in longitude/latitude: projecting only segment endpoints
    introduces small line bowing and is not an appropriate source-ID check.
    """
    boundaries = {f['properties']['osm_id']: shape(f['geometry']) for f in border_features}
    roads = {wid: LineString(route['coordinates']) for wid, route in routes.items()}
    contacts, seen = [], set()
    for feature in candidates:
        props = feature['properties']
        raw_contacts = props.get('raw_contacts')
        if raw_contacts is None or len(raw_contacts) != props['raw_contact_count']:
            raise ValueError(f"Explicit raw-contact count missing or inconsistent: {feature['id']}")
        for raw in raw_contacts:
            wid, bid = raw['route_osm_id'], raw['boundary_osm_id']
            if wid not in roads or bid not in boundaries:
                raise ValueError('Explicit raw contact has a missing source road or boundary')
            if wid not in props['route_osm_ids'] or bid not in props['boundary_osm_ids']:
                raise ValueError('Explicit raw contact is outside its candidate membership')
            point = Point(raw['coordinate'])
            if point.distance(roads[wid]) > 1e-8 or point.distance(boundaries[bid]) > 1e-8:
                raise ValueError('Explicit raw contact does not lie on its source road and boundary')
            key = (wid, bid, tuple(raw['coordinate']))
            if key in seen:
                raise ValueError('Explicit raw contact assigned more than once')
            seen.add(key)
            contacts.append({'raw_contact_id': f'raw-{wid}-{bid}-{len(contacts):05d}',
                             'candidate_id': feature['id'], 'route_osm_id': wid, 'boundary_osm_id': bid,
                             'coordinate': list(raw['coordinate']),
                             'point': transform(point, forward, interleaved=False),
                             'mode': routes[wid]['mode'],
                             'pair': tuple(sorted(c['osm_relation_id'] for c in props['country_relations'])),
                             'assignment_method': 'explicit raw contacts retained by extraction; source lines checked'})
    return contacts


def corridor_band_interval(topology, line, lo, hi):
    """Only combine review contacts if their intervening road stays in-band."""
    segment = substring(line, lo, hi)
    n = max(1, int(segment.length / topology.config['sample_step_m']) + 1)
    sample = [segment.interpolate(i / n, normalized=True).coords[0] for i in range(n + 1)]
    # Retain every vertex so a short excursion cannot hide between samples.
    if segment.geom_type == 'LineString':
        sample += list(segment.coords)
    # On open frontiers an unknown side may also mean a component endpoint or
    # junction, not proximity. Only measured boundary distance forms corridors.
    return all(gap <= topology.config['boundary_band_m'] for _, gap in topology.sides(sample))


def build(args):
    reviewer_sha256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    output_names = ('topology-summary.json', 'topology-contacts.json', 'topology-diagnostics.json',
                    'topology-review-groups.json', 'topology-overlaps.json', 'topology-major-road-review.csv')
    if any((out / name).exists() for name in output_names) and not getattr(args, 'allow_overwrite', False):
        raise ValueError('Topology output exists; use a new directory or --allow-overwrite explicitly')
    pilot = args.pilot
    summary = json.loads((pilot / 'summary.json').read_text())
    fresh = summary.get('schema_version', 1) >= 3
    candidates = json.loads((pilot / 'crossing-candidates.geojson').read_text())['features']
    evidence = json.load(gzip.open(pilot / 'osm-reference-evidence.geojson.gz', 'rt'))['features']
    boundaries = [f for f in evidence if f['geometry']['type'] == 'LineString'
                  and not f['properties'].get('mode') and f['properties'].get('osm_type') == 'w']
    ll_borders = [shape(f['geometry']) for f in boundaries]
    if not ll_borders:
        raise ValueError('No retained boundary geometry')
    polygons = list(polygonize(unary_union(ll_borders)))
    if not fresh and len(polygons) != 1:
        raise ValueError(f'Expected one closed Uganda polygon, found {len(polygons)}; cannot infer country sides')
    transformer = Transformer.from_crs('EPSG:4326', summary['metric_crs'], always_xy=True)
    forward = transformer.transform
    # A closed island segment within one bilateral frontier is not the whole
    # country polygon. Pair extractions therefore use oriented components.
    use_polygon = len(polygons) == 1 and (not fresh or not summary.get('neighbour_code'))
    polygon = transform(polygons[0], forward, interleaved=False) if use_polygon else None
    borders = [transform(b, forward, interleaved=False) for b in ll_borders]
    cfg = {**DEFAULTS, 'continuation_policy': 'all_connected_same_mode_branches' if fresh else 'legacy_ref_name_preference'}
    cache = pilot / 'osm-graph-context.json.gz' if fresh else out / 'topology-graph-context.json.gz'
    if fresh:
        if not cache.exists():
            raise ValueError('Fresh extraction lacks saved connected graph context; regenerate it from its source snapshot')
        if getattr(args, 'rebuild_context', False):
            raise ValueError('Fresh context is owned by the extraction; rebuild a new extraction snapshot')
        context = json.load(gzip.open(cache, 'rt'))
        if context.get('schema_version') != 2:
            raise ValueError('Fresh topology requires graph context schema 2 with retained OSM node IDs')
        if context.get('source_sha256') != summary['source']['sha256']:
            raise ValueError('Connected graph source checksum differs from extraction')
        if context.get('metric_crs') != summary['metric_crs']:
            raise ValueError('Connected graph projection differs from extraction')
        if context.get('buffer_m', 0) < cfg['context_buffer_m']:
            raise ValueError('Connected graph buffer is too small for topology review')
        cfg['context_buffer_m'] = context['buffer_m']
        if context.get('country_code') != summary['country_code'] or context.get('neighbour_code') != summary.get('neighbour_code'):
            raise ValueError('Connected graph country pair differs from extraction')
    elif args.rebuild_context or not cache.exists():
        if not args.pbf:
            raise ValueError('--pbf is required to create graph context')
        sha = hashlib.file_digest(args.pbf.open('rb'), 'sha256').hexdigest()
        if sha != summary['source']['sha256']:
            raise ValueError('PBF checksum differs from frozen pilot; use the original snapshot')
        print('Reading connected route context from frozen PBF…', flush=True)
        reader = GraphContext(ll_borders, forward, cfg)
        reader.apply_file(str(args.pbf), locations=True, idx='flex_mem')
        border_tree = STRtree(borders)
        kept = []
        for r in reader.routes:
            line = transform(LineString(r['coordinates']), forward, interleaved=False)
            if len(border_tree.query(line, predicate='dwithin', distance=cfg['context_buffer_m'])):
                kept.append(r)
        context = {'source_sha256': sha, 'osm_timestamp': summary['osm_data_timestamp'],
                   'buffer_m': cfg['context_buffer_m'], 'routes_inspected': reader.inspected,
                   'incomplete_way_ids': reader.incomplete, 'routes': kept}
        with gzip.open(cache, 'wt', encoding='utf-8') as fh:
            json.dump(context, fh, ensure_ascii=False)
    else:
        context = json.load(gzip.open(cache, 'rt'))
        if context['source_sha256'] != summary['source']['sha256'] or context['buffer_m'] != cfg['context_buffer_m']:
            raise ValueError('Graph cache does not match source or parameters')
    routes = context['routes']
    for r in routes:
        r['line'] = transform(LineString(r['coordinates']), forward, interleaved=False)
    topology = Topology(polygon, borders, routes, cfg)
    if fresh:
        contacts = explicit_contacts(candidates, topology.routes, boundaries, forward)
        overlaps = json.loads((pilot / 'boundary-overlaps.json').read_text())
    else:
        contacts, overlaps = reconstruct_contacts(candidates, topology.routes, boundaries, forward)
    if len(contacts) != summary['raw_intersection_points']:
        raise ValueError('Raw-contact total differs from extraction summary')
    print(f'Reviewing {len(contacts)} raw contacts and {len(candidates)} snapshot candidates…', flush=True)
    by_candidate, by_route = defaultdict(list), defaultdict(list)
    for c in contacts:
        c['diagnostic'] = topology.contact(c['route_osm_id'], c['point'])
        by_candidate[c['candidate_id']].append(c)
        by_route[c['route_osm_id']].append(c)

    # Review corridors only: contacts on the SAME OSM way whose intervening
    # geometry stays in the 30 m uncertainty band. Never merge separate modes,
    # country pairs, nearby parallel roads, or contacts separated by clear land.
    pairs = {f['id']: tuple(sorted(c.get('iso2', '') for c in f['properties']['country_relations'])) for f in candidates}
    group_members = {f['id']: {f['id']} for f in candidates}
    corridor_edges = []
    repeat_candidates = set()
    for wid, cs in by_route.items():
        cs.sort(key=lambda c: c['diagnostic'].get('route_distance_m', 0))
        line = topology.routes[wid]['line']
        for c in cs:
            neighbours = {v['candidate_id'] for v in cs if abs(v['diagnostic'].get('route_distance_m', 0) - c['diagnostic'].get('route_distance_m', 0)) <= cfg['repeat_window_m']}
            if len(neighbours) >= cfg['repeat_min_contacts']:
                repeat_candidates.add(c['candidate_id'])
        for a, b in zip(cs, cs[1:]):
            aid, bid = a['candidate_id'], b['candidate_id']
            if aid == bid or pairs[aid] != pairs[bid]:
                continue
            lo, hi = a['diagnostic']['route_distance_m'], b['diagnostic']['route_distance_m']
            if corridor_band_interval(topology, line, lo, hi):
                members = group_members[aid] | group_members[bid]
                for member in members:
                    group_members[member] = members
                corridor_edges.append({'candidate_ids': [aid, bid], 'route_osm_id': wid,
                                       'route_interval_m': [lo, hi], 'interval_length_m': round(hi - lo, 1),
                                       'reason': 'same route remains within boundary uncertainty band between contacts'})
    groups, candidate_to_group = [], {}
    unique_members = sorted({tuple(sorted(v)) for v in group_members.values()})
    for members in unique_members:
        ident = 'review-' + hashlib.sha256('|'.join(members).encode()).hexdigest()[:16]
        for cid in members:
            candidate_to_group[cid] = ident
        groups.append({'review_group_id': ident, 'candidate_ids': list(members),
                       'purpose': 'geometry review unit, not a verified crossing or permanent crossing ID',
                       'grouping_basis': 'same-route boundary-band corridor' if len(members) > 1 else 'original candidate',
                       'is_verified_crossing': False})

    diagnostics = []
    for f in candidates:
        p, cid = f['properties'], f['id']
        cs = by_candidate[cid]
        statuses = Counter(c['diagnostic']['status'] for c in cs)
        repeated = cid in repeat_candidates
        if repeated or len(group_members[cid]) > 1 or statuses.get('same_country_return'):
            status = 'boundary_alignment_or_repeated_contacts'
        elif statuses.get('sustained_country_transition'):
            status = 'sustained_country_transition'
        elif fresh and statuses.get('unresolved'):
            status = 'unresolved'
        elif 'endpoint_or_tangent_contact' in p['review_flags']:
            status = 'tangent_or_endpoint'
        else:
            status = 'unresolved'
        flags = []
        if repeated:
            flags.append('same_route_has_multiple_contacts_within_5km')
        if len(group_members[cid]) > 1:
            flags.append('review_together_as_boundary_band_corridor')
        if statuses.get('same_country_return'):
            flags.append('route_returns_to_same_country_at_stable_distance')
        if statuses.get('unresolved'):
            flags.append('some_route_arms_lack_unambiguous_continuation')
        if len(p['route_osm_ids']) > 1:
            flags.append('original_75m_group_can_contain_distinct_roads_review_each_member')
        if len(pairs[cid]) != 2:
            flags.append('country_pair_incomplete_or_ambiguous')
            status = 'unresolved'
        if any(c['diagnostic'].get('reason') == 'frontier_endpoint_or_extract_edge' for c in cs):
            flags.append('frontier_endpoint_or_extract_edge')
            status = 'unresolved'
        if summary.get('coverage', {}).get('is_partial'):
            flags.append('partial_frontier_member_coverage')
        diagnostics.append({'candidate_id': cid, 'review_group_id': candidate_to_group[cid],
                            'country_pair': list(pairs[cid]), 'mode': p['mode'],
                            'is_major_road': 'major' in p['road_tiers'],
                            'topology_status': status,
                            'has_sustained_geometric_transition': bool(statuses.get('sustained_country_transition')),
                            'raw_contact_count_reconstructed': len(cs),
                            'raw_contact_count_original': p['raw_contact_count'],
                            'contact_status_counts': dict(statuses), 'review_flags': flags,
                            'raw_contact_ids': [c['raw_contact_id'] for c in cs],
                            'is_verified_crossing': False, 'is_closure_evidence': False})
    for c in contacts:
        c.pop('point')
    write_json(out / 'topology-contacts.json', contacts)
    write_json(out / 'topology-diagnostics.json', diagnostics)
    write_json(out / 'topology-review-groups.json', {'groups': groups, 'corridor_edges': corridor_edges})
    write_json(out / 'topology-overlaps.json', overlaps)
    write_csv(out / 'topology-major-road-review.csv', [d for d in diagnostics if d['is_major_road']],
              ['candidate_id', 'review_group_id', 'country_pair', 'topology_status',
               'has_sustained_geometric_transition', 'raw_contact_count_reconstructed', 'contact_status_counts', 'review_flags'])
    result = {'created_at': datetime.now(timezone.utc).isoformat(),
              'method_version': 'regional-topology-review-3' if fresh else 'uganda-topology-review-1',
              'reviewer_sha256': reviewer_sha256,
              'country_code': summary.get('country_code'), 'neighbour_code': summary.get('neighbour_code'),
              'coverage': summary.get('coverage'),
              'contact_membership_method': 'explicit_raw_contacts' if fresh else 'frozen_v1_grouping_replay',
              'side_basis': 'closed_country_polygon' if polygon is not None else 'continuous_frontier_component',
              'frontier_component_count': len(topology.components),
              'source_osm_sha256': summary['source']['sha256'], 'source_osm_timestamp': summary['osm_data_timestamp'],
              'source_candidate_sha256': hashlib.file_digest((pilot / 'crossing-candidates.geojson').open('rb'), 'sha256').hexdigest(),
              'source_graph_sha256': hashlib.file_digest(cache.open('rb'), 'sha256').hexdigest(),
              'source_evidence_sha256': hashlib.file_digest((pilot / 'osm-reference-evidence.geojson.gz').open('rb'), 'sha256').hexdigest(),
              'parameters': cfg, 'closed_country_polygons': len(polygons), 'context_routes': len(routes),
              'candidate_count': len(diagnostics), 'raw_contacts_reconstructed': len(contacts),
              'original_raw_contact_count': summary['raw_intersection_points'],
              'review_group_count': len(groups), 'multi_candidate_review_groups': sum(len(g['candidate_ids']) > 1 for g in groups),
              'by_topology_status': dict(Counter(d['topology_status'] for d in diagnostics)),
              'major_road_by_topology_status': dict(Counter(d['topology_status'] for d in diagnostics if d['is_major_road'])),
              'limits': ['Automated geometry diagnostics are not independent verification of a crossing, its legality, operation or any closure.',
                         'Repeated-contact groups are review units and are not accepted counts of physical crossing facilities.',
                         'Sides use a complete country polygon where available, otherwise consistently oriented frontier components; systematic boundary errors remain possible.',
                         'Open-component left/right sides are geometric only and do not independently name jurisdictions; endpoints, branches and disputed segments require review.',
                         'Thirty metres and the continuation distances are explicit review parameters, not measured positional accuracy.',
                         'Modern graph joins explore all connected same-mode branches; road reference changes at borders cannot discard continuations. Frozen legacy replay retains its declared historical preference.',
                         'Incomplete or ambiguous graph continuation stays unresolved; private/access restrictions require separate review.',
                         'Only the supplied extraction candidates are diagnosed; this run does not discover missed crossings.',
                         'Extraction groups are retained for audit; nearby roads in one group are not thereby one facility.',
                         'Partial boundary-member coverage is retained as a limitation; antimeridian and polar processing are unsupported.']}
    write_json(out / 'topology-summary.json', result)
    print(json.dumps({k: v for k, v in result.items() if k not in {'limits'}}, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pilot', type=Path, default=ROOT / 'research/osm/uganda-pilot')
    parser.add_argument('--output', type=Path, default=ROOT / 'research/osm/uganda-review')
    parser.add_argument('--pbf', type=Path)
    parser.add_argument('--rebuild-context', action='store_true')
    parser.add_argument('--allow-overwrite', action='store_true', help='Explicitly replace an existing topology output')
    build(parser.parse_args())
