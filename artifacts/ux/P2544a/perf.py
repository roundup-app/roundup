"""P2544 Pad observer. Run baseline/head Vite dev servers at 5201/5202 first.

python3 artifacts/ux/P2544a/perf.py <baseline-commit> <head-commit>
Only isolated headless Chromium is measured; this is no native timing claim.
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
CLI = ROOT / 'apps/desktop/node_modules/agent-browser/bin/agent-browser-linux-x64'
OUT = pathlib.Path(__file__).resolve().parent
SESSION = 'p2544-perf'


def ab(*args):
    result = subprocess.run([str(CLI), '--session', SESSION, *args], cwd=ROOT,
                            capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError(f'{args}: {result.stderr}')
    return result.stdout


def ev(source):
    return json.loads(ab('eval', source))


fixture = '\n\n'.join(f'Paragraph {n}: ordinary prose to edit.' for n in range(100))
fixture += '\n\n| A | B |\n| - | - |\n| one | two |\n\n'
fixture += '```mermaid\ngraph LR\n A --> B\n```\n\n'
fixture += '```excalidraw\n{"type":"excalidraw","elements":[]}\n```\n'
(OUT / 'perf-fixture.md').write_text(fixture)
report = {'command': 'python3 artifacts/ux/P2544a/perf.py ' + ' '.join(sys.argv[1:]),
          'viewport': [1512, 950], 'mode': 'Vite development',
          'observer': 'trusted keydown to next requestAnimationFrame; 1000 prose keys',
          'native_claim': False, 'runs': {}, 'failures': []}
try:
    ab('set', 'viewport', '1512', '950')
    ab('set', 'media', 'light')
    for side, port, commit in [('base', 5201, sys.argv[1]), ('head', 5202, sys.argv[2])]:
        ab('open', f'http://127.0.0.1:{port}/harness.html?seed=tree-40')
        ab('wait', '#shelf-tab-pads')
        ev("window.__fake.app.rpc('pad.write', " + json.dumps({'name': 'pad-3', 'text': fixture}) + ')')
        ab('click', '#shelf-tab-pads')
        ab('wait', '[data-shelf-row] .pad-name')
        ev("document.querySelectorAll('[data-shelf-row] .pad-name')[3].click()")
        ab('wait', '.visual-mermaid svg')
        ab('wait', '.visual-drawing .excalidraw')
        ab('focus', '.ProseMirror')
        ab('press', 'Control+Home')
        ev("""(() => {
          window.__padSamples = [];
          document.querySelector('.ProseMirror').addEventListener('keydown', event => {
            if (!event.isTrusted || event.key.length !== 1) return;
            const start = performance.now();
            requestAnimationFrame(() => window.__padSamples.push(performance.now() - start));
          });
          return true;
        })()""")
        for _ in range(1000):
            ab('press', 'x')
        ab('wait', '--fn', 'window.__padSamples.length === 1000')
        samples = ev('window.__padSamples')
        p95 = sorted(samples)[949]
        report['runs'][side] = {'commit': commit, 'p95_ms': p95, 'samples_ms': samples}
    base, head = (report['runs'][s]['p95_ms'] for s in ['base', 'head'])
    if head >= 16:
        report['failures'].append(f'Head p95 {head} ms is not below 16 ms')
    if head > base * 1.1:
        report['failures'].append(f'Head p95 {head} ms exceeds baseline {base} ms by over 10%')
except Exception as error:
    report['failures'].append(str(error))
    report['partial_samples_ms'] = ev('window.__padSamples ?? []')
finally:
    ab('close')
    (OUT / 'perf.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({s: {k: v for k, v in r.items() if k != 'samples_ms'} for s, r in report['runs'].items()}))
print(json.dumps(report['failures']))
sys.exit(bool(report['failures']))
