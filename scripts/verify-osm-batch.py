#!/usr/bin/env python3
"""Exercise runner failure boundaries and safe resume without a large OSM extract."""
import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('osm_batch', ROOT / 'scripts/run-osm-batch.py')
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)


class BatchChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'repo'
        self.cache = Path(self.tmp.name) / 'cache'
        (self.root / 'dist').mkdir(parents=True)
        (self.root / 'scripts').mkdir()
        self.cache.mkdir()
        self.workbook = 'a' * 64
        (self.root / 'dist/data.js').write_text('window.BORDER_DATA = ' + json.dumps({'meta': {'source_sha256': self.workbook}}) + ';')
        (self.root / 'scripts/osm-review-topology.py').write_text('# fixture reviewer\n')
        self.pbf = self.cache / 'snapshot.osm.pbf'
        self.pbf.write_bytes(b'synthetic OSM fixture, never parsed as a real extract')
        self.sha = batch.digest(self.pbf)
        batch.write(self.cache / 'snapshot.download.json', {'sha256': self.sha})
        self.entry = {'pair': 'AA-BB', 'country_code': 'AA', 'neighbour_code': 'BB',
                      'pbf': self.pbf.name, 'download_manifest': 'snapshot.download.json', 'expected_sha256': self.sha,
                      'output': 'research/osm/fixture/extraction', 'topology_output': 'research/osm/fixture/topology',
                      'road_exceptions': None, 'allow_partial_boundary': False}
        self.manifest = self.root / 'manifest.json'
        self.save([self.entry])
        self.calls = []

    def save(self, entries):
        batch.write(self.manifest, {'schema_version': 1, 'batches': entries})

    def prepare(self, pairs=()):
        return batch.prepare(self.manifest, self.cache, pairs, root=self.root)

    def extraction(self, plan):
        output = plan['output_path']
        output.mkdir(parents=True, exist_ok=True)
        summary = {'schema_version': 3, 'source': {'sha256': plan['expected_sha256']},
                   'country_code': plan['country_code'], 'neighbour_code': plan['neighbour_code'],
                   'road_scope': 'main', 'include_nonroad': False, 'targeted_road_exceptions': plan['exceptions'],
                   'workbook_sha256': plan['workbook_sha256'], 'coverage': {'is_partial': False}}
        batch.write(output / 'summary.json', summary)
        batch.write(output / 'crossing-candidates.geojson', {'type': 'FeatureCollection', 'features': []})
        batch.write(output / 'coverage.json', {'is_partial': False})
        (output / 'osm-reference-evidence.geojson.gz').write_bytes(b'evidence fixture')
        (output / 'osm-graph-context.json.gz').write_bytes(b'graph fixture')

    def run_fake(self, args, **kwargs):
        self.assertIsInstance(args, list)
        self.assertNotIn('shell', kwargs)
        self.assertTrue(kwargs['check'])
        self.calls.append(args)
        output = Path(args[args.index('--output') + 1])
        output.mkdir(parents=True, exist_ok=True)
        if args[1].endswith('osm-crossings.py'):
            # prepare intentionally rejects partial output; use the already
            # validated plan held by the test instead of accepting that state.
            self.extraction(self.active_plan)
        else:
            pilot = Path(args[args.index('--pilot') + 1])
            summary = json.loads((pilot / 'summary.json').read_text())
            batch.write(output / 'topology-summary.json', {
                'country_code': summary['country_code'], 'neighbour_code': summary['neighbour_code'],
                'source_osm_sha256': self.sha, 'source_candidate_sha256': batch.digest(pilot / 'crossing-candidates.geojson'),
                'candidate_count': 0, 'review_group_count': 0})
            batch.write(output / 'topology-diagnostics.json', [])
            batch.write(output / 'topology-review-groups.json', {'groups': []})

    def execute(self):
        plans, identities = self.prepare()
        self.active_plan = plans[0]
        return batch.execute(plans, identities, self.manifest, root=self.root, run=self.run_fake)

    def test_validate_only_has_no_writes(self):
        plans, _ = self.prepare()
        self.assertEqual(len(plans), 1)
        self.assertFalse((self.root / 'research').exists())

    def test_bad_last_source_fails_before_first_batch_writes(self):
        other = {**self.entry, 'pair': 'CC-DD', 'country_code': 'CC', 'neighbour_code': 'DD',
                 'expected_sha256': '0' * 64, 'output': 'research/osm/other/extraction', 'topology_output': 'research/osm/other/topology'}
        self.save([self.entry, other])
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            self.prepare()
        self.assertFalse((self.root / 'research').exists())
        self.assertEqual(len(self.prepare(['AA-BB'])[0]), 1)

    def test_manifest_hash_also_must_match(self):
        batch.write(self.cache / 'snapshot.download.json', {'sha256': '0' * 64})
        with self.assertRaisesRegex(ValueError, 'download manifest checksum'):
            self.prepare()

    def test_paths_symlinks_and_output_overlap_fail(self):
        for key, value in [('pbf', '../snapshot.osm.pbf'), ('output', '/tmp/escape'),
                           ('output', 'dist/overwrite'), ('topology_output', self.entry['output'] + '/nested')]:
            with self.subTest(key=key, value=value):
                self.save([{**self.entry, key: value}])
                with self.assertRaises(ValueError):
                    self.prepare()
        outside = Path(self.tmp.name) / 'outside.pbf'
        outside.write_bytes(self.pbf.read_bytes())
        (self.cache / 'escape.pbf').symlink_to(outside)
        self.save([{**self.entry, 'pbf': 'escape.pbf'}])
        with self.assertRaisesRegex(ValueError, 'escapes'):
            self.prepare()

    def test_unique_pairs_and_requested_pair_validation(self):
        self.save([self.entry, copy.deepcopy(self.entry)])
        with self.assertRaisesRegex(ValueError, 'unique'):
            self.prepare()
        self.save([self.entry])
        with self.assertRaisesRegex(ValueError, 'absent'):
            self.prepare(['CC-DD'])

    def test_complete_matching_extraction_resumes_and_topology_reruns(self):
        result = self.execute()
        self.assertFalse(result[0]['extraction_reused'])
        self.assertEqual(len(self.calls), 2)
        self.assertNotIn('--allow-overwrite', self.calls[-1])
        result = self.execute()
        self.assertTrue(result[0]['extraction_reused'])
        self.assertEqual(len(self.calls), 3)
        self.assertIn('--allow-overwrite', self.calls[-1])
        self.assertNotIn('--include-nonroad', self.calls[0])

    def test_existing_wrong_scope_or_incomplete_extraction_is_rejected(self):
        plan = self.prepare()[0][0]
        self.extraction(plan)
        path = plan['output_path'] / 'summary.json'
        summary = batch.read(path)
        summary['road_scope'] = 'all'
        batch.write(path, summary)
        with self.assertRaisesRegex(ValueError, 'road_scope'):
            self.prepare()
        path.unlink()
        with self.assertRaisesRegex(ValueError, 'absent'):
            self.prepare()

    def test_topology_cannot_overwrite_changed_connected_graph(self):
        self.execute()
        path = self.root / self.entry['output'] / 'osm-graph-context.json.gz'
        path.write_bytes(b'changed graph topology')
        with self.assertRaisesRegex(ValueError, 'inputs changed'):
            self.prepare()

    def test_changed_source_after_validation_is_rejected(self):
        plans, identities = self.prepare()
        self.pbf.write_bytes(b'changed after hashing')
        with self.assertRaisesRegex(ValueError, 'source changed'):
            batch.execute(plans, identities, self.manifest, root=self.root, run=self.run_fake)
        self.assertFalse((self.root / 'research').exists())

    def test_road_exceptions_require_sources_and_match_resume(self):
        path = self.root / 'exceptions.json'
        self.save([{**self.entry, 'road_exceptions': 'exceptions.json'}])
        batch.write(path, {'exceptions': [{'route_osm_ids': [123], 'reason': 'Documented main post', 'source_urls': []}]})
        with self.assertRaisesRegex(ValueError, 'source URLs'):
            self.prepare()
        batch.write(path, {'exceptions': [{'route_osm_ids': [123], 'reason': 'Documented main post', 'source_urls': ['https://example.org/post']}]})
        plan = self.prepare()[0][0]
        self.extraction(plan)
        batch.write(path, {'exceptions': [{'route_osm_ids': [456], 'reason': 'Another documented post', 'source_urls': ['https://example.org/post']}]})
        with self.assertRaisesRegex(ValueError, 'targeted_road_exceptions'):
            self.prepare()


if __name__ == '__main__':
    unittest.main(verbosity=2)
