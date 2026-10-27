---
name: fuam-analysis
description: "Use for Fabric cost, CU consumption, top consumers, week-over-week comparison, capacity pressure, notebook optimization and RCA using FUAM and read-only Fabric monitoring."
---

# FUAM analysis skill

## Configuration
Replace placeholders consistently. These are FUAM resources, not the app database.

| Setting | Value |
|---|---|
| FUAM workspace name | `<FUAM_WORKSPACE_NAME>` |
| FUAM workspace ID | `<FUAM_WORKSPACE_ID>` |
| FUAM lakehouse name / SQL database | `FUAM_Lakehouse` |
| FUAM lakehouse ID | `<FUAM_LAKEHOUSE_ID>` |
| FUAM SQL server (analytics endpoint) | `<FUAM_SQL_ENDPOINT>` |
| SQL schema | `dbo` |
| Optional pricing tool binding | `<FABRIC_CU_PRICE_TOOL_NAME>` |

Use only this FUAM source for consumption figures. If unavailable, report the
error; live monitoring may still support performance RCA but is not substitute
FUAM billing data. Verify actual columns before adapting queries.
Use [Fabric skill router](./fabric-skills-router.md) for monitoring procedures.

## Data sources

| Table | Purpose / relevant columns |
|---|---|
| `capacity_metrics_by_item_by_operation_by_day` | Primary cost fact: `Date`, `CapacityId`, `WorkspaceId`, `ItemId`, `ItemKind`, `OperationName`, `TotalCUs`, `OperationCount`, `DurationInSec`, `FailureOperationCount`, `CancelledOperationCount`, `RejectedOperationCount`, `ThrottlingInMin` |
| `capacity_metrics_by_item_kind_by_day` | Daily aggregation by item kind; do not add it to item-level totals |
| `capacity_metrics_by_timepoint` | Capacity pressure: `TimePoint`, `CapacityId`, `TotalCUUsagePercentage`, `CarryOverCumulativePercentage`, `InteractiveDelayPercentage`, `InteractiveRejectionPercentage`, `BackgroundRejectionPercentage`, `InteractiveNonBillablePercentage`, `BackgroundNonBillablePercentage` |
| `workspaces` | `WorkspaceId`, `WorkspaceName`, `CapacityId` |
| `active_items` | Current inventory: `id`, `name`, `type`, `workspaceId`, `capacityId` |
| `active_items_history` | Deleted-item name history: `id`, `name`, `type`, `Snapshot_Date` |
| `activities` | Last-resort names: `ItemId`, `ItemName`, `ArtifactKind`, `CreationTime` |
| `notebooks` | `NotebookId`, `Name`, `WorkspaceId` |
| `pipelines` | `PipelineId`, `Name`, `WorkspaceId`, `relations` |
| `capacities` / `capacities_history` | Capacity `CapacityId`, `region`, `sku`; history also has `Snapshot_Date` |

- Query `dbo.<table>`. Use bounded date filters, aggregates and limited result sets.
- Join fact `WorkspaceId` to workspaces, `ItemId` to inventory `id`, and
  `CapacityId` to capacities. Avoid multiplying facts through history joins.
- Resolve names within the query and scope them to the workspace. Clarify ambiguity.
- FUAM GUIDs may be uppercase under case-sensitive collation. Compare supplied
  GUIDs with `UPPER(column) = UPPER(TRIM(@id))`; use tool parameters when supported.
  Never concatenate unescaped user text into SQL.
- Do not discard historical cost because an item was deleted. Resolve names from
  current inventory, latest applicable inventory history, then activities.
  Otherwise display the item ID and "deleted / name unknown".

## Dates, freshness and precision
- Weeks run Monday through Sunday. State explicit dates.
- "This week" is partial; "last week" is the preceding full Monday-Sunday.
- Compare like-for-like weekdays or explicitly label a partial/full comparison.
- Read `MAX(Date)` from the primary fact. Report missing days and partial today.
- Daily item/operation facts do not identify individual executions. Keep FUAM's
  stored calendar boundaries; do not shift them to a different timezone.
- Job-instance APIs give execution times/status, not CU consumption.
- Notebook run operations are `Notebook Run`, `Notebook Scheduled Run` and
  `Notebook HC Run`. Other operations can contribute cost without being runs.
- One relevant run in a daily aggregate permits attribution to that run, subject
  to operation scope. Multiple runs permit only an average, not a "latest run" CU.
- Capacity timepoints are not per-item, per-execution CU records.

## Cost calculation
`TotalCUs` is CU-seconds:

```text
CU-hours = SUM(TotalCUs) / 3600
Standalone-equivalent cost = CU-hours * regional price per CU-hour
```

1. Use a user-provided rate/model when supplied. Otherwise ask once for PAYG or
   reservation; if unspecified after that, use PAYG.
2. If available, use `<FABRIC_CU_PRICE_TOOL_NAME>` backed by the Azure Retail Prices
   API, with the capacity's region and EUR. Expected fields are
   `payg_per_cu_hour`, `reservation_1y_per_cu_year`,
   `reservation_1y_per_cu_hour`, `retrieved_utc`.
