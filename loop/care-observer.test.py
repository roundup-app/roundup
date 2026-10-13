#!/usr/bin/env python3
"""L107 authorized live observer at the GitHub boundary."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('care_observer', Path(__file__).with_name('care-observer.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class GitHub:
    repo = 'owner/repo'

    def __init__(self):
        self.comments = []
        self.runs = []
        self.calls = []
        self.fail_dispatch = False

    def object(self, path):
        if path.startswith('actions/runs/'):
            return copy.deepcopy(self.runs[-1])
        return {'state': 'open'}

    def read(self, path, key=None):
        if '/comments?' in path:
            return copy.deepcopy(self.comments)
        return copy.deepcopy(self.runs)

    def write(self, path, body):
        self.calls.append((path, copy.deepcopy(body)))
        if '/comments' in path:
            self.comments.append({'user': {'login': 'github-actions[bot]'}, **body})
        elif self.fail_dispatch:
            raise TimeoutError('unknown delivery')


class CareObserver(unittest.TestCase):
    def test_l107_authorized_dispatch_persists_intent_before_delivery(self):
        github = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            observer.observe(github, Path(directory))
        self.assertEqual(github.calls[0][0], 'issues/1385/comments')
        self.assertEqual(github.calls[1], ('actions/workflows/care.yml/dispatches', {'ref': 'main'}))

    def test_l107_unknown_delivery_never_retries(self):
        github = GitHub()
        github.fail_dispatch = True
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(TimeoutError):
                observer.observe(github, Path(directory))
            with self.assertRaisesRegex(ValueError, 'delivery unknown'):
                observer.observe(github, Path(directory))
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in github.calls), 1)


if __name__ == '__main__':
    unittest.main()
