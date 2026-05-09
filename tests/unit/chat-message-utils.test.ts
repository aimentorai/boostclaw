import { describe, expect, it } from 'vitest';
import { extractText } from '@/pages/Chat/message-utils';

describe('chat message display extraction', () => {
  it('strips runtime system notices from user-visible text', () => {
    const text = extractText({
      role: 'user',
      content:
        'System (untrusted): [2026-05-09 11:31:31 GMT+8] Exec failed (tide-wil, signal SIGTERM)\n\n' +
        'An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.\n' +
        'Current time: Saturday, May 9th, 2026 - 11:31 AM (Asia/Shanghai) / 2026-05-09 03:31 UTC 为什么会突然给用户发这个消息在对话框中',
    });

    expect(text).toBe('为什么会突然给用户发这个消息在对话框中');
  });
});
