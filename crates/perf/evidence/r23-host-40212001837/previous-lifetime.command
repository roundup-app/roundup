cwd: /tmp/roundup-r23-40212001837
$ gh api 'repos/roundup-app/roundup/actions/runs/40200071512/jobs?per_page=100' --jq '[.jobs[] | select(.name == "build #4032 / build") | {id,name,status,conclusion,started_at,completed_at,runner_name,labels,html_url}]'
