// The fleet annotation meta-test, read off the ADVERTISED tool list (the same
// wire a client sees) rather than a hand-kept table.
//
// `destructiveHint` defaults to TRUE in the spec whenever readOnlyHint is not
// true, and `openWorldHint` defaults to true too — so a forgotten hint and a
// considered one publish identically. Pinning that every tool CHOOSES is the
// only way the choice stays a decision rather than a default.
import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { ICClient } from '../src/client.js';
import { registerDistrictTools } from '../src/tools/districts.js';
import { registerStudentTools } from '../src/tools/students.js';
import { registerScheduleTools } from '../src/tools/schedule.js';
import { registerAssignmentTools } from '../src/tools/assignments.js';
import { registerGradeTools } from '../src/tools/grades.js';
import { registerAttendanceTools } from '../src/tools/attendance.js';
import { registerBehaviorTools } from '../src/tools/behavior.js';
import { registerFoodServiceTools } from '../src/tools/foodservice.js';
import { registerMessageTools } from '../src/tools/messages.js';
import { registerDocumentTools } from '../src/tools/documents.js';
import { registerCalendarTools } from '../src/tools/calendar.js';
import { registerAttendanceEventsTools } from '../src/tools/attendance_events.js';
import { registerRecentGradesTools } from '../src/tools/recent_grades.js';
import { registerTeacherTools } from '../src/tools/teachers.js';
import { registerAssessmentTools } from '../src/tools/assessments.js';
import { registerFeeTools } from '../src/tools/fees.js';
import { registerFeaturesTools } from '../src/tools/features.js';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';

const account = {
  name: 'anoka',
  baseUrl: 'https://anoka.infinitecampus.org',
  district: 'anoka',
  username: 'u',
  password: 'p',
};

interface Ann {
  readOnlyHint?: unknown;
  destructiveHint?: unknown;
  openWorldHint?: unknown;
}

async function advertised(): Promise<Record<string, Ann | undefined>> {
  const client = new ICClient(account);
  const harness = await createTestHarness((server: McpServer) => {
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
    registerHealthcheckTools(server, { account, source: 'env', configError: null, client });
  });
  try {
    const { tools } = await harness.client.listTools();
    return Object.fromEntries(tools.map((t) => [t.name, t.annotations as Ann | undefined]));
  } finally {
    await harness.close();
  }
}

describe('tool annotations', () => {
  it('covers the full surface (a meta-test that stops covering tools is worse than none)', async () => {
    expect(Object.keys(await advertised())).toHaveLength(20);
  });

  it('sets an explicit boolean destructiveHint on every write', async () => {
    const undeclared = Object.entries(await advertised())
      .filter(([, a]) => a?.readOnlyHint !== true && typeof a?.destructiveHint !== 'boolean')
      .map(([name]) => name);
    expect(undeclared).toEqual([]);
  });

  it('never lets a read claim to be destructive', async () => {
    const contradictory = Object.entries(await advertised())
      .filter(([, a]) => a?.readOnlyHint === true && a?.destructiveHint === true)
      .map(([name]) => name);
    expect(contradictory).toEqual([]);
  });

  it('declares openWorldHint true on every tool: each one reaches the Infinite Campus portal', async () => {
    // ic_download_document writes to local disk, but only after fetching the
    // PDF from the portal; ic_list_districts reads the CUPS-discovered district
    // list, which needs a live portal session. None is local-only.
    const notOpen = Object.entries(await advertised())
      .filter(([, a]) => a?.openWorldHint !== true)
      .map(([name]) => name);
    expect(notOpen).toEqual([]);
  });

  it('keeps ic_download_document as the only write, and destructive', async () => {
    // Inverse test: with overwrite:true it replaces an existing file on disk,
    // and nothing in this tool set restores the replaced file.
    const writes = Object.entries(await advertised())
      .filter(([, a]) => a?.readOnlyHint !== true)
      .map(([name, a]) => [name, a?.destructiveHint]);
    expect(writes).toEqual([['ic_download_document', true]]);
  });
});
