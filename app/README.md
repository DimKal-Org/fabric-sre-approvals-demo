# SRE Recommendation Approvals

A Fabric SSO-protected React app for reviewing recommendations written directly
to its SQL database by an external SRE workflow. Approve creates a GitHub branch
and notifies the SRE Agent; Reject only notifies the agent. Both decisions run in
server-side Rayfin Functions. The browser never writes decision fields directly.

## Scaffold and configuration

- CLI/template discovery: Rayfin **1.36.2**, `rayfin init --list-templates`.
- CLI template name: **`blankapp`**; manifest template identity: **`universal-app`**.
- App: **`sre-approvals`**.
- Workspace: choose your own Fabric workspace when deploying. No deployed workspace is bound in this public snapshot.
- Every installed `@microsoft/rayfin-*` package is pinned to **1.36.2**.
- Auth/data/Functions enabled, MSSQL, protected static hosting, password auth disabled.
- Functions were initialized with `npx rayfin functions init` into the Universal
  workspace package `packages/functions`; Functions authentication is `application`.
  The server authoring SDK `@microsoft/fabric-user-data-functions` is also **1.36.2**.
- The Universal template's Fabric auth bootstrap, provider and gate are preserved.
  Its DEV-only CLI-backed sign-in still uses Fabric/Entra, not another provider.
- Paper Dashboard theme and Card/Badge/state components are copied into the
  frontend. Muli is loaded explicitly from Google Fonts. There is no sidebar or
  dark-mode UI because this is a single-page review inbox.

## Source map

| Path | Purpose |
| --- | --- |
| `packages/data/src/Recommendation.ts` | Single decorated entity; snake_case fields |
| `packages/data/src/index.ts` | Entity registration, schema exports and `AppSchema` |
| `packages/data/tsconfig.json` | Compiles only the data package's source files |
| `packages/shared/src/index.ts` | Browser-safe record, status and severity contracts |
| `packages/frontend/src/App.tsx` | Inbox, filters, detail panel and decision workflow |
| `packages/frontend/src/components/Modal.tsx` | Native modal focus/keyboard behavior |
| `packages/frontend/src/components/Markdown.tsx` | Safe Markdown and highlighted code |
| `packages/frontend/src/components/paper/Card.tsx` | Bundled Paper components |
| `packages/frontend/src/paper-theme.css` | Bundled Paper theme |
| `packages/frontend/src/global.css` | App layout and consistent auth/error styling |
| `packages/frontend/src/services/recommendations.ts` | Typed reads and cursor pagination |
| [`packages/functions/src/function_app.ts`](./packages/functions/src/function_app.ts) | Exactly two registered decision Functions |
| [`packages/functions/src/decisions.ts`](./packages/functions/src/decisions.ts) | Caller-scoped reads/writes, validation, identity and decision orchestration |
| [`packages/functions/src/external.ts`](./packages/functions/src/external.ts) | Fetch-only GitHub/SRE integrations, OAuth cache and safe provider errors |
| [`packages/functions/src/types.ts`](./packages/functions/src/types.ts) | CLI-generated browser-safe Function contracts; do not edit |
| [`packages/functions/src/secrets.generated.ts`](./packages/functions/src/secrets.generated.ts) | CLI-generated secret-name registry; no values |
| [`packages/functions/test/decisions.test.mjs`](./packages/functions/test/decisions.test.mjs) | Mocked server-side workflow and provider tests |
| [`packages/frontend/src/services/decisions.ts`](./packages/frontend/src/services/decisions.ts) | Typed `client.functions.<name>.invoke({ id, comment })` calls |
| `packages/frontend/src/App.spec.tsx` | Review workflow tests |
| `packages/frontend/src/services/*.spec.ts` | Data and typed invocation tests |
| `scripts/print-schema.mjs` | Offline SQL reference from Rayfin metadata; permission/type assertions |
| `scripts/seed-example.sql` | Dev-only, manually reviewed three-row example INSERT |

This Universal App keeps all entity code and registration in `packages/data/src/`.
The data package exports `dist/index.js` via `package.json`, and
`services.data.path: packages/data` tells Rayfin where to build and discover it.
The `rayfin/` folder contains configuration and deployment metadata, not entity
source files. The frontend imports only browser-safe shared types and a type-only
Function schema export. It does not import server implementation code or secrets.

## Validation (no deployment)

Run from this folder:

```powershell
npm ci
npm run typecheck
npm run build
npm run lint
npm test
npm run schema:sql
```

Root build/typecheck include the Functions workspace. `npm test` runs the frontend
suite and the server tests; server tests use fake caller data and mocked `fetch`,
never Fabric, GitHub or the SRE Agent.

The Functions compiler explicitly loads Node types. The `rayfin/` compiler config
allows an empty source set because that folder can contain configuration only;
entity and Function sources remain in their Universal workspace packages.

