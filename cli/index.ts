import { parseArgs } from 'node:util';
import { legKey, type Destination, type DestinationKind } from '../src/types/data.ts';
import { requestJson } from './http.ts';
import { computeLeg } from './leg.ts';
import {
  readClosures,
  readDestinations,
  readMatrix,
  removeLegsOf,
  saveLeg,
  writeDestinations,
} from './store.ts';
import { assertValhallaReachable } from './valhalla.ts';

const USAGE = `Usage: npm run cli -- <command> [options]

Commands:
  add <id>      Add a destination, then compute its legs to and from every other one.
                  --name <text>          English name (required)
                  --name-ja <text>       Japanese name (required)
                  --kind <kind>          airport | city | onsen (required)
                  --lat <n> --lon <n>    Coordinates, or instead:
                  --geocode <query>      Look the place up on OpenStreetMap (Nominatim)
                  --rating <1-5>         How worth visiting (default: 3; 0 for airport)
                  --ideal-nights <n>     Nights before more are worth less (default by kind)
                  --max-nights <n>       Most nights auto-fill will plan here (default by kind)
                  --note <text>          Shown in the destination picker
                  --no-compute           Only record it; compute legs later with \`compute\`
  edit <id>     Change a destination's fields (same options as add). Moving it recomputes its legs.
  remove <id>   Remove a destination and every leg to or from it.
  compute       Compute every leg that is missing.
                  --id <id>              Only legs to or from this destination
                  --force                Recompute legs that already exist
  list          Destinations and how many of their legs are computed.
  explain <from> <to>
                Recompute one leg without saving, and print every km scoring at least --min
                (default 3) with what scored it: for tuning the weights in cli/scoring.ts.
                  --min <1-5>

Valhalla must be running (valhalla/README.md); VALHALLA_URL overrides http://localhost:8002.
`;

const KIND_DEFAULTS: Record<
  DestinationKind,
  Pick<Destination, 'rating' | 'idealNights' | 'maxNights'>
> = {
  airport: { rating: 0, idealNights: 0, maxNights: 0 },
  city: { rating: 3, idealNights: 2, maxNights: 3 },
  onsen: { rating: 3, idealNights: 1, maxNights: 2 },
};
const KINDS = Object.keys(KIND_DEFAULTS) as DestinationKind[];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    'name-ja': { type: 'string' },
    kind: { type: 'string' },
    lat: { type: 'string' },
    lon: { type: 'string' },
    geocode: { type: 'string' },
    rating: { type: 'string' },
    'ideal-nights': { type: 'string' },
    'max-nights': { type: 'string' },
    note: { type: 'string' },
    'no-compute': { type: 'boolean', default: false },
    id: { type: 'string' },
    force: { type: 'boolean', default: false },
    min: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const fail = (message: string): never => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const numberOption = (name: keyof typeof values): number | undefined => {
  const raw = values[name];
  if (raw === undefined || typeof raw !== 'string') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) fail(`--${name} must be a number, got "${raw}"`);
  return value;
};

const formatMinutes = (minutes: number): string =>
  `${Math.floor(minutes / 60)}h${String(Math.round(minutes % 60)).padStart(2, '0')}`;

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

const geocode = async (query: string): Promise<{ lat: number; lon: number }> => {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'jp',
  });
  const results = await requestJson<NominatimResult[]>(
    `https://nominatim.openstreetmap.org/search?${params}`,
  );
  if (results.length === 0) fail(`OpenStreetMap found nothing for "${query}"`);
  const [result] = results;
  console.log(`Geocoded "${query}" → ${result.display_name} (${result.lat}, ${result.lon})`);
  return { lat: Number(result.lat), lon: Number(result.lon) };
};

const resolveCoordinates = async (): Promise<{ lat: number; lon: number } | undefined> => {
  if (values.geocode) return geocode(values.geocode);
  const lat = numberOption('lat');
  const lon = numberOption('lon');
  if (lat === undefined && lon === undefined) return undefined;
  if (lat === undefined || lon === undefined) fail('give both --lat and --lon');
  return { lat: lat!, lon: lon! };
};

/**
 * Computes every missing leg among `destinations` — or, with `onlyId`, those touching it.
 *
 * Each leg is saved as soon as it is done, so stopping half-way (or hitting Open-Meteo's daily
 * limit) loses nothing: running the same command again picks up the legs still missing.
 */
