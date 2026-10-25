cwd: /home/runner/work/roundup/roundup
$ gh api 'repos/roundup-app/roundup/actions/runs/40202161084/jobs?per_page=100' --jq '[.jobs[] | {id,name,status,conclusion,runner_name,labels,html_url}]'
