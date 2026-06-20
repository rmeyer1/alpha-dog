import { requestSupabaseRest } from "@/lib/supabase/rest";
import type { TradeAnalysisRunRecord } from "./types";

interface StoredTradeAnalysisRun {
  id: string;
}

export async function saveTradeAnalysisRun(record: TradeAnalysisRunRecord) {
  const rows = await requestSupabaseRest<StoredTradeAnalysisRun[]>(
    "trade_analysis_runs",
    {
      body: record,
      method: "POST",
      prefer: "return=representation",
    },
  );

  return rows?.[0]?.id ?? null;
}
