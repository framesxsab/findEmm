const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSuppressionStore, prospectSuppressionKeys, screenProspectSuppressions } = require('../server/suppressions');

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

test('derives the same person and LinkedIn aliases used by provider suppression', () => {
  assert.deepEqual(prospectSuppressionKeys({ firstName: 'Asha', lastName: 'Rao', domain: 'Example.COM', profileUrl: 'https://www.linkedin.com/in/Asha-Rao/' }), { aliases: ['linkedin:asha-rao', 'person:asha|rao|example.com'], linkedInKey: 'linkedin:asha-rao', personKey: 'person:asha|rao|example.com', domainKey: 'domain:example.com' });
  assert.equal(prospectSuppressionKeys({ profileUrl: 'https://linkedin.com/in/asha%2Frao' }).linkedInKey, '');
  assert.equal(prospectSuppressionKeys({ profileUrl: 'https://linkedin.com/in/asha%5Crao' }).linkedInKey, '');
});

test('screens a batch against person HMACs without treating a blocked domain as a person opt-out', () => {
  const present = new Set(['person:asha|rao|example.com', 'domain:blocked.example']);
  let batchCalls = 0;
  const store = { has() { throw new Error('batch path should be used'); }, hasMany(keys) { batchCalls += 1; return keys.map((key) => present.has(key)); } };
  const results = screenProspectSuppressions([
    { firstName: 'asha', lastName: 'rao', domain: 'example.com' },
    { firstName: 'dev', lastName: 'shah', domain: 'blocked.example' },
    { firstName: 'single', lastName: '', domain: 'example.com' }
  ], store);
  assert.equal(batchCalls, 1);
  assert.deepEqual(results, [
    { index: 0, checkable: true, suppressed: true, matchedLinkedIn: false, matchedPerson: true, blockedDomain: false },
    { index: 1, checkable: true, suppressed: false, matchedLinkedIn: false, matchedPerson: false, blockedDomain: true },
    { index: 2, checkable: false, suppressed: false, matchedLinkedIn: false, matchedPerson: false, blockedDomain: false }
  ]);
});

test('checks many durable suppression keys with one store load', (t) => {
  const { directory, filePath } = temporaryFile();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createSuppressionStore({ filePath, secret: 'local-secret' });
  store.addMany(['person:asha|rao|example.com', 'domain:blocked.example']);
  assert.deepEqual(store.hasMany(['person:asha|rao|example.com', 'person:dev|shah|example.com', 'domain:blocked.example']), [true, false, true]);
});
