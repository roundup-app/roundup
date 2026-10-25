cwd: /tmp/r23-probe
$ sudo -n perf report -i /tmp/r23-candidate.data --stdio --show-nr-samples --percent-limit 0.5 --no-children --call-graph none
