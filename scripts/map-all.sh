#!/bin/sh
# Maps the institutions chosen by quality score (fetch-elite.mjs), then switches the published atlas to
# them and republishes. The switch happens only once every one is fully mapped, so nothing on the site is
# empty; until then the site stays as it is. Nothing is bulk-downloaded (see scripts/cache.mjs). Every step
# is cached and resumable, so when a day's OpenAlex allowance runs out it carries on after the next reset.
cd "$(dirname "$0")/.."
KEY=$(cat .cache/openalex-key)
node scripts/cache.mjs
allowance() { until [ "$(curl -s -D - -o /dev/null "https://api.openalex.org/subfields?per_page=1&api_key=$KEY" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-ratelimit-remaining-usd"{print ($2>0.05)}')" = "1" ]; do sleep 600; done; echo "allowance available $(date)"; }
export ATLAS_FILE="$(pwd)/.cache/atlas-next.json"
echo staged > .cache/atlas-state
until [ "$(cat .cache/atlas-state)" = "ready" ]; do
  allowance
  node scripts/fetch-elite.mjs
  if [ -f .cache/selection.json ]; then
    node scripts/build-atlas.mjs | tail -1
    node scripts/fetch-heat.mjs
    node scripts/build-atlas.mjs | tail -1
    node scripts/fetch-quality.mjs
    node scripts/fetch-general-links.mjs
    node scripts/fetch-people.mjs | tail -1
    node scripts/fetch-samples.mjs
    node scripts/build-atlas.mjs | tail -1
  fi
  [ "$(cat .cache/atlas-state)" = "ready" ] || sleep 1800
done
unset ATLAS_FILE
node --max-old-space-size=12288 scripts/build-links2.mjs
node scripts/build-analysis.mjs
node scripts/build-index.mjs
node scripts/build-atlas.mjs | tail -1
du -sh .cache
npx next build >/dev/null && sh scripts/deploy-gh-pages.sh Vis-42/physics-atlas
echo "finished $(date)"
