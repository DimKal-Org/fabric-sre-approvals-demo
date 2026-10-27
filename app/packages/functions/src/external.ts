import { createHash } from 'node:crypto';
import { UserThrownError } from '@microsoft/fabric-user-data-functions';

export class DecisionError extends UserThrownError {}

export type SreConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  endpoint: string;
};

export type GithubConfig = { pat: string; owner: string; repo: string; base: string };

export function parseGithubRepo(value: string): { owner: string; repo: string } {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(value);
  const owner = match?.[1];
  const repo = match?.[2].replace(/\.git$/, '');
  if (!owner || !repo || repo === '.' || repo === '..') {
    throw new DecisionError('git_repo_url must be https://github.com/<owner>/<repo>, optionally ending in .git or /.');
  }
  return { owner, repo };
}

export function githubTarget(record: {
  git_repo_url?: string | null;
  git_base_branch?: string | null;
  git_folder?: string | null;
}): { owner: string; repo: string; base: string; folder: string } {
  const { git_repo_url: url, git_base_branch: base, git_folder: folder } = record;
  if (typeof url !== 'string' || !url || typeof base !== 'string' || !base || typeof folder !== 'string') {
    throw new DecisionError('Recommendation is missing Git metadata. Log a new recommendation after discovering its workspace Git connection.');
  }
  const { owner, repo } = parseGithubRepo(url);
  const invalidBranch = base === '@' || base.startsWith('-') || base.includes('..') || base.includes('@{') ||
    /[\s\u0000-\u001f\u007f~^:?*[\]\\]/.test(base) || base.endsWith('.') ||
    base.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock'));
  if (url.length > 500 || base.length > 500 || invalidBranch) {
    throw new DecisionError('Recommendation has an invalid git_repo_url or git_base_branch.');
  }
  if (folder.length > 500 || /[\\\u0000-\u001f\u007f]/.test(folder) ||
      (folder !== '' && folder.split('/').some((part) => !part || part === '.' || part === '..' || part === '.platform'))) {
    throw new DecisionError('git_folder must be a relative folder without traversal, or an empty string for the repository root.');
  }
  return { owner, repo, base, folder };
}

export function redact(value: string, sensitive: readonly string[]): string {
  let text = value;
  for (const secret of sensitive) {
    if (!secret) continue;
    for (const form of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) {
      text = text.split(form).join('[REDACTED]');
    }
  }
  return text
    .replace(/("(?:access_token|refresh_token|client_secret|authorization)"\s*:\s*")[^"]*"/gi, '$1[REDACTED]"')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}

async function readText(response: Response, limit = 16_384): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, limit - size);
      chunks.push(chunk);
      size += chunk.length;
    }
  } finally {
    await reader.cancel();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(buffer);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function request(url: string, options: RequestInit, service: string): Promise<Response> {
  try {
    return await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new DecisionError(`${service} request failed or timed out. Check connectivity and configuration.`);
  }
}

async function responseError(response: Response, service: string, sensitive: readonly string[]): Promise<DecisionError> {
  let body: string;
  try {
    body = await readText(response);
  } catch {
    body = 'Response body unavailable.';
  }
  return new DecisionError(`${service} returned HTTP ${response.status}: ${redact(body, sensitive).slice(0, 300)}`);
}

async function json(response: Response, service: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await readText(response));
    if (object(value)) return value;
  } catch {
    throw new DecisionError(`${service} returned an invalid JSON response.`);
  }
  throw new DecisionError(`${service} returned an invalid JSON response.`);
}

export async function createBranch(config: GithubConfig, branch: string, sensitive: readonly string[]): Promise<void> {
  const root = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git`;
  const headers = {
    Authorization: `Bearer ${config.pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const base = await request(`${root}/ref/heads/${encodeURIComponent(config.base)}`, { headers }, 'GitHub base branch lookup');
  if (!base.ok) throw await responseError(base, 'GitHub base branch lookup', sensitive);
  const baseRef = await json(base, 'GitHub base branch lookup');
  if (!object(baseRef.object) || typeof baseRef.object.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(baseRef.object.sha)) {
    throw new DecisionError('GitHub base branch lookup did not return a valid SHA.');
  }
  const response = await request(`${root}/refs`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
  }, 'GitHub branch creation');
  if (response.ok) return;
  if (response.status === 422) {
    const body = await readText(response);
    let exists = false;
    try {
      const value: unknown = JSON.parse(body);
      exists = object(value) && (
        value.message === 'Reference already exists' ||
        (Array.isArray(value.errors) && value.errors.some((entry: unknown) => object(entry) && entry.message === 'Reference already exists'))
      );
    } catch {
      throw new DecisionError(`GitHub branch creation returned HTTP 422: ${redact(body, sensitive).slice(0, 300)}`);
    }
    if (exists) return;
    throw new DecisionError(`GitHub branch creation returned HTTP 422: ${redact(body, sensitive).slice(0, 300)}`);
  }
  throw await responseError(response, 'GitHub branch creation', sensitive);
}

let cachedToken: { key: string; token: string; expiresAt: number } | undefined;

async function sreToken(config: SreConfig, sensitive: string[]): Promise<string> {
  const key = createHash('sha256').update(JSON.stringify([config.tenantId, config.clientId, config.clientSecret])).digest('hex');
  if (cachedToken?.key === key && Date.now() < cachedToken.expiresAt - 300_000) {
    sensitive.push(cachedToken.token);
    return cachedToken.token;
  }
  const requestedAt = Date.now();
  const response = await request(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: 'https://azuresre.dev/.default',
    }).toString(),
  }, 'SRE token acquisition');
  if (!response.ok) throw await responseError(response, 'SRE token acquisition', sensitive);
  const body = await json(response, 'SRE token acquisition');
  if (typeof body.access_token !== 'string' || !body.access_token ||
      typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
    throw new DecisionError('SRE token acquisition did not return an access token and expiry.');
  }
  cachedToken = { key, token: body.access_token, expiresAt: requestedAt + body.expires_in * 1000 };
  sensitive.push(body.access_token);
  return body.access_token;
}

export async function notifyThread(config: SreConfig, threadId: string, message: string, sensitive: string[]): Promise<void> {
  const token = await sreToken(config, sensitive);
  const response = await request(`${config.endpoint}/api/v1/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  }, 'SRE thread notification');
  if (!response.ok) {
    if (response.status === 401) cachedToken = undefined;
    throw await responseError(response, 'SRE thread notification', sensitive);
  }
}
