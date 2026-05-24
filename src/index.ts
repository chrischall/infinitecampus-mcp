#!/usr/bin/env node
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

try {
  const { config } = await import('dotenv');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // quiet:true suppresses dotenv's startup banner — required because MCP uses
  // stdout for JSON-RPC and any extra output corrupts the stream.
  config({ path: join(__dirname, '..', '.env'), override: false, quiet: true });
} catch {
  // dotenv not available — rely on process.env
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Account } from './config.js';
import { resolveAuth, type ResolvedAuth } from './auth.js';
import { ICClient } from './client.js';
import { registerDistrictTools } from './tools/districts.js';
import { registerStudentTools } from './tools/students.js';
import { registerScheduleTools } from './tools/schedule.js';
import { registerAssignmentTools } from './tools/assignments.js';
import { registerGradeTools } from './tools/grades.js';
import { registerAttendanceTools } from './tools/attendance.js';
import { registerBehaviorTools } from './tools/behavior.js';
import { registerFoodServiceTools } from './tools/foodservice.js';
import { registerMessageTools } from './tools/messages.js';
import { registerDocumentTools } from './tools/documents.js';
import { registerCalendarTools } from './tools/calendar.js';
import { registerAttendanceEventsTools } from './tools/attendance_events.js';
import { registerRecentGradesTools } from './tools/recent_grades.js';
import { registerTeacherTools } from './tools/teachers.js';
import { registerAssessmentTools } from './tools/assessments.js';
import { registerFeeTools } from './tools/fees.js';
import { registerFeaturesTools } from './tools/features.js';

// Defer config errors so the server can still start cleanly when env vars
// aren't set (e.g. during the host's install-time smoke test, before the
// user has filled in user_config OR the user hasn't yet signed into their
// IC portal in the browser). When not configured we register no tools and
// log a clear stderr message — far better than the previous crash loop.
let account: Account | null = null;
let preloaded: ResolvedAuth['preloaded'];
let source: ResolvedAuth['source'] | undefined;
let configError: Error | null = null;
try {
  const resolved = await resolveAuth();
  account = resolved.account;
  preloaded = resolved.preloaded;
  source = resolved.source;
} catch (e) {
  configError = e as Error;
}

const server = new McpServer({ name: 'infinitecampus', version: '2.2.0' }); // x-release-please-version

if (account) {
  const client = new ICClient(account, { preloaded });
  registerDistrictTools(server, client);
  registerStudentTools(server, client);
  registerScheduleTools(server, client);
  registerAssignmentTools(server, client);
  registerGradeTools(server, client);
  registerAttendanceTools(server, client);
  registerBehaviorTools(server, client);
  registerFoodServiceTools(server, client);
  registerMessageTools(server, client);
  registerDocumentTools(server, client);
  registerCalendarTools(server, client);
  registerAttendanceEventsTools(server, client);
  registerRecentGradesTools(server, client);
  registerTeacherTools(server, client);
  registerAssessmentTools(server, client);
  registerFeeTools(server, client);
  registerFeaturesTools(server, client);

  const suffix = source === 'fetchproxy' ? ' [via fetchproxy]' : '';
  console.error(`[infinitecampus-mcp] District: ${account.name} (${account.baseUrl})${suffix}`);
} else {
  console.error(`[infinitecampus-mcp] Not configured: ${configError?.message ?? 'unknown error'}`);
  console.error('[infinitecampus-mcp] Server is running with no tools registered. Set the required env vars and reinstall.');
}
console.error('[infinitecampus-mcp] Developed and maintained by AI (Claude). Use at your own discretion.');

const transport = new StdioServerTransport();
await server.connect(transport);
