# SRE Recommendation Approvals

AI-assisted Microsoft Fabric optimization with humans in control. An Azure SRE
Agent investigates read-only, records an evidence-based recommendation, and waits
for a human decision. Approval permits scoped GitHub changes, not deployment.

This is the public demo reference implementation. It contains no private
repository history, deployed Fabric item identities, or configured credentials.
It is not a production-hardened control plane.

## Start here

- [Editable architecture and workflow diagrams](./diagrams/README.md)
- [App, data model, decision Functions, and validation guide](./app/README.md)
- [Agent instructions](./fabric/generic-agent-instructions.md)
- [Fabric skill router](./fabric/fabric-skills-router.md)
- [FUAM analysis skill](./fabric/fuam-analysis-skill.md)
- [Recommendation workflow skill](./fabric/recommendation-workflow-skill.md)

The SRE Recommendation Approvals Fabric app is in [app/](./app/README.md).
See its README for the data contract, local validation, example SQL, and
pre-deployment checklist. Deployment is performed manually.

The native Python [User Data Functions](./fabric/function-sre-recommendation-skills.UserDataFunction/function_app.py)
and [mocked local tests](./fabric/test_function_app.py) are in [fabric/](./fabric/).
They log recommendations with the investigated workspace's discovered Git target and commit approved
change sets without changing the app's three-status model or the SRE Agent's
existing authentication.

