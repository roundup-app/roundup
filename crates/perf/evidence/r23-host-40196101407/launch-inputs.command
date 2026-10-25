cwd: /tmp/roundup-r23-40196101407
$ set -o pipefail
git show HEAD:.github/workflows/build-issue.yml | sed -n '1,65p'
