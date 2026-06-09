import { z } from "zod";
import {
  polymarketCategories,
  polymarketOrderByValues,
  polymarketTimePeriods,
} from "./types";

export const walletAddressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => value.toLowerCase());

const optionalBooleanSchema = z
  .string()
  .optional()
  .transform((value) => value === "true");

const queryIntegerSchema = (defaultValue: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .default(String(defaultValue))
    .transform((value, context) => {
      const parsed = Number(value);

      if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        context.addIssue({
          code: "custom",
          message: `Expected an integer from ${min} to ${max}.`,
        });

        return z.NEVER;
      }

      return parsed;
    });

const queryNumberSchema = (defaultValue: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .default(String(defaultValue))
    .transform((value, context) => {
      const parsed = Number(value);

      if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        context.addIssue({
          code: "custom",
          message: `Expected a number from ${min} to ${max}.`,
        });

        return z.NEVER;
      }

      return parsed;
    });

export const leaderboardQuerySchema = z.object({
  category: z.enum(polymarketCategories).default("OVERALL"),
  forceRefresh: optionalBooleanSchema.default(false),
  limit: queryIntegerSchema(25, 1, 50),
  offset: queryIntegerSchema(0, 0, 1000),
  orderBy: z.enum(polymarketOrderByValues).default("PNL"),
  timePeriod: z.enum(polymarketTimePeriods).default("WEEK"),
});

export const whaleQuerySchema = leaderboardQuerySchema.extend({
  minValue: queryNumberSchema(10000, 0, 10_000_000),
});

export const sharpPlaysQuerySchema = leaderboardQuerySchema.extend({
  minTraders: queryIntegerSchema(3, 2, 10),
});

export const walletQuerySchema = z.object({
  forceRefresh: optionalBooleanSchema.default(false),
});

export function parseSearchParams(
  searchParams: URLSearchParams,
): Record<string, string> {
  return Object.fromEntries(searchParams.entries());
}
