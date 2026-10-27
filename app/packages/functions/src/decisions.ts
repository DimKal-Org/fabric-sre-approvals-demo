import { Buffer } from 'node:buffer';
import process from 'node:process';
import type { RayfinContext } from '@microsoft/fabric-user-data-functions';
import type { DecisionResult, RecommendationRecord, UniversalAppSchema } from '@rayfin-app/shared';
import { createBranch, DecisionError, githubTarget, notifyThread, redact, type SreConfig } from './external.js';

type Context = RayfinContext<UniversalAppSchema>;
type Decision = DecisionResult['status'];
type Identity = { id: string; email: string; name: string };
let loggedClaimNames = false;

function cleanComment(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new DecisionError('comment must be text.');
  const comment = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (comment.length > 500) throw new DecisionError('comment must not exceed 500 characters.');
  return comment;
}

function identity(token: string): Identity {
  let claims: Record<string, unknown>;
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
    claims = value as Record<string, unknown>;
  } catch {
    throw new DecisionError('The platform caller token is not a valid JWT payload.');
  }
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development' && !loggedClaimNames) {
    console.log(`Caller JWT claim names: ${Object.keys(claims).sort().join(', ')}`);
    loggedClaimNames = true;
  }
  const claim = (name: string): string | undefined =>
    typeof claims[name] === 'string' && claims[name].trim() ? claims[name].trim() : undefined;
  const id = claim('sub');
  let email = claim('email') ?? claim('preferred_username') ?? claim('upn');
  if (!email) {
    // Rayfin managed hosting puts the email in xms_attr.<app-id>.rfn_email.
    const attributes = claims.xms_attr;
    if (typeof attributes === 'object' && attributes !== null && !Array.isArray(attributes)) {
      const entries = Object.values(attributes);
      if (entries.length > 1) {
        throw new DecisionError('The platform caller JWT has multiple app attribute entries; reviewer email is ambiguous.');
      }
      const entry = entries[0];
      if (typeof entry === 'object' && entry !== null && !Array.isArray(entry) &&
          'rfn_email' in entry && typeof entry.rfn_email === 'string') {
        email = entry.rfn_email.trim() || undefined;
      }
    }
  }
  const name = claim('name') ?? email;
  if (!id || !email || !name) {
    throw new DecisionError('The platform caller JWT must contain sub and a reviewer email in email, preferred_username, upn, or xms_attr.<app-id>.rfn_email.');
  }
  if ([id, email, name].some((value) => value.length > 500)) throw new DecisionError('Caller identity exceeds the database field limits.');
  return { id, email, name };
}

function secret(ctx: Context, name: keyof Context['Secrets'], sensitive: string[]): string {
  let value: string;
  try {
    value = ctx.Secrets[name];
  } catch {
    throw new DecisionError(`Missing required secret: ${name}. Set it with rayfin secret set.`);
  }
  if (!value?.trim()) throw new DecisionError(`Missing required secret: ${name}. Set it with rayfin secret set.`);
  sensitive.push(value);
  return value;
}

function sreConfig(ctx: Context, sensitive: string[]): SreConfig {
  const tenantId = secret(ctx, 'SRE_TENANT_ID', sensitive).trim();
  const clientId = secret(ctx, 'SRE_CLIENT_ID', sensitive).trim();
  const clientSecret = secret(ctx, 'SRE_CLIENT_SECRET', sensitive);
  const endpoint = secret(ctx, 'SRE_AGENT_ENDPOINT', sensitive).trim().replace(/\/$/, '');
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new DecisionError('SRE_AGENT_ENDPOINT must be an HTTPS origin.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') {
    throw new DecisionError('SRE_AGENT_ENDPOINT must be an HTTPS origin without a path, query, or credentials.');
  }
  return { tenantId, clientId, clientSecret, endpoint };
}

const line = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim();

