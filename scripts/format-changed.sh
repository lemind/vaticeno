#!/usr/bin/env bash
# Format the TypeScript this branch touches, and nothing else (AGENTS.md -> Code Style). The repo was
# never reformatted in one pass on purpose: a file reaches 85 columns the first time someone edits it.
#
#   npm run format          # rewrite the changed files
#   npm run format:check    # fail if any of them is unformatted
set -euo pipefail

mode=(--write)
base=origin/main
for arg in "$@"; do
  case "$arg" in
    --check) mode=(--check) ;;
    *) base="$arg" ;;
  esac
done

mapfile -t changed < <(
  {
    git diff --name-only --diff-filter=ACMR "$base...HEAD"
    git diff --name-only --diff-filter=ACMR
    git diff --name-only --diff-filter=ACMR --cached
    git ls-files --others --exclude-standard
  } | sort -u | grep -E '\.ts$' || true
)

present=()
for file in "${changed[@]}"; do
  [ -f "$file" ] && present+=("$file")
done

if [ ${#present[@]} -eq 0 ]; then
  echo "no changed TypeScript to format"
  exit 0
fi

npx prettier "${mode[@]}" "${present[@]}"
