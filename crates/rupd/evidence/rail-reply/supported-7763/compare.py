"""Summarize retained observations without changing any budget or removing a miss."""
import json
import pathlib
import statistics
import sys

root = pathlib.Path(__file__).resolve().parent
rows = [json.loads(line) for line in (root / 'observations/pairs.jsonl').read_text().splitlines()]
budgets = json.loads(pathlib.Path(sys.argv[1]).read_text())
clean = [row for row in rows if row['qualification'] == 'clean']
historical = [row for row in clean if row['name'].endswith('historical')]
repaired = [row for row in clean if row['name'].endswith('repaired')]
if len(historical) != 9 or len(repaired) != 9:
    raise SystemExit('Acceptance requires nine clean invocations per reference')
summary = {'clean_invocations': {'historical': len(historical), 'repaired': len(repaired)},
           'observations': len(rows), 'exits': [row['exit'] for row in rows],
           'maximum_clean_load_per_cpu': max(row['median_load_per_cpu'] for row in clean),
           'metrics': {}}
for metric in historical[0]['report']['metrics']:
    budget = budgets[metric]
    baseline = statistics.median(row['report']['metrics'][metric] for row in historical)
    ceiling = baseline * 1.10 + budget.get('noise', 0) if 'linux' in budget.get('baseline', {}) else budget['limit']
    values = [row['report']['metrics'][metric] for row in repaired]
    # RSS is evaluated on every retained repaired report, including busy invocations.
    qualified = [row for row in rows if row['name'].endswith('repaired') and row['report']
                 and (metric == 'rss_extra_mb' or row['qualification'] == 'clean')]
    summary['metrics'][metric] = {'historical_median': baseline, 'ceiling': ceiling,
        'comparison': 'historical * 1.10 + existing noise' if 'linux' in budget.get('baseline', {}) else 'existing absolute limit',
        'repaired_median': statistics.median(values), 'repaired_values': values,
        'ceiling_misses': sum(row['report']['metrics'][metric] > ceiling for row in qualified),
        'absolute_limit': budget.get('limit'),
        'absolute_limit_misses': sum(row['report']['metrics'][metric] > budget.get('limit', float('inf'))
                                    for row in rows if row['report'])}
(root / 'comparison.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
