cwd: /tmp/r23-work
$ gh api repos/torvalds/linux/commits -f path=tools/perf -f per_page=1 --method GET --jq '.[0] | {sha,html_url,date:.commit.committer.date}'
