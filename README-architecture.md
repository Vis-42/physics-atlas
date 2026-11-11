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

## Institutional evidence, country strengths and appearance

`npm run data:evidence` refreshes static, per-entity snapshots from OpenAlex. The script reads `OPENALEX_API_KEY` or the ignored `.cache/openalex-key`, caches compressed responses, retries temporary failures, and writes atomically. Set `AS_OF=YYYY-MM-DD` to resume a specific snapshot date. Optional arguments `countries` and `institutions` select a collection. Existing same-date entity snapshots are reused. The prior atlas/people pipeline is independent.

`public/data/institutions/I*.json` contains documented funded initiatives, named recipients, original source links, status dates, and research activity. It covers awards beginning in the last five complete years/current year plus older awards with a current or future end year. It cannot establish a complete inventory of centers, partnerships or programs, and makes no public/private ownership assumptions. The same evidence policy applies to all mapped institutions.

Funding charts estimate new commitments by award start year, not annual revenue, spending or total institutional budgets. Positive reported amounts are split equally among distinct named recipients; awards with a parent are excluded to reduce component duplication. Currencies stay separate, without inflation adjustment. Missing amounts remain missing. The current year is labeled YTD; growth compares the last two complete years. Separate grant-linked publication counts show acknowledged research activity, not money or proof that every affiliated institution received an award. Incomplete indexing and attribution limit comparisons.

`public/data/country-strengths/CC.json` uses country-affiliated publications for the five complete years before the snapshot. Primary topics group fields/subfields; normalized top-10% citation counts rank output. Impact-rate ranking divides highly cited output by papers and requires at least 100 papers. Counts include institutions outside the mapped selection. Internationally coauthored papers count in each represented country. These rankings describe the selected citation metric, not every dimension of research quality.

`components/EvidencePanels.js` lazily loads per-entity records, ignores stale responses, supports retries, and offers initiative search/status/partnership filters and raw JSON downloads. `lib/evidence.mjs` centralizes aggregation and ranking. `npm run test:evidence` verifies complete snapshot coverage and recalculates every funding series; `npm test` checks missingness, duplicate/component handling, currency separation, equal allocation, date status and ranking thresholds. Browser tests cover responsive panels, navigation, errors and retries.

Each map style owns its palette: Atlas uses cool daylight, Survey a dark technical palette, and Engraving warm paper. The bottom preview-card picker persists `atlas-style`, supports arrow-key radio navigation, and applies the same canvas/HTML palette before hydration. An old dark preference (or the system preference on first visit) initially selects Survey; an explicit style selection is then stable. On mobile the picker sits at the bottom of the visible map above the information sheet and hides while that sheet is expanded.

## Composable researcher filters and recruitment evidence

Subfields first offer an Institutions / Researchers focus switch. Researcher focus reveals three independent checkboxes: Career leaders, Frontier now, and Open to researchers. At least one must remain selected; selecting several takes the intersection of author IDs. Returning to Institutions hides the criteria; returning to Researchers restores the last selection. URLs retain the canonical order (`~career+frontier+open`), and existing single-filter URLs remain valid. Frontier metrics determine ranking when selected; otherwise career h-index does, or advertised-versus-standing recruitment evidence when Open is used alone. These are intersections of bounded candidate snapshots, not an exhaustive census of researchers meeting an abstract quality threshold. Coauthorship edges are restricted to matched endpoints and duplicate edges retain the larger sample count rather than summing overlapping samples.

`data/recruitment-evidence.json` is the reviewed source catalog. `npm run data:open` validates it and emits all 252 `public/data/open/s*.json` snapshots. The initial catalog covers 13 named researchers across 15 subfields, with uneven geographical coverage. New researchers need not appear in either citation-based list. Explicit subject scope, named identity, and source-verified institution determine placement; raw OpenAlex affiliations can be corrected within these recruitment records. The original career/frontier snapshots remain intact.

Open status requires an explicit official university, lab or researcher invitation or advertisement. Each record stores its source URL, role types, application constraints, funding statement, checked date, review deadline, and any known application deadline. Advertised roles and standing invitations are labeled separately. No probability of admission, willingness score, spare-capacity estimate, or inferred number of vacancies is produced. Institutional funding and partnership evidence is linked only as context; it cannot qualify someone as open. Source-stated funded places, competitive funding, and unspecified funding remain distinct.

On each load the browser excludes closed notices, future-dated checks, expired deadlines and overdue reviews. Review deadlines cannot exceed 90 days after the check. Day boundaries use UTC; applicants must consult local application deadlines. No automatic process extends a review date. To refresh: inspect the official source, confirm identity and scope, update the record's status/dates/restrictions, run `npm run data:open`, and run `npm test`. Old notices and generic contact pages are recorded as excluded reviews rather than assumed openings. Unreviewed or unlisted people have unknown availability. Empty subfields explain the limited coverage and offer navigation to reviewed subfields.

`lib/research-filters.mjs` contains selection, expiry and intersection rules. Browser tests cover all seven nonempty filter combinations, counts, deep-link reload, source cards, funding navigation, missing coverage and retries, on desktop/mobile. Unit checks cover identities, metric preservation, link deduplication and expiration. No emails or applications are sent by the site.

A limited November 2026 risk audit checked five recruitment profiles against their primary sources and recomputed Harvard, Cambridge and Oxford funding series. No factual discrepancies were found in those samples. Multiple recipients are labeled as institutions listed on an award, not proof of a partnership agreement. Component awards remain excluded even if the parent is absent from an institution snapshot; the estimate-and-coverage disclosure states this limitation. This spot-check is not a certification of the full dataset.

## Colour maps, comparisons and dense-area navigation

`npm run build` first creates the compact, lazy-loaded `public/data/analysis.json` from the existing 550 institution and 51 country evidence snapshots. It contains no project descriptions and is fetched only when an analysis drawer is first opened. `components/Analysis.js` offers country/institution comparisons, a shared currency selector, raw observations, source downloads, coverage notes and a keyboard-accessible modal. `lib/analysis-metrics.mjs` keeps missing observations distinct from zero and withholds publication percentages below a 100-publication baseline.

Institution trend maps compare the complete years 2024 and 2025: indexed publications, grant-linked publications, or estimated new award commitments in one currency. Purple–neutral–teal is centered on zero and capped at ±100%; tables retain exact percentages. Missing values are grey. Viridis maps show field/subfield activity; country activity and normalized top-decile share use measured 2021–2025 primary-topic groups, while institution activity uses the atlas's existing measured/estimated 2017–2026 counts. Country totals are never formed by adding institutions. Country annual and field-specific annual series are unavailable; award topic attribution (~16.6% of monetary non-component placements) is too uneven to represent field funding trends reliably. These unsupported trend options are not inferred from period totals.

The analysis map is a separate lightweight canvas layer. Changing research scope or entering researcher focus dismisses an applied layer to prevent stale colours. A visible reset control returns to the world. The CERN blank-view regression came from losing the selected institution's country when its centre moved offscreen during deep zoom: focus now considers the campus radius as well as the centre. Area zoom is capped at four times its fitted view; invalid camera transforms are ignored. Geographic context remains visible when no campus is focused. Mobile fitting leaves space for the bottom style and analysis controls.

`tests/analysis.mjs` compares all compact institution records with their sources and verifies currency isolation, missingness, field attribution and colour semantics. `tests/analysis-ui.cjs` exercises dense CERN zoom, country/field comparisons, missing currencies, error recovery, map layers and responsive layouts.
