export function parseKalshiDollars(value: string | undefined): number | null {
  if (value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseKalshiSize(value: string | undefined): number | null {
  if (value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
