#!/usr/bin/env node
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadDotenvSafely, McpToolError, runMcp } from '@chrischall/mcp-utils';
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
import { registerHealthcheckTools } from './tools/healthcheck.js';
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
// IC portal in the browser). When not configured every tool still registers and
// log a clear stderr message — far better than the previous crash loop.
let account: Account | null = null;
let refreshSession: ResolvedAuth['refresh'];
let source: ResolvedAuth['source'] | undefined;
let configError: Error | null = null;
try {
  const resolved = await resolveAuth();
  account = resolved.account;
  refreshSession = resolved.refresh;
  source = resolved.source;
} catch (e) {
  configError = e as Error;
}

// Hand off to mcp-utils' runMcp for the connect + stdio transport + graceful
// shutdown. The registrar list is the SAME either way; only the client and the
// banner differ. A tool surface that follows the environment is what this
// avoids — see `unconfiguredClient`.
const COMMON: Pick<RunMcpOptions, 'name' | 'version'> = {
  name: 'infinitecampus',
  version: '2.8.3', // x-release-please-version
};

// Shared with the healthcheck so it can report the SAME state the tools see,
// including on the unconfigured path where there are no tools at all.
const healthState: {
  account: typeof account;
  source: typeof source;
  configError: Error | null;
  client: ICClient | null;
} = { account, source, configError, client: null };

/**
 * Stands in for the client when configuration is missing, so that every tool
 * registers either way and the failure surfaces WHERE IT IS ACTIONABLE — in the
 * answer to the tool somebody called, not in a tool list they never saw.
 *
 * The surface must not follow the environment. This server is hosted with
 * `perUserChild` + `authFields`, so mcp-host spawns a principal-less child with
 * none of the per-user config for prewarm, auto-update, restart and every
 * admin-portal tool listing — and THAT child's list is what the portal
 * publishes as the connector's surface. It advertised one tool for a connector
 * that has twenty.
 *
 * This continues the reasoning that put the healthcheck on this path rather
 * than reversing it: a server that can explain itself beats one that cannot,
 * and nineteen tools that each name the missing variables explain it better
 * than nineteen absences do. The healthcheck still reports the same state, and
 * `healthState.client` deliberately stays null so it reports "unconfigured"
 * rather than mistaking this stand-in for a live client.
 */
function unconfiguredClient(reason: Error | null): ICClient {
  const fail = (): never => {
    throw new McpToolError(
      `infinitecampus-mcp is not configured: ${reason?.message ?? 'unknown error'}`,
      {
        hint:
          'Set IC_BASE_URL (your portal URL) and IC_DISTRICT (the app-name path segment), ' +
          'plus IC_USERNAME and IC_PASSWORD together if you are not signing in through the ' +
          'browser. Call ic_healthcheck for the resolved state.',
      },
    );
  };
  return new Proxy({} as ICClient, {
    get(_target, prop) {
      // `then` must answer undefined or this object is thenable, and any
      // `await client` would resolve to something other than the client.
      // Symbols (toStringTag, node's inspect) are asked for by the runtime
      // rather than by tool code, so they get the same treatment.
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return fail;
    },
  });
}

{
  const client = account
    ? new ICClient(account, { refreshSession })
    : unconfiguredClient(configError);
  if (account) healthState.client = client;
  const tools: ToolRegistrar<ICClient>[] = [
    (server) => registerHealthcheckTools(server, healthState),
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
  const banner = account
    ? `[infinitecampus-mcp] District: ${account.name} (${account.baseUrl})${suffix}`
    : `[infinitecampus-mcp] Not configured: ${configError?.message ?? 'unknown error'}\n` +
      '[infinitecampus-mcp] Every tool is registered and will report this until the ' +
      'required env vars are set. Call ic_healthcheck for the resolved state.';
  await runMcp<ICClient>({ ...COMMON, deps: client, tools, banner: `${banner}\n${AI_NOTICE}` });
}
