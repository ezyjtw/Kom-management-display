/**
 * Exact amounts. Token quantities are stored as DECIMAL(38,18) and USD/fiat as
 * DECIMAL(20,2); Prisma returns them as Prisma.Decimal, which serialises to a
 * string in JSON. Never convert an amount to a JS number for arithmetic or
 * comparison: use these helpers.
 *
 * API input: send amounts as decimal strings ("1234.567"). Numbers are still
 * accepted for backward compatibility, but a JSON number may already have lost
 * precision when it was parsed.
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";

export type DecimalValue = Prisma.Decimal | string | number;

export const dec = (v: DecimalValue): Prisma.Decimal => new Prisma.Decimal(v);

/** null/undefined-safe conversion. */
export const decOrNull = (v: DecimalValue | null | undefined): Prisma.Decimal | null => (v == null ? null : new Prisma.Decimal(v));

/** |a - b| */
export const absDiff = (a: DecimalValue, b: DecimalValue): Prisma.Decimal => dec(a).minus(dec(b)).abs();

/** Sum of amounts, exactly. */
export const sum = (values: Array<DecimalValue | null | undefined>): Prisma.Decimal =>
  values.reduce<Prisma.Decimal>((acc, v) => (v == null ? acc : acc.plus(dec(v))), new Prisma.Decimal(0));

/** Zod schema for a decimal amount with at most `scale` fraction digits and 20 integer digits; outputs a normalised string. */
export function decimalAmount(scale: number, opts: { min?: "positive" | "nonNegative" } = {}) {
  const pattern = new RegExp(`^-?\\d{1,20}(\\.\\d{1,${scale}})?$`);
  return z
    .union([z.string().trim(), z.number().finite()])
    .transform((v) => (typeof v === "number" ? new Prisma.Decimal(v).toFixed() : v))
    .refine((v) => pattern.test(v), { message: `Must be a decimal number with at most ${scale} decimal places` })
    .refine((v) => opts.min !== "positive" || new Prisma.Decimal(v).gt(0), { message: "Must be greater than 0" })
    .refine((v) => opts.min !== "nonNegative" || new Prisma.Decimal(v).gte(0), { message: "Must not be negative" });
}

/** For fields posted from HTML forms: an empty value ("") counts as absent. Wrap the whole field, e.g. emptyAsUndefined(usdAmount().optional()). */
export const emptyAsUndefined = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema);

/** Token quantity: up to 18 decimal places. */
export const tokenAmount = (opts: { min?: "positive" | "nonNegative" } = {}) => decimalAmount(18, opts);
/** USD / fiat: up to 2 decimal places. */
export const usdAmount = (opts: { min?: "positive" | "nonNegative" } = {}) => decimalAmount(2, opts);

/**
 * Display formatting without going through a float: groups the integer part
 * and trims to `maxFractionDigits` (truncating, never rounding up an amount).
 */
export function formatAmount(v: DecimalValue | null | undefined, maxFractionDigits = 8): string {
  if (v == null || v === "") return "—";
  const d = dec(v);
  const fixed = d.toDecimalPlaces(maxFractionDigits, Prisma.Decimal.ROUND_DOWN).toFixed();
  const [int, frac] = fixed.split(".");
  const negative = int.startsWith("-");
  const digits = negative ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/** USD display: two decimals, grouped. */
export function formatUsd(v: DecimalValue | null | undefined): string {
  if (v == null || v === "") return "—";
  const fixed = dec(v).toFixed(2);
  const [int, frac] = fixed.split(".");
  const negative = int.startsWith("-");
  const digits = negative ? int.slice(1) : int;
  return `${negative ? "-" : ""}$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}
