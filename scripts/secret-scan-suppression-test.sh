#!/usr/bin/env bash
# Neither annotations, checkout config nor diff attributes may suppress a finding.
set -euo pipefail

scan="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/secret-scan.sh"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=selftest GIT_COMMITTER_NAME=selftest
export GIT_AUTHOR_EMAIL=selftest@example.invalid GIT_COMMITTER_EMAIL=selftest@example.invalid

failed=0
for bypass in allow-comment checkout-config attributes-no-diff attributes-binary; do
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
  bases=("$base")
  case "$bypass" in
    allow-comment)
      printf ' # gitleaks:allow' >>synthetic.txt
      ;;
    checkout-config)
      printf '[extend]\nuseDefault = true\n[allowlist]\npaths = ["synthetic.txt"]\n' >.gitleaks.toml
      ;;
    attributes-no-diff|attributes-binary)
      if [[ "$bypass" == attributes-no-diff ]]; then
        printf 'synthetic.txt -diff\n' >.gitattributes
      else
        printf '*.txt binary\n' >.gitattributes
      fi
      # Exercise both a known-base range and the full-history fallback.
      bases+=(0000000000000000000000000000000000000000)
      ;;
  esac
  printf '\n' >>synthetic.txt
  git add .
  git commit --quiet --message "$bypass"
  head="$(git rev-parse HEAD)"
  for scan_base in "${bases[@]}"; do
    rc=0
    out="$(SCAN_BASE="$scan_base" SCAN_HEAD="$head" bash "$scan" 2>&1)" || rc=$?
    printf '%s\n' "$out"
    if [[ "$rc" -ne 1 ]] || ! grep -Eq '^RuleID: +github-pat$' <<<"$out" \
      || ! grep -Eq "^Commit: +${head}$" <<<"$out"; then
      echo "suppression regression: ${bypass} base=${scan_base}: expected exit 1 with github-pat at ${head}, got exit ${rc}" >&2
      failed=1
    else
      echo "suppression regression: ${bypass} base=${scan_base}: detected github-pat at ${head} (scanner exit 1)"
    fi
  done
  # Also test the self-test under explicitly supplied hostile configuration.
  if [[ "$bypass" == checkout-config ]] && ! GITLEAKS_CONFIG="$repo/.gitleaks.toml" bash "$scan" self-test; then
    echo "suppression regression: ${bypass}: self-test failed" >&2
    failed=1
  fi
done
exit "$failed"
