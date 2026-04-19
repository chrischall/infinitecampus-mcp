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

/**
 * Check a feature flag via the district's displayOptions allow-list for the
 * student's first enrollment's structureID. Returns a FeatureDisabled content
 * block when the flag is explicitly `false`. Returns `null` in every other
 * case (flag is `true`, flag is absent, no enrollments, or the displayOptions
 * call itself fails) — callers then fall through to hit the real endpoint.
 *
 * Non-fatal by design: if the allow-list can't be fetched we don't want to
 * break the tool, since the 404-catch backstop still protects it.
 */
export async function checkFeatureDisabled(
  client: ICClient,
  district: string,
  studentId: string,
  student: RawStudent,
  flag: string,
  toolName: string,
  emptyData: unknown = [],
): Promise<{ content: [{ type: 'text'; text: string }] } | null> {
  const structureID = student.enrollments?.[0]?.structureID;
  if (!structureID) return null;
  try {
    const features = await client.getFeatures(district, structureID, studentId);
    if (features[flag] === false) return featureDisabled(toolName, district, emptyData);
    return null;
  } catch (e) {
    console.error(`[ic] displayOptions check failed for ${district}/${flag}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * Coerce a value to an array. Defensive against IC's prism XML→JSON
 * serializer which returns a bare object (not a 1-element array) for
 * collections that contain exactly one item. Also handles null/undefined.
 */
export function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
