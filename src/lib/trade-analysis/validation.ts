import { z } from "zod";
import { companyStrategySchema, personaIdSchema } from "@/lib/wheel/validation";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const tradeAnalysisResultSchema = z.object({
  verdict: z.enum(["validate", "invalidate", "needs_confirmation", "no_trade"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1),
  setupType: z.string().min(1),
  riskFlags: z.array(z.string()),
  invalidation: z.string().min(1),
  targets: z.array(z.string()),
  managementPlan: z.array(z.string()),
  chartRead: z.string().min(1),
  eventRisk: z.string().min(1),
  disclaimer: z.string().min(1),
});

export const tradeAnalysisRequestSchema = z.object({
  candidate: jsonValueSchema,
  candidateIdentity: z.object({
    key: z.string().trim().min(1).max(160),
    rank: z.number().int().min(1).nullable(),
    score: z.number().min(0).max(100).nullable(),
  }),
  candidateType: z.enum(["contract", "vertical_spread"]),
  dataFreshness: jsonValueSchema.optional(),
  filters: jsonValueSchema.optional(),
  persona: z.object({
    id: personaIdSchema,
    name: z.string().trim().min(1).max(120),
    motto: z.string().trim().min(1).max(240),
  }),
  source: z.enum(["wheel_dashboard", "company_dashboard"]).default("wheel_dashboard"),
  strategy: companyStrategySchema,
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z0-9.-]+$/)
    .transform((value) => value.toUpperCase()),
  underlying: z.object({
    symbol: z.string().trim().min(1).max(10),
    price: z.number().positive(),
    asOf: z.string().min(1),
    trend: z.enum(["bullish", "neutral", "bearish"]),
    rsi14: z.number().nullable(),
    movingAverages: z.object({
      ma20: z.number().nullable(),
      ma50: z.number().nullable(),
      ma200: z.number().nullable(),
    }),
  }),
});

export type ParsedTradeAnalysisRequest = z.infer<
  typeof tradeAnalysisRequestSchema
>;
