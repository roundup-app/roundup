"""GitHub boundary shared by the non-model live observers."""
import json
import subprocess


class GitHub:
    def __init__(self, repo):
        self.repo = repo

    def read(self, path, key=None):
        raw = subprocess.run(['gh', 'api', f'repos/{self.repo}/{path}', '--paginate', '--slurp'],
                             capture_output=True, text=True, check=True, timeout=180)
        pages = json.loads(raw.stdout)
        return [row for page in pages for row in (page[key] if key else page)]

    def object(self, path):
        raw = subprocess.run(['gh', 'api', f'repos/{self.repo}/{path}'],
                             capture_output=True, text=True, check=True, timeout=180)
        return json.loads(raw.stdout)

    def write(self, path, body):
        subprocess.run(['gh', 'api', f'repos/{self.repo}/{path}', '-X', 'POST', '--input', '-'],
                       input=json.dumps(body), capture_output=True, text=True, check=True, timeout=180)
