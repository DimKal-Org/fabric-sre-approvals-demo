import type { RecommendationRecord } from '@rayfin-app/shared';
import { getRayfinClient } from '@/lib/rayfin-client';

const fields = [
  'id', 'created_at', 'thread_id', 'workspace_id', 'item_type', 'item_name',
  'item_path', 'git_repo_url', 'git_base_branch', 'git_folder',
  'title', 'severity', 'estimated_impact', 'summary', 'details',
  'proposed_changes', 'status', 'branch_name', 'decided_by_name', 'decided_by_email',
  'decided_by_id', 'decided_at', 'decision_comment', 'notified_at', 'commit_sha',
  'pr_url', 'error_message',
] as const;

export async function listRecommendations(): Promise<RecommendationRecord[]> {
  const client = await getRayfinClient();
  const records: RecommendationRecord[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    let query = client.data.Recommendation.select([...fields])
      .orderBy({ created_at: 'desc', id: 'desc' }).first(100);
    if (cursor) query = query.after(cursor);
    const page = await query.executePaginated();
    records.push(...page.items);
    if (!page.hasNextPage) break;
    if (!page.endCursor || cursors.has(page.endCursor)) {
      throw new Error('The data API returned an invalid pagination cursor. Refresh to try again.');
    }
    cursor = page.endCursor;
    cursors.add(cursor);
  } while (cursor);
  return records;
}

export async function getRecommendation(id: string): Promise<RecommendationRecord> {
  const [record] = await (await getRayfinClient()).data.Recommendation
    .select([...fields]).where({ id: { eq: id } }).first(1).execute();
  if (!record) throw new Error('Recommendation no longer exists or access was removed.');
  return record;
}
