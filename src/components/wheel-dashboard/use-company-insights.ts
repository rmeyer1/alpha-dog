"use client";

import { useEffect, useState } from "react";
import type { FinnhubCompanyInsights } from "@/lib/finnhub/client";
import type { CompanyInsightState } from "@/components/company-insights";

type ApiErrorPayload = {
  error: {
    message: string;
  };
};

function isApiErrorPayload(payload: unknown): payload is ApiErrorPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as ApiErrorPayload).error?.message === "string"
  );
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);

  next.setDate(next.getDate() + days);

  return next;
}

export function useCompanyInsights(symbol: string | null) {
  const [state, setState] = useState<CompanyInsightState>({
    data: null,
    error: null,
    status: "idle",
  });

  useEffect(() => {
    const normalizedSymbol = symbol?.trim().toUpperCase() ?? "";

    if (!normalizedSymbol) {
      return;
    }

    const controller = new AbortController();

    async function loadInsights() {
      setState((current) => ({
        data: current.data?.symbol === normalizedSymbol ? current.data : null,
        error: null,
        status: "loading",
      }));

      try {
        const to = dateOnly(new Date());
        const from = dateOnly(addDays(new Date(), -7));
        const response = await fetch(
          `/api/finnhub/company/${encodeURIComponent(
            normalizedSymbol,
          )}?from=${from}&to=${to}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = (await response.json()) as
          | FinnhubCompanyInsights
          | ApiErrorPayload;

        if (!response.ok || isApiErrorPayload(payload)) {
          throw new Error(
            isApiErrorPayload(payload)
              ? payload.error.message
              : "Company context is unavailable.",
          );
        }

        setState({
          data: payload,
          error: null,
          status: "success",
        });
      } catch (caught) {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          data: null,
          error:
            caught instanceof Error
              ? caught.message
              : "Company context is unavailable.",
          status: "error",
        });
      }
    }

    void loadInsights();

    return () => controller.abort();
  }, [symbol]);

  return state;
}
