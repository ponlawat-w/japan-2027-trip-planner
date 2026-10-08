/**
 * Google's encoded-polyline format, at Valhalla's precision of 6 decimal places.
 *
 * Coordinates are `[lon, lat]` on both sides, the GeoJSON / OpenLayers order, even though the
 * encoding itself stores latitude first.
 */

const FACTOR = 1e6;

export type LonLat = [number, number];

export const decodePolyline6 = (encoded: string): LonLat[] => {
  const coordinates: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const readValue = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += readValue();
    lon += readValue();
    coordinates.push([lon / FACTOR, lat / FACTOR]);
  }
  return coordinates;
};

const encodeValue = (value: number): string => {
  let rest = value < 0 ? ~(value << 1) : value << 1;
  let output = '';
  while (rest >= 0x20) {
    output += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
    rest >>= 5;
  }
  return output + String.fromCharCode(rest + 63);
};

export const encodePolyline6 = (coordinates: LonLat[]): string => {
  let previousLat = 0;
  let previousLon = 0;
  let output = '';
  for (const [lon, lat] of coordinates) {
    const scaledLat = Math.round(lat * FACTOR);
    const scaledLon = Math.round(lon * FACTOR);
    output += encodeValue(scaledLat - previousLat) + encodeValue(scaledLon - previousLon);
    previousLat = scaledLat;
    previousLon = scaledLon;
  }
  return output;
};
