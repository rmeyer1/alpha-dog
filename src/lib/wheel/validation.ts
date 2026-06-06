import { z } from "zod";

export const personaIdSchema = z.enum([
  "conservative_wheel",
  "balanced_wheel",
  "aggressive_yield",
  "weekly_theta",
  "high_iv_hunter",
]);

export const companyStrategySchema = z.enum([
  "short_put",
  "put_credit_spread",
  "covered_call",
  "call_credit_spread",
]);

export const filtersSchema = z
  .object({
    dteMin: z.number().int().min(1).max(365).optional(),
    dteMax: z.number().int().min(1).max(730).optional(),
    deltaMin: z.number().min(0).max(1).optional(),
    deltaMax: z.number().min(0).max(1).optional(),
    minPremiumYield: z.number().min(0).max(1).optional(),
    minVolume: z.number().int().min(0).optional(),
    minOpenInterest: z.number().int().min(0).optional(),
    maxSpreadPctOfMid: z.number().min(0).max(10).optional(),
    minSpreadReturnOnRisk: z.number().min(0).max(5).optional(),
    maxSpreadWidth: z.number().min(1).max(100).optional(),
    spreadLongLegCount: z.number().int().min(1).max(10).optional(),
    excludeEarnings: z.boolean().optional(),
    includeWeeklies: z.boolean().optional(),
  })
  .optional();

export const analyzeRequestSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z0-9.-]+$/),
  persona: personaIdSchema.default("balanced_wheel"),
  filters: filtersSchema,
  resultLimit: z.number().int().min(1).max(100).default(25),
  forceRefresh: z.boolean().default(false),
});

export const screenerRequestSchema = z.object({
  persona: personaIdSchema.default("balanced_wheel"),
  strategy: companyStrategySchema.default("short_put"),
  filters: filtersSchema,
  limit: z.number().int().min(1).max(100).default(50),
  forceRefresh: z.boolean().default(false),
  cursor: z.number().int().min(0).default(0),
  batchSize: z.number().int().min(1).max(50).default(32),
});

export const savedPresetInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  basePersona: personaIdSchema,
  filters: filtersSchema.default({}),
});
