# Valhalla for the route CLI

The CLI routes against a self-hosted [Valhalla](https://github.com/valhalla/valhalla), built from
Geofabrik's Japan extract. This is the free option, and the one that exposes road attributes
(bridges, tunnels, surface, class) through `trace_attributes`.

## First start

```sh
docker compose -f valhalla/docker-compose.yml up -d
docker logs -f japan-trip-valhalla      # wait for the server to start
curl localhost:8002/status
```

The first start downloads `japan-latest.osm.pbf` (about 2.4 GB) and builds routing tiles into
`valhalla/custom_files/` (gitignored). On an 8-core machine with 8 GB given to Docker this took
about 20 minutes in total. Later starts reuse the tiles and are up in seconds.

Valhalla's own elevation tiles are not built (`build_elevation=False`). The CLI reads grades from
GSI's DEM instead, which is finer.

## Raise two service limits (once, after the first build)

The defaults reject what the CLI sends:

- `trace.max_distance` (200 km) and `trace.max_shape` (16,000): a whole long leg is traced in one
  call.
- `max_exclude_polygons_length` (10 km, summed over all polygons): every winter closure is sent
  with every route.

```sh
python3 - <<'EOF'
import json
path = 'valhalla/custom_files/valhalla.json'
config = json.load(open(path))
limits = config['service_limits']
limits['trace']['max_distance'] = 3000000.0
limits['trace']['max_shape'] = 200000
limits['max_exclude_polygons_length'] = 200000
json.dump(config, open(path, 'w'), indent=2)
EOF
docker compose -f valhalla/docker-compose.yml restart
```

The container only adds keys that are missing from an existing `valhalla.json`, so these edits
survive restarts.

## Updating the map data

```sh
docker compose -f valhalla/docker-compose.yml down
rm -rf valhalla/custom_files/valhalla_tiles* valhalla/custom_files/japan-latest.osm.pbf valhalla/custom_files/file_hashes.txt
docker compose -f valhalla/docker-compose.yml up -d
```

Then raise the limits again, and run `npm run cli -- compute --force` if the routes should be
recomputed.

## Winter closures

OSM does not reliably record that a road closes every winter (`access:conditional` is sparse in
Japan), so Valhalla will route over passes that are under snow until April. Every route the CLI
asks for excludes the polygons in `data/winter-closures.json`. Each is a box about 1 km across,
placed on the closed road away from any junction, so it cuts only that road.

To find where a box is needed, route a suspicious leg and list the roads it uses. Then add a box on
the closed one, and check that the route changes. The CLI also warns about any leg that climbs above
1,600 m.