const computeMissing = async (
  destinations: Destination[],
  options: { onlyId?: string; force?: boolean },
): Promise<void> => {
  const matrix = await readMatrix();
  const pairs: [Destination, Destination][] = [];
  for (const from of destinations) {
    for (const to of destinations) {
      if (from.id === to.id) continue;
      if (from.kind === 'airport' && to.kind === 'airport') continue;
      if (options.onlyId && from.id !== options.onlyId && to.id !== options.onlyId) continue;
      if (!options.force && matrix.legs[legKey(from.id, to.id)]) continue;
      pairs.push([from, to]);
    }
  }
  if (pairs.length === 0) {
    console.log('Every leg is already computed.');
    return;
  }

  await assertValhallaReachable();
  const closures = await readClosures();
  console.log(`Computing ${pairs.length} legs (${closures.length} winter closures excluded)…`);
  for (const [index, [from, to]] of pairs.entries()) {
    const label = `[${index + 1}/${pairs.length}] ${from.id} → ${to.id}`;
    const startedAt = Date.now();
    const { summary, geometry } = await computeLeg(from, to, closures);
    await saveLeg(summary, geometry);
    console.log(
      `${label}: ${summary.distanceKm} km, ${formatMinutes(summary.durationMin)} ` +
        `(winter ${formatMinutes(summary.winterDurationMin)}), difficulty ${summary.difficulty}` +
        ` — ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
    for (const warning of summary.warnings) console.log(`    ! ${warning}`);
  }
};

const applyFields = (destination: Destination): Destination => {
  const kind = values.kind as DestinationKind | undefined;
  if (kind !== undefined && !KINDS.includes(kind))
    fail(`--kind must be one of ${KINDS.join(', ')}`);
  const rating = numberOption('rating');
  if (rating !== undefined && (rating < 0 || rating > 5)) fail('--rating must be 0–5');
  return {
    ...destination,
    ...(values.name !== undefined && { name: values.name }),
    ...(values['name-ja'] !== undefined && { nameJa: values['name-ja'] }),
    ...(kind !== undefined && { kind }),
    ...(rating !== undefined && { rating }),
    ...(numberOption('ideal-nights') !== undefined && {
      idealNights: numberOption('ideal-nights')!,
    }),
    ...(numberOption('max-nights') !== undefined && { maxNights: numberOption('max-nights')! }),
    ...(values.note !== undefined && { note: values.note }),
  };
};

const commands: Record<string, (id?: string) => Promise<void>> = {
  async add(id) {
    if (!id) fail('add needs an id, e.g. `add kusatsu …`');
    if (!/^[a-z0-9-]+$/.test(id!)) fail('ids are lowercase letters, digits and dashes');
    const destinations = await readDestinations();
    if (destinations.some((destination) => destination.id === id)) {
      fail(`"${id}" already exists; use \`edit\` to change it`);
    }
    const kind = values.kind as DestinationKind | undefined;
    if (!values.name || !values['name-ja'] || !kind)
      fail('--name, --name-ja and --kind are required');
    if (!KINDS.includes(kind!)) fail(`--kind must be one of ${KINDS.join(', ')}`);
    const coordinates = await resolveCoordinates();
    if (!coordinates) fail('give --lat and --lon, or --geocode');

    const destination = applyFields({
      id: id!,
      name: values.name!,
      nameJa: values['name-ja']!,
      kind: kind!,
      lat: coordinates!.lat,
      lon: coordinates!.lon,
      ...KIND_DEFAULTS[kind!],
    });
    destinations.push(destination);
    await writeDestinations(destinations);
    console.log(`Added ${destination.name} (${destination.nameJa}).`);
    if (!values['no-compute']) await computeMissing(destinations, { onlyId: id });
  },

  async edit(id) {
    const destinations = await readDestinations();
    const index = destinations.findIndex((destination) => destination.id === id);
    if (index < 0) fail(`no destination "${id}"`);
    const coordinates = await resolveCoordinates();
    destinations[index] = { ...applyFields(destinations[index]), ...coordinates };
    await writeDestinations(destinations);
    console.log(`Updated ${destinations[index].name}.`);
    if (coordinates && !values['no-compute']) {
      await computeMissing(destinations, { onlyId: id, force: true });
    }
  },

  async remove(id) {
    const destinations = await readDestinations();
    if (!destinations.some((destination) => destination.id === id)) fail(`no destination "${id}"`);
    await writeDestinations(destinations.filter((destination) => destination.id !== id));
    const removed = await removeLegsOf(id!);
    console.log(`Removed "${id}" and ${removed} legs.`);
  },

  async compute() {
    const destinations = await readDestinations();
    if (values.id && !destinations.some((destination) => destination.id === values.id)) {
      fail(`no destination "${values.id}"`);
    }
    await computeMissing(destinations, { onlyId: values.id, force: values.force });
  },

  async explain(fromId) {
    const destinations = await readDestinations();
    const find = (key: string | undefined) =>
      destinations.find((destination) => destination.id === key) ?? fail(`no destination "${key}"`);
    const from = find(fromId);
    const to = find(secondId);
    await assertValhallaReachable();
    const { summary, bins } = await computeLeg(from, to, await readClosures());
    const min = numberOption('min') ?? 3;
    console.log(
      `${from.id} → ${to.id}: ${summary.distanceKm} km, difficulty ${summary.difficulty}\n` +
        JSON.stringify(summary.factors),
    );
    const share = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;
    console.table(
      bins
        .filter((bin) => bin.difficulty >= min)
        .map((bin) => ({
          km: `${(bin.startM / 1000).toFixed(0)}`,
          score: bin.difficulty,
          elev: Math.round(bin.meanElevationM),
          steep: Math.round(bin.steepM),
          motorway: share(bin.motorwayM, bin.lengthM),
          major: share(bin.majorM, bin.lengthM),
          minor: share(bin.minorM, bin.lengthM),
          tunnel: share(bin.tunnelM, bin.lengthM),
          structures: bin.structures,
          turns: Math.round(bin.turnDegPerKm),
          freeze: bin.climate.freezeRatio.toFixed(2),
          snow: bin.climate.snowRatio.toFixed(2),
        })),
    );
  },

  async list() {
    const destinations = await readDestinations();
    const matrix = await readMatrix();
    const legs = Object.values(matrix.legs);
    const expected = (destination: Destination) =>
      destinations.filter(
        (other) =>
          other.id !== destination.id &&
          !(other.kind === 'airport' && destination.kind === 'airport'),
      ).length * 2;
    console.table(
      destinations.map((destination) => ({
        id: destination.id,
        name: `${destination.name} (${destination.nameJa})`,
        kind: destination.kind,
        rating: destination.rating,
        nights: `${destination.idealNights}/${destination.maxNights}`,
        legs: `${legs.filter((leg) => leg.from === destination.id || leg.to === destination.id).length}/${expected(destination)}`,
      })),
    );
  },
};

const [command, id, secondId] = positionals;
if (values.help || !command || !commands[command]) {
  console.log(USAGE);
  process.exit(command && !values.help ? 1 : 0);
}
commands[command](id).catch((error: Error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
