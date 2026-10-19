import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChangePasswordDialog, deriveAuthProof, getApiClient } from '@medichain/shared';

/**
 * Changing a password: the current one is proved, never sent; the new one is
 * sent once so the server can refuse a weak one, and its reason is shown.
 */
function respond(status: number, body: unknown) {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as unknown as Response);
}

function fill(current: string, next: string) {
  fireEvent.change(screen.getByLabelText(/current/i), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: next } });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
}

describe('ChangePasswordDialog', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    getApiClient().clearTokens();
  });

  it('proves the current password and sends the new one for its check', async () => {
    respond(200, { success: true });
    render(<ChangePasswordDialog loginId="bt.nurse" onClose={() => undefined} />);
    fill('current secret phrase', 'violet kettle moves north');

    // The current password is stretched (PBKDF2, 210,000 rounds) before sending:
    // slow under a loaded test run, so wait for the result, not a fixed second.
    await screen.findByText(/your password has been changed/i, undefined, { timeout: 30_000 });
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.current_auth_proof).toBe(await deriveAuthProof('current secret phrase', 'bt.nurse'));
    expect(body.new_password).toBe('violet kettle moves north');
    expect(JSON.stringify(body)).not.toContain('current secret phrase');
  }, 60_000);

  it("shows the server's reason when it refuses the new password", async () => {
    respond(422, {
      error: 'That password is too common or too predictable. Choose something less guessable.',
      code: 'PASSWORD_TOO_COMMON',
    });
    render(<ChangePasswordDialog loginId="bt.nurse" onClose={() => undefined} />);
    fill('current secret phrase', 'Password2026!!!!');

    await waitFor(() => expect(screen.getByText(/too common or too predictable/i)).toBeInTheDocument(), {
      timeout: 30_000,
    });
  }, 60_000);
});
