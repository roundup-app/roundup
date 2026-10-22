import type { ConsumedSubtotal } from "@contracts/project/ConsumedSubtotal";
import type { MeasurementCost } from "@contracts/project/MeasurementCost";
import prettyMilliseconds from "pretty-ms";
import { copy } from "../copy";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** Tokens in compact units above 9,999; the exact count is `exact`. */
export const tokenFigure = (value: ConsumedSubtotal) => {
  const known = BigInt(value.known);

  return known > 9_999n ? compact.format(Number(known)) : known.toString();
};

export const exact = (value: ConsumedSubtotal) => BigInt(value.known).toLocaleString();

/** The top two units of a duration; unavailable is `—`, never zero. */
export const duration = (ns: string | null) => {
  if (ns === null) return copy.measurementUnknown;
  const ms = BigInt(ns) / 1_000_000n;

  if (ms < 1000n) return BigInt(ns) > 0n ? "<1s" : "0s";

  return prettyMilliseconds(Number(ms), { unitCount: 2, secondsDecimalDigits: 0 });
};

/** Whole percent of `part` in `whole`, `<1%` for a positive share under one percent. */
export const percent = (part: number, whole: number) => {
  if (!(whole > 0) || part < 0) return copy.measurementUnknown;
  const value = (part / whole) * 100;

  return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
};

export const modelLabel = (id: string) => {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(id);

  return match ? `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)} ${match[2]}.${match[3]}` : id === "" ? copy.measurementUnknownModel : id;
};

const scale = 12;

const toUnits = (amount: string) => {
  const [whole = "0", fraction = ""] = amount.split(".");

  return BigInt(whole + fraction.padEnd(scale, "0").slice(0, scale));
};

/** Two decimals with a `<$0.01` floor; exact decimal arithmetic, never a float. */
const money = (units: bigint, currency: string) => {
  const sign = currency === "USD" ? "$" : `${currency} `;

  if (units > 0n && units < 10n ** BigInt(scale - 2)) return `<${sign}0.01`;
  const cents = (units + 5n * 10n ** BigInt(scale - 3)) / 10n ** BigInt(scale - 2);

  return `${sign}${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
};

export const moneyText = (amount: string, currency: string) => money(toUnits(amount), currency);

/** The reference estimates summed across Models; reported money never joins them. */
export const listPrice = (cost: MeasurementCost) => {
  const currencies = new Set(cost.reference.map((estimate) => estimate.rates.currency));

  if (cost.reference.length === 0 || currencies.size !== 1) return null;
  const currency = [...currencies][0]!;

  return money(cost.reference.reduce((sum, estimate) => sum + toUnits(estimate.amount), 0n), currency);
};

export const weekdayTime = (ms: number) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ms).map((part) => [part.type, part.value]));

  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`;
};

export const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
