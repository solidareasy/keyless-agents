#!/usr/bin/env bash
# Exercise the production scan against a secret introduced only by a merge.
set -euo pipefail

scan="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/secret-scan.sh"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
# Keep the synthetic history independent of user signing, hooks and identity.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=selftest GIT_COMMITTER_NAME=selftest
export GIT_AUTHOR_EMAIL=selftest@example.invalid GIT_COMMITTER_EMAIL=selftest@example.invalid

git -C "$work" init --quiet --initial-branch=main
cd -- "$work"
printf 'base\n' >synthetic.txt
git add synthetic.txt
git commit --quiet --message base
base="$(git rev-parse HEAD)"
git checkout --quiet -b side
printf 'side\n' >synthetic.txt
git commit --quiet --all --message side
git checkout --quiet main
printf 'main\n' >synthetic.txt
git commit --quiet --all --message main
# Both parents are benign. Require an actual conflict, not a fast-forward.
rc=0
git merge --no-ff side --message merge >merge.log 2>&1 || rc=$?
[[ "$rc" -eq 1 && -n "$(git ls-files --unmerged)" ]]
# Assemble the fake token at runtime, never store a scannable token in source.
printf 'token = "%s%s"\n' 'ghp_' 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jK5' >synthetic.txt
git add synthetic.txt
git commit --quiet --message resolution
merge="$(git rev-parse HEAD)"
[[ "$(git show "${merge}^1:synthetic.txt")" == main ]]
[[ "$(git show "${merge}^2:synthetic.txt")" == side ]]
echo "merge regression: patch bytes default=$(git log -1 -p --format= | wc -c), first-parent=$(git log -1 -p --format= --diff-merges=first-parent | wc -c)"
printf 'removed\n' >synthetic.txt
git commit --quiet --all --message remove
head="$(git rev-parse HEAD)"
# HEAD no longer has the token; both known-base and full-history scans must
# still report the merge commit (not merely a removal line or another commit).
for scan_base in "$base" 0000000000000000000000000000000000000000; do
  rc=0
  out="$(SCAN_BASE="$scan_base" SCAN_HEAD="$head" bash "$scan" 2>&1)" || rc=$?
  printf '%s\n' "$out"
  if [[ "$rc" -ne 1 ]] || ! grep -Eq '^RuleID: +github-pat$' <<<"$out" \
    || ! grep -Eq "^Commit: +${merge}$" <<<"$out"; then
    echo "merge regression: expected exit 1 with github-pat at merge ${merge}, got exit ${rc}" >&2
    exit 1
  fi
  echo "merge regression: detected merge-only secret (scanner exit 1)"
done
# A later benign change must stay clean when the merge is outside the range.
printf 'benign\n' >synthetic.txt
git commit --quiet --all --message benign
SCAN_BASE="$head" SCAN_HEAD="$(git rev-parse HEAD)" bash "$scan"
echo 'merge regression: benign range passed'
