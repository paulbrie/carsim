export const AGENT_LIMITS: { nameMin: number; nameMax: number; perAddress: number; perDay: number; windowMs: number; perOwner: number; seenEveryMs: number };
export const AGENT_PREFIX: string;
export function agentUid(id: string): string;
export function agentIdOf(uid: unknown): string | null;
export class AgentError extends Error { status: number; constructor(status: number, message: string) }
export function claimCode(s: unknown): string;
export function prettyCode(c: string): string;
export function agentName(x: unknown): string;
/** uid: `agent:<id>`, the owner of its networks. owner: the user who claimed it (null: nobody yet). */
export interface Agent { id: string; uid: string; name: string; createdAt: number; seenAt: number | null; claimed: boolean; owner: string | null; ownerName: string | null; claimedAt: number | null }
export type AgentBy = { agent?: string; user?: string; admin?: boolean };
export class AgentStore {
  constructor(db: unknown, opts?: { now?: () => number; secret?: string });
  register(o: { name: unknown; from: string }): Promise<{ agent: Agent; key: string; claim: string }>;
  byKey(key: unknown): Promise<Agent | null>;
  get(id: unknown): Promise<Agent | null>;
  waiting(code: unknown): Promise<Agent | null>;
  claim(code: unknown, user: { id: string; name?: string | null }): Promise<Agent>;
  mine(owner: string): Promise<Agent[]>;
  newKey(id: string, by: AgentBy): Promise<{ agent: Agent; key: string }>;
  newClaim(id: string, by: AgentBy): Promise<{ agent: Agent; claim: string }>;
  remove(id: string, by: AgentBy): Promise<Agent>;
}
export function agentStore(): AgentStore;
