// Context-group hints (`_meta.mint`), read off the ADVERTISED tool list — the
// same wire mcp-host's gateway projects them from (core `mintHintSchema`).
//
// The schema below is a strict local copy of the shared contract: the gateway
// drops any field that does not match, so a hint that drifts from it is a hint
// that silently stops grouping. Strict, so a misspelt key fails here instead.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
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

const mintHintSchema = z
  .object({
    domain: z.enum(['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food']).optional(),
    intent: z
      .enum(['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'])
      .optional(),
    canonical: z.literal(true).optional(),
    subject: z.string().optional(),
    when: z.object({ start: z.string(), end: z.string() }).strict().optional(),
    aliases: z
      .array(z.string().max(40).regex(/^[^A-Z]*$/, 'lowercase'))
      .max(8)
      .optional(),
  })
  .strict();

type Mint = z.infer<typeof mintHintSchema>;
interface Advertised {
  mint: unknown;
  properties: Record<string, Record<string, unknown>>;
}

async function advertised(): Promise<Record<string, Advertised>> {
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
    return Object.fromEntries(
      tools.map((t) => [
        t.name,
        {
          mint: (t._meta as { mint?: unknown } | undefined)?.mint,
          properties: (t.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>,
        },
      ]),
    );
  } finally {
    await harness.close();
  }
}

describe('_meta.mint context-group hints', () => {
  it('covers the full surface', async () => {
    expect(Object.keys(await advertised())).toHaveLength(20);
  });

  it('puts a hint matching the shared contract on every tool, all in the school domain', async () => {
    const bad = Object.entries(await advertised())
      .filter(([, t]) => {
        const parsed = mintHintSchema.safeParse(t.mint);
        return !parsed.success || parsed.data.domain !== 'school' || parsed.data.intent === undefined;
      })
      .map(([name]) => name);
    expect(bad).toEqual([]);
  });

  it('marks ic_list_assignments as THE canonical whats-due tool, with its subject, range and aliases', async () => {
    const tools = await advertised();
    expect(tools.ic_list_assignments.mint).toEqual({
      domain: 'school',
      intent: 'whats-due',
      canonical: true,
      subject: 'student',
      when: { start: 'since', end: 'until' },
      aliases: ['homework', 'assignments', 'due', 'missing', 'kids', 'school'],
    });
    const canonical = Object.entries(tools)
      .filter(([, t]) => (t.mint as Mint).canonical === true)
      .map(([name]) => name);
    expect(canonical).toEqual(['ic_list_assignments']);
  });

  it('names only arguments the tool actually takes', async () => {
    const dangling: string[] = [];
    for (const [name, t] of Object.entries(await advertised())) {
      const m = t.mint as Mint;
      for (const arg of [m.subject, m.when?.start, m.when?.end]) {
        if (arg !== undefined && !(arg in t.properties)) dangling.push(`${name}.${arg}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it('assigns intents by what each tool answers', async () => {
    const intents = Object.fromEntries(
      Object.entries(await advertised()).map(([name, t]) => [name, (t.mint as Mint).intent]),
    );
    expect(intents).toEqual({
      ic_healthcheck: 'lookup',
      ic_list_districts: 'lookup',
      ic_list_students: 'lookup',
      ic_get_schedule: 'lookup',
      ic_list_assignments: 'whats-due',
      ic_list_grades: 'lookup',
      ic_list_attendance: 'whats-on',
      ic_list_behavior: 'lookup',
      ic_list_food_service: 'lookup',
      ic_list_messages: 'whats-new',
      ic_get_message: 'lookup',
      ic_list_documents: 'lookup',
      ic_download_document: 'other',
      ic_list_school_days: 'whats-on',
      ic_list_attendance_events: 'whats-on',
      ic_list_recent_grades: 'lookup',
      ic_list_teachers: 'lookup',
      ic_list_assessments: 'lookup',
      ic_list_fees: 'lookup',
      ic_get_features: 'lookup',
    });
  });

  it('gives every whats-on tool its date range', async () => {
    const tools = await advertised();
    for (const name of ['ic_list_attendance', 'ic_list_school_days', 'ic_list_attendance_events']) {
      expect((tools[name].mint as Mint).when, name).toEqual({ start: 'since', end: 'until' });
    }
  });

  it('advertises the student argument without an enum when no labels were built', async () => {
    const tools = await advertised();
    const student = tools.ic_list_assignments.properties.student;
    expect(student).toBeDefined();
    expect(student.type).toBe('string');
    expect('enum' in student).toBe(false);
  });
});
