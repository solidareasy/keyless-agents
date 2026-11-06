#!/usr/bin/env bash
# Neither inline annotations nor checkout configuration may suppress a finding.
set -euo pipefail

scan="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/secret-scan.sh"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=selftest GIT_COMMITTER_NAME=selftest
export GIT_AUTHOR_EMAIL=selftest@example.invalid GIT_COMMITTER_EMAIL=selftest@example.invalid

failed=0
for bypass in allow-comment checkout-config; do
  repo="$work/$bypass"
  mkdir -- "$repo"
  git -C "$repo" init --quiet --initial-branch=main
  cd -- "$repo"
  printf 'benign\n' >synthetic.txt
  git add synthetic.txt
  git commit --quiet --message base
  base="$(git rev-parse HEAD)"
  # Assemble a synthetic PAT at runtime; never commit a literal token in source.
  printf 'token = "%s%s"' 'ghp_' 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jK5' >synthetic.txt
  if [[ "$bypass" == allow-comment ]]; then
    printf ' # gitleaks:allow\n' >>synthetic.txt
  else
    printf '\n' >>synthetic.txt
    printf '[extend]\nuseDefault = true\n[allowlist]\npaths = ["synthetic.txt"]\n' >.gitleaks.toml
  fi
  git add .
  git commit --quiet --message "$bypass"
  head="$(git rev-parse HEAD)"
  rc=0
  out="$(SCAN_BASE="$base" SCAN_HEAD="$head" bash "$scan" 2>&1)" || rc=$?
  printf '%s\n' "$out"
  if [[ "$rc" -ne 1 ]] || ! grep -Eq '^RuleID: +github-pat$' <<<"$out" \
    || ! grep -Eq "^Commit: +${head}$" <<<"$out"; then
    echo "suppression regression: ${bypass}: expected exit 1 with github-pat at ${head}, got exit ${rc}" >&2
    failed=1
  else
    echo "suppression regression: ${bypass}: detected synthetic secret (scanner exit 1)"
  fi
  # Also test the self-test under explicitly supplied hostile configuration.
  if [[ "$bypass" == checkout-config ]] && ! GITLEAKS_CONFIG="$repo/.gitleaks.toml" bash "$scan" self-test; then
    echo "suppression regression: ${bypass}: self-test failed" >&2
    failed=1
  fi
done
exit "$failed"
