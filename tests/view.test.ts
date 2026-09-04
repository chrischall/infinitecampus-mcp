// The `view` rung, driven through the REGISTERED RPC path rather than through
// `viewResponse` alone.
//
// Why this file is end-to-end and not a unit test of `src/view.ts`: a green
// unit test of the helper says nothing about whether any tool CALLS it.
// eventbrite-mcp shipped exactly that gap — `viewResponse` was tested and
// passing while 14 of its 26 tools were never wired to it, so the default rung
// silently did nothing on more than half the server. Every assertion here goes
// through `client.callTool`, so the schema validation, the argument plumbing
// and the content envelope are all the production ones.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { ICClient } from '../src/client.js';
import { registerStudentTools } from '../src/tools/students.js';
import { registerTeacherTools } from '../src/tools/teachers.js';

// Every registrar in the server, so the wiring audit below sees every tool the
// production entry point registers. `registerHealthcheckTools` is deliberately
// absent: it takes a state object rather than the client, and it registers
// through mcp-utils' `registerCredentialHealthcheckTool` rather than through a
// `registerTool` call in this repo — it is a live credential probe, not a read
// of Infinite Campus data, and has no payload to project.
import { registerDistrictTools } from '../src/tools/districts.js';
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
import { registerAssessmentTools } from '../src/tools/assessments.js';
import { registerFeeTools } from '../src/tools/fees.js';
import { registerFeaturesTools } from '../src/tools/features.js';

const account = {
  name: 'anoka',
  baseUrl: 'https://anoka.infinitecampus.org',
  district: 'anoka',
  username: 'u',
  password: 'p',
};

/**
 * A students payload shaped like the thing compact exists to shrink: media
 * URLs under media-named keys, a bare `.jpg` under a non-media key, and a
 * field nobody anticipated sitting next to them.
 */
const STUDENTS = [
  {
    personID: 12345,
    firstName: 'Ada',
    lastName: 'Lovelace',
    photo: 'https://anoka.infinitecampus.org/campus/photo/12345.jpg',
    thumbnailUrl: 'https://anoka.infinitecampus.org/campus/photo/12345-thumb.png',
    schoolLogo: 'https://anoka.infinitecampus.org/assets/logo.png',
    somethingNobodyAnticipated: { nested: 'value', count: 3 },
    enrollments: [{ enrollmentID: 1, calendarID: 2, structureID: 3 }],
  },
];

async function studentsHarness(payload: unknown = STUDENTS) {
  const client = new ICClient(account);
  const request = vi.spyOn(client, 'request').mockResolvedValue(payload as never);
  const harness = await createTestHarness((server: McpServer) => {
    registerStudentTools(server, client);
  });
  return { harness, request };
}

afterEach(() => vi.restoreAllMocks());

describe('view: the default rung, end to end', () => {
  it('strips media URLs from a real tool call with no view argument', async () => {
    const { harness } = await studentsHarness();
    try {
      const result = await harness.callTool('ic_list_students', { district: 'anoka' });
      const [student] = parseToolResult<Record<string, unknown>[]>(result);

      // Media-named keys are gone...
      expect(student).not.toHaveProperty('photo');
      expect(student).not.toHaveProperty('thumbnailUrl');
      // ...and so is a bare image URL under a key the pattern does not know.
      expect(student).not.toHaveProperty('schoolLogo');

      // Everything a caller acts on survives.
      expect(student.personID).toBe(12345);
      expect(student.firstName).toBe('Ada');
      expect(student.enrollments).toEqual([{ enrollmentID: 1, calendarID: 2, structureID: 3 }]);
    } finally {
      await harness.close();
    }
  });

  it('leaves a field nobody anticipated untouched — compact here is SUBTRACTIVE', async () => {
    // The claim src/view.ts makes: with no verified record of Infinite
    // Campus's field list, compact removes media and NOTHING else, so it
    // cannot punch a hole in a record by failing to know about a field.
    const { harness } = await studentsHarness();
    try {
      const result = await harness.callTool('ic_list_students', { district: 'anoka' });
      const [student] = parseToolResult<Record<string, unknown>[]>(result);
      expect(student.somethingNobodyAnticipated).toEqual({ nested: 'value', count: 3 });
    } finally {
      await harness.close();
    }
  });

  it('minifies: no formatting whitespace in the emitted text', async () => {
    const { harness } = await studentsHarness();
    try {
      const result = await harness.callTool('ic_list_students', { district: 'anoka' });
      const text = (result.content as { type: string; text: string }[])[0].text;
      expect(text).not.toContain('\n');
      expect(text).toBe(JSON.stringify(JSON.parse(text)));
    } finally {
      await harness.close();
    }
  });

  it('never sends `view` to Infinite Campus', async () => {
    // The leak this guards is not hypothetical: two sibling repos spread the
    // raw tool args into the upstream query (`{ ...args }`), which put `view`
    // on the wire as an unrecognised parameter. Every tool here reaches
    // upstream through ICClient.request, so asserting on its recorded calls
    // covers the district AND the path.
    const { harness, request } = await studentsHarness();
    try {
      await harness.callTool('ic_list_students', { district: 'anoka', view: 'full' });
      expect(request).toHaveBeenCalled();
      for (const call of request.mock.calls) {
        expect(JSON.stringify(call)).not.toMatch(/view/i);
      }
    } finally {
      await harness.close();
    }
  });
});

