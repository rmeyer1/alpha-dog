import { NextResponse } from "next/server";

export interface SymbolRouteContext {
  params: Promise<{ symbol: string }>;
}

export function normalizeRouteSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

export async function symbolFromContext(context: SymbolRouteContext) {
  const { symbol } = await context.params;

  return normalizeRouteSymbol(symbol);
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

export function invalidSymbolResponse() {
  return errorResponse(
    "INVALID_SYMBOL",
    "A valid company symbol is required.",
    400,
  );
}

export function invalidQueryResponse(message: string) {
  return errorResponse("INVALID_QUERY", message, 400);
}

export function providerErrorResponse(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : "Finnhub request failed.";

  return errorResponse("FINNHUB_REQUEST_FAILED", message, 502);
}

export function jsonResponse(body: unknown) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, max-age=300",
    },
  });
}

export function dateParam(
  request: Request,
  name: "from" | "to",
) {
  const value = new URL(request.url).searchParams.get(name);

  if (!value) {
    return undefined;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function integerParam(
  request: Request,
  name: string,
  options: { defaultValue: number; max: number; min: number },
) {
  const value = new URL(request.url).searchParams.get(name);

  if (!value) {
    return options.defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return null;
  }

  return Math.max(options.min, Math.min(options.max, parsed));
}
