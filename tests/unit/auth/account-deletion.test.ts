import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Tests for account deletion error mapping.
 *
 * These exist because of a specific defect: the original implementation decided whether the
 * `delete-account` Edge Function was missing by searching `error.message` for "404" or "not found".
 * `functions.invoke` does not put the status there — it attaches the upstream response to
 * `error.context`, and the message of an undeployed function is the generic "Edge Function returned
 * a non-2xx status code". The string search therefore never matched, and a deployment gap was
 * reported to the user as "Could not start account deletion. Please try again." with no hint of the
 * cause.
 *
 * The regression these tests lock down is the shape of the error object, not the wording: a 404 we
 * detect, a 500 we do not, and a missing response we treat as unreachable.
 */

const invoke = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ functions: { invoke } }),
  isCloudConfigured: () => true,
}));

const { requestAccountDeletion } = await import('@/features/auth/service');

/** Builds the error shape `functions.invoke` actually rejects with. */
function functionError(status: number | undefined): Error & { context?: { status?: number } } {
  const error = new Error(
    status === undefined ? 'Failed to send a request to the Edge Function' : 'Edge Function returned a non-2xx status code',
  ) as Error & { context?: { status?: number } };

  error.name = status === undefined ? 'FunctionsFetchError' : 'FunctionsHttpError';
  if (status !== undefined) {
    error.context = { status };
  }

  return error;
}

describe('requestAccountDeletion', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('reports a missing Edge Function when the function returns 404', async () => {
    invoke.mockResolvedValue({ data: null, error: functionError(404) });

    const result = await requestAccountDeletion();

    expect(result.ok).toBe(false);
    // The message must name the actual remedy (deploy the function), because that is the only
    // action that resolves it.
    expect(result.formError).toContain('delete-account Edge Function');
    expect(result.formError).toContain('docs/DEPLOYMENT.md');
  });

  it('does not treat a generic non-2xx error as a missing function', async () => {
    invoke.mockResolvedValue({ data: null, error: functionError(500) });

    const result = await requestAccountDeletion();

    expect(result.ok).toBe(false);
    expect(result.formError).not.toContain('not been deployed');
    expect(result.formError).toContain('Nothing was removed');
  });

  it('reports an unreachable server when there is no response at all', async () => {
    // No `context.status`: the request never reached a server, so retrying is the right advice
    // rather than telling the user the service failed.
    invoke.mockResolvedValue({ data: null, error: functionError(undefined) });

    const result = await requestAccountDeletion();

    expect(result.ok).toBe(false);
    expect(result.formError).toContain('Check your connection');
  });

  it('asks the user to sign in again on 401', async () => {
    invoke.mockResolvedValue({ data: null, error: functionError(401) });

    const result = await requestAccountDeletion();

    expect(result.ok).toBe(false);
    expect(result.formError).toContain('session has expired');
  });

  it('surfaces an error message returned in the body', async () => {
    invoke.mockResolvedValue({ data: { error: 'Account deletion is not configured on the server.' }, error: null });

    const result = await requestAccountDeletion();

    expect(result.ok).toBe(false);
    expect(result.formError).toBe('Account deletion is not configured on the server.');
  });

  it('succeeds only on an explicit ok:true from the server', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });

    const result = await requestAccountDeletion();

    expect(result.ok).toBe(true);
  });

  it('does not claim success when the server confirms nothing', async () => {
    // A 2xx with an unrecognised body means the outcome is unknown. Reporting success would sign
    // the user out believing their account was gone when it may not be.
    invoke.mockResolvedValue({ data: {}, error: null });

    const result = await requestAccountDeletion();

    expect(result.ok).toBe(false);
    expect(result.formError).toContain('did not confirm');
  });
});
