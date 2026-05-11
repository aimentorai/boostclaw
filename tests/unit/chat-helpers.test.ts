import { describe, expect, it } from 'vitest';
import { isInternalMessage } from '@/stores/chat/helpers';

describe('chat helper message filtering', () => {
  it('treats runtime async command notices as internal messages', () => {
    expect(
      isInternalMessage({
        role: 'user',
        content:
          'System (untrusted): [2026-05-09 11:31:31 GMT+8] Exec failed (tide-wil, signal SIGTERM)\n\n' +
          'An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.\n' +
          'Current time: Saturday, May 9th, 2026 - 11:31 AM (Asia/Shanghai) / 2026-05-09 03:31 UTC',
      })
    ).toBe(true);
  });

  it('hides user HEARTBEAT read messages with any intermediate text', () => {
    expect(
      isInternalMessage({
        role: 'user',
        content: 'Read the HEARTBEAT.md file in the workspace to see if there are any tasks that need attention.',
      })
    ).toBe(true);
    expect(
      isInternalMessage({
        role: 'user',
        content: 'Read HEARTBEAT.md',
      })
    ).toBe(true);
  });

  it('keeps normal user questions about system messages visible', () => {
    expect(
      isInternalMessage({
        role: 'user',
        content: '为什么会突然给用户发这个消息在对话框中',
      })
    ).toBe(false);
  });
});
