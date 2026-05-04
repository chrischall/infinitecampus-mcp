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
import { loadAccount } from './config.js';
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

const account = loadAccount();
const client = new ICClient(account);
const server = new McpServer({ name: 'infinitecampus', version: '2.1.3' });

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

console.error(`[infinitecampus-mcp] District: ${account.name} (${account.baseUrl})`);
console.error('[infinitecampus-mcp] Developed and maintained by AI (Claude). Use at your own discretion.');

const transport = new StdioServerTransport();
await server.connect(transport);
