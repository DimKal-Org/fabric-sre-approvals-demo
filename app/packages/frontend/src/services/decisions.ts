import type { DecisionResult } from '@rayfin-app/shared';
import { getRayfinClient } from '@/lib/rayfin-client';

export type { DecisionResult } from '@rayfin-app/shared';

export async function approveRecommendation(id: string, comment?: string): Promise<DecisionResult> {
  const client = await getRayfinClient();
  return client.functions.approveRecommendation.invoke({ id, comment });
}

export async function rejectRecommendation(id: string, comment?: string): Promise<DecisionResult> {
  const client = await getRayfinClient();
  return client.functions.rejectRecommendation.invoke({ id, comment });
}
