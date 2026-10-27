import type { RecommendationRecord } from '@rayfin-app/shared';

export function recommendation(overrides: Partial<RecommendationRecord> = {}): RecommendationRecord {
  return {
    id: '63094d09-0394-4f49-8e0b-56076ed5a001',
    created_at: new Date('2026-10-22T09:00:00Z'),
    thread_id: 'test-thread-collect',
    workspace_id: 'test-workspace',
    item_type: 'Notebook',
    item_name: 'Sales ETL',
    item_path: 'Sales_ETL.Notebook',
    title: 'Avoid collecting the full sales dataset',
    severity: 'High',
    estimated_impact: 'Lower driver memory pressure',
    summary: 'Keep the sales transformation distributed.',
    details: '## Finding\n`collect()` materializes all rows.',
    proposed_changes: '## Proposed change\n```python\nresult = sales.filter("net > 0")\n```',
    status: 'Pending',
    ...overrides,
  };
}
