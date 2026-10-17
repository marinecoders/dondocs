#!/usr/bin/env python3
"""Direct import commands must leave protected templates untouched."""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from form_paths import source_folder

SCRIPTS = Path(__file__).resolve().parent


class FormPathsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name).resolve()
        self.root = self.repo / 'public' / 'templates'
        self.root.mkdir(parents=True)
        self.builtin = self.root / 'NAVMC10274 - Administrative Action'
        self.builtin.mkdir()
        (self.builtin / 'page1.pdf').write_bytes(b'original')
        (self.root / 'index.json').write_text(json.dumps({'templates': [
            {'id': 'navmc10274', 'directory': self.builtin.name},
        ]}))
        self.scripts = self.repo / 'scripts'
        self.scripts.mkdir()
        for filename in ['import-navmc.sh', 'flatten-navmc-form.sh', 'form-names.py', 'form_paths.py']:
            shutil.copy2(SCRIPTS / filename, self.scripts / filename)
        self.source = self.repo / 'source.pdf'
        self.source.write_bytes(b'%PDF-1.7\n')

    def test_source_and_external_staging(self):
        self.assertEqual(source_folder(self.root, 'DD1 - New Form'), self.root / 'DD1 - New Form')
        staging = self.repo / 'staging'
        self.assertEqual(source_folder(self.root, str(staging), True), staging)

    def test_rejects_escape_and_revision_destinations(self):
        for folder in ['..', '../elsewhere', 'fixture/revisions/hash', str(self.root / 'fixture' / 'revisions' / 'hash')]:
            with self.subTest(folder=folder), self.assertRaises(ValueError):
                source_folder(self.root, folder, True)
        outside = self.repo / 'outside'
        outside.mkdir()
        (self.root / 'link').symlink_to(outside)
        with self.assertRaises(ValueError):
            source_folder(self.root, 'link')
        with self.assertRaises(ValueError):
            source_folder(self.root, str(self.root / 'link'), True)

    def test_direct_commands_refuse_builtins_before_processing(self):
        for command, destination in [('import-navmc.sh', self.builtin.name), ('flatten-navmc-form.sh', str(self.builtin))]:
            with self.subTest(command=command):
                result = subprocess.run(
                    ['bash', str(self.scripts / command), str(self.source), destination],
                    capture_output=True, text=True, timeout=5,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('protected', result.stderr)
                self.assertEqual((self.builtin / 'page1.pdf').read_bytes(), b'original')


if __name__ == '__main__':
    unittest.main()
