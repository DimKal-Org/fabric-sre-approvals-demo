export const statuses = ['Pending', 'Approved', 'Rejected'] as const;
export const severities = ['Low', 'Medium', 'High'] as const;
export type RecommendationStatus = typeof statuses[number];
export type Severity = typeof severities[number];

export type DecisionResult = {
  status: 'Approved' | 'Rejected';
  branch_name?: string;
  error?: string;
};

export interface RecommendationRecord {
  id: string;
  created_at: Date;
  thread_id: string;
  workspace_id: string;
  item_type: string;
  item_name: string;
  item_path: string;
  git_repo_url?: string | null;
  git_base_branch?: string | null;
  git_folder?: string | null;
  title: string;
  severity: Severity;
  estimated_impact: string;
  summary: string;
  details: string;
  proposed_changes: string;
  status: RecommendationStatus;
  branch_name?: string | null;
  decided_by_name?: string | null;
  decided_by_email?: string | null;
  decided_by_id?: string | null;
  decided_at?: Date | null;
  decision_comment?: string | null;
  notified_at?: Date | null;
  commit_sha?: string | null;
  pr_url?: string | null;
  error_message?: string | null;
}

export type UniversalAppSchema = { Recommendation: RecommendationRecord };
