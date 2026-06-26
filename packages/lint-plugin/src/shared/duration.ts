const durationPattern = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s*$/;

const unitToMilliseconds: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1_000,
  sec: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
  month: 2_592_000_000,
  months: 2_592_000_000,
  y: 31_536_000_000,
  year: 31_536_000_000,
  years: 31_536_000_000,
};

export function parseDurationMilliseconds(value: string | number): number | undefined {
  if (typeof value === "number") {
    return value;
  }

  const match = durationPattern.exec(value);
  if (!match) {
    return;
  }

  const amount = Number(match[1]);
  const unit = unitToMilliseconds[match[2]?.toLowerCase() ?? ""];
  return Number.isFinite(amount) && unit ? amount * unit : undefined;
}
