#!/usr/bin/env python3
"""Malformed acquisition arguments must fail before any network request."""
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name('acquire-form.sh')


class AcquireArgumentsTest(unittest.TestCase):
    def test_missing_values(self):
        for option in ['--family', '--limit', '--folder', '--category']:
            for suffix in [[], ['--yes']]:
                with self.subTest(option=option, suffix=suffix):
                    result = subprocess.run(
                        ['bash', str(SCRIPT), '--active', option, *suffix],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        timeout=2,
                    )
                    self.assertEqual(result.returncode, 2)

    def test_invalid_limits(self):
        for limit in ['-1', '1.5', 'lots']:
            with self.subTest(limit=limit):
                result = subprocess.run(
                    ['bash', str(SCRIPT), '--active', '--limit', limit],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    timeout=2,
                )
                self.assertEqual(result.returncode, 2)


if __name__ == '__main__':
    unittest.main()
