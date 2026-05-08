export function elapsed(from: string, to: string | null = null): string {
  const start = Date.parse(from);
  const end = to ? Date.parse(to) : Date.now();
  const sec = Math.max(0, Math.round((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

export function formatCost(usd: number | undefined): string {
  if (usd === undefined) return "—";
  if (usd === 0) return "$0.00";
  return `$${usd.toFixed(2)}`;
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
