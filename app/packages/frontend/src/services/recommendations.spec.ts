import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recommendation } from '@/test/recommendation';

const { getClient } = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock('@/lib/rayfin-client', () => ({ getRayfinClient: getClient }));
import { getRecommendation, listRecommendations } from './recommendations';

const page = vi.fn();
const execute = vi.fn();
const query = { select: vi.fn(), where: vi.fn(), orderBy: vi.fn(), first: vi.fn(), after: vi.fn(), executePaginated: page, execute };

beforeEach(() => {
  vi.resetAllMocks();
  query.select.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.first.mockReturnValue(query);
  query.after.mockReturnValue(query);
  // Only the SDK boundary is mocked; the production query/pagination runs unchanged.
  getClient.mockResolvedValue({
    data: { Recommendation: query },
  });
});

describe('recommendation data service', () => {
  it('loads all pages in newest-first order, not just the default 100 rows', async () => {
    page.mockResolvedValueOnce({ items: [recommendation()], hasNextPage: true, endCursor: 'next' });
    page.mockResolvedValueOnce({ items: [recommendation({ id: 'second' })], hasNextPage: false });
    expect(await listRecommendations()).toHaveLength(2);
    expect(query.orderBy).toHaveBeenCalledWith({ created_at: 'desc', id: 'desc' });
    expect(query.after).toHaveBeenCalledWith('next');
  });
  it('surfaces invalid cursors rather than silently dropping rows', async () => {
    page.mockResolvedValue({ items: [], hasNextPage: true, endCursor: null });
    await expect(listRecommendations()).rejects.toThrow('invalid pagination cursor');
  });
  it('surfaces disappeared records rather than returning success-shaped data', async () => {
    execute.mockResolvedValue([]);
    await expect(getRecommendation('missing')).rejects.toThrow('no longer exists');
  });
  it('explicitly selects all fields when refreshing a record, not just the primary key', async () => {
    const record = recommendation({ status: 'Approved', branch_name: 'sre/rec-12345678' });
    execute.mockResolvedValue([record]);
    expect(await getRecommendation(record.id)).toEqual(record);
    expect(query.select).toHaveBeenCalledWith(expect.arrayContaining([
      'status', 'branch_name', 'decided_at', 'error_message', 'git_repo_url', 'git_base_branch', 'git_folder',
    ]));
    expect(query.where).toHaveBeenCalledWith({ id: { eq: record.id } });
    expect(query.first).toHaveBeenCalledWith(1);
  });
});
