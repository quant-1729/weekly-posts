import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError, serviceAccountCredentials } from '@/lib/ai/client';

// Vercel has no key file, so the service account JSON comes from GOOGLE_SERVICE_ACCOUNT_JSON.
describe('serviceAccountCredentials', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is undefined when the variable is not set or blank (local runs use the key file path)', () => {
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_JSON', '');
    expect(serviceAccountCredentials()).toBeUndefined();
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_JSON', '   ');
    expect(serviceAccountCredentials()).toBeUndefined();
  });

  it('parses a pasted key file, including the escaped newlines in the private key', () => {
    const key = { type: 'service_account', client_email: 'bot@p.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n' };
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_JSON', ` ${JSON.stringify(key)}\n`);
    const creds = serviceAccountCredentials();
    expect(creds?.client_email).toBe(key.client_email);
    expect(creds?.private_key).toBe(key.private_key);
  });

  it('gives a clear error for bad JSON or a missing field, without echoing the value', () => {
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_JSON', '{"client_email": "x", secret-stuff');
    expect(() => serviceAccountCredentials()).toThrow(AiError);
    try {
      serviceAccountCredentials();
    } catch (e) {
      expect((e as Error).message).not.toContain('secret-stuff');
    }
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_JSON', JSON.stringify({ type: 'service_account', client_email: 'x@y' }));
    expect(() => serviceAccountCredentials()).toThrow(/private_key/);
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_JSON', JSON.stringify({ client_email: 'x@y', private_key: 'k' }));
    expect(() => serviceAccountCredentials()).toThrow(/type/);
  });

  it('accepts other Google credential types, such as a personal gcloud login', () => {
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_JSON', JSON.stringify({ type: 'authorized_user', client_id: 'a', client_secret: 'b', refresh_token: 'c' }));
    expect(serviceAccountCredentials()?.type).toBe('authorized_user');
  });
});
