# AI-Powered Fabric Optimization with Humans in Control

As Microsoft Fabric becomes central to business reporting and data engineering, inefficient workloads can affect more than execution time. They can consume shared capacity, compete with critical processes, and increase the effort required to keep analytics reliable and cost-effective. Identifying an optimization opportunity is valuable, but turning it into a trusted change requires evidence, clear ownership, and human judgment.

This solution brings together **Azure SRE Agent, Microsoft Fabric, and GitHub** to connect investigation with an explicit approval workflow. The agent analyzes workloads and proposes improvements, while a human reviewer decides whether those changes should proceed.

The central question is simple: **How can we use AI to accelerate Fabric optimization without handing it unrestricted control over workloads or code?**

The answer is a workflow in which the agent investigates, the human approves, and server-side functions validate and execute the permitted repository operations.

---

What This Solution Enables
--------------------------

The **SRE Recommendation Approvals** demo provides a reviewable path from a performance or capacity finding to a proposed Git change:

- **Evidence-based investigation** using Fabric definitions, execution monitoring, and Fabric Unified Admin Monitoring (FUAM) data.
- **A dedicated approval inbox** where reviewers can inspect the findings, rationale, estimated impact, and proposed changes.
- **An explicit human decision** before a branch is created or approved edits are committed.
- **Traceability** through the recommendation ID, reviewer identity, decision comment, branch, and resulting commit.
- **A deliberate stop before deployment**, leaving merge, publication, and Fabric workspace synchronization outside the automated flow.

**Approving a recommendation authorizes the proposed repository changes. It does not authorize an automatic production deployment.**

---

Architecture Built Around Clear Responsibilities
------------------------------------------------

The design separates analysis, human decisions, and repository writes rather than giving one agent responsibility for every action.

### Azure SRE Agent: investigate and explain

The agent uses Fabric MCP, documented read-only APIs, and workload-specific skills to inspect the target workspace and item. Official Fabric skill documents are read through configured Code Access to the `microsoft/skills-for-fabric` repository.

FUAM adds consumption and capacity context through a read-only SQL endpoint connection. The agent must distinguish observations from likely causes and estimated benefits, check data freshness, and avoid presenting daily usage aggregates as exact measurements for an individual run.

Investigation does not run notebooks or pipelines, alter data, or change live Fabric settings. Managed identity provides Fabric API access; the agent does not receive the GitHub PAT used for repository writes.

### A Fabric app: make the human decision visible

The approval experience is a Fabric SSO-protected app built with the Rayfin SDK. It presents a recommendation inbox and a detail panel containing the explanation, Markdown findings, proposed changes, and decision history.

Reviewers can add a comment and explicitly confirm **Approve** or **Reject**. Server-side decision Functions derive reviewer identity from the platform-issued caller context rather than trusting identity fields supplied by the browser.

The app's SQL database records the recommendation and its outcome. Its persisted decision states are intentionally simple: **Pending, Approved, and Rejected**.

### Native Fabric UDFs: validate repository operations

Two Python User Data Functions support the agent workflow:

- `log_recommendation` records the proposal, originating SRE thread, and discovered Git target.
- `commit_change_set` checks the stored approval, exact recommendation branch, and permitted item paths before writing the change set.

The app's decision Functions create the branch on approval. The Python commit UDF subsequently writes the approved edits using its separately configured GitHub credential. PAT values remain server-side.

These checks do not replace code review: the agent must stay within the approved scope, and reviewers still assess the resulting diff before merge.

### GitHub: keep changes reviewable and isolated

Each recommendation stores the investigated workspace's **repository, base branch, and Git folder**. The workflow never assumes that the workload belongs in the approvals app's own repository, and an existing approval is not silently retargeted when a workspace's Git connection changes.

Approved edits go to a dedicated recommendation branch. Pull request creation is **off by default** and requires an explicit reviewer request.

[View the editable Azure, Fabric, and GitHub architecture diagram](./diagrams/sre-platform-architecture.excalidraw).

---

From Investigation to Approved Change
-------------------------------------

At a conceptual level, the workflow is:

