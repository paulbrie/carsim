export interface TicketUser { id: string; name: string; image: string | null; admin?: true }
export function issueTicket(user: { id: string; name: string; image?: string | null; admin?: boolean }, secret: string, ttlMs?: number, now?: number): string;
export function verifyTicket(ticket: unknown, secret: string | undefined, now?: number): TicketUser | null;
