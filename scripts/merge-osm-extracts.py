#!/usr/bin/env python3
"""Merge sorted regional OSM snapshots only when shared objects agree exactly.

Every input needs a checked download manifest (default: INPUT.osm.download.json).
This is a streaming union, not an update/history merge. Missing frontier members
remain missing and must be audited by osm-crossings.py after the merge.
"""
import argparse
import hashlib
import json
import os
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import osmium

TYPE_ORDER = {'n':0, 'w':1, 'r':2}


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def snapshot_time(value):
    if not value:
        raise ValueError('Every input must declare an osmosis_replication_timestamp')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Snapshot timestamp must have an explicit timezone')
    return parsed.astimezone(timezone.utc)


def payload(item):
    """Compare exact OSM content, including metadata and ordered topology.

    Tag ordering is immaterial. Integer OSM coordinate units avoid floating-point
    rounding, while node/member order and member roles remain significant.
    """
    metadata = (item.type_str(), item.id, item.version, item.visible, item.changeset,
                item.timestamp, item.uid, item.user, tuple(sorted(item.tags)))
    if item.is_node():
        geometry = (item.location.valid(), item.location.x, item.location.y)
    elif item.is_way():
        geometry = tuple(node.ref for node in item.nodes)
    else:
        geometry = tuple((member.type, member.ref, member.role) for member in item.members)
    return metadata, geometry


def checked_entities(processor, path, timestamp):
    previous = None
    for item in processor:
        kind = item.type_str()
        if kind not in TYPE_ORDER:
            raise ValueError(f'Unsupported entity type {kind!r} in {path.name}')
        key = TYPE_ORDER[kind], item.id
        if previous is not None and key <= previous:
            raise ValueError(f'{path.name} is not a strictly sorted snapshot: {kind}/{item.id}; '
                             'each input must contain one version per object')
        if not item.visible:
            raise ValueError(f'Deleted object {kind}/{item.id} in snapshot {path.name}')
        if item.timestamp > timestamp:
            raise ValueError(f'Object {kind}/{item.id} is newer than its declared snapshot in {path.name}')
        previous = key
        yield item


