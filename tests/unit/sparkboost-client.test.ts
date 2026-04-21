import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparkBoostClient, SparkBoostError } from '@sparkboost/sparkboost-client';

describe('SparkBoostClient', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockResponse(status: number, body: string) {
    mockFetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
    });
  }

  const client = new SparkBoostClient({
    secretKey: 'test-key-123',
    baseUrl: 'http://gateway.test.com',
  });

  describe('post', () => {
    it('sends POST with secret-key header', async () => {
      mockResponse(200, '{"success":true,"code":"SUCCESS","data":[]}');

      await client.post('/api/v1/test', { foo: 'bar' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://gateway.test.com/api/v1/test',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'secret-key': 'test-key-123',
          },
          body: '{"foo":"bar"}',
        })
      );
    });

    it('sends POST without body when omitted', async () => {
      mockResponse(200, '{"success":true,"code":"SUCCESS","data":[]}');

      await client.post('/api/v1/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: undefined })
      );
    });

    it('throws SparkBoostError on HTTP error', async () => {
      mockResponse(401, '{"message":"Unauthorized"}');

      await expect(client.post('/api/v1/test')).rejects.toThrow(SparkBoostError);
    });

    it('throws SparkBoostError when success is false', async () => {
      mockResponse(200, '{"success":false,"msg":"Invalid token"}');

      await expect(client.post('/api/v1/test')).rejects.toThrow('Invalid token');
    });

    it('strips trailing slashes from baseUrl', async () => {
      const trailingClient = new SparkBoostClient({
        secretKey: 'key',
        baseUrl: 'http://test.com///',
      });
      mockResponse(200, '{"success":true,"code":"SUCCESS","data":[]}');

      await trailingClient.post('/path');

      expect(mockFetch).toHaveBeenCalledWith('http://test.com/path', expect.anything());
    });
  });

  describe('get', () => {
    it('sends GET with secret-key header', async () => {
      mockResponse(200, '{"code":200,"data":{"status":2}}');

      await client.get('/grokImagine/result?id=123');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://gateway.test.com/grokImagine/result?id=123',
        expect.objectContaining({
          method: 'GET',
          headers: { 'secret-key': 'test-key-123' },
        })
      );
    });
  });
});

describe('SparkBoostError', () => {
  it('includes status, endpoint, and truncated body', () => {
    const err = new SparkBoostError(500, '/api/test', 'A'.repeat(500));
    expect(err.status).toBe(500);
    expect(err.endpoint).toBe('/api/test');
    expect(err.message).toContain('500');
    expect(err.message).toContain('/api/test');
    expect(err.body.length).toBeGreaterThan(200);
    expect(err.name).toBe('SparkBoostError');
  });
});
