#!/usr/bin/env node
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadDotenvSafely, runMcp } from '@chrischall/mcp-utils';
import type { RunMcpOptions, ToolRegistrar } from '@chrischall/mcp-utils';

// quiet load of the local .env (no-throw, silent when the file is absent —
// e.g. inside an mcpb bundle). Path is resolved next to dist/ so the same
// `..`/.env that the previous inline dotenv call used still applies.
// override:false keeps real host-provided env winning. stdout stays clean
// for JSON-RPC (loadDotenvSafely forces dotenv's quiet:true).
await loadDotenvSafely({
  path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env'),
  override: false,
});

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

const AI_NOTICE =
  '[infinitecampus-mcp] Developed and maintained by AI (Claude). Use at your own discretion.';

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

// Hand off to mcp-utils' runMcp for the connect + stdio transport + graceful
// shutdown. We keep the deferred-config-error pattern by deciding the registrar
// list and banner up here: when configured we wire every
// register<Domain>Tools(server, client) call; when not, we register no tools so
// the host's install-time tools/list still succeeds and the user gets an
// actionable stderr message (banner) instead of a crash loop.
const COMMON: Pick<RunMcpOptions, 'name' | 'version'> = {
  name: 'infinitecampus',
  version: '2.3.2', // x-release-please-version
};

if (account) {
  const client = new ICClient(account, { preloaded });
  const tools: ToolRegistrar<ICClient>[] = [
    registerDistrictTools,
    registerStudentTools,
    registerScheduleTools,
    registerAssignmentTools,
    registerGradeTools,
    registerAttendanceTools,
    registerBehaviorTools,
    registerFoodServiceTools,
    registerMessageTools,
    registerDocumentTools,
    registerCalendarTools,
    registerAttendanceEventsTools,
    registerRecentGradesTools,
    registerTeacherTools,
    registerAssessmentTools,
    registerFeeTools,
    registerFeaturesTools,
  ];

  const suffix = source === 'fetchproxy' ? ' [via fetchproxy]' : '';
  const districtLine = `[infinitecampus-mcp] District: ${account.name} (${account.baseUrl})${suffix}`;
  await runMcp<ICClient>({ ...COMMON, deps: client, tools, banner: `${districtLine}\n${AI_NOTICE}` });
} else {
  const notConfigured =
    `[infinitecampus-mcp] Not configured: ${configError?.message ?? 'unknown error'}\n` +
    '[infinitecampus-mcp] Server is running with no tools registered. Set the required env vars and reinstall.';
  await runMcp({ ...COMMON, tools: [], banner: `${notConfigured}\n${AI_NOTICE}` });
}
