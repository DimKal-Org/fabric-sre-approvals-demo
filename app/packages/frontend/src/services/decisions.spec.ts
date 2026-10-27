import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getClient, approve, reject } = vi.hoisted(() => ({
  getClient: vi.fn(), approve: vi.fn(), reject: vi.fn(),
}));
vi.mock('@/lib/rayfin-client', () => ({ getRayfinClient: getClient }));
import { approveRecommendation, rejectRecommendation } from './decisions';

beforeEach(() => {
  vi.resetAllMocks();
  getClient.mockResolvedValue({ functions: {
    approveRecommendation: { invoke: approve }, rejectRecommendation: { invoke: reject },
  } });
});

describe('typed decision function calls', () => {
  it.each([
    [approveRecommendation, approve, 'Approved'],
    [rejectRecommendation, reject, 'Rejected'],
  ] as const)('forwards id and comment and returns the server result', async (invoke, sdk, status) => {
    const result = { status, branch_name: status === 'Approved' ? 'sre/rec-12345678' : undefined };
    sdk.mockResolvedValue(result);
    await expect(invoke('id', 'reviewed')).resolves.toEqual(result);
    expect(sdk).toHaveBeenCalledExactlyOnceWith({ id: 'id', comment: 'reviewed' });
  });
  it.each([
    [approveRecommendation, approve], [rejectRecommendation, reject],
  ] as const)('propagates function errors without writing data', async (invoke, sdk) => {
    sdk.mockRejectedValue(new Error('SRE thread notification returned HTTP 503'));
    await expect(invoke('id')).rejects.toThrow('HTTP 503');
    expect(sdk).toHaveBeenCalledExactlyOnceWith({ id: 'id', comment: undefined });
  });
});
