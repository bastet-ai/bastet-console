#!/usr/bin/env node
// Read-only backup. Requires Node 22+ and a fresh private output directory.
// SUPABASE_ACCESS_TOKEN authorizes only api.supabase.com; the service-role key
// authorizes only the matching project's REST endpoint. Never log either key.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

export const CATALOG_QUERIES = {
  tables: `select c.relname as table_name, c.relkind, c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced, pg_catalog.obj_description(c.oid) as comment
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','f') order by c.relname`,
  columns: `select c.relname as table_name, a.attname as column_name, a.attnum as ordinal_position,
    pg_catalog.format_type(a.atttypid,a.atttypmod) as data_type, not a.attnotnull as nullable,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid) as column_default,
    a.attidentity as identity, a.attgenerated as generated,
    pg_catalog.col_description(c.oid,a.attnum) as comment
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_catalog.pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname='public' and c.relkind in ('r','p','v','m','f') order by c.relname,a.attnum`,
  constraints: `select c.relname as table_name, k.conname as name, k.contype as type,
    pg_catalog.pg_get_constraintdef(k.oid,true) as definition,
    (select pg_catalog.json_agg(a.attname order by x.ord)
      from pg_catalog.unnest(k.conkey) with ordinality x(attnum,ord)
      join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum=x.attnum) as columns
    from pg_catalog.pg_constraint k join pg_catalog.pg_class c on c.oid=k.conrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' order by c.relname,k.conname`,
  indexes: `select tablename as table_name, indexname, indexdef
    from pg_catalog.pg_indexes where schemaname='public' order by tablename,indexname`,
  policies: `select * from pg_catalog.pg_policies where schemaname='public' order by tablename,policyname`,
  triggers: `select c.relname as table_name, t.tgname as name,
    pg_catalog.pg_get_triggerdef(t.oid,true) as definition
    from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname`,
  functions: `select p.proname as name, pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
    pg_catalog.pg_get_functiondef(p.oid) as definition
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind in ('f','p') order by p.proname,p.oid`,
  enums: `select t.typname as name, e.enumlabel as value, e.enumsortorder as ordinal_position
    from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace
    join pg_catalog.pg_enum e on e.enumtypid=t.oid where n.nspname='public'
    order by t.typname,e.enumsortorder`,
};

export function quoteIdentifier(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Invalid SQL identifier');
  return `"${value.replaceAll('"', '""')}"`;
}

const literal = value => `'${value.replaceAll("'", "''")}'`;
const checksum = text => createHash('sha256').update(text).digest('hex');
const privateWrite = (path, data) => writeFile(path, data, { mode: 0o600, flag: 'wx' });
const parsePrivateJson = (text, label) => {
  try { return JSON.parse(text); }
  catch { throw new Error(`${label}: invalid JSON (contents suppressed)`); }
};

export function snapshotQuery(schema) {
  const tables = schema.tables.filter(t => ['r', 'p'].includes(t.relkind));
  if (!tables.length) return null;
  return tables.map(table => {
    const keys = schema.constraints.find(c => c.table_name === table.table_name && c.type === 'p')?.columns;
    const order = keys?.length ? keys.map(k => `t.${quoteIdentifier(k)}`).join(', ')
      : 'pg_catalog.row_to_json(t)::text COLLATE "C"';
    const jsonColumns = (schema.columns ?? []).filter(c => c.table_name === table.table_name && ['json', 'jsonb'].includes(c.data_type));
    const jsonFields = jsonColumns.length ? `pg_catalog.json_build_object(${jsonColumns.map(c =>
      `${literal(c.column_name)}, t.${quoteIdentifier(c.column_name)}::text`).join(', ')})` : "'{}'::json";
    // PostgreSQL serializes each table as text inside the response. Keeping that
    // text unchanged avoids JS rounding bigint or numeric values in JSON fields.
    return `select ${literal(table.table_name)} as table_name, count(*)::text as row_count,
      coalesce(pg_catalog.json_agg(pg_catalog.row_to_json(t) order by ${order}), '[]'::json)::text as records_json,
      coalesce(pg_catalog.json_agg(${jsonFields} order by ${order}), '[]'::json)::text as json_fields_json
      from public.${quoteIdentifier(table.table_name)} t`;
  }).join('\nunion all\n');
}

