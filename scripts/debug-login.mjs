#!/usr/bin/env node
/**
 * Debug script — tests the IC login flow and data fetch with full diagnostics.
 * Usage: node scripts/debug-login.mjs
 * Reads IC_1_* env vars from .env (or pass them directly).
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), quiet: true });

const BASE_URL = process.env.IC_1_BASE_URL;
const DISTRICT = process.env.IC_1_DISTRICT;
const USERNAME = process.env.IC_1_USERNAME;
const PASSWORD = process.env.IC_1_PASSWORD;

if (!BASE_URL || !DISTRICT || !USERNAME || !PASSWORD) {
  console.error('Set IC_1_BASE_URL, IC_1_DISTRICT, IC_1_USERNAME, IC_1_PASSWORD in .env');
  process.exit(1);
}

console.log(`Base URL: ${BASE_URL}`);
console.log(`District: ${DISTRICT}`);
console.log(`Username: ${USERNAME}`);
console.log(`Password: ${'*'.repeat(PASSWORD.length)}`);
console.log('---');

// Step 1: Try the pre-login GET (to see if it sets cookies)
console.log('\n=== Step 1: GET login page ===');
const getUrl = `${BASE_URL}/campus/portal/parents/${DISTRICT}.jsp`;
console.log(`GET ${getUrl}`);
const getRes = await fetch(getUrl, { redirect: 'manual' });
console.log(`Status: ${getRes.status}`);
console.log(`Set-Cookie: ${getRes.headers.get('set-cookie') ?? '(none)'}`);
console.log(`getSetCookie: ${JSON.stringify(getRes.headers.getSetCookie?.() ?? '(unavailable)')}`);
console.log(`Location: ${getRes.headers.get('location') ?? '(none)'}`);

// Capture cookies from step 1
const step1Cookies = (getRes.headers.getSetCookie?.() ?? [])
  .map(c => c.split(';')[0].trim()).join('; ');
console.log(`Captured cookies: ${step1Cookies || '(none)'}`);

// --- Smart cookie parser (matches client.ts parseSetCookies) ---
function parseClean(headers) {
  const raw = headers.getSetCookie?.() ?? [];
  const jar = new Map();
  let xsrf = '';
  for (const entry of raw) {
    if (/Max-Age=0/i.test(entry)) continue; // skip deletions
    const nv = entry.split(';')[0].trim();
    const eq = nv.indexOf('=');
    if (eq < 1) continue;
    const name = nv.substring(0, eq);
    const value = nv.substring(eq + 1);
    if (!value) continue; // skip empty values
    jar.set(name, value);
    if (name === 'XSRF-TOKEN') xsrf = value;
  }
  return {
    cookieHeader: [...jar.entries()].map(([k,v]) => `${k}=${v}`).join('; '),
    xsrf,
  };
}

// Step 2: POST to verify.jsp (without pre-login cookies)
console.log('\n=== Step 2a: POST verify.jsp (NO pre-login cookies) ===');
const verifyUrl = `${BASE_URL}/campus/verify.jsp?nonBrowser=true&username=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}&appName=${encodeURIComponent(DISTRICT)}&portalLoginPage=parents`;
console.log(`POST ${verifyUrl.replace(encodeURIComponent(PASSWORD), '***')}`);
const postRes1 = await fetch(verifyUrl, { method: 'POST' });
console.log(`Status: ${postRes1.status}`);
console.log(`Set-Cookie: ${postRes1.headers.get('set-cookie') ?? '(none)'}`);
console.log(`getSetCookie: ${JSON.stringify(postRes1.headers.getSetCookie?.() ?? '(unavailable)')}`);
const body1 = await postRes1.text();
console.log(`Body (first 500 chars): ${body1.substring(0, 500)}`);
console.log(`Contains 'password-error': ${body1.includes('password-error')}`);

const post1Cookies = (postRes1.headers.getSetCookie?.() ?? [])
  .map(c => c.split(';')[0].trim()).join('; ');
console.log(`Captured cookies: ${post1Cookies || '(none)'}`);

// Step 2b: POST to verify.jsp WITH pre-login cookies
console.log('\n=== Step 2b: POST verify.jsp (WITH pre-login cookies from step 1) ===');
const postRes2 = await fetch(verifyUrl, {
  method: 'POST',
  headers: step1Cookies ? { Cookie: step1Cookies } : {},
});
console.log(`Status: ${postRes2.status}`);
console.log(`getSetCookie: ${JSON.stringify(postRes2.headers.getSetCookie?.() ?? '(unavailable)')}`);
const body2 = await postRes2.text();
console.log(`Body (first 500 chars): ${body2.substring(0, 500)}`);
console.log(`Contains 'password-error': ${body2.includes('password-error')}`);

const post2Cookies = (postRes2.headers.getSetCookie?.() ?? [])
  .map(c => c.split(';')[0].trim()).join('; ');
console.log(`Captured cookies: ${post2Cookies || '(none)'}`);

// Step 3: Try data requests with CLEANED cookies (matching client.ts logic)
const clean2a = parseClean(postRes1.headers);
console.log(`\n=== Cleaned 2a cookies: ${clean2a.cookieHeader}`);
console.log(`=== XSRF token: ${clean2a.xsrf}`);

const endpoints = [
  '/campus/api/portal/students',
  '/campus/resources/portal/grades',
  '/campus/resources/portal/roster',
];

for (const ep of endpoints) {
  const url = `${BASE_URL}${ep}`;
  console.log(`\n=== GET ${ep} (cleaned cookies + XSRF header) ===`);
  const r = await fetch(url, {
    headers: {
      Cookie: clean2a.cookieHeader,
      Accept: 'application/json',
      ...(clean2a.xsrf ? { 'X-XSRF-TOKEN': clean2a.xsrf } : {}),
    },
  });
  console.log(`Status: ${r.status}`);
  const t = await r.text();
  console.log(`Body (first 500 chars): ${t.substring(0, 500)}`);
}

console.log('\n=== Done ===');
