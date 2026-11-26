export const MCP_VERSIONS: string[];
export const MCP_INSTRUCTIONS: string;
export const MCP_TOOLS: Record<string, { description: string; inputSchema: object }>;
export function mcpSession(): string;
export function mcpHandle(message: unknown, ctx?: { session?: string; bearer?: string; who?: string; client?: string }): Promise<{ answer: object | null; session?: string }>;
