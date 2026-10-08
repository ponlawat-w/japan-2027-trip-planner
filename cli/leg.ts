import type { Destination, LegGeometry, LegSummary } from '../src/types/data.ts';
import { scoreRoute, type Bin } from './scoring.ts';
import type { WinterClosure } from './store.ts';
import { route, traceAttributes } from './valhalla.ts';

/** Routes, traces and scores one directed drive. */
export const computeLeg = async (
  from: Destination,
  to: Destination,
  closures: WinterClosure[],
): Promise<{ summary: LegSummary; geometry: LegGeometry; bins: Bin[] }> => {
  const routed = await route(from, to, closures);
  const trace = await traceAttributes(routed.encodedShape);
  const scored = await scoreRoute(trace.shape, trace.edges);

  const durationMin = routed.durationS / 60;
  const warnings = [...scored.warnings];
  if (routed.hasFerry) {
    warnings.unshift('Includes a ferry: book it, and check the timetable (crossing time only).');
  }

  return {
    summary: {
      from: from.id,
      to: to.id,
      distanceKm: Math.round(routed.distanceKm * 10) / 10,
      durationMin: Math.round(durationMin),
      winterDurationMin: Math.round(durationMin * scored.winterTimeFactor),
      difficulty: scored.difficulty,
      factors: { ...scored.factors, ferry: routed.hasFerry, toll: routed.hasToll },
      warnings,
      computedAt: new Date().toISOString(),
    },
    geometry: { from: from.id, to: to.id, sections: scored.sections },
    bins: scored.bins,
  };
};
