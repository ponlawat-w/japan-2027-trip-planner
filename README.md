# Japan 2027 Trip Planner

A planner for a February road trip in Japan: arrive at Chubu Centrair (NGO) on 2 February 2027, fly
home from NGO on the 15th. Put destinations on a night-by-night timeline, pin the nights that are
fixed, and let auto-fill fill the rest. Each drive shows its distance, its time, and how hard it is
likely to be in February.

Everything runs in the browser. Distances, times, route lines and difficulty are computed ahead of
time by a CLI and committed under `data/`, then bundled into the build.

```
data/             ← written by the CLI, committed, bundled into the site
  destinations.json
  matrix.json         every directed leg: distance, time, difficulty, factors, warnings
  legs/<a>__<b>.json  each leg's line, split into difficulty-coloured sections (lazy-loaded)
  winter-closures.json  roads closed every winter, excluded from routing
cli/              ← the CLI: Valhalla + GSI DEM + Open-Meteo → data/
src/              ← the React app
valhalla/         ← docker compose for the self-hosted router
```

## The app

```sh
npm install
npm run dev        # http://localhost:5190
```

- **Timeline.** Click an empty night (or drag across several) to plan it. Drag a stay's edge to
  change its nights. Click a stay to pin it, change it or swap it with a neighbour. Drag an
  unpinned stay onto another to reorder them. Pinned stays keep their dates. On a phone the
  timeline is vertical: tap a night, drag the grip at a stay's top or bottom, and press and hold a
  stay to move it.
- **Auto-fill** keeps pinned nights and refills every other night. It trades the places' ratings
  against winter driving time, long days and hard legs. It never picks a place that is already
  pinned, and it uses each place for at most one stay. When it runs out of places (or a place
  would go past its maximum nights), it leaves the rest of the nights empty. Each click picks a
  different random seed, so you get a different plan; undo goes back to the previous one.
- **The address bar always holds the plan** (`#plan=nagoya!.suzuka!.…`), updated as you edit, so
  you can copy the URL at any time; **Copy link** does the same in one tap. Opening a link loads
  its plan, and undo brings back the one you had before. The plan is also saved in `localStorage`.
- **km / mi** in the app bar switches distances and heights between metric and imperial. It is
  saved per browser, and is not part of shared links.
- **Summary, map and drives** are read-only views of the timeline. Hover a drive to highlight it
  on the map. Expand a drive to see what its difficulty is based on.

Legs the CLI has not computed yet still work. The app estimates them from straight-line distance
and shows them with a `≈` and a dashed line.

## The CLI

It follows [the route-difficulty handoff](docs/handoff-route-difficulty.md) for each directed pair
of destinations:

1. **Valhalla** `route` gets the fastest drive, avoiding `winter-closures.json`. `trace_attributes`
   then gives road class, surface, bridges, tunnels and speed along it.
2. The line is sampled every **100 m**. Elevation comes from GSI's DEM10B tiles (国土地理院 標高タイル).
   Bridges and tunnels are interpolated rather than read from the ground. Grades are measured over
   200 m. Any climb or descent steeper than 8% that lasts 300 m or more counts as steep.
3. Every **1 km** gets February climate from **Open-Meteo**'s archive: 2–15 February in each year
   from 2016 to 2025, on a 0.1° grid. Night-time minimums are corrected to the road's own height
   at 0.65 °C per 100 m.
4. Each km gets a score from 1 to 5, from altitude, steepness, snow cover (halved on
   motorways and trunk roads), black-ice weather, bridges and tunnel mouths, minor or unpaved road,
   and winding road. The leg's score is the highest one held for 3 km (or a tenth of a short leg).
   Every weight is a named constant in [cli/scoring.ts](cli/scoring.ts).
5. The **winter time** stretches each km's time by its score (×1.0 to ×1.5).

DEM tiles and Open-Meteo responses are cached in `.cache/` (gitignored), so recomputing is cheap.

### Using it

Valhalla must be running first: see [valhalla/README.md](valhalla/README.md).

```sh
npm run cli -- list
npm run cli -- add kinosaki --name "Kinosaki Onsen" --name-ja 城崎温泉 --kind onsen \
  --lat 35.6237 --lon 134.8137 --rating 4
npm run cli -- add arima --name "Arima Onsen" --name-ja 有馬温泉 --kind onsen --geocode "有馬温泉"
npm run cli -- edit arima --rating 5 --max-nights 2      # metadata only, no recompute
npm run cli -- compute                                   # any legs still missing
npm run cli -- compute --id arima --force                # recompute one destination's legs
npm run cli -- remove arima
npm run cli -- explain gero okuhida --min 3              # per-km breakdown, for tuning weights
```

