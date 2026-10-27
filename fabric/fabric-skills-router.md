---
name: fabric-skills-router
description: "Use for Microsoft Fabric workspace/item discovery, notebook and pipeline definitions, Spark investigation, RCA, capacity and workload guidance. Load before Fabric investigation tools."
---

# Fabric skill router

## Sources
Read official skills through the repository configured in SRE Builder Code Access:

| Setting | Value |
|---|---|
| Repository | `https://github.com/microsoft/skills-for-fabric` |
| Branch | `main` |
| Skills root | `plugins/fabric-skills/skills/` |
| Shared references | `plugins/fabric-skills/common/` |

Use the configured Code Access file-read tools. Do not assume a GitHub MCP
server exists. If Code Access is unavailable, report the missing capability;
do not fabricate API syntax or silently switch to remembered procedures.

## Routing

| Request | Official skill folder |
|---|---|
| Spark/notebook performance, errors or definitions | `spark-cli` |
| Warehouse or Lakehouse SQL endpoint | `sqldw-cli` |
| Fabric SQL database | `sqldb-cli` |
| Eventhouse/KQL | `eventhouse-cli` |
| Eventstream | `eventstream-cli` |
| Dataflows | `dataflows-cli` |
| Git connection/status investigation | `git-integration-operations-cli` |
| Variable Library definitions | `variable-library-cli` |
| Other workloads | List the skills root and select the matching skill |

For FUAM calculations and cost attribution, also load
[FUAM analysis skill](./fuam-analysis-skill.md).
For recommendation writes and approved Git commits, use only
[Recommendation workflow skill](./recommendation-workflow-skill.md).
Neither is replaced by a general Fabric authoring skill.

## Procedure
1. Read the chosen `SKILL.md` in full and its mandatory references. Resolve
   relative links from that skill's directory.
2. Select the documented mode: for failed/slow Spark runs use investigation/
   operations mode, not an authoring or run mode.
3. Resolve workspace and item names with the documented list/filter procedure.
   Do not reuse an unrelated workspace ID from an example.
4. Use Fabric MCP for supported discovery and definition reads. Use documented
   read-only API calls through the execution environment when a required
   monitoring endpoint is not exposed by MCP. Do not invent tool names.
5. Follow the official skill's authentication, pagination, LRO and telemetry
   requirements, including its `x-ms-fabric-skill` header on Fabric REST calls.
6. Read live notebook/pipeline definitions through Fabric, even for Git-backed
   workspaces. GitHub MCP is not required for this demo.
7. Before recording a recommendation, read
   `GET /v1/workspaces/{workspaceId}/git/connection` for the investigated workspace
   through the recommendation skill's managed-identity helper. Route this to
   `git-integration-operations-cli` and include its telemetry header. Map
   `gitProviderDetails.ownerName` and `repositoryName` to the GitHub URL,
   `branchName` to the base branch and `directoryName` to the relative Git folder.
   Accept only `ConnectedAndInitialized` public GitHub connections. No GitHub MCP,
   new MCP server, connect, initialization or sync operation is needed.
8. Report the source and time range of the evidence. Live definitions may differ
   from the approved Git branch; the commit UDF will reject non-matching edits.

## Restrictions
- Read-only inspection only. Do not execute the official skill's create, update,
  refresh, run, delete, deploy or Git synchronization steps.
- The generic agent instructions take precedence over a skill's recommendation
  to mutate a live workspace.
- Do not expose GitHub PAT values or read Variable Library secrets to the agent.
- If an essential tool, endpoint permission or source is unavailable, report
  the limitation instead of claiming a complete RCA.

## GitHub org access prerequisite
- The agent sandbox's GitHub proxy token comes from the SREAgent-OAuth app. If the investigated workspace's Git repository belongs to a GitHub organization with OAuth App access restrictions enabled, the proxy token will receive HTTP 403.

- **Operator action**: In the GitHub org settings, go to Third-party Access → OAuth app policy and grant access to SREAgent-OAuth. This is a one-time step per organization.

- If not approved, the agent cannot read repository files directly. Fall back to Fabric `getDefinition` or Spark Monitoring job descriptions for notebook source code.
