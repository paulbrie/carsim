export const BRIDGE_LIMITS: { codeMs: number; idleMs: number; commandMs: number; events: number; waitMs: number };
export class BridgeError extends Error { status: number; constructor(status: number, message: string) }
export interface BridgeEvent { seq: number; at: number; kind: string; text?: string }
export class Bridge {
  pair(user: string): { pageId: string; pageToken: string; code: string; expiresAt: number };
  attach(pageId: string, pageToken: string, send: (event: string, data: unknown) => void): () => void;
  hello(pageId: string, pageToken: string, o: { url?: unknown; title?: unknown }): unknown;
  result(pageId: string, pageToken: string, o: { id: unknown; ok: unknown; data?: unknown; error?: unknown }): boolean;
  message(pageId: string, pageToken: string, text: unknown): { to: string | null };
  close(pageId: string, pageToken: string): void;
  claim(code: unknown, agent: unknown): { agentToken: string; pageId: string };
  status(agentToken: string): unknown;
  command(agentToken: string, o: { type: unknown; args: unknown }): Promise<{ ok: boolean; data?: unknown; error?: string; timeout?: boolean }>;
  events(agentToken: string, after?: number, wait?: number): Promise<{ events: BridgeEvent[]; seq: number }>;
}
export function bridgeOn(env?: Record<string, string | undefined>): boolean;
export function bridge(): Bridge;
