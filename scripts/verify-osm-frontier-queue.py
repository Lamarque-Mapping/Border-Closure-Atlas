#!/usr/bin/env python3
"""Check source-led queue coverage, no invented pairs, transport triage and exports."""
import copy
from collections import Counter
import openpyxl
import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('frontier_queue', ROOT / 'scripts/build-osm-frontier-queue.py')
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)


def fixture():
    def feature(ident, codes=None, point=False):
        props = {'location_id': ident, 'display_role': 'crossing_reference' if point else 'frontier_context'}
        if codes is not None:
            props['country_codes'] = codes
        return {'type': 'Feature', 'geometry': {'type': 'Point' if point else 'LineString'}, 'properties': props}
    def event(ident, locs, text='Named Bridge'):
        return {'id': ident, 'title': ident, 'countries': ['Alpha', 'Beta', 'Gamma'], 'location_ids': locs,
                'crossings': text, 'region': 'Test',
                'workbook_locations': [{'Marker precision': 'medium; name extracted from register, geographic identity unverified'}]}
    return {
        'countries': {'features': [{'properties': {'ADM0_A3': a, 'ISO_A2': b, 'ADMIN': n}}
                                   for a, b, n in [('AAA', 'AA', 'Alpha'), ('BBB', 'BB', 'Beta'), ('CCC', 'CC', 'Gamma')]]},
        'locations': {'features': [feature('ab', ['AAA', 'BBB']), feature('bc', ['BBB', 'CCC']),
                                   feature('point', point=True), feature('uncertain', ['AAA'])]},
        'context_locations': {'features': []},
        'crossing_contexts': [{'location_id': 'point', 'context_location_id': 'ab'}],
        'links': [{'event_id': 'linked', 'location_id': 'point'}],
        'events': [event('single', ['ab']), event('linked', []), event('multi', ['ab', 'bc']),
                   event('unresolved', ['ab', 'uncertain']), event('none', []),
                   {**event('excluded', ['bc']), 'quarantined': True}],
    }