The [agent instructions](./fabric/generic-agent-instructions.md) and three
companion skills are also in that folder. See the
[rollout steps](./app/README.md#rolling-out-per-workspace-git-targeting) before
applying the schema and publishing the updated app/UDF.

## Configure your own environment

Prerequisites: a tenant/workspace with Fabric Apps available, Rayfin **1.36.2**,
a Fabric SQL database, a native User Data Functions item, Azure SRE Agent and its
configured user-assigned managed identity, FUAM and its read-only SQL connection,
and an initialized GitHub connection on each investigated Fabric workspace.

1. Clone this public repository and follow the validation and operator deployment
   steps in [app/README.md](./app/README.md). Every `@microsoft/rayfin-*` package is
   pinned to 1.36.2. No deployment lockfile or local environment file is included;
   bind and provision the app in **your own** workspace. Keep Fabric SSO enabled.
2. Deploy the app and data schema yourself. Obtain your SQL connection details
   from the deployed resources, not from example IDs in tests.
3. Configure the app's GitHub PAT and SRE notification service-principal settings
   through the documented Rayfin secret commands. PAT permissions must cover the
   repositories that you intend to investigate. The app and native UDF use
   separate credential stores.
4. Create a native Fabric User Data Functions item and import
   [function_app.py](./fabric/function-sre-recommendation-skills.UserDataFunction/function_app.py).
   Configure the public libraries and the `sqlDB` / `githubConfig` aliases
   described in its [binding example](./fabric/function-sre-recommendation-skills.UserDataFunction/definition.example.json).
   That example deliberately contains placeholders and is **not** a deployable
   item export. Create your own item identities and connection bindings.
5. Create a Variable Library named `githubConfig`. Set its `GITHUB_PAT` variable
   privately in Fabric, using the [dummy-value definition](./fabric/githubConfig.VariableLibrary/variables.json)
   as a shape reference. The committed value is deliberately fake and cannot
   authenticate. Never replace it with a real PAT in this public repository.
6. Replace every environment placeholder in the four documents under `fabric/`.
   Register the three skills with Azure SRE Agent and apply the generic
   instructions. Configure Fabric MCP, the FUAM SQL tool, Code Access, and managed
   identity permissions. Confirm real access; a workspace role alone does not
   prove that a SQL connection works.
7. Copy the native UDF's **actual HTTPS host** from its published invocation
   details into `UDF_BASE`. Do not paste the full `/v1/.../invoke` URL there; the
   invocation helper appends that path. Set the current SRE thread from runtime
   context, never a placeholder or test thread.
8. Use a disposable workload and recommendation to verify logging, approval,
   rejection, commit boundaries, and failure recovery before any wider rollout.
   No merge, publish, notebook execution, or Fabric Git synchronization is
   automatic. PR creation requires an explicit reviewer request.

### Placeholder map

| Placeholder | Supply from your environment |
|---|---|
| `<APP_WORKSPACE_ID>` | Workspace hosting the app/native UDF in this demo |
| `<UDF_ITEM_ID>` | Published native UDF item ID |
| `<UDF_HTTPS_HOST>` | Native UDF HTTPS hostname only, without scheme or path |
| `<SRE_MI_CLIENT_ID>` | Agent user-assigned managed identity client ID |
| `<APP_SQL_DATABASE_ITEM_ID>`, `<GITHUB_CONFIG_ITEM_ID>` | App SQL database and Variable Library item IDs used in the UDF binding example |
| `<FUAM_WORKSPACE_NAME>`, `<FUAM_WORKSPACE_ID>` | Your FUAM workspace |
| `<FUAM_LAKEHOUSE_ID>`, `<FUAM_SQL_ENDPOINT>` | FUAM Lakehouse ID and SQL server hostname |
| `<FABRIC_CU_PRICE_TOOL_NAME>` | Optional verified pricing tool, or follow the documented rate-input flow |
| `DUMMY_VALUE_NOT_A_REAL_GITHUB_PAT` | Deliberately fake public value; configure a real credential only in your own environment |

Identifiers and addresses in automated test fixtures are synthetic test data.
The demonstration notebook source is supplied without `.platform` identity
metadata. Deployment-generated item identities, app bindings, local MCP settings,
and the original environment's invocation notebook are intentionally omitted.

## Local checks and operational limits

The app's [validation commands](./app/README.md#validation-no-deployment) run
type-checks, builds, lint, mocked frontend/Function tests, and an offline schema
check. The Python [regression tests](./fabric/test_function_app.py) mock the Fabric
SDK and make no live requests. JSON Patch coverage is explicitly skipped when
`jsonpatch` is unavailable; the native UDF runtime requires it.

Do not use `npm run dev` as an offline preview: that command can provision Fabric
resources and apply the schema. Install dependencies only in your own chosen
development environment, and deploy/publish only after reviewing configuration.

The persisted statuses are Pending, Approved, and Rejected. Commits retain
Approved and add metadata. The demo has no distributed lock, immutable audit log,
or guaranteed exactly-once workflow. Review the documented recovery limitations,
least-privilege controls, credentials, and release process before production use.

## Security and authorization

The following table summarizes authentication and access requirements for the
agent's investigation and native UDF workflow. **UAMI** means user-assigned
managed identity. This demo uses Contributor as its workspace-role baseline;
that access does not authorize actions outside the read-only investigation and
human-approved change boundaries.

| Step | Auth method | Requires |
|---|---|---|
| Discover workspaces and items (Fabric MCP) | UAMI via MCP connector | Workspace role for the UAMI |
| Query FUAM SQL endpoint | UAMI via MCP connector | Workspace role on the FUAM workspace for the UAMI |
| Read notebook definition (Fabric API) | UAMI obtains a Fabric token | Workspace role for the UAMI |
| Read Spark monitoring data | UAMI obtains a Fabric token | Workspace role for the UAMI |
| Discover workspace Git connection | UAMI obtains a Fabric token | Workspace role for the UAMI |
| Read notebook source from GitHub | SREAgent-OAuth proxy token | Organization owner approves SREAgent-OAuth where OAuth app restrictions apply |
| Log recommendation / commit (UDF invocation) | UAMI obtains a Fabric token | Workspace role on the UDF/app workspace for the UAMI |
| UDF pushes commit to GitHub | PAT from the Variable Library | PAT has Contents read/write on the target repository |
| Azure Retail Prices API | None (public) | No authentication required |

A workspace role alone does not prove that the FUAM SQL endpoint connection
works. Configure and verify the connector's SQL read access separately. Native
UDF access to the app database likewise uses its configured `sqlDB` binding and
SQL permissions; the caller's Fabric token authenticates UDF invocation, not the
downstream SQL connection.

GitHub OAuth authorization for source reads and PAT authorization for writes are
separate. The app's decision Functions use a separately stored PAT to create the
approved branch, while the UDF reads its PAT from `githubConfig`. The agent never
receives either PAT. Decision notifications to the originating SRE thread use
the app's separate service principal and client-credentials flow, and reviewers
access the approval app through Fabric SSO.

Human approval remains mandatory before repository changes. The workflow does
not automatically merge, deploy, publish, execute workloads, or synchronize
Fabric workspaces.

## Licensing

See the root [MIT license](./LICENSE), the retained Microsoft
[template license](./app/LICENSE), and [third-party notices](./THIRD_PARTY_NOTICES.md).

## SRE Agent Code Access setup

Configure this in SRE Builder under **Code access configuration**, not in the
agent instructions. The Fabric skill router uses Code Access to read official
workload procedures and their shared references.

1. Select the **GitHub** tab and choose **Add repository**.
2. Add `https://github.com/microsoft/skills-for-fabric` using an authorized
   GitHub OAuth connection. In the demonstrated setup, the connection is named
   **OAuth for microsoft**.
3. Use branch `main`. The router reads skills from
   `plugins/fabric-skills/skills/` and shared references from
   `plugins/fabric-skills/common/`.
4. Confirm the repository appears with a healthy connection and a successful
   **Last synced** timestamp. Use **Refresh** when updating the configured source.
5. Verify the agent can read a skill's `SKILL.md` and its linked references
   through the configured Code Access file-read tools.

This repository supplies agent guidance; it is not the Git target for workload
changes. The investigated workspace's Git connection determines that target.
GitHub MCP is not required, and branch creation and approved commits still go
through the app Functions and Fabric UDF with their separately configured PATs.

If direct repository reads are needed for a GitHub organization that restricts
OAuth apps, an organization owner must approve **SREAgent-OAuth** under the
organization's **Third-party Access > OAuth app policy**. This authorization is
separate from the app/UDF PAT permissions. See the
[Fabric skill router](./fabric/fabric-skills-router.md) for access-failure and
Fabric definition-read fallback guidance.