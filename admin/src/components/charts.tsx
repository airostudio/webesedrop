// Small hand-rolled SVG charts — this dashboard has exactly two time-series
// views (revenue, orders), so a full charting library is more dependency
// than the job needs. Both take pre-aggregated points from the API.

interface BarChartProps {
  data: Array<{ label: string; value: number }>;
  valueFormatter?: (value: number) => string;
  height?: number;
}

export function BarChart({ data, valueFormatter = (v) => String(v), height = 180 }: BarChartProps) {
  if (data.length === 0) return <EmptyChart height={height} />;

  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = 100 / data.length;

  return (
    <div className="chart">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="chart-svg" role="img">
        {data.map((d, i) => {
          const barHeight = (d.value / max) * (height - 24);
          return (
            <g key={d.label}>
              <rect
                x={i * barWidth + barWidth * 0.15}
                y={height - 24 - barHeight}
                width={barWidth * 0.7}
                height={Math.max(barHeight, 1)}
                className="chart-bar"
              >
                <title>{`${d.label}: ${valueFormatter(d.value)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="chart-labels">
        {data.map((d) => (
          <span key={d.label}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function EmptyChart({ height }: { height: number }) {
  return (
    <div className="chart-empty" style={{ height }}>
      No data yet
    </div>
  );
}
