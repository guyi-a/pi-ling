function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return millions >= 10
      ? `${Math.round(millions)}m`
      : `${millions.toFixed(1)}m`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return thousands >= 10
      ? `${Math.round(thousands)}k`
      : `${thousands.toFixed(1)}k`;
  }
  return String(value);
}

export function formatContextUsage(usage: {
  used: number;
  size: number;
}): string {
  if (usage.size > 0) {
    return `${formatTokenCount(usage.used)} / ${formatTokenCount(usage.size)} context`;
  }
  return `${formatTokenCount(usage.used)} context`;
}
