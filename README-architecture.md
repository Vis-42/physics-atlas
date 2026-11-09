# netwrk Atlas: how it fits together

One canvas, one continuous zoom from the world down to one researcher. Nothing on the map is pre-drawn:
every frame draws territories, roads, dots and labels from what is in memory (names, institutions,
links), and the layout (positions, territory outlines) is computed in the browser.

## Front end (`lib/`)

Each piece of shared state is owned by one module. Other modules read it through ES live bindings
(`import { T } from './camera'`) and change it only through that module's functions.

| Module | Owns | Does |
|---|---|---|
| `atlas.js` | `A` (world, view, selection, phase, heat, net), listeners | Public API for the React components: `start`, loading (`loadDetail`, topics, people index), views (`setPhase`), styles, and re-exports `go`, `goPerson`, `up`, `searchItems`. |
| `camera.js` | `T` (zoom transform), canvas size, `VP` (the free part of the screen), flight, momentum, wheel | Fitting (`cam.*`), pan limits (`constrain`), smoothed wheel, flights (`flyTo`), drag momentum, and the wrap helpers `wrapX`, `dxw`, `sxOf`, `worldCopies`. |
| `projection.js` | n/a | The map projection (oblique Equal Earth) and wrap arithmetic. |
| `loop.js` | the animation frame | `kick()` asks for a frame; frames continue only while something moves. |
| `focus.js` | `fcountry`, `funi`, `farea` | Each frame, which country, institution and area is in focus and how open each is (the semantic zoom). |
| `nav.js` | the address bar state | `go`, `up`, `readHash`, `syncView`: the URL hash and the view stay in step. |
| `draw.js` | label-control boxes | One frame: territories, roads, dots, labels. |
| `overlays.js` | n/a | Heat maps, a subfield's world network, exits at campus/area edges, land, grid. |
| `paint.js` | `P` (shared canvas context) | Low-level painting: territories, dots, roads, great-circle arcs, priority label placement (with dot obstacles and leader lines), hit testing. |
| `input.js` | n/a | Pointer, click, keyboard, tooltips. |
| `search.js` | n/a | Search across countries, institutions, views, areas and people. |
| `model.js` | n/a | Turns the data files into a laid-out world (`buildWorld`) and an institution's inside (`buildDetail`). |
| `phase.js` | n/a | Views (all research, physics, field, subfield, topic) and the significance measure. |

## The map

- **Projection.** Equal Earth rotated by `[-10, -35, 0]`, placing 10°E, 35°N at the
  center. Rotation changes framing while preserving relative geographic areas. No research-weighted
  displacement grid is loaded or built. Crowding is handled consistently by institution collision
  layout and priority labels with leader lines, not by enlarging individual regions.
- **Navigation.** The homepage and world reset fit the complete globe on desktop and mobile.
  The oblique outline is bounded, with no horizontal repetition. Explicit entity links still work.
- **Seams.** Geographic paths and research arcs use D3's rotated spherical clipping. Country landing
  views fit the connected main-landmass piece nearest their geographic anchor.

## Researcher verification (`scripts/fetch-authors.mjs`, `verify-people.mjs`, `apply-people.mjs`)

Every researcher on the map is checked against their own OpenAlex profile (100 profiles per lookup,
~3,200 lookups for the whole map). `npm run verify` fetches and writes a dry-run decision for every
placement to `.cache/verify/decisions.json`; `apply-people.mjs` carries it out and repairs every
reference (links, suggestions, co-authors elsewhere); then `build-index.mjs` rebuilds search.
The rules (top of `verify-people.mjs`):
- **Inactive**: fewer than 2 papers since 2024: removed.
- **Fused profile**: OpenAlex sometimes merges everyone with a common name. Removed when there are 20+
  organisations since 2024 at 0.4+ per recent paper, or 2,000+ papers at 40+ papers per point of h-index.
- **One home**: the current affiliation weighed by recent years and years held (a single 2026 paper
  elsewhere does not outweigh a long-standing home). Concurrent appointments (a hospital and its
  university) keep the person where they are shown, the most specific place first. If their real home is
  off the map they are removed; if it is another map institution they move there.
- **Department**: the subfield that carries most of their work among the institution's 18 biggest; a
  weak fit (10%+) stays only when nothing fits better; under 10% everywhere there: removed.
The rules were tuned against 20 audit agents' verdicts on stratified samples (`.cache/verify/audit*`,
`score.mjs`): on institutions the agents had not seen before tuning, the rules matched 96% of
confident verdicts.

## Data pipeline (`scripts/`)

OpenAlex answers are cached gzip-compressed in `.cache/`; every step is resumable. `npm run data` runs
the main chain and ends with `build-projection.mjs`. `sh scripts/deploy-gh-pages.sh [owner/repo]`
builds with `BASE_PATH` and publishes to GitHub Pages.

## Optional researcher views

Subfields open in **Institutions** mode. **Career leaders** and **Frontier now** load their own
network on demand and replace institutional dots, labels, statistics and heat layers with a focused
researcher layer. Geography, search, coauthorship links, selections and map styles remain available.
Researcher choices are shareable as `#s3105:world~career` or `#s3105:world~frontier`. Switching
subfields defaults to Institutions; navigating to an institution also leaves researcher mode.
Loading, missing-data and retry states never substitute career metrics for recent evidence.

`npm run data:frontier` builds independent `public/data/frontier/s<ID>.json` snapshots. Optional
subfield IDs narrow a run; `AS_OF=YYYY-MM-DD` pins its date. Cache files stay in `.cache/frontier`;
completed same-date snapshots are skipped, and the command stops on rate limits. It does not change
the staged atlas or existing career data. Publication dates cover the rolling three years ending
on the snapshot date. Candidates are the leading 100 authors by subfield papers in OpenAlex's
normalized top citation decile, with at least two such papers. Exact grouped subfield publication
counts verify at least one paper in the last 12 months. Up to 60 eligible authors are ranked by
recent top-decile count, then last-12-month publication count, then ID. Each coauthor receives full
credit. Career h-index does not enter this ranking. Links are a sample from up to 100 highly cited
papers in the same window, not a complete collaboration census. Current institution coordinates are resolved in a separate batch without modifying the staged
institution index. Unresolved affiliations may be placed approximately at country level; unresolved locations remain in the panel and search.

Snapshots carry date bounds, candidate limits, sampling and methodology. Citation lag, full-count
collaboration effects, author-profile errors and the bounded candidate set limit interpretation.
Run `npm test` for geographic-edge and researcher-data regression checks, `npm run test:data`
for a complete, consistently dated frontier dataset, then `npm run build`.
Source is kept on `main`; the complete static artifact is published to `gh-pages` by a single
fast-forward update. `.cache`, credentials, dependencies and build outputs are excluded from source.

Browser regression checks: serve a completed static build, then run `npm run test:browser` with
`TEST_BASE_URL` set to its root (including the project path if present). Playwright must be
resolvable as `playwright`, or supplied via `PLAYWRIGHT_MODULE`; `CHROME_BIN` optionally selects
a local Chrome executable. These checks cover opt-in loading, clean layers, researcher search,
selection, shared links, retries, missing snapshots, zoom and stale-request isolation.