1. **Request an investigation.** A user identifies the Fabric workload and analysis period in an SRE Agent conversation.
2. **Collect evidence.** The agent inspects definitions and monitoring, checks relevant FUAM data, and explains the findings and their limitations.
3. **Record a recommendation when requested.** The agent discovers the workspace's Git connection and invokes `log_recommendation`, preserving the real conversation thread and Git target.
4. **Review the proposal.** A human examines what will change, why it is recommended, and the expected impact in the approval app.
5. **Approve or reject.** Approval creates a branch from the stored base and sends the decision back to the originating SRE thread. Rejection notifies that thread without modifying GitHub.
6. **Implement only the approved scope.** Following approval, the agent invokes `commit_change_set`; the UDF validates the record and target before creating a non-force commit.
7. **Report the outcome.** Commit metadata is stored with the recommendation, and the agent reports the confirmed result in the original conversation. A PR URL is included only when a PR was explicitly requested and created.

The recommendation remains **Approved** after the commit. The commit SHA and optional PR URL provide implementation details without introducing a separate deployment status.

[View the editable approval and rejection workflow](./diagrams/sre-approval-architecture.excalidraw).

---

Why This Matters for the Business
--------------------------------

The opportunity is not simply to generate optimization suggestions faster. It is to reduce the manual handoffs between identifying a problem, understanding its business relevance, assigning a decision, and preparing a reviewable fix.

For platform and engineering teams, this creates a consistent place to discuss performance and capacity trade-offs. For workload owners, it keeps the proposed scope and decision visible. For organizations adopting AI-assisted operations, it demonstrates a practical division of responsibility: **AI supports analysis and implementation; people retain authority over change.**

Any claimed improvement still needs validation. Reduced runtime or CU consumption does not automatically translate into lower invoices, and estimated benefits should be measured against an agreed baseline after the normal deployment process.

---

Implementation and Practical Scope
----------------------------------

This article describes a **demo reference implementation**, not a production-hardened autonomous operations platform. Notebook optimization is the initial demonstration focus, with pipeline investigation and item-specific change handling providing a foundation for broader scenarios.

Important boundaries include:

- Git targeting currently supports initialized connections to repositories hosted on `github.com`, not every Git provider or custom GitHub domain.
- Live Fabric definitions can differ from repository content. A non-matching edit should be investigated, not used as permission to broaden the approved change.
- Investigation permissions use a Contributor baseline in the demo; instructions constrain behavior but are not a substitute for technical access controls.
- The UI prevents repeated submissions within the current page, but the workflow does not provide distributed locking or guaranteed exactly-once processing across concurrent requests.
- The SQL record provides workflow traceability, not an immutable compliance audit trail.

Before production adoption, teams should assess least-privilege access, credential lifecycle, concurrency and recovery, audit requirements, and their existing release controls.

The source and setup guidance are available in the [SRE Recommendation Approvals GitHub repository](https://github.com/DimKal-Org/fabric-sre-approvals-demo), including:

- The Fabric app, SQL entity, and decision Functions.
- The native Python UDF implementation.
- Agent instructions and companion skills for Fabric investigation, FUAM analysis, and the recommendation workflow.
- Local tests, configuration guidance, and editable architecture diagrams.

See the [app implementation guide](./app/README.md) for the detailed contracts and configuration requirements. Deployment and publishing are operator-controlled activities.

---

Who This Pattern Is For
-----------------------

- **Fabric platform teams** investigating reliability and shared-capacity pressure.
- **Data engineers** who want actionable recommendations with explicit review boundaries.
- **SRE and FinOps practitioners** connecting technical evidence with operational and consumption priorities.
- **Architects evaluating agentic operations** without removing human ownership of change.

What's Next
------------

The next step is a scoped customer pilot with agreed workloads, reviewers, and success criteria. The pilot should measure recommendation quality, review effort, and verified runtime or consumption improvements while testing rejection, failure, and recovery paths. Broader workload coverage should follow demonstrated value and stronger operational controls, not precede them.

**The goal is not to remove humans from Fabric operations. It is to give them better evidence, clearer choices, and a controlled path from insight to change.**
