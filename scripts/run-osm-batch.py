#!/usr/bin/env python3
"""Run declared OSM batches from verified local cache files; never download data."""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTRACTION_INPUTS = ('summary.json', 'crossing-candidates.geojson',
                     'osm-reference-evidence.geojson.gz', 'osm-graph-context.json.gz', 'coverage.json')
TOPOLOGY_OUTPUTS = ('topology-summary.json', 'topology-diagnostics.json', 'topology-review-groups.json')


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def relative_path(base, value, *, output=False):
    """Reject both lexical escapes and symlink escapes before accessing a file."""
    if not isinstance(value, str) or not value or '\\' in value:
        raise ValueError('Paths must be nonempty POSIX relative strings')
    path = Path(value)
    if path.is_absolute() or any(part in {'.', '..'} for part in value.split('/')) or '' in value.split('/'):
        raise ValueError('Absolute and traversal paths are forbidden: ' + value)
    if output and (len(path.parts) < 3 or path.parts[:2] != ('research', 'osm')):
        raise ValueError('Outputs must be inside a dedicated research/osm directory')
    resolved = (Path(base).resolve() / path).resolve()
    if not resolved.is_relative_to(Path(base).resolve()):
        raise ValueError('Path escapes its declared root: ' + value)
    if output and not resolved.is_relative_to((Path(base).resolve() / 'research/osm').resolve()):
        raise ValueError('Output symlink escapes research/osm')
    return resolved


def required_file(directory, name):
    path = relative_path(directory, name)
    if not path.is_file():
        raise ValueError('Required input file is absent: ' + str(path))
    return path


def signature(path):
    stat = path.stat()
    return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns)


def exceptions_from(path):
    if path is None:
        return []
    payload = read(path)
    exceptions = payload.get('exceptions')
    if not isinstance(exceptions, list):
        raise ValueError('Road-exception file needs an exceptions array')
    for item in exceptions:
        if (not isinstance(item, dict) or not isinstance(item.get('reason'), str) or not item['reason'].strip()
                or not isinstance(item.get('route_osm_ids'), list) or not item['route_osm_ids']
                or any(type(number) is not int or number <= 0 for number in item['route_osm_ids'])
                or not isinstance(item.get('source_urls'), list) or not item['source_urls']
                or any(not isinstance(url, str) or not re.match(r'https?://[^/\s]+', url) for url in item['source_urls'])):
            raise ValueError('Every road exception requires positive OSM way IDs, a reason and source URLs')
    return exceptions


def extraction_identity(plan, root):
    output = plan['output_path']
    if not output.exists() or not any(output.iterdir()):
        return None
    files = {name: required_file(output, name) for name in EXTRACTION_INPUTS}
    summary = read(files['summary.json'])
    expected = {'country_code': plan['country_code'], 'neighbour_code': plan['neighbour_code'],
                'road_scope': 'main', 'include_nonroad': False,
                'targeted_road_exceptions': plan['exceptions'], 'workbook_sha256': plan['workbook_sha256']}
    for key, value in expected.items():
        if summary.get(key) != value:
            raise ValueError(f"{plan['pair']}: extraction identity mismatch for {key}; use a new output directory")
    if summary.get('schema_version', 0) < 3 or summary.get('source', {}).get('sha256') != plan['expected_sha256']:
        raise ValueError(f"{plan['pair']}: extraction schema/source mismatch; use a new output directory")
    if summary.get('coverage', {}).get('is_partial') and not plan['allow_partial_boundary']:
        raise ValueError(f"{plan['pair']}: partial extraction requires explicit manifest opt-in")
    return {name: digest(path) for name, path in files.items()}


def topology_identity(plan, inputs):
    output = plan['topology_path']
    if not output.exists() or not any(output.iterdir()):
        return False
    if inputs is None:
        raise ValueError(f"{plan['pair']}: topology output exists without a matching extraction")
    for name in TOPOLOGY_OUTPUTS:
        required_file(output, name)
    summary = read(required_file(output, 'topology-summary.json'))
    expected = {'country_code': plan['country_code'], 'neighbour_code': plan['neighbour_code'],
                'source_osm_sha256': plan['expected_sha256'],
                'source_candidate_sha256': inputs['crossing-candidates.geojson']}
    if any(summary.get(key) != value for key, value in expected.items()):
        raise ValueError(f"{plan['pair']}: existing topology does not identify the current extraction")
    receipt = output / 'batch-input-receipt.json'
    if receipt.exists() and read(required_file(output, 'batch-input-receipt.json')).get('extraction_input_sha256') != inputs:
        raise ValueError(f"{plan['pair']}: retained extraction inputs changed since topology review")
    return True


