const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSuppressionStore } = require('../server/suppressions');

function temporaryFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'findemm-suppressions-'));
  return { directory, filePath: path.join(directory, 'suppressions.json') };
}

test('stores only normalized HMAC keys and add is idempotent', (t) => {
  const { directory, filePath } = temporaryFile();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createSuppressionStore({ filePath, secret: 'local-secret' });

  assert.equal(store.add(' Recruiter@Example.COM '), true);
  assert.equal(store.add('recruiter@example.com'), false);
  assert.equal(store.addMany(['linkedin:asha', 'person:asha|rao|example.com']), 2);
  assert.equal(store.has('RECRUITER@example.com'), true);

  const raw = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(raw, /recruiter|example\.com/i);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['hashes', 'verifier', 'version']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test('persists across instances while a different secret cannot match', (t) => {
  const { directory, filePath } = temporaryFile();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createSuppressionStore({ filePath, secret: 'first-secret' }).add('asha@example.com');

  assert.equal(createSuppressionStore({ filePath, secret: 'first-secret' }).has('asha@example.com'), true);
  assert.throws(() => createSuppressionStore({ filePath, secret: 'second-secret' }), /does not match/);
});

test('rejects corrupt files instead of resetting suppressions', (t) => {
  const { directory, filePath } = temporaryFile();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(filePath, '{"version":1,"hashes":["raw@example.com"]}');

  assert.throws(() => createSuppressionStore({ filePath, secret: 'local-secret' }), /corrupt/);
  assert.match(fs.readFileSync(filePath, 'utf8'), /raw@example\.com/);
});

test('migrates only an empty legacy store to the secret-bound format', (t) => {
  const { directory, filePath } = temporaryFile();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(filePath, '{"version":1,"hashes":[]}\n');
  createSuppressionStore({ filePath, secret: 'local-secret' });
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(data.version, 2);
  assert.match(data.verifier, /^[a-f0-9]{64}$/);
});
