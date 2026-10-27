-- DEV ONLY. Documentation, not a migration. Never run automatically.
-- Replace workspace_id with the actual workspace before manual use.
-- Replace REPLACE_WITH_GIT_REPO_URL, REPLACE_WITH_GIT_BASE_BRANCH and
-- REPLACE_WITH_GIT_FOLDER with the investigated workspace's discovered target.
-- Use N'' for git_folder when the workspace is connected at repository root.
-- Confirm the deployed table using `npm run schema:sql` and SQL catalog metadata.
-- The external UDF supplies id and created_at.
-- summary, details, proposed_changes allow 4000 characters; these examples are shorter.
INSERT INTO [dbo].[Recommendations]
  ([id], [created_at], [thread_id], [workspace_id], [item_type], [item_name],
   [item_path], [git_repo_url], [git_base_branch], [git_folder],
   [title], [severity], [estimated_impact], [summary],
   [details], [proposed_changes], [status])
VALUES
  ('63094d09-0394-4f49-8e0b-56076ed5a001', '2026-10-22T09:00:00',
   N'demo-thread-collect', N'REPLACE_WITH_WORKSPACE_ID', N'Notebook', N'Sales ETL',
   N'Sales_ETL.Notebook', N'REPLACE_WITH_GIT_REPO_URL', N'REPLACE_WITH_GIT_BASE_BRANCH',
   N'REPLACE_WITH_GIT_FOLDER', N'Avoid collecting the full sales dataset on the driver',
   N'High', N'Lower driver memory pressure; validate CU savings',
   N'The notebook collects a large DataFrame into driver memory. This risks driver OOM and serial processing. Keep the transformation distributed.',
   N'## Finding
`sales.collect()` materializes all rows on the driver. The downstream transformation can be expressed with Spark column operations.',
   N'## Proposed change
Replace the Python loop with a distributed column expression.
```python
from pyspark.sql import functions as F
result = sales.withColumn("net", F.col("gross") - F.col("tax"))
```',
   N'Pending'),
  ('63094d09-0394-4f49-8e0b-56076ed5a002', '2026-10-22T09:05:00',
   N'demo-thread-pruning', N'REPLACE_WITH_WORKSPACE_ID', N'Notebook', N'Daily Orders',
   N'Daily_Orders.Notebook', N'REPLACE_WITH_GIT_REPO_URL', N'REPLACE_WITH_GIT_BASE_BRANCH',
   N'REPLACE_WITH_GIT_FOLDER', N'Filter the partition column before transforming orders',
   N'Medium', N'Fewer scanned files; measure before and after',
   N'The daily job reads every partition before filtering transformed timestamps. Filter the partition column directly to reduce scanned data. Confirm the same date boundaries are preserved.',
   N'## Finding
Filtering a derived date prevents effective partition pruning. The source Delta table is partitioned by `order_date`.',
   N'## Proposed change
Push the partition predicate into the read.
```python
orders = spark.read.table("orders").where("order_date = DATE ''2026-10-21''")
```
Validate row counts against the original job.',
   N'Pending'),
  ('63094d09-0394-4f49-8e0b-56076ed5a003', '2026-10-22T09:10:00',
   N'demo-thread-cache', N'REPLACE_WITH_WORKSPACE_ID', N'Notebook', N'Customer Segments',
   N'Customer_Segments.Notebook', N'REPLACE_WITH_GIT_REPO_URL', N'REPLACE_WITH_GIT_BASE_BRANCH',
   N'REPLACE_WITH_GIT_FOLDER', N'Reuse a cached customer input across repeated actions',
   N'Low', N'Avoid repeated reads; validate memory and CU usage',
   N'The same customer table is read repeatedly for three actions. Reuse one cached DataFrame when it fits available memory. Release it once all consumers finish.',
   N'## Finding
Three separate reads repeat file scans and transformations. Confirm the Spark plan and input size before caching.',
   N'## Proposed change
```python
customers = spark.read.table("customers").cache()
try:
    build_segments(customers)
    build_metrics(customers)
    build_export(customers)
finally:
    customers.unpersist()
```
Keep the original outputs unchanged.',
   N'Pending');
