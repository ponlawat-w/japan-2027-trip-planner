import type { Units } from '@/store/preferencesStore';

const KM_PER_MILE = 1.609344;
const FEET_PER_METRE = 3.28084;

export const formatDuration = (minutes: number): string => {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (hours === 0) return `${rest} min`;
  return `${hours}h${String(rest).padStart(2, '0')}`;
};

const formatLength = (value: number, unit: string): string =>
  `${value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1).replace(/\.0$/, '')} ${unit}`;

export const formatDistance = (km: number, units: Units): string =>
  units === 'metric' ? formatLength(km, 'km') : formatLength(km / KM_PER_MILE, 'mi');

export const formatElevation = (metres: number, units: Units): string =>
  units === 'metric'
    ? `${Math.round(metres).toLocaleString()} m`
    : `${(Math.round((metres * FEET_PER_METRE) / 10) * 10).toLocaleString()} ft`;

/** Turning per distance, a proxy for winding road: degrees per km, or per mile. */
export const formatTurnRate = (degreesPerKm: number, units: Units): string =>
  units === 'metric'
    ? `${Math.round(degreesPerKm)}°/km`
    : `${Math.round(degreesPerKm * KM_PER_MILE)}°/mi`;

export const formatPercent = (ratio: number): string => `${Math.round(ratio * 100)}%`;

/**
 * Converts the distances inside a sentence the CLI wrote, such as a leg's warnings ("Climbs to
 * 1730 m…", "10.7 km of…"). The CLI writes metric prose once; converting it here keeps the data
 * free of a second, imperial copy of every sentence.
 */
export const localizeText = (text: string, units: Units): string =>
  units === 'metric'
    ? text
    : text.replace(/(\d[\d,]*(?:\.\d+)?) (km|m)\b/g, (_, number: string, unit: string) => {
        const value = Number(number.replace(/,/g, ''));
        return unit === 'km' ? formatDistance(value, units) : formatElevation(value, units);
      });
