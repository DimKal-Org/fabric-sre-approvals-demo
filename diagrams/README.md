# Architecture diagrams

Both diagrams show the implemented demo design, not proof of a deployed end-to-end run. Human approval is required before repository changes, and a Git commit does not deploy or sync Fabric.

| Diagram | Description | Updated |
|---|---|---|
| [sre-approval-architecture.excalidraw](./sre-approval-architecture.excalidraw) | Existing approval and rejection timeline, with actors, execution identities, stored Git targeting, and optional PR creation. | 2026-10-27 |
| [sre-platform-architecture.excalidraw](./sre-platform-architecture.excalidraw) | Azure SRE Agent, read-only Fabric investigation and FUAM, the human approval app, native UDFs, SQL, and governed GitHub changes. | 2026-10-27 |

Open the files in Excalidraw to edit or export them. Icons are embedded, so no external library installation is required.

The platform diagram uses the `microsoft-fabric-architecture-icons` and `architecture-diagram-components` libraries. Its Azure SRE Agent image is reused from the supplied workflow diagram because the libraries do not contain a matching Azure SRE Agent icon.

Key boundaries:

- The agent investigates with read-only Fabric APIs and FUAM SQL access. Code Access provides official Fabric skill documents.
- Each recommendation stores the investigated workspace's GitHub repository, base branch, and Git folder. Approval never falls back to the app's repository.
- Approving creates the branch and sends the decision to the originating SRE thread. Rejecting does not modify GitHub.
- The native Python UDF validates the approved recommendation and exact stored branch before committing approved edits. It records commit metadata while the recommendation remains `Approved`.
- PR creation is off by default and requires an explicit reviewer request. Merge, deployment, publish, execution, and workspace sync are not automatic.
- App and UDF GitHub PATs stay server-side in separate stores. The agent's managed identity and the app's notification service principal have different roles.
