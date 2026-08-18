export interface LlmResponse {
  response: string;
  intent: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  latencyMs: number;
}
