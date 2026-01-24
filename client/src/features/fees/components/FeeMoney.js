export function money(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "0";
  return x.toLocaleString();
}

export function toNumberOrZero(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
