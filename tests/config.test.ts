import { describe, it, expect } from 'vitest';
import { loadAccounts } from '../src/config.js';

const baseEnv = {
  IC_1_NAME: 'anoka',
  IC_1_BASE_URL: 'https://anoka.infinitecampus.org',
  IC_1_DISTRICT: 'anoka',
  IC_1_USERNAME: 'parent@example.com',
  IC_1_PASSWORD: 'secret',
};

describe('loadAccounts', () => {
  it('parses a single account', () => {
    const accounts = loadAccounts(baseEnv);
    expect(accounts).toEqual([{
      name: 'anoka',
      baseUrl: 'https://anoka.infinitecampus.org',
      district: 'anoka',
      username: 'parent@example.com',
      password: 'secret',
    }]);
  });

  it('parses three sequential accounts', () => {
    const env = {
      ...baseEnv,
      IC_2_NAME: 'mpls', IC_2_BASE_URL: 'https://mpls.infinitecampus.org',
      IC_2_DISTRICT: 'mpls', IC_2_USERNAME: 'u2', IC_2_PASSWORD: 'p2',
      IC_3_NAME: 'stp', IC_3_BASE_URL: 'https://stp.infinitecampus.org',
      IC_3_DISTRICT: 'stp', IC_3_USERNAME: 'u3', IC_3_PASSWORD: 'p3',
    };
    expect(loadAccounts(env)).toHaveLength(3);
  });

  it('stops scanning at the first gap', () => {
    const env = {
      ...baseEnv,
      // IC_2_* deliberately missing
      IC_3_NAME: 'stp', IC_3_BASE_URL: 'https://stp.infinitecampus.org',
      IC_3_DISTRICT: 'stp', IC_3_USERNAME: 'u3', IC_3_PASSWORD: 'p3',
    };
    expect(loadAccounts(env)).toHaveLength(1);
  });
});