describe('view: the full rung', () => {
  it('returns the payload untouched, media URLs included', async () => {
    // The other arm of `viewResponse`'s rung ternary. Without this the `full`
    // rung was reachable from the schema and exercised by nothing — a caller
    // who asked for it would have been the first to run the line.
    const { harness } = await studentsHarness();
    try {
      const result = await harness.callTool('ic_list_students', { district: 'anoka', view: 'full' });
      const [student] = parseToolResult<Record<string, unknown>[]>(result);
      expect(student.photo).toBe('https://anoka.infinitecampus.org/campus/photo/12345.jpg');
      expect(student.thumbnailUrl).toBe('https://anoka.infinitecampus.org/campus/photo/12345-thumb.png');
      expect(student.schoolLogo).toBe('https://anoka.infinitecampus.org/assets/logo.png');
      expect(student.somethingNobodyAnticipated).toEqual({ nested: 'value', count: 3 });
    } finally {
      await harness.close();
    }
  });

  it('rejects a rung this server does not honour rather than aliasing it', async () => {
    // `raw` is in the fleet vocabulary but not in IC_VIEWS, so the schema —
    // not the handler — has to be the thing that says no. A schema that
    // accepted it would silently answer in some other rung.
    const { harness } = await studentsHarness();
    try {
      const result = await harness.callTool('ic_list_students', { district: 'anoka', view: 'raw' });
      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });
});

describe('view: an unexpected payload shape comes back WHOLE', () => {
  // The failure mode compact must never have is the one every absence guard in
  // this fleet exists to prevent: a response that came back empty or
  // half-filled and reads as a verified answer. These drive payloads the
  // projection has no idea what to do with.

  it('passes a bare string through instead of emptying it', async () => {
    const { harness } = await studentsHarness('an unexpected string body');
    try {
      const result = await harness.callTool('ic_list_students', { district: 'anoka' });
      expect(parseToolResult(result)).toBe('an unexpected string body');
    } finally {
      await harness.close();
    }
  });

  it('passes a class instance through rather than rebuilding it from its keys', async () => {
    class Enrollment {
      constructor(public enrollmentID: number, public photo: string) {}
    }
    const { harness } = await studentsHarness([new Enrollment(7, 'https://x/y.jpg')]);
    try {
      const result = await harness.callTool('ic_list_students', { district: 'anoka' });
      // Serialised, so the prototype is gone — but the FIELDS are all there,
      // media key included. Rebuilding a non-plain object from its enumerable
      // keys would quietly change what it is.
      expect(parseToolResult(result)).toEqual([{ enrollmentID: 7, photo: 'https://x/y.jpg' }]);
    } finally {
      await harness.close();
    }
  });

  it('preserves a null, which is a fact and not an absent field', async () => {
    const { harness } = await studentsHarness([{ personID: 1, counselorEmail: null }]);
    try {
      const result = await harness.callTool('ic_list_students', { district: 'anoka' });
      expect(parseToolResult(result)).toEqual([{ personID: 1, counselorEmail: null }]);
    } finally {
      await harness.close();
    }
  });
});

describe('view: the projection reaches a tool that assembles its answer', () => {
  it('strips media from ic_list_teachers, which merges two endpoints', async () => {
    // ic_list_teachers was one of the three read tools the rollout skipped
    // (issue #166). It does not hand back one payload — it merges two — so it
    // is the case a spot check of a passthrough tool would have missed.
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockImplementation(async (_district: string, path: string) => {
      if (path.includes('section/contacts')) {
        return [{
          sectionID: 9, courseName: 'Calculus', firstName: 'Grace', lastName: 'Hopper',
          email: 'ghopper@example.edu', photo: 'https://anoka.infinitecampus.org/p/9.jpg',
        }] as never;
      }
      return [{
        firstName: 'Alan', lastName: 'Turing', email: 'aturing@example.edu',
        avatar: 'https://anoka.infinitecampus.org/a/1.png',
      }] as never;
    });
    const harness = await createTestHarness((server: McpServer) => {
      registerTeacherTools(server, client);
    });
    try {
      const result = await harness.callTool('ic_list_teachers', { district: 'anoka', studentId: '12345' });
      const data = parseToolResult<{
        counselors: Record<string, unknown>[];
        teachers: Record<string, unknown>[];
      }>(result);

      expect(data.teachers[0]).not.toHaveProperty('photo');
      expect(data.teachers[0].email).toBe('ghopper@example.edu');
      expect(data.counselors[0]).not.toHaveProperty('avatar');
      expect(data.counselors[0].email).toBe('aturing@example.edu');

      const full = await harness.callTool(
        'ic_list_teachers',
        { district: 'anoka', studentId: '12345', view: 'full' },
      );
      const fullData = parseToolResult<{ teachers: Record<string, unknown>[] }>(full);
      expect(fullData.teachers[0].photo).toBe('https://anoka.infinitecampus.org/p/9.jpg');
    } finally {
      await harness.close();
    }
  });
});

describe('view: the wiring audit', () => {
  // The structural half of this file. The tests above prove the projection
  // works on the tools they drive; this one proves no read tool was LEFT OUT,
  // which is the failure the unit-test-only version of this file could not
  // see. It reads the advertised schema over the wire, so a tool that stopped
  // declaring `view` fails here even if its handler still calls viewResponse.
  async function allTools() {
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
    });
    const { tools } = await harness.client.listTools();
    await harness.close();
    return tools;
  }

  it('registers exactly the 19 tools this server has always had', async () => {
    // A rollout script in this fleet once silently deleted two write tools
    // while editing every tool file. This is the count that would have caught
    // it, asserted against what the server actually advertises.
    const tools = await allTools();
    expect(tools).toHaveLength(19);
  });

  it('gives every read tool a `view` parameter', async () => {
    const tools = await allTools();
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true);

    // 18 of the 19: only ic_download_document is excluded, and it is a write
    // (destructiveHint — it puts a PDF on disk) whose response is a receipt.
    expect(readOnly).toHaveLength(18);

    const without = readOnly
      .filter((t) => !(t.inputSchema.properties as Record<string, unknown> | undefined)?.view)
      .map((t) => t.name);
    expect(without).toEqual([]);
  });

  it('offers compact and full — and only those — on every read tool', async () => {
    const tools = await allTools();
    for (const tool of tools.filter((t) => t.annotations?.readOnlyHint === true)) {
      const view = (tool.inputSchema.properties as Record<string, { enum?: string[] }>).view;
      expect(view.enum, `${tool.name} advertises the wrong rungs`).toEqual(['compact', 'full']);
    }
  });

  it('leaves the one write tool without a view parameter', async () => {
    const tools = await allTools();
    const download = tools.find((t) => t.name === 'ic_download_document')!;
    expect(download.annotations?.destructiveHint).toBe(true);
    expect((download.inputSchema.properties as Record<string, unknown>).view).toBeUndefined();
  });
});
