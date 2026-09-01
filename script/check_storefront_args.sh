#!/usr/bin/env bash
#
# Every NEXT_PUBLIC_ name the storefront reads must be declared in its Dockerfile.
#
#   script/check_storefront_args.sh
#
# ── why ──────────────────────────────────────────────────────────────────────
#
# NEXT_PUBLIC_* is inlined into the bundle at BUILD time. Docker silently ignores
# a --build-arg the Dockerfile does not declare. Put those together and a setting
# passed correctly on the command line simply does not exist in the built site,
# with no error anywhere.
#
# This has now happened twice on this project:
#
#   the contact page   shipped with neutral defaults and no form, because three
#                      CONTACT_ args were passed and never declared
#   the canada shop    redirected / to /us/en, because NEXT_PUBLIC_DEFAULT_COUNTRY
#                      was passed as ca and dropped, leaving the "us" fallback
#
# Both were found by looking at the result, not by anything failing. So compare
# the two lists directly.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

SRC='storefront/src'
DOCKERFILE='storefront/Dockerfile'
[ -f "$DOCKERFILE" ] || { echo "no $DOCKERFILE"; exit 1; }

# Comment lines are stripped first. A JSDoc block explaining the rule mentions
# `process.env.NEXT_PUBLIC_SOMETHING`, and the first version of this check
# reported that placeholder as a missing build arg. A check that cries wolf is a
# check that gets ignored, which is exactly the failure it exists to prevent.
read_names=$(grep -rh --include='*.ts' --include='*.tsx' -E 'process\.env\.NEXT_PUBLIC_[A-Z0-9_]+' "$SRC" 2>/dev/null \
  | grep -vE '^\s*(//|\*|/\*)' \
  | grep -oE 'process\.env\.NEXT_PUBLIC_[A-Z0-9_]+' \
  | sed 's/process\.env\.//' | sort -u)
declared=$(grep -oE '^ARG NEXT_PUBLIC_[A-Z0-9_]+' "$DOCKERFILE" | awk '{print $2}' | sort -u)

missing=$(comm -23 <(printf '%s\n' "$read_names") <(printf '%s\n' "$declared"))
# The other direction is only a tidiness issue: an ARG nothing reads is dead
# weight, not a broken build, so it prints as a note and does not fail.
unused=$(comm -13 <(printf '%s\n' "$read_names") <(printf '%s\n' "$declared"))

count() { printf '%s' "$1" | grep -c . ; }

echo "  $(count "$read_names") NEXT_PUBLIC_ name(s) read by the source"
echo "  $(count "$declared") declared as ARG in the Dockerfile"

if [ -n "$unused" ]; then
  echo ''
  echo "  declared but never read (harmless, worth tidying):"
  printf '%s\n' "$unused" | sed 's/^/    /'
fi

if [ -z "$missing" ]; then
  echo ''
  echo 'ok — every name the storefront reads can be set at build time'
  exit 0
fi

cat <<MSG

$(count "$missing") name(s) the storefront READS are not declared in $DOCKERFILE:

$(printf '%s\n' "$missing" | sed 's/^/  /')

Passing any of these with --build-arg does nothing and says nothing. Add an
ARG and a matching ENV line for each, next to the others.
MSG
exit 1
