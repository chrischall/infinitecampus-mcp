import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';
import { textContent } from './_shared.js';

const argsSchema = z.object({
  district: z.string().describe('District name from ic_list_districts'),
});

export function registerStudentTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_students', {
    description: 'List students enrolled under the parent account for a given district.',
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const data = await client.request(args.district, '/campus/api/portal/students');
    return textContent(data);
  });
}
