import { describe, it, expect, vi, afterEach } from 'vitest';
import { ICClient } from '../../src/client.js';
import {
  textContent,
  is404,
  featureDisabled,
  findStudent,
  studentNotFound,
  toArray,
  type RawStudent,
} from '../../src/tools/_shared.js';

const account = {
  name: 'anoka',
  baseUrl: 'https://anoka.infinitecampus.org',
  district: 'anoka',
  username: 'u',
  password: 'p',
};

afterEach(() => vi.restoreAllMocks());

describe('_shared.textContent', () => {
  it('wraps an object as a pretty-printed JSON text block', () => {
    const result = textContent({ foo: 'bar', n: 1 });
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ foo: 'bar', n: 1 }, null, 2) }],
    });
  });

  it('wraps an array as pretty-printed JSON', () => {
    const result = textContent([1, 2, 3]);
    expect(result.content[0].text).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('wraps null', () => {
    expect(textContent(null).content[0].text).toBe('null');
  });

  it('wraps a primitive string', () => {
    expect(textContent('hi').content[0].text).toBe('"hi"');
  });
});

describe('_shared.is404', () => {
  it('returns true for IC 404 Error instances', () => {
    expect(is404(new Error('IC 404 Not Found for /x'))).toBe(true);
  });

  it('returns false for Error instances without the IC 404 prefix', () => {
    expect(is404(new Error('IC 500 Server Error'))).toBe(false);
  });

  it('returns false for the download-404 variant (different prefix)', () => {
    expect(is404(new Error('IC download 404 for /x'))).toBe(false);
  });

  it('returns false for non-Error thrown values', () => {
    expect(is404('IC 404 Not Found')).toBe(false);
    expect(is404(404)).toBe(false);
    expect(is404(null)).toBe(false);
    expect(is404(undefined)).toBe(false);
    expect(is404({ message: 'IC 404 Not Found' })).toBe(false);
  });
});

describe('_shared.featureDisabled', () => {
  it('uses default empty-array data when not provided', () => {
    const result = featureDisabled('behavior', 'anoka');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      warning: 'FeatureDisabled',
      feature: 'behavior',
      district: 'anoka',
      data: [],
    });
  });

  it('accepts an explicit data shape (e.g. object for food service)', () => {
    const result = featureDisabled('foodService', 'anoka', { balance: null, transactions: [] });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toEqual({ balance: null, transactions: [] });
    expect(parsed.feature).toBe('foodService');
    expect(parsed.district).toBe('anoka');
  });

  it('accepts explicit data when it happens to equal the default', () => {
    const result = featureDisabled('documents', 'anoka', []);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toEqual([]);
  });
});

describe('_shared.findStudent', () => {
  it('returns the matching student when present', async () => {
    const client = new ICClient(account);
    const students: RawStudent[] = [
      { personID: 1, firstName: 'A' },
      { personID: 2, firstName: 'B' },
    ];
    vi.spyOn(client, 'request').mockResolvedValue(students as unknown as never);
    const found = await findStudent(client, 'anoka', '2');
    expect(found).toEqual({ personID: 2, firstName: 'B' });
  });

  it('returns null when no student matches the id', async () => {
    const client = new ICClient(account);
    const students: RawStudent[] = [{ personID: 1 }];
    vi.spyOn(client, 'request').mockResolvedValue(students as unknown as never);
    const found = await findStudent(client, 'anoka', '999');
    expect(found).toBeNull();
  });

  it('calls the students endpoint on the correct district', async () => {
    const client = new ICClient(account);
    const spy = vi.spyOn(client, 'request').mockResolvedValue([] as unknown as never);
    await findStudent(client, 'anoka', '1');
    expect(spy).toHaveBeenCalledWith('anoka', '/campus/api/portal/students');
  });
});

describe('_shared.studentNotFound', () => {
  it('returns a StudentNotFound error content block', () => {
    const result = studentNotFound('42');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ error: 'StudentNotFound', studentId: '42' });
  });
});

describe('_shared.toArray', () => {
  it('returns empty array for undefined', () => {
    expect(toArray(undefined)).toEqual([]);
  });

  it('returns empty array for null', () => {
    expect(toArray(null)).toEqual([]);
  });

  it('returns the same array when already an empty array', () => {
    expect(toArray([])).toEqual([]);
  });

  it('passes through an already-array value', () => {
    const input = [{ a: 1 }];
    expect(toArray(input)).toEqual([{ a: 1 }]);
  });

  it('wraps a single object in a 1-element array', () => {
    expect(toArray({ a: 1 })).toEqual([{ a: 1 }]);
  });

  it('wraps a falsy primitive (0) as [0] — does not treat as missing', () => {
    expect(toArray(0)).toEqual([0]);
  });

  it('wraps an empty string as [\'\'] — does not treat as missing', () => {
    expect(toArray('')).toEqual(['']);
  });
});
