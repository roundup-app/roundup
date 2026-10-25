#!/usr/bin/env python3
"""Opt-in CI3781 build evidence. Cargo owns timings; strace owns exec/exit records."""
from datetime import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time


def prepare(root, output, env):
    """Install a run-owned Cargo proxy; never change Cargo/linker configuration."""
    output.mkdir(parents=True, exist_ok=False)
    cargo = shutil.which('cargo', path=env['PATH'])
    nextest = shutil.which('cargo-nextest', path=env['PATH'])
    tracer = shutil.which('strace', path=env['PATH'])
    if not all((cargo, nextest, tracer)):
        raise ValueError('build observation requires installed Cargo, nextest and strace')
    facts = {}
    for name, command in {
        'cargo': [cargo, '--version'], 'rustc': ['rustc', '-vV'],
        'nextest': [nextest, 'nextest', '--version'], 'strace': [tracer, '--version'],
        'metadata': [cargo, 'metadata', '--no-deps', '--format-version=1'],
        'cpu': ['lscpu', '--json'],
    }.items():
        result = subprocess.run(command, cwd=root, env=dict(env, LC_ALL='C') if name == 'cpu' else env, capture_output=True, text=True, timeout=60)
        facts[name] = dict(command=command, exit_code=result.returncode, stdout=result.stdout, stderr=result.stderr)
        (output / 'facts.json').write_text(json.dumps(facts, indent=2) + '\n')
        if result.returncode:
            raise ValueError(f'build observation facts failed: {name} (exit {result.returncode})')
    facts['cpu_model'] = next((row['data'] for row in json.loads(facts['cpu']['stdout'])['lscpu'] if row['field'] == 'Model name:'), None)
    if not facts['cpu_model']:
        raise ValueError('missing runner CPU model')
    (output / 'facts.json').write_text(json.dumps(facts, indent=2) + '\n')
    target = Path(json.loads(facts['metadata']['stdout'])['target_directory'])
    settings = {key: value for key, value in env.items() if key in (
        'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTC', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER',
        'RUSTUP_TOOLCHAIN', 'CARGO_BUILD_TARGET', 'CARGO_BUILD_JOBS', 'CARGO_INCREMENTAL',
    ) or key.startswith('CARGO_PROFILE_') or (key.startswith('CARGO_TARGET_') and key.endswith(('_LINKER', '_RUSTFLAGS', '_RUNNER')))}
    configs = {}
    for path in (root / 'Cargo.toml', root / 'rust-toolchain.toml', root / '.cargo/config', root / '.cargo/config.toml',
                 Path(env.get('CARGO_HOME', str(Path.home() / '.cargo'))) / 'config.toml'):
        configs[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
    (output / 'settings.json').write_text(json.dumps(dict(environment=settings, config_hashes=configs), indent=2) + '\n')
    proxy = output / 'bin/cargo'
    proxy.parent.mkdir()
    proxy.symlink_to(Path(__file__).resolve())
    return dict(env, PATH=str(proxy.parent) + os.pathsep + env['PATH'], CARGO=str(proxy),
                E14_BUILD_OUTPUT=str(output), E14_REAL_CARGO=cargo, E14_REAL_NEXTEST=nextest,
                E14_STRACE=tracer, E14_TIMINGS=str(target / 'cargo-timings'))


def _links(directory):
    links = []
    for trace in sorted(directory.glob('trace.*')):
        text = trace.read_text()
        # -xx represents every byte as hex, avoiding C-string/locale ambiguities in argv.
        executions = list(re.finditer(r'(?m)^(\d+\.\d+) execve\("((?:\\x[0-9a-f]{2})*)", \[(.*?)\], .*?\) = (.*)$', text))
        if 'execveat(' in text or len(executions) != text.count('execve('):
            raise ValueError(f'unsupported or truncated exec record: {trace}')
        terminal = re.search(r'(?m)^(\d+\.\d+) \+\+\+ (?:exited with (\d+)|killed by (\w+).*?) \+\+\+$', text)
        for execution in executions:
            if not re.fullmatch(r'"(?:\\x[0-9a-f]{2})*"(?:, "(?:\\x[0-9a-f]{2})*")*', execution[3]):
                raise ValueError(f'truncated exec argv: {trace}')
            argv = [bytes.fromhex(value.replace('\\x', '')).decode('utf-8', errors='surrogateescape')
                    for value in re.findall(r'"((?:\\x[0-9a-f]{2})*)"', execution[3])]
            # Include compiler drivers and actual linkers, even custom executable names, by their output argument.
            # rustc uses --out-dir, while C compilation uses -c; neither is a linker interval.
            if '-o' not in argv or any(flag in argv for flag in ('-c', '-E', '-S', '--out-dir')):
                continue
            row = dict(pid=int(trace.suffix[1:]), executable=bytes.fromhex(execution[2].replace('\\x', '')).decode('utf-8', errors='surrogateescape'),
                       argv=argv, output=argv[argv.index('-o') + 1], start=float(execution[1]),
                       exec_result=execution[4], trace=trace.name)
            if execution[4] != '0':
                row.update(end=None, exit_code=None, error='exec failed')
            elif terminal:
                row.update(end=float(terminal[1]), exit_code=int(terminal[2]) if terminal[2] else None, signal=terminal[3])
            else:
                row.update(end=None, exit_code=None, error='missing process exit')
            links.append(row)
    return links


def _proxy():
    env = os.environ.copy()
    args = sys.argv[1:]
    # Direct nextest invocation preserves CARGO for its internal `cargo test --no-run`.
    # Cargo's external-subcommand dispatch would replace it with the unobserved Cargo executable.
    if args[:2] == ['nextest', 'run']:
        os.execvpe(env['E14_REAL_NEXTEST'], [env['E14_REAL_NEXTEST'], *args, '--timings'], env)
    builds = ('build', 'test', 'run', 'rustc')
    if not any(arg in builds for arg in args):
        os.execvpe(env['E14_REAL_CARGO'], [env['E14_REAL_CARGO'], *args], env)
    # A cargo test that executes tests under ptrace would break E12's own tracing. nextest only builds here.
    if 'test' in args and '--no-run' not in args:
        raise ValueError('build observation requires nextest to execute tests outside strace')
    directory = Path(tempfile.mkdtemp(prefix='cargo-', dir=env['E14_BUILD_OUTPUT']))
    timings = Path(env['E14_TIMINGS'])
    before = {p.name: p.stat().st_mtime_ns for p in timings.glob('*.html')}
    command = [env['E14_REAL_CARGO'], *args]
    if '--timings' not in command:
        command.insert(command.index('--') if '--' in command else len(command), '--timings')
    if not any(arg.startswith('--message-format') for arg in command):
        command.insert(command.index('--') if '--' in command else len(command), '--message-format=json-render-diagnostics')
    traced = [env['E14_STRACE'], '-ff', '-ttt', '-s', '1048576', '-xx', '-e', 'trace=process', '-o', str(directory / 'trace'), *command]
    record = dict(command=command, tracer_command=traced, start=time.time(), exit_code=None, end=None,
                  reports=[], links=[], status='incomplete')
    record_path = directory / 'build.json'
    record_path.write_text(json.dumps(record, indent=2) + '\n')
    child = None
    def interrupt(signum, _frame):
        raise InterruptedError(f'build observer received signal {signum}')
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, interrupt)
    try:
        with (directory / 'strace.stderr').open('w') as errors, (directory / 'cargo.stdout').open('wb') as messages:
            # Forward Cargo's complete JSON stream unchanged after the build, before nextest can execute tests.
            child = subprocess.Popen(traced, env=env, stdout=messages, stderr=errors, start_new_session=True)
            code = child.wait(timeout=15 * 60)
        record.update(end=time.time(), exit_code=code)
        for path in timings.glob('*.html'):
            if path.name != 'cargo-timing.html' and before.get(path.name) != path.stat().st_mtime_ns:
                shutil.copy2(path, directory / path.name)
                record['reports'].append(path.name)
        record['status'] = 'collected'
    except (OSError, subprocess.TimeoutExpired) as error:
        record['collection_error'] = str(error)
        raise
    finally:
        try:
            if child is not None and child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
                # The tracer can exit before a descendant that ignores TERM. Kill the whole owned group.
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait(timeout=5)
                record.update(end=time.time(), exit_code=child.returncode, status='interrupted-or-timeout')
            attempts = _links(directory)
            record['links'] = [r for r in attempts if r['exec_result'] == '0']
            record['exec_failures'] = [r for r in attempts if r['exec_result'] != '0']
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            record.update(status='invalid', collection_error=str(error))
            raise
        finally:
            record_path.write_text(json.dumps(record, indent=2) + '\n')
            if (directory / 'cargo.stdout').exists():
                sys.stdout.buffer.write((directory / 'cargo.stdout').read_bytes())
                sys.stdout.buffer.flush()
    return code if code >= 0 else 1


