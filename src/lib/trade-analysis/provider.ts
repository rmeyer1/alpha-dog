import { getEnv } from "@/lib/env";
import {
  observeProviderCall,
  privateProviderFetchTracing,
  providerHttpError,
  providerMalformedResponse,
} from "@/lib/observability/provider";
import { withProviderTimeout } from "@/lib/provider-timeout";
import { tradeAnalysisJsonSchema } from "./prompt";
import type { TradeAnalysisChartSource, TradeAnalysisResult } from "./types";
import { tradeAnalysisResultSchema } from "./validation";

interface TradeAnalysisProviderInput {
  chartSource: TradeAnalysisChartSource;
  messages: Array<{ content: string; role: "system" | "user" }>;
  signal?: AbortSignal;
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
  signal,
}: TradeAnalysisProviderInput): Promise<TradeAnalysisProviderOutput> {
  const env = getEnv();

  if (env.TRADE_ANALYSIS_PROVIDER !== "openai") {
    throw new Error(`Unsupported trade analysis provider: ${env.TRADE_ANALYSIS_PROVIDER}`);
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = env.OPENAI_TRADE_ANALYSIS_MODEL;
  return observeProviderCall("openai", "trade_analysis", async () => {
    const providerSignal = withProviderTimeout(signal, 45_000);
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
      opentelemetry: privateProviderFetchTracing,
      signal: providerSignal,
    });
    let body: OpenAIResponseBody | null;

    try {
      body = await response.json() as OpenAIResponseBody;
    } catch (error) {
      throw providerMalformedResponse(
        "OpenAI returned a malformed response.",
        error,
      );
    }

    if (!response.ok) {
      throw providerHttpError(
        response.status,
        body?.error?.message ?? `OpenAI returned HTTP ${response.status}.`,
      );
    }

    const outputText = body ? extractOutputText(body) : null;

    if (!outputText) {
      throw providerMalformedResponse(
        "OpenAI returned an empty trade analysis response.",
      );
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
  });
}
