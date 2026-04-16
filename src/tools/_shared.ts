import type { ICClient } from '../client.js';

export interface RawEnrollment {
  enrollmentID: number;
  calendarID: number;
  structureID: number;
  calendarName?: string;
  schoolName?: string;
  schoolID?: number;
  endDate?: string | null;
}

export interface RawStudent {
  personID: number;
  firstName?: string;
  lastName?: string;
  enrollments?: RawEnrollment[];
}

/** Wrap a value as an MCP text content block — the standard tool return shape. */
export function textContent(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** Detect "IC 404 ..." errors thrown by ICClient.request for endpoints that don't exist. */
export function is404(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith('IC 404 ');
}

/** Build a FeatureDisabled warning content block. */
export function featureDisabled(feature: string, district: string, data: unknown = []) {
  return textContent({ warning: 'FeatureDisabled', feature, district, data });
}

/** Fetch the students list and find the one matching studentId. Returns null if not found. */
export async function findStudent(
  client: ICClient,
  district: string,
  studentId: string,
): Promise<RawStudent | null> {
  const students = await client.request<RawStudent[]>(district, '/campus/api/portal/students');
  return students.find((s) => String(s.personID) === studentId) ?? null;
}

/** Standard error content block for when studentId doesn't match any student. */
export function studentNotFound(studentId: string) {
  return textContent({ error: 'StudentNotFound', studentId });
}