class FrontierQueueChecks(unittest.TestCase):
    def test_contexts_never_expand_country_cooccurrence(self):
        result = queue.build(fixture(), {})
        pairs = {r['frontier_key']: r for r in result['frontiers']}
        self.assertEqual(set(pairs), {'AAA-BBB', 'BBB-CCC'})
        self.assertEqual(pairs['BBB-CCC']['record_ids'], ['multi'])
        records = {r['record_id']: r for r in result['records']}
        self.assertEqual(records['single']['context_frontier_keys'], ['AAA-BBB'])
        self.assertEqual(records['linked']['existing_crossing_reference_ids'], ['point'])
        self.assertIsNone(records['multi']['primary_frontier_key'])
        self.assertIsNone(records['unresolved']['primary_frontier_key'])
        self.assertEqual(records['unresolved']['unresolved_location_links'], ['uncertain'])
        self.assertEqual(len(records), 5)

    def test_whole_text_is_preserved_without_automatic_identity(self):
        data = fixture()
        text = 'First town; second town / alternate name; route uncertain'
        data['events'][0]['crossings'] = text
        result = queue.build(data, {})
        lead = next(r for r in result['leads'] if r['record_id'] == 'single')
        self.assertEqual(lead['crossings_verbatim'], text)
        self.assertEqual(lead['identity_status'], 'not_resolved')
        self.assertEqual(lead['accepted_event_crossing_links'], [])
        self.assertFalse(lead['eligible_for_automatic_acceptance'])

    def test_transport_only_text_does_not_drive_main_road_priority(self):
        data = fixture()
        data['events'] = [dict(data['events'][0], id='rail', crossings='Eagle Pass international railway bridge'),
                          dict(data['events'][0], id='ferry', crossings='Rosso international ferry'),
                          dict(data['events'][0], id='ped', crossings='PedWest'),
                          dict(data['events'][0], id='road', crossings='Main road bridge'),
                          dict(data['events'][0], id='mixed', crossings='Road and railway crossing')]
        row = queue.build(data, {})['frontiers'][0]
        self.assertEqual(row['main_road_text_priority_record_ids'], ['mixed', 'road'])
        self.assertEqual(row['specific_location_text_review_lead_count'], 5)

    def test_coverage_dimensions_are_independent(self):
        coverage = {'frontiers': {'AA-BB': {'extraction_status': 'completed_scoped_snapshot',
                                          'reference_review_status': 'pending', 'status': 'awaiting_review'}}}
        row = next(r for r in queue.build(fixture(), coverage)['frontiers'] if r['frontier_key'] == 'AAA-BBB')
        self.assertEqual(row['extraction_status'], 'completed_scoped_snapshot')
        self.assertEqual(row['reference_review_status'], 'pending')
        self.assertFalse(row['is_closure_evidence'])

    def test_duplicates_fail_and_input_is_unchanged(self):
        data = fixture()
        original = copy.deepcopy(data)
        queue.build(data, {})
        self.assertEqual(data, original)
        data['events'].append(copy.deepcopy(data['events'][0]))
        with self.assertRaisesRegex(ValueError, 'Duplicate included'):
            queue.build(data, {})

    def test_js_is_never_executed_and_csv_is_formula_safe(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'data.js'
            path.write_text('alert(1); window.BORDER_DATA = {};')
            with self.assertRaises(ValueError):
                queue.read_data(path)
            path.write_text('window.BORDER_DATA = {}; alert(1);')
            with self.assertRaises(json.JSONDecodeError):
                queue.read_data(path)
            csv_path = Path(tmp) / 'safe.csv'
            queue.write_csv(csv_path, [{'name': '  =2+2', 'text': 'One; two'}], ['name', 'text'])
            with csv_path.open(encoding='utf-8-sig', newline='') as stream:
                row = next(csv.DictReader(stream))
            self.assertEqual(row['name'], "'  =2+2")
            self.assertEqual(row['text'], 'One; two')

    def test_canonical_workbook_is_accounted_once(self):
        path = ROOT / 'dist/data.js'
        before = queue.digest(path)
        data = queue.read_data(path)
        result = queue.build(data, {})
        summary = result['summary']
        workbook_path = ROOT / 'source' / data['meta']['source_filename']
        self.assertEqual(queue.digest(workbook_path), data['meta']['source_sha256'])
        wb = openpyxl.load_workbook(workbook_path, read_only=True, data_only=True)
        rows = [row for row in wb['Register'].iter_rows(values_only=True) if any(v is not None for v in row)]
        register = [dict(zip(rows[2], row)) for row in rows[3:] if row[0]]
        wb.close()
        expected = {r['ID']: r for r in register if r['Analysis inclusion'] == 'Included'}
        self.assertEqual(len(expected), 697)  # Independently reconciled replacement register.
        self.assertEqual(summary['included_record_count'], len(expected))
        self.assertEqual({r['record_id'] for r in result['records']}, set(expected))
        self.assertEqual(len(result['records']), len(expected))
        self.assertEqual(sum(summary['primary_dispositions'].values()), len(expected))
        source = {e['id']: e for e in data['events'] if e['id'] in expected}
        for row in result['records']:
            rid = row['record_id']; event = source[rid]
            self.assertEqual(row['crossings_verbatim'], event.get('crossings', ''))
            self.assertEqual(row['rationales'], [c.strip() for c in (expected[rid]['Current broad rationales'] or '').split(';') if c.strip() and not c.strip().startswith('Uncoded')])
            self.assertEqual(row['workbook_location_rows'], event['workbook_locations'])
            self.assertEqual(row['phase_location_rows'], event['phase_locations'])
            self.assertFalse(row['existing_crossing_reference_ids'])
        self.assertEqual(summary['rationale_counts'], dict(Counter(c.strip() for r in expected.values() for c in (r['Current broad rationales'] or '').split(';') if c.strip() and not c.strip().startswith('Uncoded'))))
        pairs = {r['pair_key_iso2']: r for r in result['frontiers'] if r['pair_key_iso2']}
        self.assertEqual(pairs['KE-SO']['record_ids'], ['H01', 'H08', 'H12'])
        self.assertNotIn('ET-KE', pairs)
        self.assertNotIn('KE-SS', pairs)
        self.assertIn('GL01', pairs['RW-UG']['record_ids'])
        self.assertIn('SA001', pairs['AF-PK']['main_road_text_priority_record_ids'])
        for filename, field in [('frontier-queue.json', 'frontiers'), ('frontier-queue-records.json', 'records'), ('workbook-named-locations.json', 'leads')]:
            document = json.loads((queue.BASE / filename).read_text())
            self.assertEqual(document['provenance']['workbook_sha256'], queue.digest(workbook_path))
            self.assertEqual(document['provenance']['canonical_data_sha256'], before)
            for relative, expected_hash in document['provenance']['input_sha256'].items():
                self.assertEqual(queue.digest(ROOT / relative), expected_hash, relative)
            coverage = json.loads((queue.BASE / 'frontier-queue-coverage.json').read_text())
            self.assertEqual(document[field], queue.build(data, coverage)[field])
        self.assertEqual(set(summary['rationale_counts']), set(data['meta']['rationale_categories']))
        self.assertEqual(queue.digest(path), before)
        self.assertTrue(all(not row['accepted_event_crossing_links'] for row in result['records']))


if __name__ == '__main__':
    unittest.main(verbosity=2)
