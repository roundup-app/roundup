cwd: /tmp/roundup-r23-40206540231
$ set -o pipefail
git show HEAD:.github/workflows/build-issue.yml | sed -n '1,100p'