def merge(inputs, output, input_manifests=None, output_manifest=None):
    code_sha256 = sha256(Path(__file__))
    inputs = [Path(path).resolve() for path in inputs]
    output = Path(output).resolve()
    output_manifest = Path(output_manifest).resolve() if output_manifest else output.with_suffix('.download.json')
    if len(inputs) < 2 or len(set(inputs)) != len(inputs):
        raise ValueError('Supply at least two distinct regional input files')
    if output.suffix != '.pbf':
        raise ValueError('Output must use an .osm.pbf or .pbf suffix')
    if output in inputs or output_manifest == output:
        raise ValueError('Output paths must be distinct from inputs and each other')
    if output.exists() or output_manifest.exists():
        raise ValueError('Output or manifest already exists; use a new snapshot path')
    manifests = ([Path(path).resolve() for path in input_manifests] if input_manifests
                 else [path.with_suffix('.download.json') for path in inputs])
    if len(manifests) != len(inputs):
        raise ValueError('Supply one --input-manifest per input, in input order')
    if output_manifest in inputs or output in manifests or output_manifest in manifests:
        raise ValueError('Output paths must not overwrite source files or manifests')
    provenance, processors = [], []
    common_timestamp = None
    header = osmium.io.Header()
    for path, manifest_path in zip(inputs, manifests):
        if not manifest_path.is_file():
            raise ValueError(f'Missing input download manifest: {manifest_path}')
        manifest = json.loads(manifest_path.read_text())
        actual_sha = sha256(path)
        if manifest.get('sha256') != actual_sha:
            raise ValueError(f'Input manifest checksum mismatch: {path.name}')
        if manifest.get('bytes') != path.stat().st_size:
            raise ValueError(f'Input manifest byte count mismatch: {path.name}')
        processor = osmium.FileProcessor(path)
        input_header = processor.header
        if input_header.has_multiple_object_versions:
            raise ValueError(f'History input is not a single snapshot: {path.name}')
        timestamp = snapshot_time(input_header.get('osmosis_replication_timestamp'))
        if common_timestamp is not None and timestamp != common_timestamp:
            raise ValueError('Input snapshot timestamps differ; obtain matching dated extracts')
        if manifest.get('osm_data_timestamp') and snapshot_time(manifest['osm_data_timestamp']) != timestamp:
            raise ValueError(f'Input manifest snapshot timestamp mismatch: {path.name}')
        common_timestamp = timestamp
        if input_header.box().valid():
            header.add_box(input_header.box())
        provenance.append({**manifest, 'file':path.name,
                           'osm_data_timestamp':timestamp.isoformat().replace('+00:00','Z')})
        processors.append(checked_entities(processor,path,timestamp))
    timestamp_string = common_timestamp.isoformat().replace('+00:00','Z')
    header.set('generator', 'BorderClosuresAtlas checked regional union')
    header.set('osmosis_replication_timestamp', timestamp_string)
    header.set('sorting', 'Type_then_ID')
    output.parent.mkdir(parents=True, exist_ok=True)
    output_manifest.parent.mkdir(parents=True, exist_ok=True)
    written, duplicates = Counter(), Counter()
    with tempfile.TemporaryDirectory(prefix='.osm-merge-', dir=output.parent) as temporary:
        staged = Path(temporary)/'merged.osm.pbf'
        with osmium.SimpleWriter(staged, header=header) as writer:
            for row in osmium.zip_processors(*processors):
                items = [item for item in row if item is not None]
                first = items[0]
                if len(items) > 1:
                    expected = payload(first)
                    if any(payload(item) != expected for item in items[1:]):
                        raise ValueError(f'Conflicting duplicate {first.type_str()}/{first.id}: '
                                         'versions, metadata or payload differ; no output committed')
                    duplicates[first.type_str()] += len(items)-1
                writer.add(first)
                written[first.type_str()] += 1
        created_at = datetime.now(timezone.utc).isoformat()
        manifest = {'kind':'checked_same_snapshot_regional_merge', 'schema_version':1,
                    'created_at':created_at, 'retrieved_at':created_at,
                    'merge_script_sha256':code_sha256, 'osm_data_timestamp':timestamp_string,
                    'bytes':staged.stat().st_size, 'sha256':sha256(staged), 'inputs':provenance,
                    'entities_written':{kind:written[kind] for kind in TYPE_ORDER},
                    'identical_duplicates_removed':{kind:duplicates[kind] for kind in TYPE_ORDER},
                    'conflicting_duplicates':0,
                    'duplicate_equality':'type, id, version, visibility, changeset, timestamp, uid, user, tags, and ordered coordinates/node refs/relation members',
                    'limits':['Union of regional inputs; frontier member coverage is audited separately.',
                              'No missing geometry is interpolated or manufactured.',
                              'Strictly sorted current snapshots only; history and mixed timestamps are rejected.']}
        # Stage the manifest beside its destination for same-filesystem atomic
        # creation. Hard links refuse accidental overwrites, including races.
        with tempfile.TemporaryDirectory(prefix='.osm-merge-manifest-', dir=output_manifest.parent) as manifest_temp:
            staged_manifest = Path(manifest_temp)/'manifest.json'
            staged_manifest.write_text(json.dumps(manifest,indent=2)+'\n')
            os.link(staged,output)
            try:
                os.link(staged_manifest,output_manifest)
            except BaseException:
                output.unlink()
                raise
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inputs',type=Path,nargs='+')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--input-manifest',type=Path,action='append',help='Repeat once per input in input order; defaults to adjacent .download.json')
    parser.add_argument('--output-manifest',type=Path,help='Defaults to output with .download.json replacing .pbf')
    args = parser.parse_args()
    print(json.dumps(merge(args.inputs,args.output,args.input_manifest,args.output_manifest),indent=2))