async function request(fetchImpl, url, options, label) {
  let response;
  try { response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(120_000), redirect: 'error' }); }
  catch { throw new Error(`${label}: request failed (details suppressed to protect credentials)`); }
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} (body suppressed)`);
  const text = await response.text();
  try { return { text, data: JSON.parse(text) }; }
  catch { throw new Error(`${label}: invalid JSON response (body suppressed)`); }
}

export async function exportSupabase({ projectRef, outputDir, env = process.env, fetchImpl = fetch }) {
  if (!/^[a-z]{20}$/.test(projectRef ?? '')) throw new Error('A valid Supabase project reference is required');
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_ACCESS_TOKEN and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  const expectedOrigin = `https://${projectRef}.supabase.co`;
  const configuredUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  if (configuredUrl && new URL(configuredUrl).origin !== expectedOrigin) throw new Error('Project reference does not match SUPABASE_URL');
  if (!outputDir) throw new Error('A fresh private output directory is required');
  const destination = resolve(outputDir);
  await mkdir(destination, { mode: 0o700 }); // Deliberately refuses existing paths.
  await mkdir(resolve(destination, 'tables'), { mode: 0o700 });
  const startedAt = new Date().toISOString();
  const query = async (sql, label) => {
    const result = await request(fetchImpl, `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `/* bastet-export:${label} */\n${sql}` }),
    }, label);
    if (!Array.isArray(result.data)) throw new Error(`${label}: expected query result array`);
    return result.data;
  };
  const openapi = await request(fetchImpl, `${expectedOrigin}/rest/v1/`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/openapi+json' },
  }, 'OpenAPI');
  await privateWrite(resolve(destination, 'openapi.json'), openapi.text);
  const schema = {};
  for (const [name, sql] of Object.entries(CATALOG_QUERIES)) schema[name] = await query(sql, name);
  if (schema.tables.some(table => table.relkind === 'f')) throw new Error('Foreign tables require a separately coordinated snapshot');
  const schemaText = JSON.stringify(schema, null, 2) + '\n';
  await privateWrite(resolve(destination, 'schema.json'), schemaText);
  const sql = snapshotQuery(schema);
  const rows = sql ? await query(sql, 'snapshot') : [];
  const expected = schema.tables.filter(t => ['r', 'p'].includes(t.relkind)).map(t => t.table_name);
  if (rows.length !== expected.length || new Set(rows.map(r => r.table_name)).size !== expected.length
      || rows.some(row => !expected.includes(row.table_name))) throw new Error('Snapshot table set mismatch');
  const tables = [];
  for (const row of rows) {
    if (typeof row.records_json !== 'string' || !/^\d+$/.test(row.row_count)) throw new Error('Invalid snapshot response');
    const records = parsePrivateJson(row.records_json, 'Table records');
    if (!Array.isArray(records) || BigInt(records.length) !== BigInt(row.row_count)) throw new Error('Snapshot row count mismatch');
    if (typeof row.json_fields_json !== 'string') throw new Error('Missing JSON field fidelity metadata');
    const jsonFields = parsePrivateJson(row.json_fields_json, 'JSON field metadata');
    if (!Array.isArray(jsonFields) || jsonFields.length !== records.length) throw new Error('JSON field row count mismatch');
    const file = `tables/${encodeURIComponent(row.table_name)}.json`;
    const jsonFieldsFile = `tables/${encodeURIComponent(row.table_name)}.json-fields.json`;
    const content = row.records_json + '\n';
    const jsonFieldsContent = row.json_fields_json + '\n';
    await privateWrite(resolve(destination, file), content);
    await privateWrite(resolve(destination, jsonFieldsFile), jsonFieldsContent);
    tables.push({ table: row.table_name, rows: row.row_count, file, sha256: checksum(content), jsonFieldsFile, jsonFieldsSha256: checksum(jsonFieldsContent) });
  }
  // Counts and bucket metadata only: Auth credentials and blob content are not
  // exported here. Nonzero inventory requires a separate preservation step.
  const inventory = await query(`select 'auth.users' as relation, count(*)::text as rows from auth.users
    union all select 'storage.buckets',count(*)::text from storage.buckets
    union all select 'storage.objects',count(*)::text from storage.objects`, 'inventory');
  const buckets = await query(`select pg_catalog.row_to_json(b)::text as metadata_json,
    (select count(*)::text from storage.objects o where o.bucket_id=b.id) as object_count
    from storage.buckets b order by b.id`, 'buckets');
  await privateWrite(resolve(destination, 'storage-inventory.json'), JSON.stringify({ inventory, buckets }, null, 2) + '\n');
  const manifest = { format: 'bastet-supabase-export-v1', projectRef, startedAt, completedAt: new Date().toISOString(),
    consistency: 'All public base-table records were read in one SQL statement/snapshot; schema and inventory were read separately.',
    restoreNotes: 'Archive, not an import. JSON files preserve PostgreSQL JSON text, IDs and numeric precision. Each jsonFieldsFile is aligned with table record order and maps every JSON column to its PostgreSQL text (string), or null for SQL NULL. This distinguishes JSON literal null and preserves nested numeric precision. Views/functions/policies are schema only. Auth user records and Storage object bytes are not included.',
    openapi: { file: 'openapi.json', sha256: checksum(openapi.text) },
    schema: { file: 'schema.json', sha256: checksum(schemaText) }, tables, inventory };
  await privateWrite(resolve(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { outputDir: destination, tables: tables.map(({ table, rows }) => ({ table, rows })), inventory };
}

async function main() {
  const { values } = parseArgs({ options: { 'env-file': { type: 'string' }, 'project-ref': { type: 'string' }, 'output-dir': { type: 'string' } } });
  const env = { ...(values['env-file'] ? parseEnv(await readFile(values['env-file'], 'utf8')) : {}), ...process.env };
  const result = await exportSupabase({ projectRef: values['project-ref'], outputDir: values['output-dir'], env });
  console.log(JSON.stringify(result, null, 2)); // Only relation names, counts, destination.
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Export failed: ${error.message}`); process.exitCode = 1; });
}
