export function formatDate(date: string | number): string {
  // Handle raw millisecond timestamps from backend
  const ms = typeof date === "number" ? date : Number(date);
  if (!isNaN(ms) && ms > 1000000000000) {
    return new Date(ms).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  // Fallback: try parsing as ISO/date string
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours < 24) return `${hours}h ${mins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/**
 * An actor address as people read it. The runtime writes a peko's address
 * as `principal:local:<id>` / `principal:hub:<id>` (its wire form); the app
 * shows `peko:…`. Other addresses are unchanged.
 */
export function shownAddress(address: string): string {
  if (!address.startsWith("principal:")) return address;
  const rest = address.slice("principal:".length);
  // A local route is written bare (`principal:prin_x`); show its scope.
  return rest.startsWith("local:") || rest.startsWith("hub:") ? `peko:${rest}` : `peko:local:${rest}`;
}

/**
 * How long ago `iso` was, in words: "just now", "5 minutes ago",
 * "3 hours ago", "2 days ago". Empty for an unreadable time.
 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (isNaN(then)) return "";
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return "just now";
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (mins < 60) return unit(mins, "minute");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return unit(hours, "hour");
  return unit(Math.floor(hours / 24), "day");
}

/** Up to two letters standing for a group's name. */
export function groupMonogram(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return "#";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
