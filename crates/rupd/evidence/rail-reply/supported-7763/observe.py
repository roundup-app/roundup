"""R16 evidence collector. Run only after every build/check exits; never changes budgets."""
import datetime
import hashlib
import json
import os
import pathlib
import statistics
import subprocess
import sys

mode, output_dir, *paths = sys.argv[1:]
output = pathlib.Path(output_dir).resolve()
output.mkdir(parents=True, exist_ok=True)
records = output / (mode + '.jsonl')
if records.exists():
    raise SystemExit('Refusing to overwrite retained observations: ' + str(records))
if mode == 'profiles':
    original, repaired, typed_current, typed_historical = paths
    observations = [(f'client-{pair}-{name}', [binary], None, {})
                    for pair in range(1, 4)
                    for name, binary in [('original', original), ('repaired', repaired)]]
    observations += [(f'typed-{name}', [binary], None, {})
                     for name, binary in [('historical', typed_historical), ('current', typed_current)]]
elif mode == 'isolation':
    probe_original, probe_repaired, cwd, daemon = paths
    observations = [(f'{pair}-{name}', [probe, '--runs', '11', '--calls', '1000', '--rupd', daemon], cwd,
                     {'R16_CURRENT_PROTOCOL': '1'})
                    for pair in range(1, 4)
                    for name, probe in [('original', probe_original), ('repaired', probe_repaired)]]
elif mode == 'pairs':
    probe, cwd, historical, repaired = paths
    observations = [(f'{pair}-{name}', [probe, '--runs', '11', '--calls', '1000', '--rupd', daemon], cwd,
                     {'R16_CURRENT_PROTOCOL': '1'} if name == 'repaired' else {})
                    for pair in range(1, 10)
                    for name, daemon in [('historical', historical), ('repaired', repaired)]]
else:
    raise SystemExit('Expected profiles, isolation or pairs')

for name, command, cwd, extra_env in observations:
    attempt = 0
    while True:
        attempt += 1
        stem = f'{mode}-{name}-{attempt}'
        report_path = output / (stem + '.json')
        cmd = command if mode == 'profiles' else command + ['--out', str(report_path)]
        env = dict(os.environ)
        env.pop('R16_CURRENT_PROTOCOL', None)
        env.update(extra_env)
        started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            result = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=180)
            exit_code, log = result.returncode, result.stdout + result.stderr
        except subprocess.TimeoutExpired as err:
            exit_code = 124
            log = str(err)
        report = json.loads(report_path.read_text()) if report_path.exists() else None
        load = statistics.median(report['loads']) / report['cpus'] if report else None
        clean = exit_code == 0 if mode == 'profiles' else report is not None and exit_code in (0, 1) and load <= 2.0
        record = dict(name=name, attempt=attempt, started_at=started_at,
                      ended_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      command=cmd, cwd=cwd, env=extra_env,
                      exit=exit_code, median_load_per_cpu=load, qualification='clean' if clean else 'busy/failed',
                      hashes={path: hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
                              for path in [cmd[0]] + ([cmd[cmd.index('--rupd') + 1]] if '--rupd' in cmd else [])},
                      report=report, log=log)
        with records.open('a') as file:
            file.write(json.dumps(record) + '\n')
        # The append-only row retains the complete report and log before removing scratch output.
        report_path.unlink(missing_ok=True)
        if report:
            print(stem, exit_code, 'load/CPU', load, 'Rail-40', report['metrics']['rail_tree_40_p95_ms'], flush=True)
        else:
            print(stem, exit_code, log.strip(), flush=True)
        # Ceiling misses (exit 1) are observations, never retried into a pass.
        if clean:
            break
        if attempt >= 3:
            raise SystemExit('Three busy/failed attempts retained; repair observer before resuming')
