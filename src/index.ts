#!/usr/bin/env node
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

try {
  const { config } = await import('dotenv');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  config({ path: join(__dirname, '..', '.env'), override: false });
} catch {
  // dotenv not available — rely on process.env
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAccounts } from './config.js';
import { ICClient } from './client.js';
import { registerDistrictTools } from './tools/districts.js';
import { registerStudentTools } from './tools/students.js';

const accounts = loadAccounts();
const client = new ICClient(accounts);
const server = new McpServer({ name: 'infinitecampus', version: '0.1.0' });

registerDistrictTools(server, client);
registerStudentTools(server, client);

console.error(`[infinitecampus-mcp] Loaded ${accounts.length} district(s): ${accounts.map((a) => a.name).join(', ')}`);
console.error('[infinitecampus-mcp] Developed and maintained by AI (Claude). Use at your own discretion.');

const transport = new StdioServerTransport();
await server.connect(transport);
