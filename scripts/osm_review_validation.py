"""Fail-closed snapshot checks shared by the international review builder/tests."""
import gzip
import hashlib
import json
from collections import Counter


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_no_publication(value):
    """Discovery and geography review cannot manufacture accepted event links."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {'accepted_event_link_ids', 'accepted_event_links', 'accepted_event_crossing_links', 'workbook_candidate_links'}:
                require(not item, f'New review cannot contain {key}')
            if key in {'published_on_map', 'point_display_enabled', 'automatic_event_linking',
                       'eligible_for_automatic_acceptance', 'is_closure_evidence', 'is_verified_crossing'}:
                require(item is False, f'New review cannot enable {key}')
            validate_no_publication(item)
    elif isinstance(value, list):
        for item in value:
            validate_no_publication(item)


def validate_association_provenance(decisions, benchmark_path, candidate_path, diagnostic_path, summary, topology):
    expected = {
        'benchmark_sha256': sha(benchmark_path),
        'source_candidate_sha256': sha(candidate_path),
        'source_osm_sha256': summary['source']['sha256'],
        'topology_diagnostics_sha256': sha(diagnostic_path),
        'topology_reviewer_sha256': topology['reviewer_sha256'],
        'topology_method_version': topology['method_version'],
    }
    for key, value in expected.items():
        require(decisions.get(key) == value, f'Stale or missing association provenance: {key}')
    validate_no_publication(decisions)
    assigned, proposed = set(), set()
    for association in decisions['associations']:
        ids = association.get('candidate_ids', [])
        proposals = [p['candidate_id'] for p in association.get('related_candidate_proposals', [])]
        require(len(set(ids)) == len(ids), 'Duplicate associated candidate')
        require(len(set(proposals)) == len(proposals), 'Duplicate provisional candidate')
        require(not set(ids) & set(proposals), 'Provisional component promoted into candidate_ids')
        if association['match_status'] == 'supported_corridor':
            require(ids, 'Supported corridor must retain its reviewed candidate IDs')
        assigned.update(ids)
        proposed.update(proposals)
    require(not assigned & proposed, 'Provisional component promoted into a named association')


def validate_batch_provenance(root, batch, benchmark, summary, topology, features, diagnostics, workbook_sha256):
    extraction = root / batch['output']
    pair = batch['pair']
    require(summary.get('schema_version') == 3, f'{pair}: extraction schema must be 3')
    require(summary.get('extractor_sha256') == sha(root / 'scripts/osm-crossings.py'), f'{pair}: stale extractor code hash')
    require(topology.get('reviewer_sha256') == sha(root / 'scripts/osm-review-topology.py'), f'{pair}: stale topology code hash')
    require(topology.get('method_version') == 'regional-topology-review-3', f'{pair}: stale topology method')
    require(summary.get('workbook_sha256') == benchmark.get('workbook_sha256') == workbook_sha256, f'{pair}: workbook provenance differs')
    require(topology['source_osm_sha256'] == summary['source']['sha256'] == batch['expected_sha256'], f'{pair}: OSM provenance differs')
    require(topology['source_candidate_sha256'] == sha(extraction / 'crossing-candidates.geojson'), f'{pair}: candidate provenance differs')
    require(summary['road_scope'] == 'main' and summary['include_nonroad'] is False, f'{pair}: candidate scope broadened')
    require(topology['parameters']['continuation_policy'] == 'all_connected_same_mode_branches', f'{pair}: branch policy differs')
    for document, name in ((summary, 'extraction'), (topology, 'topology')):
        require(document['country_code'] == batch['country_code'] and document['neighbour_code'] == batch['neighbour_code'], f'{pair}: {name} country pair differs')
    require(topology['coverage'] == summary['coverage'], f'{pair}: boundary coverage differs')
    require(topology['source_osm_timestamp'] == summary['osm_data_timestamp'], f'{pair}: OSM timestamp differs')
    require(len(features) == summary['candidate_count'] == topology['candidate_count'], f'{pair}: candidate count differs')
    require(features.keys() == diagnostics.keys(), f'{pair}: topology candidate membership differs')
    require(sum(f['properties']['raw_contact_count'] for f in features.values()) == summary['raw_intersection_points'] == topology['raw_contacts_reconstructed'], f'{pair}: raw-contact counts differ')
    require(dict(Counter(d['topology_status'] for d in diagnostics.values())) == topology['by_topology_status'], f'{pair}: topology status counts differ')
    graph_path, evidence_path = extraction / 'osm-graph-context.json.gz', extraction / 'osm-reference-evidence.geojson.gz'
    require(topology.get('source_graph_sha256') == sha(graph_path), f'{pair}: graph provenance differs')
    require(topology.get('source_evidence_sha256') == sha(evidence_path), f'{pair}: boundary evidence provenance differs')
    with gzip.open(graph_path, 'rt') as handle:
        graph = json.load(handle)
    require(graph.get('schema_version') == 2, f'{pair}: graph schema differs')
    require(graph['source_sha256'] == summary['source']['sha256'], f'{pair}: graph OSM provenance differs')
    require(graph['metric_crs'] == summary['metric_crs'], f'{pair}: graph projection differs')
    require(graph['country_code'] == summary['country_code'] and graph['neighbour_code'] == summary['neighbour_code'], f'{pair}: graph country pair differs')
    require(graph['coverage'] == summary['coverage'], f'{pair}: graph coverage differs')
    require(graph['buffer_m'] >= 1500 and graph['buffer_m'] == topology['parameters']['context_buffer_m'], f'{pair}: graph buffer differs')
    require(len(graph['routes']) == summary['connected_context_routes'] == topology['context_routes'], f'{pair}: graph route count differs')
    paths = {graph_path, evidence_path}
    if batch['road_exceptions']:
        exception_path = root / batch['road_exceptions']
        require(json.loads(exception_path.read_text())['exceptions'] == summary['targeted_road_exceptions'], f'{pair}: road exception provenance differs')
        paths.add(exception_path)
    else:
        require(not summary['targeted_road_exceptions'], f'{pair}: unrequested road exceptions')
    validate_no_publication(benchmark)
    validate_no_publication(list(features.values()))
    validate_no_publication(list(diagnostics.values()))
    return paths