`schema:sql` uses the **installed Rayfin schema analyzer**, prints schema/table,
column types, nullability, primary key and enum CHECK expressions, and asserts
that only authenticated read/update are granted. It does not contact a database
or apply SQL. Actual migration constraints/default names are owned by Rayfin.

The physical table is **`[dbo].[Recommendations]`** (plural), while the typed API
is **`client.data.Recommendation`** (singular). Required columns:

| Column | SQL type |
| --- | --- |
| `id` | `UNIQUEIDENTIFIER` primary key |
| `created_at` | `DATETIME2` |
| `thread_id`, `workspace_id` | `NVARCHAR(500)` |
| `item_type` | `NVARCHAR(100)` |
| `item_name`, `item_path` | `NVARCHAR(500)` |
| `title` | `NVARCHAR(250)` |
| `severity` | `NVARCHAR(6)`; Low, Medium, High |
| `estimated_impact` | `NVARCHAR(500)` |
| `summary`, `details`, `proposed_changes` | `NVARCHAR(4000)` |
| `status` | `NVARCHAR(8)`; Pending, Approved, Rejected |

Nullable columns:

| Column | SQL type |
| --- | --- |
| `git_repo_url`, `git_base_branch`, `git_folder` | `NVARCHAR(500)` |
| `branch_name`, `decided_by_name`, `decided_by_email`, `decided_by_id` | `NVARCHAR(500)` |
| `decided_at`, `notified_at` | `DATETIME2` |
| `decision_comment` | `NVARCHAR(2000)`; decision UI/Function still limit input to 500 |
| `error_message` | `NVARCHAR(500)` |
| `commit_sha` | `NVARCHAR(40)` |
| `pr_url` | `NVARCHAR(2000)` |

**Approved requirement change:** `summary`, `details`, and `proposed_changes`
use `NVARCHAR(4000)`, not `NVARCHAR(MAX)`, following the user's clarification
after reviewing Rayfin 1.36.2's documented MAX/GraphQL metadata limitation.
`error_message` remains `NVARCHAR(500)`; the model allows a 2,000-unit decision
comment while the decision workflow retains its 500-unit input limit. The external UDF
must validate each column's length explicitly; do not silently truncate findings
or proposed changes. SQL NVARCHAR lengths count UTF-16 code units.

The external UDF supplies IDs and timestamps. Use UTC for all `DATETIME2` values.
There is no client create or delete permission. TDS access uses SQL permissions,
not the client permission decorators; grant the UDF identity the minimum required
SQL permissions separately.

## Review behavior

- Newest-first list, with cursor pagination so the default 100-row API page does
  not truncate the inbox.
- The only persisted statuses are Pending, Approved, and Rejected. Filters are
  Pending (default), Approved, Rejected, and All. Title/item-name search is
  case-insensitive.
- Manual refresh plus polling every 15 seconds, including the open detail record.
- Native modal side panel on desktop, full-screen on narrow devices; Escape,
  focus trapping and restoration use the browser's dialog implementation.
- Markdown does not enable raw HTML. PR links permit only HTTP(S), open in a new
  tab and use `noopener noreferrer`.
- Only Pending exposes decision controls. The optional comment is
  limited to 500 characters with a counter.
- Confirmation repeats the item and title. Both actions are disabled while a
  request is running. A small donut spinner appears only in the affected row;
  processing is transient UI state, never a database status. The detail panel
  can be closed while waiting so the row's progress remains visible.
- Demo scope: robust duplicate-request handling across tabs or server instances
  is intentionally out of scope. There is no persisted processing/locking state.
- Successful and error responses show explicit notices. A successful response
  supplies Approved or Rejected and removes the decision controls. After every
  call, including errors, the row is re-read from the server. Errors do not
  introduce another status; a record still Pending remains actionable.
  No decision status is changed before receiving a server response.
- Browser checks use intercepted test fixtures only. No sample records or test
  auth are compiled into the production app. The SQL example is outside the
  static hosting folder and is never executed by build, startup or deployment.

## Before your first `npx rayfin up`

1. Verify the target workspace and that you have permission to create a Fabric
   App and its SQL database. Confirm Fabric Apps is enabled for your tenant.
2. Run `npx rayfin login` yourself and confirm the intended tenant/account.
3. Review `rayfin/rayfin.yml`: keep protected hosting, Fabric SSO and Functions
   authentication type `application`. Configure the seven secrets below.
   Add only your actual standalone origins to `allowedRedirectUris` if needed.
   The CLI may regenerate local/deployed environment settings.
4. Review the 4000-character limits for `summary`, `details`, and
   `proposed_changes` with the external UDF writer; `error_message` and
   `decision_comment` remain limited to 500 characters.