def prepare(manifest_path, cache, pairs=(), root=ROOT):
    """Validate every selected source and destination before the caller may write."""
    root, cache = Path(root).resolve(), Path(cache).resolve()
    manifest_path = Path(manifest_path).resolve()
    identities = {manifest_path: signature(manifest_path)}
    manifest = read(manifest_path)
    if manifest.get('schema_version') != 1 or not isinstance(manifest.get('batches'), list) or not manifest['batches']:
        raise ValueError('Expected schema_version 1 and a nonempty batches list')
    data_path = required_file(root, 'dist/data.js')
    identities[data_path] = signature(data_path)
    data_text = data_path.read_text(encoding='utf-8').strip()
    prefix = 'window.BORDER_DATA = '
    if not data_text.startswith(prefix) or not data_text.endswith(';'):
        raise ValueError('Invalid canonical data wrapper')
    workbook_sha256 = json.loads(data_text[len(prefix):-1])['meta']['source_sha256']
    known, outputs = set(), []
    rows = []
    for entry in manifest['batches']:
        if not isinstance(entry, dict):
            raise ValueError('Each batch must be an object')
        row = dict(entry)
        codes = [row.get('country_code'), row.get('neighbour_code')]
        if any(not isinstance(c, str) or not re.fullmatch('[A-Z]{2}', c) for c in codes) or len(set(codes)) != 2:
            raise ValueError('Each batch needs two distinct uppercase ISO-style country codes')
        if row.get('pair') != '-'.join(sorted(codes)) or row['pair'] in known:
            raise ValueError('Pair keys must be unique and sorted country-code pairs')
        known.add(row['pair'])
        row['output_path'] = relative_path(root, row.get('output'), output=True)
        row['topology_path'] = relative_path(root, row.get('topology_output'), output=True)
        for path in [row['output_path'], row['topology_path']]:
            if path.exists() and not path.is_dir():
                raise ValueError('Output path is not a directory: ' + str(path))
            if any(path.is_relative_to(previous) or previous.is_relative_to(path) for previous in outputs):
                raise ValueError('Batch output directories overlap')
            outputs.append(path)
        rows.append(row)
    if set(pairs) - known:
        raise ValueError('Requested pairs absent from manifest: ' + ', '.join(sorted(set(pairs) - known)))
    selected = [row for row in rows if not pairs or row['pair'] in pairs]
    hashes = {}
    for row in selected:
        if not isinstance(row.get('expected_sha256'), str) or not re.fullmatch('[0-9a-f]{64}', row['expected_sha256']):
            raise ValueError('Each source needs a lowercase SHA-256 digest')
        row['pbf_path'] = relative_path(cache, row.get('pbf'))
        row['download_manifest_path'] = relative_path(cache, row.get('download_manifest'))
        for path in [row['pbf_path'], row['download_manifest_path']]:
            if not path.is_file():
                raise ValueError('Required local cache input is absent: ' + str(path))
            if any(path.is_relative_to(output) for output in outputs):
                raise ValueError('Input files cannot be inside output directories')
            if path not in hashes:
                before = signature(path)
                hashes[path] = digest(path)
                if signature(path) != before:
                    raise ValueError('Source changed during validation')
                identities[path] = before
        if hashes[row['pbf_path']] != row['expected_sha256']:
            raise ValueError(f"{row['pair']}: PBF checksum mismatch")
        if read(row['download_manifest_path']).get('sha256') != row['expected_sha256']:
            raise ValueError(f"{row['pair']}: download manifest checksum mismatch")
        row['road_exceptions_path'] = relative_path(root, row['road_exceptions']) if row.get('road_exceptions') else None
        if row['road_exceptions_path'] is not None:
            if not row['road_exceptions_path'].is_file():
                raise ValueError('Road-exception file is absent')
            if any(row['road_exceptions_path'].is_relative_to(output) for output in outputs):
                raise ValueError('Road-exception input cannot live inside an output directory')
            identities[row['road_exceptions_path']] = signature(row['road_exceptions_path'])
        row['exceptions'] = exceptions_from(row['road_exceptions_path'])
        if type(row.get('allow_partial_boundary', False)) is not bool:
            raise ValueError('allow_partial_boundary must be a boolean')
        row['allow_partial_boundary'] = row.get('allow_partial_boundary', False)
        row['workbook_sha256'] = workbook_sha256
        row['extraction_inputs'] = extraction_identity(row, root)
        row['overwrite_topology'] = topology_identity(row, row['extraction_inputs'])
    if any(signature(path) != stamp for path, stamp in identities.items()):
        raise ValueError('An input changed during validation')
    return selected, identities