`add` computes the new destination's legs to and from every other destination. With *n*
destinations that is 2(*n* − 1) legs, a few seconds each once caches are warm. Each leg is saved as
soon as it is done, so an interrupted run loses nothing: run `compute` again and it continues.

Fields: `--kind` is `city`, `onsen` or `airport`.
`--rating` (1–5) is how much auto-fill wants to go there. `--ideal-nights` is the number of nights
after which each extra night is worth about a third as much. `--max-nights` is a limit auto-fill
never exceeds.

Afterwards, commit `data/`. The next push to `master` deploys it.

#### Destinations not yet added

Coordinates checked against OpenStreetMap. The ratings are suggestions:

```sh
npm run cli -- add shibu --name "Shibu Onsen" --name-ja 渋温泉 --kind onsen --lat 36.7345 --lon 138.4306 --rating 4
npm run cli -- add nozawa --name "Nozawa Onsen" --name-ja 野沢温泉 --kind onsen --lat 36.9232 --lon 138.4466 --rating 4
npm run cli -- add ginzan --name "Ginzan Onsen" --name-ja 銀山温泉 --kind onsen --lat 38.5738 --lon 140.5245 --rating 5
npm run cli -- add kinosaki --name "Kinosaki Onsen" --name-ja 城崎温泉 --kind onsen --lat 35.6237 --lon 134.8137 --rating 4
npm run cli -- add arima --name "Arima Onsen" --name-ja 有馬温泉 --kind onsen --lat 34.7993 --lon 135.2463 --rating 4
npm run cli -- add shodoshima --name "Shodoshima (Olive Onsen)" --name-ja 小豆島 --kind onsen --lat 34.4763 --lon 134.1789 --rating 3 --note "Island: ferry crossing"
npm run cli -- add dogo --name "Dogo Onsen" --name-ja 道後温泉 --kind onsen --lat 33.8504 --lon 132.7851 --rating 4
npm run cli -- add shirahama --name "Nanki-Shirahama Onsen" --name-ja 南紀白浜温泉 --kind onsen --lat 33.6782 --lon 135.3479 --rating 4
npm run cli -- add yunomine --name "Yunomine Onsen" --name-ja 湯の峰温泉 --kind onsen --lat 33.8287 --lon 135.7574 --rating 4
npm run cli -- add gora --name "Hakone Gora Onsen" --name-ja 強羅温泉 --kind onsen --lat 35.2508 --lon 139.0483 --rating 4
npm run cli -- add shuzenji --name "Shuzenji Onsen" --name-ja 修善寺温泉 --kind onsen --lat 34.9705 --lon 138.9284 --rating 4
npm run cli -- add kawazu --name "Kawazu Onsen" --name-ja 河津温泉郷 --kind onsen --lat 34.7474 --lon 138.9965 --rating 3 --note "Kawazu-zakura bloom from early February"
```

### Limits worth knowing

- Open-Meteo's free tier is **non-commercial only**: 10,000 calls a day and 5,000 an hour. A new
  area costs 10 calls per 0.1° cell (one per year), and then nothing, because the responses are
  cached. If the daily limit stops a run, run the same command again the next day.
- **No tool can tell you whether a road is icy, closed or under chain control today.** Check the
  road operators, JARTIC and road cameras before you leave.
- Valhalla will happily route over roads that close every winter. Known ones go in
  `data/winter-closures.json` as small polygons across the road. Any leg that climbs above
  1,600 m gets a warning to check by hand.
- Times on mountain roads run short, because OSM often lacks speed limits there.

## Deploying

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) lints, builds and publishes `dist/` to
the `gh-pages` branch on every push to `master`. Once, in the repository settings: **Pages → Build
and deployment → Deploy from a branch → `gh-pages` / root.**

## Credits

Routing: [Valhalla](https://github.com/valhalla/valhalla) on © OpenStreetMap contributors (ODbL)
data, via Geofabrik. Elevation: 国土地理院 (GSI) 標高タイル. Climate:
[Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Basemap: Esri Dark Gray Canvas (Esri, HERE, Garmin, © OpenStreetMap contributors).
