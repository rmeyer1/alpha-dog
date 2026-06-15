import { getEnv } from "@/lib/env";
import { tradeAnalysisJsonSchema } from "./prompt";
import type { TradeAnalysisChartSource, TradeAnalysisResult } from "./types";
import { tradeAnalysisResultSchema } from "./validation";

interface TradeAnalysisProviderInput {
  chartSource: TradeAnalysisChartSource;
  messages: Array<{ content: string; role: "system" | "user" }>;
}

interface TradeAnalysisProviderOutput {
  model: string;
  provider: string;
  result: TradeAnalysisResult;
  rawResponse: unknown;
}

interface OpenAIResponseContent {
  text?: string;
  type?: string;
}

interface OpenAIResponseOutputItem {
  content?: OpenAIResponseContent[];
}

interface OpenAIResponseBody {
  error?: {
    message?: string;
  };
  output?: OpenAIResponseOutputItem[];
  output_text?: string;
}

function extractOutputText(body: OpenAIResponseBody) {
  if (typeof body.output_text === "string") {
    return body.output_text;
  }

  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return null;
}

export async function runTradeAnalysisProvider({
  chartSource,
  messages,
}: TradeAnalysisProviderInput): Promise<TradeAnalysisProviderOutput> {
  const env = getEnv();

  if (env.TRADE_ANALYSIS_PROVIDER !== "openai") {
    throw new Error(`Unsupported trade analysis provider: ${env.TRADE_ANALYSIS_PROVIDER}`);
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = env.OPENAI_TRADE_ANALYSIS_MODEL;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: messages,
      model,
      text: {
        format: {
          type: "json_schema",
          name: "trade_analysis_verdict",
          strict: true,
          schema: tradeAnalysisJsonSchema,
        },
      },
    }),
  });
  const body = (await response.json().catch(() => null)) as
    | OpenAIResponseBody
    | null;

  if (!response.ok) {
    throw new Error(
      body?.error?.message ?? `OpenAI returned HTTP ${response.status}.`,
    );
  }

  const outputText = body ? extractOutputText(body) : null;

  if (!outputText) {
    throw new Error("OpenAI returned an empty trade analysis response.");
  }

  const parsedJson = JSON.parse(outputText) as unknown;
  const parsed = tradeAnalysisResultSchema.parse(parsedJson);

  return {
    model,
    provider: env.TRADE_ANALYSIS_PROVIDER,
    rawResponse: body,
    result: {
      ...parsed,
      chartSource,
    },
  };
}
