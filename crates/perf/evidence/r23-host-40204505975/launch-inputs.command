cwd: /tmp/roundup-r23-40204505975
$ set -o pipefail
git show HEAD:.github/workflows/build-issue.yml | sed -n '1,100p'
