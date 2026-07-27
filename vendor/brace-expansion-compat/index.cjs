"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- This entry point intentionally preserves the legacy CommonJS callable API.
const safeBraceExpansion = require("brace-expansion-safe");

function expand(pattern, options) {
  return safeBraceExpansion.expand(pattern, options);
}

expand.expand = expand;
expand.EXPANSION_MAX = safeBraceExpansion.EXPANSION_MAX;
expand.EXPANSION_MAX_LENGTH = safeBraceExpansion.EXPANSION_MAX_LENGTH;

module.exports = expand;
