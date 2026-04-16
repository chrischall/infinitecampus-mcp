import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ICClient } from '../client.js';

export function registerDistrictTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_districts', {
    description: 'List Infinite Campus districts configured for this MCP server. Returns names + base URLs (no credentials).',
    annotations: { readOnlyHint: true },
  }, async () => {
    const data = client.listDistricts();
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
