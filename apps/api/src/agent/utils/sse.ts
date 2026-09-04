import type { ServerResponse } from 'node:http';

export type SSESender = (event: string, data: unknown) => void;

export function createSSESender(res: ServerResponse): SSESender {
  return (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function sendToken(send: SSESender, text: string): void {
  send('token', { text });
}

export function sendDone(send: SSESender, content: string, iterations: number, maxTokens: number): void {
  send('done', { content: content || '(no response)', iterations, maxTokens });
}

export function sendError(send: SSESender, message: string, chain?: string, msgCount?: number, code?: string): void {
  // code (e.g. gateway 'feature_closed'/'quota_exhausted') lets the renderer show a
  // localized message instead of the raw English upstream text.
  send('error', { message, chain, msgCount, code });
}

export function sendReasoning(send: SSESender, text: string): void {
  send('reasoning', { text });
}

export function sendToolCall(send: SSESender, tool: string, args: string): void {
  send('tool_call', { tool, args });
}

export function sendToolResult(send: SSESender, tool: string, result: unknown): void {
  send('tool_result', { tool, result });
}

export function sendThinking(send: SSESender, text: string, iteration?: number): void {
  send('thinking', { text, iteration });
}