export function decisionMessage(record: RecommendationRecord, decision: Decision, who: Identity, at: string, comment: string, branch?: string): string {
  return [
    '[SRE-RECOMMENDATION-DECISION]',
    `decision: ${decision.toUpperCase()}`,
    `recommendation_id: ${record.id}`,
    `item_type: ${line(record.item_type)}`,
    `item_name: ${line(record.item_name)}`,
    `item_path: ${line(record.item_path)}`,
    `title: ${line(record.title)}`,
    `branch: ${branch ?? 'n/a'}`,
    `decided_by: ${line(who.name)} (${line(who.email)})`,
    `decided_at: ${at}`,
    `reviewer_comment: ${comment ? line(comment) : 'none'}`,
    '[/SRE-RECOMMENDATION-DECISION]',
    decision === 'Approved'
      ? `Action: apply the approved changes for recommendation ${record.id} to branch ${branch} using the commit_change_set function in the recommendation-workflow skill. Use the recommendation's stored Git target. Do not create a pull request unless explicitly requested by the reviewer. Report the commit and any requested pull request in this thread.`
      : 'Action: none. Do not change anything. Acknowledge the rejection in this thread.',
  ].join('\n');
}

export async function decideRecommendation(ctx: Context, rawId: string, rawComment: string | undefined, decision: Decision): Promise<DecisionResult> {
  if (typeof rawId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
    throw new DecisionError('id must be a UUID.');
  }
  const id = rawId.toLowerCase();
  const comment = cleanComment(rawComment);
  const sensitive = [ctx.accessToken];
  const data = ctx.getDataClient();
  let record: RecommendationRecord | undefined;
  try {
    // findById in 1.36.2 selects only id; select the fields this workflow actually needs.
    const rows = await data.Recommendation.select([
      'id', 'status', 'thread_id', 'item_type', 'item_name', 'item_path', 'title', 'branch_name',
      'git_repo_url', 'git_base_branch', 'git_folder',
    ]).where({ id: { eq: id } }).first(1).execute();
    record = rows[0];
  } catch {
    throw new DecisionError('Could not load recommendation. Check caller data permissions.');
  }
  if (!record) throw new DecisionError('Recommendation not found or caller access was removed.');
  if (record.status !== 'Pending') throw new DecisionError('Recommendation already decided.');

  try {
    // Demo only: no processing statuses or distributed duplicate-request lock.
    const who = identity(ctx.accessToken);
    const config = sreConfig(ctx, sensitive);
    if (!record.thread_id?.trim()) throw new DecisionError('Recommendation has no thread_id.');
    let branch: string | undefined;
    if (decision === 'Approved') {
      const { owner, repo, base } = githubTarget(record);
      const pat = secret(ctx, 'GITHUB_PAT', sensitive);
      branch = `sre/rec-${id.slice(0, 8)}`;
      if (branch === base) throw new DecisionError('Recommendation branch must differ from git_base_branch.');
      if (record.branch_name && record.branch_name !== branch) throw new DecisionError('Stored branch_name does not match the recommendation branch.');
      await createBranch({ pat, owner, repo, base }, branch, sensitive);
      try {
        await data.Recommendation.update({ id }, { branch_name: branch });
      } catch {
        throw new DecisionError('The branch exists, but saving branch_name failed. Retry this decision.');
      }
    }
    const decidedAt = new Date();
    await notifyThread(config, record.thread_id, decisionMessage(record, decision, who, decidedAt.toISOString(), comment, branch), sensitive);
    try {
      await data.Recommendation.update({ id }, {
        status: decision,
        ...(branch ? { branch_name: branch } : {}),
        decided_by_id: who.id,
        decided_by_email: who.email,
        decided_by_name: who.name,
        decided_at: decidedAt,
        decision_comment: comment || null,
        notified_at: new Date(),
        error_message: null,
      });
    } catch {
      throw new DecisionError('The SRE notification was sent, but saving the decision failed. Refresh before retrying; another notification may be sent.');
    }
    return { status: decision, ...(branch ? { branch_name: branch } : {}) };
  } catch (error) {
    const message = redact(error instanceof DecisionError ? error.message : 'The decision could not be completed. Check backend configuration and connectivity.', sensitive).slice(0, 500);
    try {
      // Preserve Pending and any branch already created. Errors are not another status.
      await data.Recommendation.update({ id }, { error_message: message });
    } catch {
      console.error('Decision error could not be saved to the recommendation.');
      throw new DecisionError(`${message.slice(0, 350)} Error details could not be saved; refresh the record before retrying.`);
    }
    throw new DecisionError(message);
  }
}
