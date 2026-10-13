"""Compare retained R16 invocations without changing any probe budget."""
import json
import pathlib
import statistics

root = pathlib.Path(__file__).parent
rows = [json.loads(line) for line in (root / 'pairs.jsonl').read_text().splitlines()]
budgets = json.loads(pathlib.Path('/tmp/rpc-1374-history/crates/perf/budgets.json').read_text())
historical = [row for row in rows if row['name'].endswith('historical') and row['qualification'] == 'clean']
repaired = [row for row in rows if row['name'].endswith('repaired') and row['qualification'] == 'clean']
assert len(historical) == len(repaired) == 9
metrics = {}
for metric, budget in budgets.items():
    baseline = statistics.median(row['report']['metrics'][metric] for row in historical)
    ceiling = baseline * 1.10 + budget.get('noise', 0) if 'baseline' in budget else None
    metrics[metric] = {
        'historical_median': baseline,
        'repaired_median': statistics.median(row['report']['metrics'][metric] for row in repaired),
        'historical_regression_ceiling': ceiling,
        'absolute_limit': budget.get('limit'),
        'repaired_clean_regression_misses': [row['name'] for row in repaired
            if ceiling is not None and row['report']['metrics'][metric] > ceiling],
        'absolute_misses_at_any_load': [row['name'] for row in rows if row['report']
            and 'limit' in budget and row['report']['metrics'][metric] > budget['limit']],
    }
    if metric == 'rss_extra_mb':
        metrics[metric]['regression_misses_at_any_load'] = [row['name'] for row in rows
            if row['name'].endswith('repaired') and row['report']
            and row['report']['metrics'][metric] > ceiling]
result = {
    'clean_pairs': 9,
    'all_observation_exits': [row['exit'] for row in rows],
    'busy_or_failed': [row['name'] for row in rows if row['qualification'] != 'clean'],
    'max_clean_median_load_per_cpu': max(row['median_load_per_cpu'] for row in historical + repaired),
    'metrics': metrics,
    'policy': 'Historical median * 1.10 + existing noise; every existing absolute limit; RSS at every load',
}
(root / 'comparison.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
