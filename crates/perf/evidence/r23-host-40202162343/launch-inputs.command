cwd: /home/runner/work/roundup/roundup
$ set -o pipefail
git show HEAD:.github/workflows/build-issue.yml | sed -n '1,100p'
