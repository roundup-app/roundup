cwd: /tmp/r23-work
$ bash -o pipefail -c 'gzip -dc /tmp/r23-work/crates/perf/evidence/r23-queues-40186616032/historical-instrumented-common-kernel.data.gz | zstd -T1 -10 -o /tmp/r23-work/crates/perf/evidence/r23-queues-40186616032/historical-instrumented-common-kernel.data.zst'
