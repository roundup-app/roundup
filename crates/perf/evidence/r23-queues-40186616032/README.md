# R23 qualified task/queue capture (#3991)

Builder 40186616032, job 121148876933, runner GitHub Actions 1000013020.
`qualification.exit` is 0 on the exact R16 9V45 identity. `boot-before.stdout`
and `jobs-before.stdout` retain the live execution identity. Qualification alone
completes no capture acceptance. Raw capture and executable retention follow in
this PR; #3983 owns their assessment, under #3760 and #3720.
