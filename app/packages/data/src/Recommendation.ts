import { authenticated, date, entity, set, text, uuid } from '@microsoft/rayfin-core';
import { severities, statuses } from '@rayfin-app/shared';
import type { RecommendationRecord, RecommendationStatus, Severity } from '@rayfin-app/shared';

@entity()
@authenticated(['read', 'update'])
export class Recommendation implements RecommendationRecord {
  @uuid() id!: string;
  @date() created_at!: Date;
  @text({ max: 500 }) thread_id!: string;
  @text({ max: 500 }) workspace_id!: string;
  @text({ max: 100 }) item_type!: string;
  @text({ max: 500 }) item_name!: string;
  @text({ max: 500 }) item_path!: string;
  @text({ max: 500, optional: true }) git_repo_url?: string;
  @text({ max: 500, optional: true }) git_base_branch?: string;
  @text({ max: 500, optional: true }) git_folder?: string;
  @text({ max: 250 }) title!: string;
  @set(...severities) severity!: Severity;
  @text({ max: 500 }) estimated_impact!: string;
  @text({ max: 4000 }) summary!: string;
  @text({ max: 4000 }) details!: string;
  @text({ max: 4000 }) proposed_changes!: string;
  @set(...statuses) status!: RecommendationStatus;
  @text({ max: 500, optional: true }) branch_name?: string;
  @text({ max: 500, optional: true }) decided_by_name?: string;
  @text({ max: 500, optional: true }) decided_by_email?: string;
  @text({ max: 500, optional: true }) decided_by_id?: string;
  @date({ optional: true }) decided_at?: Date;
  @text({ max: 2000, optional: true }) decision_comment?: string;
  @date({ optional: true }) notified_at?: Date;
  @text({ max: 40, optional: true }) commit_sha?: string;
  @text({ max: 2000, optional: true }) pr_url?: string;
  @text({ max: 500, optional: true }) error_message?: string;
}
