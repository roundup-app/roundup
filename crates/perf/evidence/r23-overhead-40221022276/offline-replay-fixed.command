python3 /tmp/assess-overhead.py crates/perf/evidence/r23-overhead-40221022276 /tmp/r23-offline-replay-fixed
cmp /tmp/r23-offline-replay-fixed/assessment.json /tmp/r23-assessment-final/assessment.json
cmp /tmp/r23-offline-replay-fixed/table.md crates/perf/evidence/r23-overhead-40221022276/table.md
