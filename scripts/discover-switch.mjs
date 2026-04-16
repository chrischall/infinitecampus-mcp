#!/usr/bin/env node
/**
 * Discover how IC's cross-district switching works.
 * Login to district 1, then probe for switching mechanisms to district 2.
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), quiet: true });

const BASE1 = 'https://campus.springfield.k12.example.us';
const DISTRICT1 = 'springfield';
const BASE2 = 'https://campus.westside.k12.example.us';
const DISTRICT2 = 'westside';
const USERNAME = process.env.IC_1_USERNAME;
const PASSWORD = process.env.IC_1_PASSWORD;

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
    jar,
  };
}

// Login to district 1
console.log('=== Login to district 1 ===');
const loginRes = await fetch(
  `${BASE1}/campus/verify.jsp?nonBrowser=true&username=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}&appName=${encodeURIComponent(DISTRICT1)}&portalLoginPage=parents`,
  { method: 'POST' },
);
const { cookieHeader: cookies1, xsrf: xsrf1, jar: jar1 } = parseClean(loginRes.headers);
const headers1 = { Cookie: cookies1, Accept: 'application/json', ...(xsrf1 ? { 'X-XSRF-TOKEN': xsrf1 } : {}) };
console.log('Login OK. JSESSIONID:', jar1.get('JSESSIONID')?.substring(0, 10) + '...');

async function probe(base, path, label, hdrs, opts = {}) {
  const url = `${base}${path}`;
  try {
    const r = await fetch(url, { headers: hdrs, redirect: 'manual', ...opts });
    const loc = r.headers.get('location');
    const setCookie = r.headers.getSetCookie?.() ?? [];
    const text = await r.text();
    const preview = text.substring(0, 400);
    console.log(`\n${r.status} ${label}`);
    if (loc) console.log(`  Location: ${loc}`);
    if (setCookie.length > 0) console.log(`  Set-Cookie count: ${setCookie.length}`);
    if (text.length > 0) {
      const isJson = text.startsWith('{') || text.startsWith('[');
      console.log(`  Body (${text.length} chars${isJson ? ', JSON' : ''}): ${preview}`);
    }
    return { status: r.status, text, headers: r.headers, location: loc };
  } catch (e) {
    console.log(`\nERR ${label}: ${e.message}`);
    return null;
  }
}

console.log('\n=== Try district 1 cookies on district 2 endpoints ===');
await probe(BASE2, '/campus/api/portal/students', 'D2 students with D1 cookies', headers1);
await probe(BASE2, '/campus/resources/portal/grades?personID=12345', 'D2 grades with D1 cookies', headers1);

console.log('\n=== Probe district-switching endpoints on district 1 ===');
// Try switching/linking endpoints
await probe(BASE1, `/campus/api/portal/switchDistrict?appName=${DISTRICT2}`, 'switchDistrict to D2', headers1);
await probe(BASE1, `/campus/api/portal/switch?appName=${DISTRICT2}`, 'switch to D2', headers1);
await probe(BASE1, `/campus/prism?x=portal.PortalLinkedAccount-getLinkedAccounts`, 'prism getLinkedAccounts', headers1);
await probe(BASE1, `/campus/prism?x=portal.PortalSwitchAccount-getLinkedAccounts`, 'prism SwitchAccount-getLinkedAccounts', headers1);
await probe(BASE1, `/campus/prism?x=portal.PortalAccount-getLinkedAccounts`, 'prism Account-getLinkedAccounts', headers1);
await probe(BASE1, `/campus/prism?x=user.User-getLinkedAccounts`, 'prism User-getLinkedAccounts', headers1);
await probe(BASE1, `/campus/prism?x=portal.PortalNavigation-getLinkedAccounts`, 'prism Navigation-getLinkedAccounts', headers1);

// Maybe there's a cross-district auth token endpoint
await probe(BASE1, `/campus/api/portal/crossDistrictToken?appName=${DISTRICT2}`, 'crossDistrictToken', headers1);
await probe(BASE1, `/campus/api/portal/sso?appName=${DISTRICT2}`, 'sso to D2', headers1);
await probe(BASE1, `/campus/resources/portal/sso?targetApp=${DISTRICT2}`, 'resources sso', headers1);

// Try login to D2 using D1's JSESSIONID as an auth mechanism
console.log('\n=== Try D2 verify with D1 session cookie forwarded ===');
await probe(BASE2, `/campus/verify.jsp?nonBrowser=true&appName=${DISTRICT2}&portalLoginPage=parents`, 'D2 verify (no creds, with D1 cookie)', headers1, { method: 'POST' });

// Try the nav-wrapper switch
console.log('\n=== Nav-wrapper approach ===');
const navRes = await probe(BASE1, `/campus/nav-wrapper/parent/portal/parent/home?appName=${DISTRICT2}`, 'D1 nav-wrapper with D2 appName', { ...headers1, Accept: '*/*' });

// What if we just login to D1 but with D2's appName?
console.log('\n=== Login to D1 base with D2 appName ===');
const crossLogin = await fetch(
  `${BASE1}/campus/verify.jsp?nonBrowser=true&username=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}&appName=${encodeURIComponent(DISTRICT2)}&portalLoginPage=parents`,
  { method: 'POST' },
);
const crossBody = await crossLogin.text();
console.log(`D1 verify with D2 appName: ${crossLogin.status} — ${crossBody.trim()}`);

// What about D2 base with D1 appName?
console.log('\n=== Login to D2 base with D1 appName ===');
const crossLogin2 = await fetch(
  `${BASE2}/campus/verify.jsp?nonBrowser=true&username=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}&appName=${encodeURIComponent(DISTRICT1)}&portalLoginPage=parents`,
  { method: 'POST' },
);
const crossBody2 = await crossLogin2.text();
console.log(`D2 verify with D1 appName: ${crossLogin2.status} — ${crossBody2.trim()}`);

// Try linked account switching via POST
console.log('\n=== POST-based switching ===');
await probe(BASE1, '/campus/api/portal/linkedAccountSwitch', 'linkedAccountSwitch POST',
  { ...headers1, 'Content-Type': 'application/json' },
  { method: 'POST', body: JSON.stringify({ appName: DISTRICT2, baseUrl: BASE2 }) });

await probe(BASE1, `/campus/prism?x=portal.PortalLinkedAccount-switchAccount&appName=${DISTRICT2}`, 'prism switchAccount', headers1);
await probe(BASE1, `/campus/prism?x=portal.PortalLinkedAccount-switchDistrict&appName=${DISTRICT2}`, 'prism switchDistrict', headers1);
await probe(BASE1, `/campus/prism?x=portal.PortalLinkedAccount-switch&appName=${DISTRICT2}`, 'prism switch', headers1);

// Check if there's an accountID in our cookies/session
await probe(BASE1, '/campus/prism?x=portal.PortalLinkedAccount-getAll', 'prism LinkedAccount-getAll', headers1);
await probe(BASE1, '/campus/prism?x=portal.PortalNavigation-getAll', 'prism Navigation-getAll', headers1);
await probe(BASE1, '/campus/prism?x=portal.PortalNavigation-getMenu', 'prism Navigation-getMenu', headers1);

console.log('\n=== Done ===');