def report(output):
    """Validate retained collection; missing/failed intervals never become zero timings."""
    builds = [json.loads(p.read_text()) for p in sorted(output.glob('cargo-*/build.json'))]
    if not builds:
        raise ValueError('missing Cargo build observations')
    packages = {}
    for path, row in zip(sorted(output.glob('cargo-*/build.json')), builds):
        if row['status'] != 'collected' or row['exit_code'] != 0:
            raise ValueError(f'failed Cargo collection: {path} (exit {row["exit_code"]})')
        if not row['reports']:
            raise ValueError(f'missing Cargo timing report: {path}')
        if not all(isinstance(row[k], (int, float)) and math.isfinite(row[k]) for k in ('start', 'end')) or row['end'] <= row['start']:
            raise ValueError(f'invalid Cargo interval: {path}')
        if not list(path.parent.glob('trace.*')):
            raise ValueError(f'missing raw process trace: {path}')
        attempts = _links(path.parent)
        row['links'] = [r for r in attempts if r['exec_result'] == '0']
        row['exec_failures'] = [r for r in attempts if r['exec_result'] != '0']
        messages = [json.loads(line) for line in (path.parent / 'cargo.stdout').read_text().splitlines() if line.startswith('{')]
        finished = [m for m in messages if m.get('reason') == 'build-finished']
        if len(finished) != 1 or not finished[0]['success']:
            raise ValueError(f'missing or failed Cargo build-finished record: {path}')
        row['artifacts'] = [m for m in messages if m.get('reason') == 'compiler-artifact']
        if not row['artifacts']:
            raise ValueError(f'missing Cargo compiler artifacts: {path}')
        row['units'] = []
        row['cargo_intervals'] = []
        for name in row['reports']:
            html = path.with_name(name).read_text()
            marker = re.search(r'const UNIT_DATA = ', html)
            profile = re.search(r'<td>Profile:</td><td>([^<]+)</td>', html)
            started = re.search(r'<td>Build start:</td><td>([^<]+)</td>', html)
            duration = re.search(r'(?m)^(?:const )?DURATION = ([0-9.]+);', html)
            if not marker or not profile or not started or not duration:
                raise ValueError(f'unsupported Cargo timing report: {name}')
            start = datetime.fromisoformat(started[1].replace('Z', '+00:00')).timestamp()
            seconds = float(duration[1])
            if not math.isfinite(seconds) or seconds < 0:
                raise ValueError(f'invalid Cargo build duration: {name}')
            row['cargo_intervals'].append(dict(start=start, end=start + seconds, seconds=seconds, profile=profile[1], report=name, source='Cargo HTML Build start + DURATION (rounded by Cargo)'))
            units, _ = json.JSONDecoder().raw_decode(html[marker.end():])
            for unit in units:
                if not all(key in unit for key in ('name', 'version', 'target', 'features', 'duration')) or not math.isfinite(unit['duration']) or unit['duration'] < 0:
                    raise ValueError(f'invalid Cargo compilation unit: {name}')
                row['units'].append(dict(unit, profile=profile[1], report=name))
                package = unit['name'] + '@' + unit['version']
                packages[package] = packages.get(package, 0) + unit['duration']
        for link in row['links']:
            link['cargo_profiles'] = sorted({interval['profile'] for interval in row['cargo_intervals']})
            if link['exec_result'] != '0' or link['exit_code'] != 0 or link['end'] is None or not math.isfinite(link['end']) or link['end'] <= link['start']:
                raise ValueError(f'failed or missing linker interval: {link}')
            if any(arg.startswith('@') for arg in link['argv']):
                raise ValueError(f'unretained linker response file: {link}')
        for artifact in row['artifacts']:
            outputs = [Path(name) for name in artifact['filenames'] if name == artifact['executable'] or Path(name).suffix == '.so']
            if artifact['fresh'] or not outputs:
                continue
            matched = []
            for link in row['links']:
                output = Path(link['output'])
                for expected in outputs:
                    # Cargo copies unhashed binaries out of deps/build dirs after rustc links their hashed outputs.
                    name = re.escape(expected.stem.replace('-', '_')) + r'(?:-[0-9a-f]+)?' + re.escape(expected.suffix)
                    if output == expected or (output.parent in (expected.parent, expected.parent / 'deps') and re.fullmatch(name, output.name)):
                        matched.append(link)
            if not matched:
                raise ValueError(f'missing linker observation for Cargo artifact: {artifact["package_id"]} {artifact["target"]["name"]}')
    if not packages or not any(row['links'] for row in builds):
        raise ValueError('no compiled units or linker intervals; warm/empty build is not a link observation')
    return dict(builds=builds, packages=[dict(package=key, unit_seconds=value) for key, value in sorted(packages.items(), key=lambda p: (-p[1], p[0]))])


if __name__ == '__main__':
    try:
        sys.exit(_proxy())
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f'CI3781 build observation FAILED: {error}', file=sys.stderr)
        sys.exit(1)
