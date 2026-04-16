import { describe, it, expect } from 'vitest';
import { ICClient } from '../src/client.js';
import type { Account } from '../src/config.js';

const accounts: Account[] = [
  { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka',
    username: 'u', password: 'p' },
  { name: 'mpls', baseUrl: 'https://mpls.infinitecampus.org', district: 'mpls',
    username: 'u', password: 'p' },
];

describe('ICClient.listDistricts', () => {
  it('returns name + baseUrl for each configured account, no creds', () => {
    const client = new ICClient(accounts);
    expect(client.listDistricts()).toEqual([
      { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org' },
      { name: 'mpls', baseUrl: 'https://mpls.infinitecampus.org' },
    ]);
  });
});