5. Run the validation commands above. `npm run dev` is **not** an offline preview:
   it provisions/reuses Fabric services and applies the schema. It was not used
   during this implementation. `npm run dev:frontend` starts only Vite, but
   cannot show real authenticated data until a backend is configured.
6. Run `npx rayfin up` yourself from this folder. This implementation did not run
   deployment or apply database changes.
   Afterward verify deployment status, actual SQL catalog columns and client
   read/update versus denied create/delete.
7. Retrieve the deployed SQL/TDS endpoint and configure the external UDF's
   identity/SQL grants. Use `scripts/seed-example.sql` only if you explicitly want
   manual dev data; replace its placeholder workspace IDs. Do not run it in prod.

## Decision Functions

Exactly **`approveRecommendation`** and **`rejectRecommendation`** are registered.
Each accepts `{ id: string; comment?: string }`. Successful calls return:

```typescript
type DecisionResult = {
  status: 'Approved' | 'Rejected';
  branch_name?: string;
  error?: string;
};
```

- UUIDs are validated and normalized; comments are stripped of control characters,
  trimmed, and limited to 500 UTF-16 code units. Only Pending records can be decided.
- All Recommendation reads and writes use `ctx.getDataClient()`, retaining the
  signed-in caller's data permissions despite `application` Functions auth.
  Explicit field selection avoids 1.36.2's ID-only `findById()` result.
- The platform-issued `ctx.accessToken` JWT is decoded, not re-verified. Identity
  uses the original `sub`, then email/preferred_username/upn, and name or email.
  Rayfin 1.36.2 managed-hosting tokens instead expose the email under
  `xms_attr.<app-id>.rfn_email`; this format is also supported. When no top-level
  email is present, exactly one app-attribute entry is required rather than
  guessing between identities. Missing/malformed identity claims fail before
  branch creation or notification; browser-supplied identity is never trusted.
  In the local
  Development host, JWT claim **names only** are logged once per worker.
- Approve creates `sre/rec-<first eight UUID characters>` in the recommendation's
  stored `git_repo_url` from `git_base_branch`. The URL must be HTTPS
  `github.com/owner/repo`, optionally ending in `.git` or `/`. `git_folder` is a
  canonical relative folder; `""` explicitly means repository root. Missing
  metadata is an error, never a fallback to global settings. A GitHub 422 is accepted only when its
  message, or a structured error message, is `Reference already exists`.
- `branch_name` is saved before notification. A failure leaves the status Pending,
  preserves the branch and records a concise `error_message`. Errors reject the
  call as Rayfin `UserThrownError`; they never introduce another persisted status.
- Reject makes no GitHub calls and does not require GitHub secrets.
- SRE OAuth uses client credentials and `https://azuresre.dev/.default`, caching
  the token until five minutes before expiry. Configuration changes invalidate
  the cache; notification HTTP 401 clears it for the next retry.
- Thread notification preserves the validated notebook's URL, headers and JSON
  body shape **`{ "text": MESSAGE }`**. The structured decision block is followed
  by the approved commit_change_set instruction or the rejection acknowledgement.
  Interpolated fields cannot introduce extra message lines.
- Provider calls use `fetch`, 30-second timeouts and no redirects. Non-2xx errors
  include the HTTP status and at most 300 characters of redacted response body;
  stored errors are at most 500 characters. Tokens/secrets are never returned or
  logged by these handlers.
- Demo limitation: no distributed lock or processing status. The current page
  disables controls and shows only the affected row's spinner, but simultaneous
  requests from other tabs are not guaranteed once-only. Retrying reuses the
  deterministic branch. A notification acknowledged by the agent followed by a
  failed database write, or a lost HTTP response, can cause a duplicate notification
  on retry. The final-write error explicitly tells the reviewer to refresh first.
  This deliberately does not add workflow states or a lock entity.

### Configure secrets yourself

Create your own scoped GitHub PAT and Entra application credential. No credential
values are included in this public snapshot. From the app folder, use the interactive CLI prompts:

```powershell
npx rayfin secret set GITHUB_PAT
npx rayfin secret set SRE_TENANT_ID
npx rayfin secret set SRE_CLIENT_ID
npx rayfin secret set SRE_CLIENT_SECRET
npx rayfin secret set SRE_AGENT_ENDPOINT
```

Use a GitHub credential permitted to read refs and create branches in the target
repositories (fine-grained PAT: Contents read/write on every target).
`GITHUB_REPO_URL` and `GITHUB_BASE_BRANCH` remain declared for generated-registry
compatibility but are legacy and are not read. The SRE application
needs the appropriate permission to post to the agent threads. The endpoint must
be an HTTPS origin, without a path, credentials or query.

