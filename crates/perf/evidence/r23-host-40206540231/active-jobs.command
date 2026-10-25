cwd: /tmp/roundup-r23-40206540231
$ gh api 'repos/roundup-app/roundup/actions/runs/40206540231/jobs?per_page=100' --jq '[.jobs[] | {id,name,status,conclusion,runner_name,labels,html_url}]'
