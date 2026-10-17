#!/usr/bin/env python3
"""A reviewed candidate cannot replace a publication it was not based on."""
import json
import tempfile
from pathlib import Path
from index_json import patch

with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / 'index.json'
    path.write_text(json.dumps({'templates': [{'directory': 'form', 'definitionRevision': 'newer'}]}))
    before = path.read_bytes()
    try:
        patch({'form': {'definitionRevision': 'stale'}}, path, {'form': 'older'})
        raise AssertionError('Stale publication accepted')
    except ValueError as error:
        assert 'Stale candidate' in str(error)
    assert path.read_bytes() == before
    patch({'form': {'definitionRevision': 'next'}}, path, {'form': 'newer'})
    # Retrying the identical publication remains idempotent.
    patch({'form': {'definitionRevision': 'next'}}, path, {'form': 'newer'})
    assert json.loads(path.read_text())['templates'][0]['definitionRevision'] == 'next'
print('Publication compare-and-swap passed')
