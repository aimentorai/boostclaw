import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SparkBoostTaskManager } from '@sparkboost/task-manager';
import { SparkBoostClient } from '@sparkboost/sparkboost-client';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function mockClient(responses: Map<string, () => string>): SparkBoostClient {
  return {
    post: vi.fn(async (path: string, body: Record<string, unknown>) => {
      const handler = responses.get(path);
      if (!handler) throw new Error(`Unexpected POST: ${path}`);
      return handler();
    }),
    get: vi.fn(async (path: string) => {
      const handler = responses.get(path);
      if (!handler) throw new Error(`Unexpected GET: ${path}`);
      return handler();
    }),
  } as unknown as SparkBoostClient;
}

describe('SparkBoostTaskManager', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'task-mgr-test-'));
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  describe('submit', () => {
    it('submits a task and returns it with submitted status', async () => {
      const responses = new Map([
        ['/grokImagine/submit', () => JSON.stringify({ data: { id: 'task-1' } })],
      ]);
      const client = mockClient(responses);
      const mgr = new SparkBoostTaskManager(client, stateDir);

      const task = await mgr.submit('grok-video', {
        prompt: 'a cat playing piano',
        duration: 10,
        aspectRatio: '9:16',
      });

      expect(task.taskId).toBe('task-1');
      expect(task.status).toBe('submitted');
      expect(task.params.prompt).toBe('a cat playing piano');
      expect(task.pollCount).toBe(0);
      expect(typeof task.submittedAt).toBe('number');
    });

    it('throws when API returns no task ID', async () => {
      const responses = new Map([['/grokImagine/submit', () => JSON.stringify({ data: {} })]]);
      const client = mockClient(responses);
      const mgr = new SparkBoostTaskManager(client, stateDir);

      await expect(
        mgr.submit('grok-video', { prompt: 'test', duration: 6, aspectRatio: '9:16' })
      ).rejects.toThrow('no task ID');
    });
  });

  describe('getStatus', () => {
    it('returns null for unknown task', () => {
      const client = mockClient(new Map());
      const mgr = new SparkBoostTaskManager(client, stateDir);
      expect(mgr.getStatus('nonexistent')).toBeNull();
    });

    it('returns a copy (not the internal reference)', async () => {
      const responses = new Map([
        ['/grokImagine/submit', () => JSON.stringify({ data: { id: 't1' } })],
      ]);
      const client = mockClient(responses);
      const mgr = new SparkBoostTaskManager(client, stateDir);
      await mgr.submit('grok-video', { prompt: 'test', duration: 6, aspectRatio: '9:16' });

      const a = mgr.getStatus('t1');
      const b = mgr.getStatus('t1');
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  describe('listTasks', () => {
    it('returns empty array when no tasks', () => {
      const client = mockClient(new Map());
      const mgr = new SparkBoostTaskManager(client, stateDir);
      expect(mgr.listTasks()).toEqual([]);
    });

    it('filters by status', async () => {
      const responses = new Map([
        ['/grokImagine/submit', () => JSON.stringify({ data: { id: 't1' } })],
      ]);
      const client = mockClient(responses);
      const mgr = new SparkBoostTaskManager(client, stateDir);
      await mgr.submit('grok-video', { prompt: 'test', duration: 6, aspectRatio: '9:16' });

      const submitted = mgr.listTasks('submitted');
      const succeeded = mgr.listTasks('succeeded');
      expect(submitted).toHaveLength(1);
      expect(succeeded).toHaveLength(0);
    });
  });

  describe('cancel', () => {
    it('cancels a pending task immutably', async () => {
      const responses = new Map([
        ['/grokImagine/submit', () => JSON.stringify({ data: { id: 't1' } })],
      ]);
      const client = mockClient(responses);
      const mgr = new SparkBoostTaskManager(client, stateDir);
      await mgr.submit('grok-video', { prompt: 'test', duration: 6, aspectRatio: '9:16' });

      const beforeCancel = mgr.getStatus('t1')!;
      expect(beforeCancel.status).toBe('submitted');

      const ok = mgr.cancel('t1');
      expect(ok).toBe(true);

      const afterCancel = mgr.getStatus('t1')!;
      expect(afterCancel.status).toBe('failed');
      expect(afterCancel.error).toBe('Cancelled by user');

      // Original snapshot unchanged (immutability)
      expect(beforeCancel.status).toBe('submitted');
    });

    it('returns false for unknown task', () => {
      const client = mockClient(new Map());
      const mgr = new SparkBoostTaskManager(client, stateDir);
      expect(mgr.cancel('nonexistent')).toBe(false);
    });

    it('returns false for already succeeded task', async () => {
      const responses = new Map([
        ['/grokImagine/submit', () => JSON.stringify({ data: { id: 't1' } })],
      ]);
      const client = mockClient(responses);
      const mgr = new SparkBoostTaskManager(client, stateDir);
      await mgr.submit('grok-video', { prompt: 'test', duration: 6, aspectRatio: '9:16' });

      // Simulate succeeded by directly manipulating internal state
      const task = mgr.getStatus('t1')!;
      (mgr as any).tasks.set('t1', {
        ...task,
        status: 'succeeded',
        videoUrl: 'http://example.com/v.mp4',
      });

      expect(mgr.cancel('t1')).toBe(false);
    });
  });

  describe('persist and restore (crash recovery)', () => {
    it('persists state to disk and restores on new instance', async () => {
      const responses = new Map([
        ['/grokImagine/submit', () => JSON.stringify({ data: { id: 't1' } })],
      ]);
      const client = mockClient(responses);
      const mgr = new SparkBoostTaskManager(client, stateDir);
      await mgr.submit('grok-video', { prompt: 'test', duration: 6, aspectRatio: '9:16' });

      // Force persist
      await (mgr as any).persist();

      // Verify file exists
      expect(existsSync(join(stateDir, 'tasks.json'))).toBe(true);

      // Restore into a new instance
      const mgr2 = new SparkBoostTaskManager(client, stateDir);
      await (mgr2 as any).restore();

      const task = mgr2.getStatus('t1');
      expect(task).not.toBeNull();
      expect(task!.taskId).toBe('t1');
      expect(task!.status).toBe('submitted');
    });

    it('only restores non-terminal tasks', async () => {
      const responses = new Map([
        ['/grokImagine/submit', () => JSON.stringify({ data: { id: 't1' } })],
      ]);
      const client = mockClient(responses);
      const mgr = new SparkBoostTaskManager(client, stateDir);
      await mgr.submit('grok-video', { prompt: 'test', duration: 6, aspectRatio: '9:16' });

      // Cancel the task (makes it 'failed')
      mgr.cancel('t1');
      await (mgr as any).persist();

      // Restore — failed tasks should NOT be restored
      const mgr2 = new SparkBoostTaskManager(client, stateDir);
      await (mgr2 as any).restore();
      expect(mgr2.getStatus('t1')).toBeNull();
    });

    it('handles corrupted state file gracefully', async () => {
      writeFileSync(join(stateDir, 'tasks.json'), 'NOT JSON{{{', 'utf-8');

      const client = mockClient(new Map());
      const mgr = new SparkBoostTaskManager(client, stateDir);
      // Should not throw, just start fresh
      await (mgr as any).restore();
      expect(mgr.listTasks()).toEqual([]);
    });

    it('uses atomic write (temp file + rename)', async () => {
      const responses = new Map([
        ['/grokImagine/submit', () => JSON.stringify({ data: { id: 't1' } })],
      ]);
      const client = mockClient(responses);
      const mgr = new SparkBoostTaskManager(client, stateDir);
      await mgr.submit('grok-video', { prompt: 'test', duration: 6, aspectRatio: '9:16' });
      await (mgr as any).persist();

      // Temp file should not exist after persist
      expect(existsSync(join(stateDir, 'tasks.json.tmp'))).toBe(false);
      // Final file should exist
      expect(existsSync(join(stateDir, 'tasks.json'))).toBe(true);
    });
  });

  describe('prune', () => {
    it('removes old completed tasks', async () => {
      const responses = new Map([
        ['/grokImagine/submit', () => JSON.stringify({ data: { id: 't1' } })],
      ]);
      const client = mockClient(responses);
      const mgr = new SparkBoostTaskManager(client, stateDir);
      await mgr.submit('grok-video', { prompt: 'test', duration: 6, aspectRatio: '9:16' });

      // Simulate a completed task from 2 days ago
      const task = mgr.getStatus('t1')!;
      (mgr as any).tasks.set('t1', {
        ...task,
        status: 'succeeded',
        completedAt: Date.now() - 48 * 60 * 60 * 1000,
        videoUrl: 'http://example.com/v.mp4',
      });

      const pruned = mgr.prune(24);
      expect(pruned).toBe(1);
      expect(mgr.getStatus('t1')).toBeNull();
    });

    it('keeps recent completed tasks', async () => {
      const responses = new Map([
        ['/grokImagine/submit', () => JSON.stringify({ data: { id: 't1' } })],
      ]);
      const client = mockClient(responses);
      const mgr = new SparkBoostTaskManager(client, stateDir);
      await mgr.submit('grok-video', { prompt: 'test', duration: 6, aspectRatio: '9:16' });

      const task = mgr.getStatus('t1')!;
      (mgr as any).tasks.set('t1', {
        ...task,
        status: 'succeeded',
        completedAt: Date.now() - 1000,
        videoUrl: 'http://example.com/v.mp4',
      });

      expect(mgr.prune(24)).toBe(0);
      expect(mgr.getStatus('t1')).not.toBeNull();
    });
  });
});
