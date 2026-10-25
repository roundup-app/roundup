cwd: /tmp/roundup-r23-40212001837
$ gh api 'repos/roundup-app/roundup/actions/runs/40212001837/jobs?per_page=100' --jq '[.jobs[] | {id,name,status,conclusion,runner_name,labels,html_url}]'
