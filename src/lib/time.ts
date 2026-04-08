export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function truncateToHour(date: Date): Date {
  const truncated = new Date(date);
  truncated.setUTCMinutes(0, 0, 0);
  return truncated;
}

export function secondsSince(isoTimestamp: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(isoTimestamp).getTime()) / 1000));
}
