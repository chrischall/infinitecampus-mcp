export interface Account {
  name: string;
  baseUrl: string;
  district: string;
  username: string;
  password: string;
}

const FIELDS = ['NAME', 'BASE_URL', 'DISTRICT', 'USERNAME', 'PASSWORD'] as const;

function readSlot(env: NodeJS.ProcessEnv | Record<string, string | undefined>, n: number) {
  const out: Partial<Record<typeof FIELDS[number], string>> = {};
  let any = false;
  for (const f of FIELDS) {
    const v = env[`IC_${n}_${f}`];
    if (v && v.length > 0) {
      out[f] = v;
      any = true;
    }
  }
  return { any, fields: out };
}

export function loadAccounts(env = process.env): Account[] {
  const accounts: Account[] = [];
  const seenNames = new Set<string>();

  for (let n = 1; n < 1000; n++) {
    const { any, fields } = readSlot(env, n);
    if (!any) break;

    const missing = FIELDS.filter((f) => !fields[f]);
    if (missing.length > 0) {
      throw new Error(
        `Account IC_${n} is incomplete: missing ${missing.join(', ')}. ` +
        `Required vars: ${FIELDS.join(', ')}.`,
      );
    }

    if (seenNames.has(fields.NAME!)) {
      throw new Error(
        `Duplicate district name '${fields.NAME}' in IC_${n}. Names must be unique.`,
      );
    }
    seenNames.add(fields.NAME!);

    if (!/^https:\/\//.test(fields.BASE_URL!)) {
      throw new Error(`IC_${n}_BASE_URL is not a valid https URL: '${fields.BASE_URL}'`);
    }

    accounts.push({
      name: fields.NAME!,
      baseUrl: fields.BASE_URL!.replace(/\/$/, ''),
      district: fields.DISTRICT!,
      username: fields.USERNAME!,
      password: fields.PASSWORD!,
    });
  }

  if (accounts.length === 0) {
    throw new Error(
      'No Infinite Campus accounts configured. Set IC_1_NAME, IC_1_BASE_URL, ' +
      'IC_1_DISTRICT, IC_1_USERNAME, IC_1_PASSWORD (and IC_2_*, IC_3_* for more).',
    );
  }

  return accounts;
}
