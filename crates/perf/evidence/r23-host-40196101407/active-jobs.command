cwd: /tmp/roundup-r23-40196101407
$ gh api repos/roundup-app/roundup/actions/runs/40196101407/jobs --jq '.jobs[] | {id,name,status,runner_id,runner_name,runner_group_name,labels}'
