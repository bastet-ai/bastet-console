import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { exportSupabase, quoteIdentifier, snapshotQuery } from '../scripts/export-supabase.mjs';

const projectRef = 'abcdefghijklmnopqrst';
const env = { SUPABASE_ACCESS_TOKEN: 'test-management', SUPABASE_SERVICE_ROLE_KEY: 'test-service', SUPABASE_URL: `https://${projectRef}.supabase.co` };
const schema = { tables: [{ table_name: 'users', relkind: 'r' }], columns: [{ table_name: 'users', column_name: 'metadata', data_type: 'jsonb' }], constraints: [{ table_name: 'users', type: 'p', columns: ['id'] }] };
const rawRecords = '[{"id":"stable-id","metadata":{"exact":9007199254740993},"nullable":null}]';
const jsonFields = '[{"metadata":"{\\"exact\\":9007199254740993}","nullable":null}]';

function mockFetch(overrides = {}) {
  return async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/rest/v1/')) {
      assert.equal(options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
      return new Response('{"swagger":"2.0","definitions":{"users":{}}}');
    }
    assert.equal(url, `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Bearer ${env.SUPABASE_ACCESS_TOKEN}`);
    const sql = JSON.parse(options.body).query;
    const label = sql.match(/bastet-export:([^ ]+)/)[1];
    const data = { tables: schema.tables, columns: schema.columns, constraints: schema.constraints,
      snapshot: [{ table_name: 'users', row_count: '1', records_json: rawRecords, json_fields_json: jsonFields }],
      inventory: [{ relation: 'auth.users', rows: '0' }, { relation: 'storage.buckets', rows: '0' }, { relation: 'storage.objects', rows: '0' }],
      ...overrides }[label] ?? [];
    return new Response(JSON.stringify(data));
  };
}

test('identifiers are quoted and primary keys define stable record order', () => {
  assert.equal(quoteIdentifier('a"b'), '"a""b"');
  assert.throws(() => quoteIdentifier('a\0b'));
  const query = snapshotQuery(schema);
  assert.match(query, /order by t\."id"/);
  assert.match(query, /from public\."users" t/);
  assert.match(query, /'metadata', t\."metadata"::text/);
  assert.match(snapshotQuery({ ...schema, constraints: [] }), /COLLATE "C"/);
  assert.equal(snapshotQuery({ tables: [], constraints: [] }), null);
});

test('private export preserves IDs, raw JSON numeric precision and checksums', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'bastet-export-test-'));
  const outputDir = join(parent, 'backup');
  const result = await exportSupabase({ projectRef, outputDir, env, fetchImpl: mockFetch() });
  assert.deepEqual(result.tables, [{ table: 'users', rows: '1' }]);
  assert.equal(await readFile(join(outputDir, 'tables/users.json'), 'utf8'), rawRecords + '\n');
  assert.equal(await readFile(join(outputDir, 'tables/users.json-fields.json'), 'utf8'), jsonFields + '\n');
  assert.equal((await stat(outputDir)).mode & 0o777, 0o700);
  assert.equal((await stat(join(outputDir, 'tables/users.json'))).mode & 0o777, 0o600);
  const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'));
  assert.match(manifest.tables[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(manifest).includes('test-service'), false);
  await assert.rejects(exportSupabase({ projectRef, outputDir, env, fetchImpl: mockFetch() }), /EEXIST/);
});

test('project mismatch is rejected before credentials are sent', async () => {
  await assert.rejects(exportSupabase({ projectRef, outputDir: '/unused', env: { ...env, SUPABASE_URL: 'https://example.com' },
    fetchImpl: () => assert.fail('must not fetch') }), /does not match/);
});

test('missing or truncated tables fail without a completion manifest', async () => {
  for (const snapshot of [[], [{ table_name: 'users', row_count: '2', records_json: rawRecords }]]) {
    const parent = await mkdtemp(join(tmpdir(), 'bastet-export-test-'));
    const outputDir = join(parent, 'backup');
    await assert.rejects(exportSupabase({ projectRef, outputDir, env, fetchImpl: mockFetch({ snapshot }) }), /mismatch/);
    await assert.rejects(stat(join(outputDir, 'manifest.json')), /ENOENT/);
  }
});

test('upstream errors never reflect credential-bearing response bodies', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'bastet-export-test-'));
  await assert.rejects(exportSupabase({ projectRef, outputDir: join(parent, 'backup'), env,
    fetchImpl: async () => new Response('secret-do-not-print', { status: 401 }) }), error =>
    /HTTP 401/.test(error.message) && !error.message.includes('secret-do-not-print'));
});

test('malformed record payload does not leak its contents in errors', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'bastet-export-test-'));
  await assert.rejects(exportSupabase({ projectRef, outputDir: join(parent, 'backup'), env,
    fetchImpl: mockFetch({ snapshot: [{ table_name: 'users', row_count: '1', records_json: 'secret-do-not-print', json_fields_json: '[]' }] }) }), error =>
    /contents suppressed/.test(error.message) && !error.message.includes('secret-do-not-print'));
});
