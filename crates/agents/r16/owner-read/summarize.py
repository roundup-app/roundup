"""Summarize all owner-read timings, retaining each input log."""
import json, pathlib, statistics, sys
root = pathlib.Path(sys.argv[1])
rows=[]
for p in sorted(root.glob('*.stderr')):
 values=[list(map(int,line.split()[2:])) for line in p.read_text().splitlines() if line.startswith('TRACE owner_read ')]
 if not values: continue
 rows.append(dict(file=p.name, writes=len(values), medians_ns=dict(zip(['rail_lock','attempts_lock','prepare','query','owner_resolution','callback'], map(statistics.median,zip(*values))))))
(root/'summary.json').write_text(json.dumps(rows,indent=2)+'\n')
print(json.dumps(rows,indent=2))
