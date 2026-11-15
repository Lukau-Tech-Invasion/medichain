import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadJitsiScript } from '../../../shared/src/components/JitsiMeetComponent';

afterEach(() => {
  document.getElementById('jitsi-external-api')?.remove();
  delete window.JitsiMeetExternalAPI;
});

describe('video API recovery', () => {
  it('can load again after the video service temporarily refuses the script', async () => {
    const first = loadJitsiScript('localhost:8443');
    const rejected = expect(first).rejects.toThrow('Failed to load the Jitsi video API');
    const failedScript = document.getElementById('jitsi-external-api')!;
    failedScript.dispatchEvent(new Event('error'));
    await rejected;
    const retry = loadJitsiScript('localhost:8443');
    const newScript = document.getElementById('jitsi-external-api')!;
    expect(newScript).not.toBe(failedScript);
    window.JitsiMeetExternalAPI = vi.fn() as unknown as NonNullable<typeof window.JitsiMeetExternalAPI>;
    newScript.dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBeUndefined();
  });
});
