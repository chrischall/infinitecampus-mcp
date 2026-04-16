import { writeFile, mkdir, stat } from 'fs/promises';
import { dirname } from 'path';
import type { Account } from './config.js';

interface Session {
  cookie: string;          // serialized "name=value; name2=value2" header
  loggedInAt: number;
  loginInFlight: Promise<void> | null;
}

const SESSION_TTL_MS = 5 * 60 * 60 * 1000; // 5h, slightly under IC's typical 6h

export interface RequestOpts {
  method?: 'GET' | 'POST';
  body?: BodyInit;
  headers?: Record<string, string>;
}

export class ICClient {
  private accounts = new Map<string, Account>();
  private sessions = new Map<string, Session>();

  constructor(accounts: Account[]) {
    for (const a of accounts) this.accounts.set(a.name, a);
  }

  listDistricts(): { name: string; baseUrl: string }[] {
    return [...this.accounts.values()].map((a) => ({ name: a.name, baseUrl: a.baseUrl }));
  }
}

export class UnknownDistrictError extends Error {
  constructor(public district: string, public available: string[]) {
    super(`Unknown district '${district}'. Configured: [${available.join(', ')}]`);
    this.name = 'UnknownDistrictError';
  }
}

export class AuthFailedError extends Error {
  constructor(public district: string) {
    super(`Login failed for district '${district}'. Check IC_N_USERNAME and IC_N_PASSWORD.`);
    this.name = 'AuthFailedError';
  }
}

export class PortalUnreachableError extends Error {
  constructor(public district: string, public status: number) {
    super(`Portal unreachable for district '${district}' (status ${status})`);
    this.name = 'PortalUnreachableError';
  }
}

export class SessionExpiredError extends Error {
  constructor(public district: string) {
    super(`Session expired for district '${district}' after re-login retry`);
    this.name = 'SessionExpiredError';
  }
}