def execute(plans, identities, manifest_path, root=ROOT, run=subprocess.run):
    root = Path(root).resolve()
    # prepare has finished every selected checksum before this first write.
    if any(signature(path) != stamp for path, stamp in identities.items()):
        raise ValueError('A validated source changed before execution')
    results = []
    for plan in plans:
        if any(signature(path) != stamp for path, stamp in identities.items()):
            raise ValueError('A validated source changed before batch execution')
        reused = plan['extraction_inputs'] is not None
        if not reused:
            command = [sys.executable, str(root / 'scripts/osm-crossings.py'),
                       '--pbf', str(plan['pbf_path']), '--country-code', plan['country_code'],
                       '--neighbour-code', plan['neighbour_code'], '--download-manifest', str(plan['download_manifest_path']),
                       '--output', str(plan['output_path']), '--road-scope', 'main', '--data', str(root / 'dist/data.js')]
            if plan['road_exceptions_path']:
                command += ['--road-exceptions', str(plan['road_exceptions_path'])]
            if plan['allow_partial_boundary']:
                command.append('--allow-partial-boundary')
            plan['output_path'].mkdir(parents=True, exist_ok=True)
            print(f"{plan['pair']}: extracting verified local snapshot", file=sys.stderr, flush=True)
            with (plan['output_path'] / 'batch-extraction.log').open('w', encoding='utf-8') as log:
                run(command, cwd=root, check=True, stdout=log, stderr=subprocess.STDOUT)
            plan['extraction_inputs'] = extraction_identity(plan, root)
            if plan['extraction_inputs'] is None:
                raise ValueError('Extractor produced no outputs')
        # Revalidate immediately before an explicitly requested topology rerun.
        current = extraction_identity(plan, root)
        if current != plan['extraction_inputs']:
            raise ValueError('Extraction inputs changed after validation')
        overwrite = topology_identity(plan, current)
        command = [sys.executable, str(root / 'scripts/osm-review-topology.py'),
                   '--pilot', str(plan['output_path']), '--output', str(plan['topology_path'])]
        if overwrite:
            command.append('--allow-overwrite')
        plan['topology_path'].mkdir(parents=True, exist_ok=True)
        print(f"{plan['pair']}: reviewing topology ({'reused' if reused else 'new'} extraction)", file=sys.stderr, flush=True)
        with (plan['topology_path'] / 'batch-topology.log').open('w', encoding='utf-8') as log:
            run(command, cwd=root, check=True, stdout=log, stderr=subprocess.STDOUT)
        summary = read(required_file(plan['topology_path'], 'topology-summary.json'))
        if summary.get('source_candidate_sha256') != current['crossing-candidates.geojson'] or summary.get('source_osm_sha256') != plan['expected_sha256']:
            raise ValueError('Topology output did not identify its current inputs')
        write(plan['topology_path'] / 'batch-input-receipt.json', {
            'schema_version': 1, 'pair': plan['pair'], 'manifest_sha256': digest(manifest_path),
            'source_osm_sha256': plan['expected_sha256'], 'workbook_sha256': plan['workbook_sha256'],
            'extraction_input_sha256': current,
            'topology_script_sha256': digest(root / 'scripts/osm-review-topology.py'),
            'runner_script_sha256': digest(Path(__file__)),
            'extraction_reused': reused,
        })
        results.append({'pair': plan['pair'], 'extraction_reused': reused,
                        'candidate_count': summary.get('candidate_count'), 'review_group_count': summary.get('review_group_count')})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--pair', action='append', default=[])
    parser.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()
    try:
        plans, identities = prepare(args.manifest, args.cache, args.pair)
        if args.validate_only:
            result = [{'pair': row['pair'], 'extraction_reusable': row['extraction_inputs'] is not None,
                       'topology_rerun': row['overwrite_topology']} for row in plans]
        else:
            result = execute(plans, identities, args.manifest)
        print(json.dumps({'validated_only': args.validate_only, 'batches': result}, indent=2))
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    main()
