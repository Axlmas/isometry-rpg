#!/usr/bin/env bash
# Builds the whole GitHub Pages site:
#   main          -> site root
#   other branch  -> preview/<branch-slug>/
#   preview/      -> index page listing all previews
# A branch with package.json is built with `npm run build` (output: dist/),
# a branch without it is published as a static index.html.
set -euo pipefail

OUT="$(realpath -m "${1:-_site}")"
TRIGGER_BRANCH="${TRIGGER_BRANCH:-}"
DEFAULT_BRANCH="main"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; git worktree prune' EXIT

rm -rf "$OUT"
mkdir -p "$OUT/preview"

git fetch --depth=1 --no-tags --prune origin '+refs/heads/*:refs/remotes/origin/*'

slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's#[^a-z0-9._-]+#-#g; s#^-+|-+$##g'
}

html_escape() {
  sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

# Explicit `|| return 1` on every step: `set -e` is ignored inside functions
# called from an `if` condition, so we cannot rely on it here.
build_branch() { # $1 = branch, $2 = absolute destination dir
  local branch="$1" dest="$2"
  local src="$WORK/src-$(slugify "$branch")"
  git worktree add --detach "$src" "origin/$branch" >/dev/null || return 1
  mkdir -p "$dest" || return 1
  if [ -f "$src/package.json" ]; then
    local install="npm install"
    [ -f "$src/package-lock.json" ] && install="npm ci"
    (cd "$src" || exit 1
      $install --no-audit --no-fund || exit 1
      VITE_BRANCH="$branch" npm run build || exit 1
      cp -R dist/. "$dest/" || exit 1
    ) || return 1
  else
    cp "$src/index.html" "$dest/" || return 1
  fi
}

failure_page() { # $1 = branch, $2 = destination dir
  local name
  name="$(echo "$1" | html_escape)"
  mkdir -p "$2"
  cat > "$2/index.html" <<EOF
<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Build failed: $name</title>
<style>body{margin:0;padding:24px 16px;background:#12141a;color:#e6e1d6;font-family:system-ui,sans-serif}</style>
</head><body>
<h1>Сборка ветки не прошла</h1>
<p>Ветка <code>$name</code>. Подробности в логах GitHub Actions.</p>
</body></html>
EOF
}

# 1. Default branch at the root. If it fails, abort so the previous deploy stays live.
echo "::group::Build $DEFAULT_BRANCH"
build_branch "$DEFAULT_BRANCH" "$OUT"
echo "::endgroup::"

# 2. Every other branch under preview/<slug>/.
failed=()
rows=""
while IFS= read -r branch; do
  case "$branch" in
    "" | HEAD | "$DEFAULT_BRANCH") continue ;;
  esac
  slug="$(slugify "$branch")"
  dest="$OUT/preview/$slug"
  status="ok"
  echo "::group::Build $branch -> preview/$slug/"
  if ! build_branch "$branch" "$dest"; then
    echo "::warning::Build failed for branch $branch"
    rm -rf "$dest"
    failure_page "$branch" "$dest"
    failed+=("$branch")
    status="build failed"
  fi
  echo "::endgroup::"
  info="$(git log -1 --format='%cs · %s' "origin/$branch" | html_escape)"
  name="$(echo "$branch" | html_escape)"
  rows+="<li><a href=\"./$slug/\">$name</a><span>$info</span>"
  [ "$status" = "ok" ] || rows+="<b>$status</b>"
  rows+="</li>"$'\n'
done < <(git for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin)

# 3. Preview index.
[ -n "$rows" ] || rows="<li>Пока нет веток с превью.</li>"
cat > "$OUT/preview/index.html" <<EOF
<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Isometry RPG previews</title>
<style>
  body{margin:0;padding:24px 16px;background:#12141a;color:#e6e1d6;font-family:system-ui,sans-serif}
  main{max-width:640px;margin:0 auto} a{color:#7fd1b9} ul{padding:0;list-style:none}
  li{padding:12px 0;border-bottom:1px solid #2a2d36;display:flex;flex-direction:column;gap:4px}
  span{color:#8f8a80;font-size:14px} b{color:#e07a5f;font-size:14px}
</style>
</head><body><main>
<h1>Превью веток</h1>
<p><a href="../">← Основная версия (main)</a></p>
<ul>
$rows</ul>
</main></body></html>
EOF

if [ ${#failed[@]} -gt 0 ]; then
  echo "Failed previews: ${failed[*]}"
  for b in "${failed[@]}"; do
    if [ "$b" = "$TRIGGER_BRANCH" ]; then
      echo "::error::Build failed for the branch that triggered this run: $b"
      exit 1
    fi
  done
fi
