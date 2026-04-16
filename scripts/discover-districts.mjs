#!/usr/bin/env node
/**
 * Discover multi-district switching mechanism in IC.
 * Usage: node scripts/discover-districts.mjs
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

// Login
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
    const isJson = text.startsWith('[') || text.startsWith('{');
    console.log(`${r.status} ${label}`);
    if (r.status === 200) {
      if (isJson) {
        console.log(`     ${text.substring(0, 500)}`);
      } else {
        console.log(`     (non-JSON, ${text.length} chars) ${text.substring(0, 200)}`);
      }
    }
  } catch (e) {
    console.log(`ERR  ${label} — ${e.message}`);
  }
}

console.log('=== DISTRICT DISCOVERY ===');

// Check if the students endpoint returns students from multiple districts
await probe('/campus/api/portal/students', 'students (current district)');

// Probe for district-listing endpoints
await probe('/campus/api/portal/districts', 'districts (api)');
await probe('/campus/resources/portal/districts', 'districts (resources)');
await probe('/campus/api/portal/parent/districts', 'parent/districts');
await probe('/campus/resources/portal/parent/districts', 'resources parent/districts');

// Prism-based district lookup
await probe('/campus/prism?x=portal.PortalDistrict-listDistricts', 'prism listDistricts');
await probe('/campus/prism?x=portal.PortalDistrict-getDistricts', 'prism getDistricts');
await probe('/campus/prism?x=portal.PortalSwitch-listDistricts', 'prism PortalSwitch-listDistricts');

// Account/user info that might include district list
await probe('/campus/api/portal/user', 'user (api)');
await probe('/campus/resources/portal/user', 'user (resources)');
await probe('/campus/api/portal/parent', 'parent (api)');
await probe('/campus/resources/portal/parent', 'parent (resources)');
await probe('/campus/api/portal/userAccount', 'userAccount');

// Context / district switching
await probe('/campus/api/portal/context', 'context');
await probe('/campus/resources/portal/context', 'resources context');
await probe('/campus/api/portal/switchDistrict', 'switchDistrict');
await probe('/campus/resources/portal/switchDistrict', 'resources switchDistrict');

// App names / linked districts
await probe('/campus/api/portal/linkedAccounts', 'linkedAccounts');
await probe('/campus/resources/portal/linkedAccounts', 'resources linkedAccounts');
await probe('/campus/api/portal/portalAccounts', 'portalAccounts');

// Multi-district enrollment
await probe('/campus/prism?x=portal.PortalAccount-getLinkedAccounts', 'prism getLinkedAccounts');
await probe('/campus/prism?x=portal.PortalAccount-getAccounts', 'prism getAccounts');
await probe('/campus/prism?x=user.User-getLinkedAccounts', 'prism user getLinkedAccounts');

// Nav wrapper (the URL the user shared)
await probe('/campus/nav-wrapper/parent/portal/parent/home?appName=' + DISTRICT, 'nav-wrapper home');

// Try getting available appNames
await probe('/campus/api/portal/application', 'application');
await probe('/campus/resources/portal/application', 'resources application');
await probe('/campus/api/portal/appName', 'appName');

console.log('\n=== Done ===');
