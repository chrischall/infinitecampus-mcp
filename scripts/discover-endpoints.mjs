#!/usr/bin/env node
/**
 * Probe IC portal for real endpoint paths.
 * Usage: node scripts/discover-endpoints.mjs
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), quiet: true });

const BASE = process.env.IC_1_BASE_URL;
const DISTRICT = process.env.IC_1_DISTRICT;
const USERNAME = process.env.IC_1_USERNAME;
const PASSWORD = process.env.IC_1_PASSWORD;
const PERSON_ID = '12345'; // Alex

// --- Login ---
function parseClean(headers) {
  const raw = headers.getSetCookie?.() ?? [];
  const jar = new Map();
  let xsrf = '';
  for (const entry of raw) {
    if (/Max-Age=0/i.test(entry)) continue;
    const nv = entry.split(';')[0].trim();
    const eq = nv.indexOf('=');
    if (eq < 1) continue;
    const name = nv.substring(0, eq);
    const value = nv.substring(eq + 1);
    if (!value) continue;
    jar.set(name, value);
    if (name === 'XSRF-TOKEN') xsrf = value;
  }
  return {
    cookieHeader: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    xsrf,
  };
}

const loginRes = await fetch(
  `${BASE}/campus/verify.jsp?nonBrowser=true&username=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}&appName=${encodeURIComponent(DISTRICT)}&portalLoginPage=parents`,
  { method: 'POST' },
);
const { cookieHeader, xsrf } = parseClean(loginRes.headers);
const headers = {
  Cookie: cookieHeader,
  Accept: 'application/json',
  ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}),
};

async function probe(path, label) {
  const url = `${BASE}${path}`;
  try {
    const r = await fetch(url, { headers });
    const text = await r.text();
    const preview = text.substring(0, 300);
    const isJson = text.startsWith('[') || text.startsWith('{');
    console.log(`${r.status} ${label.padEnd(45)} ${path}`);
    if (r.status === 200 && isJson) {
      const data = JSON.parse(text);
      const count = Array.isArray(data) ? data.length : Object.keys(data).length;
      console.log(`     ✅ ${count} ${Array.isArray(data) ? 'items' : 'keys'}: ${preview.substring(0, 200)}`);
    } else if (r.status === 200) {
      console.log(`     📄 (non-JSON) ${preview.substring(0, 150)}`);
    }
  } catch (e) {
    console.log(`ERR  ${label.padEnd(45)} ${path} — ${e.message}`);
  }
}

console.log('=== GRADES ===');
await probe('/campus/resources/portal/grades', 'grades (no params)');
await probe(`/campus/resources/portal/grades?personID=${PERSON_ID}`, 'grades (personID)');
await probe(`/campus/resources/portal/grades?studentID=${PERSON_ID}`, 'grades (studentID)');
await probe(`/campus/api/portal/grades`, 'api/portal/grades');
await probe(`/campus/api/portal/grades?personID=${PERSON_ID}`, 'api/portal/grades (personID)');
await probe(`/campus/resources/portal/grades?_expand=true`, 'grades (_expand)');

console.log('\n=== ATTENDANCE ===');
await probe(`/campus/resources/portal/attendance?personID=${PERSON_ID}`, 'attendance (resources)');
await probe(`/campus/api/portal/attendance?personID=${PERSON_ID}`, 'attendance (api)');
await probe(`/campus/api/portal/attendance`, 'attendance (api, no params)');
await probe(`/campus/resources/portal/attendance`, 'attendance (resources, no params)');
await probe(`/campus/prism?x=portal.PortalAttendance&personID=${PERSON_ID}`, 'attendance (prism)');
await probe(`/campus/resources/portal/portalAttendance?personID=${PERSON_ID}`, 'portalAttendance');
await probe(`/campus/api/portal/portalAttendance?personID=${PERSON_ID}`, 'api portalAttendance');
await probe(`/campus/resources/portal/dailyAttendance?personID=${PERSON_ID}`, 'dailyAttendance');
await probe(`/campus/api/portal/dailyAttendance?personID=${PERSON_ID}`, 'api dailyAttendance');

console.log('\n=== MESSAGES / NOTIFICATIONS ===');
await probe('/campus/resources/portal/messages', 'messages (resources)');
await probe('/campus/api/portal/messages', 'messages (api)');
await probe('/campus/resources/portal/notification', 'notification (resources)');
await probe('/campus/api/portal/notification', 'notification (api)');
await probe('/campus/prism?x=notifications.Notification-retrieve&limitCount=20', 'notifications (prism retrieve)');
await probe('/campus/prism?x=notifications.NotificationUser-countUnviewed', 'notifications (prism count)');
await probe('/campus/prism?x=portal.PortalMessage-getInbox', 'messages (prism inbox)');
await probe('/campus/prism?x=portal.PortalMessage-getSent', 'messages (prism sent)');
await probe(`/campus/resources/portal/inbox`, 'inbox (resources)');
await probe(`/campus/api/portal/inbox`, 'inbox (api)');
await probe(`/campus/resources/portal/announcements`, 'announcements (resources)');
await probe(`/campus/api/portal/announcements`, 'announcements (api)');

console.log('\n=== DOCUMENTS ===');
await probe(`/campus/resources/portal/documents?personID=${PERSON_ID}`, 'documents (resources)');
await probe(`/campus/api/portal/documents?personID=${PERSON_ID}`, 'documents (api)');
await probe(`/campus/resources/portal/reportCard?personID=${PERSON_ID}`, 'reportCard');
await probe(`/campus/api/portal/reportCard?personID=${PERSON_ID}`, 'api reportCard');

console.log('\n=== OTHER POTENTIAL ENDPOINTS ===');
await probe(`/campus/resources/portal/calendar?personID=${PERSON_ID}`, 'calendar');
await probe(`/campus/resources/portal/gpa?personID=${PERSON_ID}`, 'gpa');
await probe(`/campus/resources/portal/term`, 'terms');
await probe(`/campus/resources/term?structureID=3917`, 'terms (structureID from enrollment)');
await probe(`/campus/resources/portal/gradingTask?personID=${PERSON_ID}`, 'gradingTask');
await probe(`/campus/resources/portal/grade?personID=${PERSON_ID}`, 'grade (singular)');

console.log('\n=== Done ===');
