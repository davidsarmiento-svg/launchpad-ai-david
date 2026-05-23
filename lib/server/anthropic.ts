import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { serverEnv } from "@/lib/server/env";

let cachedAnthropicClient: Anthropic | null = null;

/**
 * Anthropic client for Claude. Server-only: the API key is never shipped
 * to the browser. Use this inside Route Handlers and server actions.
 */
export function getAnthropicClient(): Anthropic {
  if (!cachedAnthropicClient) {
    cachedAnthropicClient = new Anthropic({
      apiKey: serverEnv.ANTHROPIC_API_KEY,
    });
  }
  return cachedAnthropicClient;
}
