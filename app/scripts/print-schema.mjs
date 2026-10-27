import assert from 'node:assert/strict';
import { ConfigGenerator, SchemaAnalyzer } from '@microsoft/rayfin-core/analysis';
import { schema } from '@rayfin-app/data';

// Offline reference DDL: the deployment service applies the real migration.
const entities = new SchemaAnalyzer(schema, 'mssql', { log: () => {} }).analyzeEntities();
assert.equal(entities.length, 1);
const entity = entities[0];
const config = new ConfigGenerator('mssql').generateConfig(entities);
assert.equal(entity.name, 'Recommendation');
assert.deepEqual(entity.permissions.authenticated, ['read', 'update']);
assert.equal(entity.permissions.anonymous, undefined);
assert.equal(entity.fields.length, 27);
for (const field of entity.fields) {
  assert.match(field.name, /^[a-z][a-z_]*$/);
  assert.equal(field.isRelationship, false);
}
for (const name of ['summary', 'details', 'proposed_changes']) {
  assert.equal(entity.fields.find((field) => field.name === name)?.dbType, 'NVARCHAR(4000)');
}
for (const name of ['error_message']) {
  assert.equal(entity.fields.find((field) => field.name === name)?.dbType, 'NVARCHAR(500)');
}
assert.equal(entity.fields.find((field) => field.name === 'decision_comment')?.dbType, 'NVARCHAR(2000)');
for (const name of ['git_repo_url', 'git_base_branch', 'git_folder']) {
  const field = entity.fields.find((field) => field.name === name);
  assert.equal(field?.dbType, 'NVARCHAR(500)');
  assert.equal(field?.nullable, true);
}
const status = entity.fields.find((field) => field.name === 'status');
assert.equal(status?.dbType, 'NVARCHAR(8)');
assert.equal(status?.checkConstraint, "[status] IN ('Pending', 'Approved', 'Rejected')");
const quote = (value) => `[${value.replaceAll(']', ']]')}]`;
const table = entity.source?.table ?? entity.tableName;
const namespace = entity.source?.schema ?? 'dbo';
assert.equal(table, 'Recommendations');
assert.equal(namespace, 'dbo');
assert.equal(config.entities.Recommendation.source, 'Recommendations');
assert.deepEqual(config.entities.Recommendation.permissions, [
  { role: 'authenticated', actions: ['read', 'update'] },
]);
const columns = entity.fields.map((field) => {
  const name = field.columnName ?? field.name;
  return `  ${quote(name)} ${field.dbType} ${field.nullable ? 'NULL' : 'NOT NULL'}${field.primaryKey ? ' PRIMARY KEY' : ''}${field.checkConstraint ? ` CHECK (${field.checkConstraint})` : ''}`;
});
console.log(`-- Offline reference DDL from Rayfin 1.36.2 metadata; no database was contacted.\nCREATE TABLE ${quote(namespace)}.${quote(table)} (\n${columns.join(',\n')}\n);`);
