/** Input contracts and validation errors for simulated-position operations. */
import { z } from "zod";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const snapshotSchema = z.record(z.string(), z.unknown());
const optionalSnapshotSchema = snapshotSchema.optional().default({});
const optionalNonNegativeNumber = z.number().finite().min(0).optional();
const optionalGreek = z.number().finite().optional();

const dataProvenanceSchema = z
  .object({
    asOf: z.string().datetime().optional(),
    cacheSource: z
      .enum(["demo", "live", "materialized", "memory_cache", "runtime_cache"])
      .optional(),
    cacheStatus: z.enum(["demo", "fresh", "stale"]).optional(),
    feed: z.enum(["demo", "indicative", "opra"]).optional(),
    sourceMode: z.enum(["demo", "live", "unknown"]).default("unknown"),
  })
  .superRefine((provenance, ctx) => {
    if (provenance.sourceMode === "demo" && provenance.feed !== "demo") {
      ctx.addIssue({
        code: "custom",
        message: "Demo positions must retain the demo feed provenance.",
        path: ["feed"],
      });
    }
    if (
      provenance.sourceMode === "live" &&
      !["indicative", "opra"].includes(provenance.feed ?? "")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Live positions must retain a live feed provenance.",
        path: ["feed"],
      });
    }
  });

const simulatedPositionLegInputSchema = z.object({
  askPrice: optionalNonNegativeNumber,
  bidPrice: optionalNonNegativeNumber,
  contractSymbol: z.string().trim().min(1).max(80).optional(),
  currentMark: optionalNonNegativeNumber,
  delta: optionalGreek,
  expirationDate: dateSchema.optional(),
  gamma: optionalGreek,
  impliedVolatility: optionalNonNegativeNumber,
  legIndex: z.number().int().min(0).optional(),
  midPrice: optionalNonNegativeNumber,
  openInterest: z.number().int().min(0).optional(),
  openPrice: z.number().finite().min(0),
  optionType: z.enum(["put", "call"]).optional(),
  quantity: z.number().int().positive().optional(),
  quoteAsOf: z.string().datetime().optional(),
  rho: optionalGreek,
  side: z.enum(["short", "long"]),
  snapshot: optionalSnapshotSchema,
  strike: z.number().finite().positive().optional(),
  theta: optionalGreek,
  vega: optionalGreek,
  volume: z.number().int().min(0).optional(),
});

export const simulatedPositionInputSchema = z
  .object({
    candidateSnapshot: optionalSnapshotSchema,
    contracts: z.number().int().positive().max(1000),
    dataProvenance: dataProvenanceSchema.optional(),
    expirationDate: dateSchema.optional(),
    legs: z.array(simulatedPositionLegInputSchema).min(1).max(4),
    netCredit: z.number().finite().positive().optional(),
    notes: z.string().trim().max(2000).optional(),
    openedAt: dateSchema.optional(),
    strategyType: z.enum([
      "short_put",
      "covered_call",
      "put_credit_spread",
      "call_credit_spread",
    ]),
    symbol: z
      .string()
      .trim()
      .min(1)
      .max(10)
      .regex(/^[A-Za-z0-9.-]+$/)
      .transform((value) => value.toUpperCase()),
    underlyingPriceAtOpen: z.number().finite().positive().optional(),
  })
  .superRefine((input, ctx) => {
    const expectedLegCount = input.strategyType.endsWith("_spread") ? 2 : 1;
    if (input.legs.length !== expectedLegCount) {
      ctx.addIssue({
        code: "custom",
        message: `${input.strategyType} requires ${expectedLegCount} leg${expectedLegCount === 1 ? "" : "s"}.`,
        path: ["legs"],
      });
    }
    if (input.strategyType.endsWith("_spread")) {
      const sides = new Set(input.legs.map((leg) => leg.side));
      if (!sides.has("short") || !sides.has("long")) {
        ctx.addIssue({
          code: "custom",
          message: "Credit spreads require one short leg and one long leg.",
          path: ["legs"],
        });
      }
    }
  });
export type SimulatedPositionInput = z.infer<
  typeof simulatedPositionInputSchema
>;

export const closeSimulatedPositionInputSchema = z.object({
  closedAt: z.string().datetime().optional(),
  closePrice: z.number().finite().min(0),
  contractsToClose: z.number().int().positive(),
  notes: z.string().trim().max(2000).optional(),
});
export type CloseSimulatedPositionInput = z.infer<
  typeof closeSimulatedPositionInputSchema
>;

export const expireSimulatedPositionInputSchema = z.object({
  expiredAt: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).optional(),
  underlyingPriceAtExpiration: z.number().finite().positive(),
});
export type ExpireSimulatedPositionInput = z.infer<
  typeof expireSimulatedPositionInputSchema
>;

export class SimulatedPositionValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "SimulatedPositionValidationError";
  }
}
