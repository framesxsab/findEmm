const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecord, queueDraft, toCsv } = require('../extension/state');

test('creates a local record with no implicit send state', () => {
  const record = createRecord({ name: 'Ada Lovelace', company: 'Example' }, []);
  assert.equal(record.saved, false);
  assert.deepEqual(record.sequence, []);
  assert.equal(record.list, 'Saved prospects');
});

test('queues a draft-only follow-up locally', () => {
  const sequence = queueDraft([]);
  assert.equal(sequence.length, 1);
  assert.equal(sequence[0].kind, 'draft_outreach');
  assert.equal(sequence[0].status, 'queued');
});

test('exports contact provenance to CSV', () => {
  const record = createRecord({ name: 'Ada Lovelace', company: 'Example', title: 'Engineer' }, [{ value: 'ada@example.com', contactType: 'work_email', status: 'publicly_found', confidence: 85, sourceUrl: 'https://example.com/contact', retrievedAt: '2026-07-15T00:00:00.000Z' }]);
  const csv = toCsv(record);
  assert.match(csv, /source_url/);
  assert.match(csv, /ada@example.com/);
  assert.match(csv, /publicly_found/);
});

test('seals and opens a vault payload with AES-GCM', async () => {
  const salt = FindEmmState.newSalt();
  const sealed = await FindEmmState.seal({ token: 'local-token', records: [{ id: '1' }] }, 'a long passphrase', salt);
  assert.notEqual(sealed.cipher, 'local-token');
  assert.deepEqual(await FindEmmState.open(sealed, 'a long passphrase', salt), { token: 'local-token', records: [{ id: '1' }] });
  await assert.rejects(() => FindEmmState.open(sealed, 'wrong passphrase', salt));
});
