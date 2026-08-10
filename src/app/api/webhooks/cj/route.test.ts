// @vitest-environment node
import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => Promise<unknown>) => run({ tx: true }),
  }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/lib/secrets/webhook-secret-store', () => ({
  listWebhookSecrets: vi.fn(),
}));

vi.mock('@/modules/catalog/discovery/webhook-inbox-repository', () => ({
  insertInboxEventIfAbsent: vi.fn(),
}));

vi.mock('@/modules/catalog/discovery/outbox-repository', () => ({
  insertOutboxIntents: vi.fn(),
}));

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }));

vi.mock('@/modules/catalog/discovery/queue-transport', () => ({
  default: () => ({ publish: publishMock }),
}));

// eslint-disable-next-line import/first
import { NextRequest } from 'next/server';
// eslint-disable-next-line import/first
import { listWebhookSecrets } from '@/lib/secrets/webhook-secret-store';
// eslint-disable-next-line import/first
import { insertInboxEventIfAbsent } from '@/modules/catalog/discovery/webhook-inbox-repository';
// eslint-disable-next-line import/first
import { insertOutboxIntents } from '@/modules/catalog/discovery/outbox-repository';
// eslint-disable-next-line import/first
import { POST } from './route';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SECRET = '28305';
const BODY = JSON.stringify({
  messageId: 'm-1',
  type: 'PRODUCT',
  messageType: 'UPDATE',
  params: { pid: 'pid-1' },
});

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

function request(body: string, headers: Record<string, string>): NextRequest {
  return new NextRequest('https://portal.example.com/api/webhooks/cj', {
    method: 'POST',
    body,
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(listWebhookSecrets).mockResolvedValue([
    { connectionId: 'connection-1', secret: SECRET },
  ]);
  asMock(insertInboxEventIfAbsent).mockResolvedValue({ id: 'inbox-1' });
  publishMock.mockResolvedValue(undefined);
});

describe('POST /api/webhooks/cj', () => {
  it('accepts a correctly signed raw body: 200 within the fast path, event persisted, successor intent recorded', async () => {
    const response = await POST(request(BODY, { sign: sign(BODY, SECRET) }));

    expect(response.status).toBe(200);
    expect(insertInboxEventIfAbsent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        supplierConnectionId: 'connection-1',
        messageId: 'm-1',
        eventType: 'PRODUCT',
        operation: 'UPDATE',
      }),
    );
    expect(insertOutboxIntents).toHaveBeenCalled();
    // No supplier lookup or evaluation happened - only persistence and one
    // best-effort publish.
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid signature with 401 and persists nothing', async () => {
    const response = await POST(
      request(BODY, { sign: sign(BODY, 'wrong-secret') }),
    );

    expect(response.status).toBe(401);
    expect(insertInboxEventIfAbsent).not.toHaveBeenCalled();
    expect(insertOutboxIntents).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('rejects a length-mismatched signature safely', async () => {
    const response = await POST(request(BODY, { sign: 'short' }));

    expect(response.status).toBe(401);
    expect(insertInboxEventIfAbsent).not.toHaveBeenCalled();
  });

  it('rejects a missing signature header without touching the database', async () => {
    const response = await POST(request(BODY, {}));

    expect(response.status).toBe(401);
    expect(listWebhookSecrets).not.toHaveBeenCalled();
  });

  it('acknowledges a duplicate messageId with 200 and enqueues nothing new', async () => {
    asMock(insertInboxEventIfAbsent).mockResolvedValue(null);

    const response = await POST(request(BODY, { sign: sign(BODY, SECRET) }));

    expect(response.status).toBe(200);
    expect(insertOutboxIntents).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('verifies the exact raw bytes - a body altered after signing never verifies', async () => {
    const altered = `${BODY} `;
    const response = await POST(request(altered, { sign: sign(BODY, SECRET) }));

    expect(response.status).toBe(401);
  });

  it('enforces the conservative request-size ceiling before heavy processing', async () => {
    const huge = JSON.stringify({
      messageId: 'm-big',
      type: 'PRODUCT',
      params: { pid: 'x'.repeat(300 * 1024) },
    });

    const response = await POST(request(huge, { sign: sign(huge, SECRET) }));

    expect(response.status).toBe(413);
    expect(insertInboxEventIfAbsent).not.toHaveBeenCalled();
  });

  it('rejects a signed but structurally invalid payload with 400, after signature verification', async () => {
    const junk = JSON.stringify({ nonsense: true });
    const response = await POST(request(junk, { sign: sign(junk, SECRET) }));

    expect(response.status).toBe(400);
    expect(insertInboxEventIfAbsent).not.toHaveBeenCalled();
  });

  it('still returns 200 when the immediate queue publish fails - the durable inbox/outbox pair carries the event', async () => {
    publishMock.mockRejectedValue(new Error('transport down'));

    const response = await POST(request(BODY, { sign: sign(BODY, SECRET) }));

    expect(response.status).toBe(200);
  });
});
