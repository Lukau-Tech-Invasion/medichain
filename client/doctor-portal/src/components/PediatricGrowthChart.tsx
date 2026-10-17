export interface GrowthMeasurement {
  date: Date | null;
  ageMonths: number | null;
  weight: number | null;
  height: number | null;
}

/** Scale a recorded value into chart coordinates, centering a single-value domain. */
function position(value: number, min: number, max: number, start: number, end: number): number {
  return max === min ? (start + end) / 2 : start + (value - min) / (max - min) * (end - start);
}

/** Render one measurement series without inventing ages, interpolated observations or reference centiles. */
function MeasurementSeries({ points, metric, unit, label }: {
  points: readonly GrowthMeasurement[]; metric: 'weight' | 'height'; unit: string; label: string;
}) {
  const known = points.filter(point => point.ageMonths !== null && point[metric] !== null)
    .slice().sort((a, b) => a.ageMonths! - b.ageMonths! || (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  if (!known.length) return <p>{label}: no measurements with a recorded age.</p>;
  const ages = known.map(point => point.ageMonths!);
  const values = known.map(point => point[metric]!);
  const minAge = Math.min(...ages), maxAge = Math.max(...ages);
  const minValue = Math.min(...values), maxValue = Math.max(...values);
  const coordinates = known.map(point => ({ point,
    x: position(point.ageMonths!, minAge, maxAge, 55, 405),
    y: position(point[metric]!, minValue, maxValue, 150, 25) }));
  return <figure className="space-y-2">
    <figcaption className="font-medium">{label} ({unit})</figcaption>
    {minAge === maxAge && known.length > 1 && <p className="text-sm text-content-muted">
      These {known.length} measurements were recorded at age {minAge} months.
    </p>}
    <div className="overflow-x-auto">
      <svg role="img" aria-label={`${label} by recorded age in months`} viewBox="0 0 440 200"
        className="w-full min-w-[360px]" style={{ fontSize: 13 }}>
        <title>{label} by recorded age in months</title>
        <desc>Each point is a saved assessment. Exact dates, ages and measurements are in the growth history table.</desc>
        <path d="M55 20V155H410" fill="none" stroke="currentColor" strokeWidth="1" />
        <text x="48" y={minValue === maxValue ? 92.5 : 155} textAnchor="end" fill="currentColor">{minValue}</text>
        {maxValue !== minValue && <text x="48" y="30" textAnchor="end" fill="currentColor">{maxValue}</text>}
        <text x={minAge === maxAge ? 230 : 55} y="174" textAnchor="middle" fill="currentColor">{minAge}</text>
        {maxAge !== minAge && <text x="405" y="174" textAnchor="middle" fill="currentColor">{maxAge}</text>}
        <text x="230" y="195" textAnchor="middle" fill="currentColor">Age at assessment (months)</text>
        <polyline points={coordinates.map(({ x, y }) => `${x},${y}`).join(' ')} fill="none"
          stroke="currentColor" strokeWidth="2" className="text-sky-700 dark:text-sky-300" />
        {coordinates.map(({ point, x, y }, index) => <circle key={index} cx={x} cy={y} r="4"
          fill="currentColor" className="text-sky-700 dark:text-sky-300">
          <title>{`${point.ageMonths} months: ${point[metric]} ${unit}; ${point.date?.toLocaleDateString() ?? 'date not recorded'}`}</title>
        </circle>)}
      </svg>
    </div>
  </figure>;
}

/** Show a child's accumulated measurements; missing ages stay visible in the accompanying table. */
export default function PediatricGrowthChart({ points }: { points: readonly GrowthMeasurement[] }) {
  return <section aria-label="Recorded growth charts" className="space-y-4">
    <p className="text-sm text-content-muted">Recorded measurements over time. New assessments add to this history; earlier records are preserved. These are not reference percentile curves.</p>
    <MeasurementSeries points={points} metric="weight" unit="kg" label="Weight" />
    <MeasurementSeries points={points} metric="height" unit="cm" label="Height" />
    {points.some(point => point.ageMonths === null) && <p className="text-sm">Measurements without a recorded age are listed in the table but are not plotted.</p>}
  </section>;
}
