export const BRIDGE_LIMITS: { codeMs: number; idleMs: number; commandMs: number; events: number; waitMs: number };
export class BridgeError extends Error { status: number; constructor(status: number, message: string) }
export interface BridgeEvent { seq: number; at: number; kind: string; text?: string }
export interface BridgeKeeper { load(): Promise<object[]>; save(list: object[]): Promise<unknown> }
export interface BridgePageInfo { pageId: string; url: string; title: string; connected: boolean; agent: string | null; pairedAt: number | null; lastSeen: number; standing: boolean }
export class Bridge {
  constructor(o?: { now?: () => number; key?: string; keeper?: BridgeKeeper | null });
  version: number;
  ready: Promise<Bridge>;
  kept(): object[];
  pair(user: string, o?: { standing?: boolean }): { pageId: string; pageToken: string; code: string; expiresAt: number };
  attach(pageId: string, pageToken: string, send: (event: string, data: unknown) => void): () => void;
  hello(pageId: string, pageToken: string, o: { url?: unknown; title?: unknown }): unknown;
  result(pageId: string, pageToken: string, o: { id: unknown; ok: unknown; data?: unknown; error?: unknown }): boolean;
  message(pageId: string, pageToken: string, text: unknown): { to: string | null };
  close(pageId: string, pageToken: string): void;
  claim(code: unknown, agent: unknown): { agentToken: string; pageId: string };
  list(key: unknown): BridgePageInfo[];
  take(key: unknown, pageId: string, agent: unknown): { agentToken: string; pageId: string };
  status(agentToken: string): unknown;
  command(agentToken: string, o: { type: unknown; args: unknown }): Promise<{ ok: boolean; data?: unknown; error?: string; timeout?: boolean }>;
  events(agentToken: string, after?: number, wait?: number): Promise<{ events: BridgeEvent[]; seq: number }>;
}
export function bridgeOn(env?: Record<string, string | undefined>): boolean;
export function bridgeAgentKey(env?: Record<string, string | undefined>): string;
export function dbKeeper(): BridgeKeeper;
export function bridge(): Bridge;
export function bridgeReady(): Promise<Bridge>;
