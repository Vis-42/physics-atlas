#!/bin/sh
# Build a complete artifact and advance Pages once, retaining its previous revision.
set -eu
REPO="${1:-Vis-42/physics-atlas}"
NAME="${REPO#*/}"
cd "$(dirname "$0")/.."
SOURCE_REV="$(git rev-parse --verify HEAD 2>/dev/null || echo unknown)"
BASE_PATH="/$NAME" npx next build
OUT="$(pwd)/out"
touch "$OUT/.nojekyll"
WORK="$(mktemp -d)"
REMOTE="git@github.com:$REPO.git"
git init -q "$WORK"
cd "$WORK"
git remote add origin "$REMOTE"
git fetch --depth=1 origin gh-pages
git checkout -q -b gh-pages FETCH_HEAD
PREVIOUS="$(git rev-parse HEAD)"
echo "Rollback revision: $PREVIOUS"
# Keep the Git metadata; replace only the published artifact.
find . -mindepth 1 -maxdepth 1 ! -name .git ! -name CNAME -exec rm -rf {} +
cp -R "$OUT/." .
git add -A
if git diff --cached --quiet; then
  echo "No publication changes"
  exit 0
fi
git -c user.name="Research Atlas deploy" -c user.email="deploy@users.noreply.github.com" commit -q -m "Publish atlas from $SOURCE_REV"
# One fast-forward update exposes all assets together; reject concurrent changes.
git push origin HEAD:gh-pages
echo "Published revision: $(git rev-parse HEAD)"
echo "Published to https://$(echo "${REPO%%/*}" | tr 'A-Z' 'a-z').github.io/$NAME/"
