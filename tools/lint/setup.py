"""Install pinned release binaries without changing the runner or its global PATH."""
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shutil
import sys
import tarfile
import urllib.request

HERE = Path(__file__).resolve().parent


def install(lane):
    machine = {'AMD64': 'x86_64', 'arm64': 'aarch64'}.get(platform.machine(), platform.machine())
    system = {'Linux': 'unknown-linux-musl', 'Darwin': 'apple-darwin'}[platform.system()]
    target = f'{machine}-{system}'
    releases = json.loads((HERE / 'releases.json').read_text())
    for tool in (['cargo-deny'] if lane == 'rust' else ['ruff', 'typos']):
        release = releases[f'{tool}/{target}']
        destination = HERE / '.tools' / release['sha256'] / tool
        if destination.is_file():
            continue
        print(f'Installing {tool}: {release["url"]}', flush=True)
        data = urllib.request.urlopen(release['url'], timeout=120).read()
        if hashlib.sha256(data).hexdigest() != release['sha256']:
            raise ValueError(f'{tool}: release checksum mismatch')
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            member, = [m for m in archive.getmembers() if m.isfile() and Path(m.name).name == tool]
            with archive.extractfile(member) as source, destination.with_suffix('.tmp').open('wb') as output:
                shutil.copyfileobj(source, output)
        destination.with_suffix('.tmp').chmod(0o755)
        os.replace(destination.with_suffix('.tmp'), destination)


if __name__ == '__main__':
    try:
        install(sys.argv[1])
    except Exception as error:
        print(f'lint setup: {error}', file=sys.stderr)
        sys.exit(2)
