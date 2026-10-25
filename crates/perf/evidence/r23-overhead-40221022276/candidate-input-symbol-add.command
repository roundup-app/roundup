cwd: /tmp/r23-overhead
$ sudo -n perf probe -x /tmp/r23-queue-bins/candidate-instrumented-rupd --add 'r23p:candidate_input=*terminal*write*'
