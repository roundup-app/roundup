"""Record the machine, references, toolchain and retained binary hashes."""
import hashlib
import json
import os
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1]).resolve()
metadata = {}
for name, command in {
    'os': ['cat', '/etc/os-release'],
    'cpu': ['lscpu'],
    'online': ['cat', '/sys/devices/system/cpu/online'],
    'available': ['nproc'],
    'affinity': ['taskset', '-pc', str(os.getpid())],
    'kernel': ['uname', '-a'],
    'rust': ['rustc', '-Vv'],
    'cargo': ['cargo', '-V'],
    'shell': ['bash', '--version'],
}.items():
    metadata[name] = dict(command=command, output=subprocess.check_output(command, text=True))
metadata['refs'] = {name: subprocess.check_output(['git', 'rev-parse', ref], text=True).strip()
                    for name, ref in zip(['before', 'after'], sys.argv[2:4])}
metadata['env'] = {name: os.environ.get(name) for name in ['RUSTFLAGS', 'CARGO_BUILD_RUSTFLAGS', 'CARGO_TARGET_DIR', 'SHELL']}
metadata['profile'] = 'Default release profile, committed lockfiles; profile binaries have temporary timing instrumentation only.'
binary_root = pathlib.Path(sys.argv[4]).resolve() if len(sys.argv) > 4 else root
metadata['hashes'] = {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                      for path in binary_root.glob('rupd-*') if path.is_file()}
(root/'machine.json').write_text(json.dumps(metadata, indent=2)+'\n')