3. If the tool is absent or fails, ask for a rate; still report CU-hours without
   currency. Never invent prices or treat a missing rate as zero.
4. For a reservation, annual price / 8,760 gives the hourly equivalent.
5. Price each capacity/region separately. Use applicable historical capacity/SKU
   data for historical periods; disclose unavailable history.
6. Calculate with unrounded numbers. Display rates and CU-hours to four decimals,
   currency to two. Record model, region, source and retrieval time.
7. These are retail standalone-equivalent costs, not invoice allocation or
   guaranteed savings. Discounts, OneLake storage and non-billable/preview
   operations can make actual charges differ.

Every currency answer ends with actual operands, grouped subtotals if necessary:

```text
CALCULATION
Rate: EUR <rate>/CU-hour (<model>, <region>, <source>, retrieved <UTC>)
CU-seconds: <subtotals> = <total>
CU-hours: <total> / 3600 = <hours>
Cost: <hours> * EUR <rate> = EUR <cost>
```

For multiple capacities, show each calculation then the total. For averages,
also show CU-seconds / run count. Explain the unit conversion in one sentence.

## Pipeline attribution
1. Report the pipeline's own operations separately.
2. Parse `pipelines.relations` for `dependentOnArtifactId`; verify actual JSON
   representation and confirm which children ran during the requested period.
3. Use job/activity evidence where available; static dependencies are not proof
   that a child executed.
4. Shared children or independently scheduled/manual runs prevent exact pipeline
   attribution. Show them separately and label an included total an upper bound.
5. Never label aggregate child usage as the exact cost of a particular pipeline run.

## Investigation procedures

### Cost or top-consumer question
1. Resolve workspace/item/capacity and period; check freshness.
2. Aggregate the primary fact by item, operation or day as requested.
3. Join human-readable names and capacity regions without losing deleted items.
4. State CU-hours, run counts where relevant, and precision.
5. Add currency only with a verified rate.

### Failure, slowdown or throttling
1. Locate the affected execution and its exact times/status through read-only
   Fabric monitoring. Check relevant daily FUAM failures/durations.
2. Correlate the incident window with capacity timepoints and other consumers.
   Correlation alone is not proof of causation.
3. For Spark, inspect the execution's driver/executor errors, lost executors,
   stages, skew, shuffle/spill and allocation. Compare a healthy run if available.
4. For a pipeline notebook activity, investigate the child notebook execution,
   not just the pipeline's daily aggregate.
5. Conclude with observed evidence, most likely cause, alternatives and what
   would confirm the explanation. Report missing monitoring explicitly.

### Notebook optimization
1. Quantify the recent trend, typically 14 days: daily CU/run, duration/run,
   failures and throttling. These are averages where more than one run occurred.
2. Inspect the live definition through Fabric; do not require GitHub MCP.
3. Look for large `collect()`/`toPandas()`, repeated reads/actions, missing pruning,
   unnecessary full processing, expensive shuffles, small files and poor sizing.
4. Tie each recommendation to source/monitoring evidence. Cache or repartition
   only when evidence supports it, not as a blanket optimization.
5. Label expected reductions as estimates with assumptions. Reducing allocated
   consumption does not automatically reduce a fixed-capacity invoice.
6. When asked to record, use the recommendation workflow skill to discover the
   investigated workspace's GitHub target and store it with the recommendation.
   Do not substitute the FUAM or approvals workspace's Git connection. Await approval.

### SQL endpoint staleness
The FUAM Lakehouse SQL analytics endpoint may serve stale data even when
the lakehouse has been refreshed, because the endpoint refreshes on its
own schedule. Before concluding a workspace or item is missing:
1. Check `MAX(fuam_modified_at)` from `dbo.workspaces` — this is the
   lakehouse refresh time, not the endpoint sync time.
2. If the value is older than expected, the FUAM lakehouse refresh may
   be in progress or overdue — report the staleness rather than
   spending queries retrying with different case/ID formats.
3. If the workspace was recently created or assigned to the capacity,
   it will only appear after the next successful FUAM refresh.
   State this as a coverage gap rather than a data issue.

## Optional derived Spark CU
- Only when requested and allocation data is complete, estimate
  `SUM(allocated cores * allocation seconds) / 2` CU-seconds, including the driver.
- Confirm units, executor add/remove times and application end time. Do not use
  running cores instead of allocated cores.
- Label it "derived from Spark allocation; estimate, not validated against
  Capacity Metrics" unless validation for this setup is recorded.
- Do not attribute an entire shared high-concurrency application to one notebook.
- Cross-check daily derived totals against matching FUAM scope; disclose a
  difference over 10% and show both figures rather than silently choosing one.

## Answer format
Answer first, then a compact breakdown, evidence, precision and freshness.
State uncertainties and actionable next steps. Put the calculation block last
when giving currency figures. This skill never changes or runs Fabric items.
