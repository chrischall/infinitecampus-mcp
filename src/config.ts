export interface Account {
  name: string;
  baseUrl: string;
  district: string;
  username: string;
  password: string;
}

export function loadAccount(env: Record<string, string | undefined> = process.env): Account {
  const baseUrl = env.IC_BASE_URL;
  const district = env.IC_DISTRICT;
  const username = env.IC_USERNAME;
  const password = env.IC_PASSWORD;
  const name = env.IC_NAME || district;

  const missing: string[] = [];
  if (!baseUrl) missing.push('IC_BASE_URL');
  if (!district) missing.push('IC_DISTRICT');
  if (!username) missing.push('IC_USERNAME');
  if (!password) missing.push('IC_PASSWORD');

  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(', ')}. ` +
      'Set IC_BASE_URL, IC_DISTRICT, IC_USERNAME, and IC_PASSWORD.',
    );
  }

  if (!/^https:\/\//.test(baseUrl!)) {
    throw new Error(`IC_BASE_URL must be an https URL, got: '${baseUrl}'`);
  }

  return {
    name: name!,
    baseUrl: baseUrl!.replace(/\/$/, ''),
    district: district!,
    username: username!,
    password: password!,
  };
}
