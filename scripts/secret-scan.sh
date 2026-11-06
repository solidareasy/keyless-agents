#!/usr/bin/env bash
# Secret scanning gate (REQUIREMENTS.md, quality gate 5).
#
#   secret-scan.sh              scan the commits of the change (SCAN_BASE..SCAN_HEAD)
#   secret-scan.sh self-test    prove the scanner fails on a synthetic secret
#
# Uses default gitleaks rules from a generated temporary config, not the checkout.
# Inline gitleaks:allow comments are disabled; the only repository-controlled
# suppression is the exact-fingerprint `.gitleaksignore`. Findings are redacted.
set -euo pipefail

gitleaks="${GITLEAKS_BIN:-gitleaks}"
zero=0000000000000000000000000000000000000000
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
config="$work/gitleaks.toml"
printf '[extend]\nuseDefault = true\n' >"$config"

case "${1:-scan}" in
  scan)
    head="${SCAN_HEAD:?SCAN_HEAD is required}"
    base="${SCAN_BASE:-$zero}"
    # A known base limits the scan to the change; otherwise (new branch, unknown
    # base) scan every commit reachable from head. Never HEAD-only.
    if [[ "$base" != "$zero" ]] && git cat-file -e "${base}^{commit}" 2>/dev/null; then
      range="${base}..${head}"
    else
      range="${head}"
    fi
    echo "secret-scan: scanning ${range}"
    "$gitleaks" git --ignore-gitleaks-allow --config "$config" --no-banner --no-color --redact --verbose --exit-code 1 --log-opts="--diff-merges=first-parent $range" .
    ;;
  self-test)
    repo="$work/repo"
    mkdir -- "$repo"
    git -C "$repo" init --quiet
    # Assembled at run time so this file never contains a scannable token.
    printf 'token = "%s%s" # gitleaks:allow\n' 'ghp_' 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jK5' >"$repo/synthetic.txt"
    git -C "$repo" add synthetic.txt
    git -C "$repo" -c user.name=selftest -c user.email=selftest@example.invalid \
      commit --quiet --message synthetic
    rc=0
    out="$("$gitleaks" git --ignore-gitleaks-allow --config "$config" --no-banner --no-color --redact --verbose --exit-code 1 --log-opts=HEAD "$repo" 2>&1)" || rc=$?
    printf '%s\n' "$out"
    if [[ "$rc" -eq 1 ]] && grep -Eq '^RuleID: +github-pat$' <<<"$out"; then
      echo "secret-scan self-test: scanner failed on the synthetic secret as required"
    else
      echo "secret-scan self-test: expected exit 1 with a github-pat finding, got exit ${rc}" >&2
      exit 1
    fi
    ;;
  *)
    echo "usage: secret-scan.sh [scan|self-test]" >&2
    exit 2
    ;;
esac