`rayfin/rayfin.yml` stores only names and descriptions. Read values only through
`ctx.Secrets`. Missing values produce a clear error naming the required secret.
For local debugging, use the secrets documentation's ignored
`packages/functions/local.settings.json` Values bag; do not commit credentials.

### Local host without deployment

With Azure Functions Core Tools installed and an existing Rayfin deployment's
local configuration available:

```powershell
npx rayfin dev functions apply --no-debug --no-emit-env
```

This focused command builds and starts the local Functions host and regenerates
Function types, runtime metadata and the secret registry. It does not deploy.
The existing Vite `rayfinLocalDev()` plugin owns local invocation routing; do not
hard-code a Functions URL in the shared client. Stop the host with Ctrl+C.
Do not use the root `npm run dev` just to validate Functions: that broader command
also provisions/reuses Fabric services and applies the data schema.

### Manual test plan (after you configure and deploy)

Use separate Pending demo rows and valid SRE thread IDs. Do not execute the seed
SQL or tests against production automatically.

1. **Approve:** enter an optional comment and confirm. Only that row shows the
   donut. Verify one branch in the recorded repository from the recorded base, exact APPROVED message/action
   in its thread, caller identity and UTC timestamps, Approved status, success
   notice, and no remaining decision controls.
2. **Reject:** confirm a different Pending row. Verify the exact REJECTED message,
   Rejected metadata/status and notice, and no GitHub branch or GitHub request.
3. **Ordinary double-click:** while one invocation waits, click again in the same
   page. Controls remain disabled and the same row keeps its spinner. On response
   it becomes idle/nonactionable. Cross-tab/distributed races are out of demo scope.
4. **Notify failure and retry:** temporarily use a bad HTTPS SRE endpoint, then
   approve. Verify an error notice, Pending status, saved branch, and `error_message`.
   Restore the endpoint using the CLI, make the revised secret available to the
   running/deployed host, and retry. Verify the same branch is reused, notification
   succeeds, Approved is saved and the old error is cleared.
5. **Branch already exists:** pre-create the deterministic recommendation branch,
   then approve its Pending row. The matching GitHub 422 must not fail the decision.
   A different 422, such as invalid ref validation, must still fail clearly.
6. **Validation/access:** try a 501-character comment or malformed UUID through an
   invocation client; verify rejection before external calls. Attempt a second
   decision on an Approved/Rejected row; it must say already decided without a
   database change. Verify unauthenticated callers cannot read/update data.

### Applying the simplified status constraint

Apply database changes only through the Rayfin CLI. The new status column is
`NVARCHAR(8)` with a CHECK allowing only Pending, Approved, and Rejected. Existing
rows with an older status must be reviewed and assigned one of those three
values through the app's data API before the stricter constraint can be applied.
Do not silently remap rows or bypass CLI safety checks with `--force`.

### Rolling out per-workspace Git targeting

The agent discovers the investigated workspace's connection with the read-only
[Get Git Connection API](https://learn.microsoft.com/en-us/rest/api/fabric/core/git/get-connection)
using its existing managed identity (Contributor). Only initialized public
GitHub connections are supported. No GitHub MCP server is required.

1. Stop agent logging and decisions during the coordinated update. From this
   app folder, apply the three nullable Git columns using the Rayfin CLI:
   ```powershell
   npx rayfin up db apply
   ```
   Review its migration output; do not use manual ALTER scripts or blindly force.
2. Deploy the updated app/decision Functions yourself. Readers now select the
   three new columns, so the schema must be applied first.
3. Publish the updated native Python
   [UDF source](../fabric/function-sre-recommendation-skills.UserDataFunction/function_app.py).
   `log_recommendation` now requires `gitRepoUrl`, `gitBaseBranch`, `gitFolder`.
   Configure only `GITHUB_PAT` in its `githubConfig` library, with access to all
   target repositories; keep the app's separate PAT secret configured too.
4. Reload/register the [agent instructions](../fabric/generic-agent-instructions.md)
   and three companion skills, especially the
   [recommendation workflow](../fabric/recommendation-workflow-skill.md).
   Its helper discovers the target and supplies the new camelCase UDF inputs.
5. Resume and log fresh recommendations. Verify root and nested Git folders,
   different repositories/base branches, approval, rejection and commit metadata.

Existing rows remain readable and rejectable but cannot be approved or committed
without Git metadata. Re-log them after discovery; do not guess/backfill a default
repository. The stored target is a snapshot and does not change when a workspace
switches its Git connection. A commit uses `git_folder` only for GitHub paths,
never as part of the item-relative input `item_path`.

Local Python regression tests (no live calls or package installation):
```powershell
python -m unittest discover -s ..\fabric -p test_function_app.py -v
```
The Fabric SDK is mocked. Real JSON Patch tests are explicitly skipped if the
already-installed Python environment lacks `jsonpatch`; do not install it automatically.
