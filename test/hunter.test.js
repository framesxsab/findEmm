const test = require('node:test');
const assert = require('node:assert/strict');
const { createHunterAdapter, linkedInHandle } = require('../server/hunter');

const prospect = { firstName: 'asha', lastName: 'rao', domain: 'example.com', profileUrl: '' };
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
function memorySuppressionStore() {
  const entries = new Set();
  return { has: (key) => entries.has(key), addMany: (keys) => { let added = 0; keys.forEach((key) => { if (!entries.has(key)) { entries.add(key); added += 1; } }); return added; } };
}

test('extracts only a LinkedIn profile handle', () => {
  assert.equal(linkedInHandle('https://www.linkedin.com/in/asha-rao/?trk=profile'), 'asha-rao');
  assert.equal(linkedInHandle('https://example.com/in/asha-rao'), '');
});

test('keeps Hunter disabled without key and explicit commercial approval', async () => {
  let calls = 0;
  const adapter = createHunterAdapter({ apiKey: 'secret', commercialApproval: false, fetchImpl: async () => { calls += 1; } });
  assert.equal(adapter.enabled, false);
  assert.deepEqual(await adapter.lookup(prospect), { contacts: [] });
  assert.equal(calls, 0);
});

test('requires durable suppression storage when Hunter is enabled', () => {
  assert.throws(() => createHunterAdapter({ apiKey: 'secret', commercialApproval: true }), /durable suppression store/);
});

test('requires name and domain aliases before any Hunter lookup route', async () => {
  let calls = 0;
  const adapter = createHunterAdapter({ apiKey: 'secret', commercialApproval: true, suppressionStore: memorySuppressionStore(), fetchImpl: async () => { calls += 1; return response({ data: {} }); } });
  assert.deepEqual(await adapter.lookup({ profileUrl: 'https://linkedin.com/in/asha-rao' }), { contacts: [] });
  assert.equal(calls, 0);
});

test('uses header auth, sanitizes response, and deduplicates concurrent lookups', async () => {
  let calls = 0;
  let clock = 0;
  const fetchImpl = async (url, options) => { calls += 1; assert.equal(url.searchParams.has('api_key'), false); assert.equal(options.headers['x-api-key'], 'secret'); return response({ data: { email: 'asha@example.com', score: 97, verification: { status: 'valid', date: '2026-07-01' }, sources: [{ uri: 'javascript:alert(1)' }, { uri: 'https://example.com/team', last_seen_on: '2026-07-01' }] } }); };
  const adapter = createHunterAdapter({ apiKey: 'secret', commercialApproval: true, suppressionStore: memorySuppressionStore(), fetchImpl, now: () => clock });
  const [first, second] = await Promise.all([adapter.lookup(prospect), adapter.lookup(prospect)]);
  assert.equal(calls, 1);
  await adapter.lookup(prospect);
  assert.equal(calls, 1);
  clock = 24 * 60 * 60 * 1000 + 1;
  await adapter.lookup(prospect);
  assert.equal(calls, 2);
  assert.deepEqual(first, second);
  assert.deepEqual(first.contacts[0], { email: 'asha@example.com', score: 97, verificationStatus: 'valid', verificationDate: '2026-07-01T00:00:00.000Z', sourceUrl: 'https://example.com/team', evidenceSnippet: 'Hunter source last seen 2026-07-01; mailbox status valid.' });
  assert.doesNotMatch(JSON.stringify(first), /secret/);
});

test('persists a 451 suppression and performs no later network request', async () => {
  let calls = 0;
  const suppressionStore = memorySuppressionStore();
  const first = createHunterAdapter({ apiKey: 'secret', commercialApproval: true, suppressionStore, fetchImpl: async () => { calls += 1; return response({ errors: [{ id: 'claimed_email', details: 'private provider detail' }] }, 451); } });
  const result = await first.lookup({ ...prospect, profileUrl: 'https://linkedin.com/in/asha-rao' });
  assert.deepEqual(result, { contacts: [], suppressed: true });
  assert.doesNotMatch(JSON.stringify(result), /private provider detail/);

  const restarted = createHunterAdapter({ apiKey: 'secret', commercialApproval: true, suppressionStore, fetchImpl: async () => { calls += 1; throw new Error('network must not run'); } });
  assert.deepEqual(await restarted.lookup(prospect), { contacts: [], suppressed: true });
  assert.equal(calls, 1);
});

test('rechecks suppression inside serialized work before an alias request runs', async () => {
  let calls = 0;
  const suppressionStore = memorySuppressionStore();
  const adapter = createHunterAdapter({
    apiKey: 'secret',
    commercialApproval: true,
    suppressionStore,
    fetchImpl: async (url) => {
      calls += 1;
      if (url.searchParams.has('linkedin_handle')) return response({ errors: [{ id: 'claimed_email' }] }, 451);
      return response({ data: { email: 'asha@example.com', score: 90, verification: { status: 'valid', date: '2026-07-01' } } });
    }
  });

  const [handleResult, aliasResult] = await Promise.all([
    adapter.lookup({ ...prospect, profileUrl: 'https://linkedin.com/in/asha-rao' }),
    adapter.lookup(prospect)
  ]);

  assert.deepEqual(handleResult, { contacts: [], suppressed: true });
  assert.deepEqual(aliasResult, { contacts: [], suppressed: true });
  assert.equal(calls, 1);
});

test('rechecks suppression after a provider response before returning or caching it', async () => {
  let calls = 0;
  const suppressionStore = memorySuppressionStore();
  const adapter = createHunterAdapter({
    apiKey: 'secret',
    commercialApproval: true,
    suppressionStore,
    fetchImpl: async () => {
      calls += 1;
      suppressionStore.addMany(['person:asha|rao|example.com']);
      return response({ data: { email: 'asha@example.com', score: 90, verification: { status: 'valid', date: '2026-07-01' } } });
    }
  });

  assert.deepEqual(await adapter.lookup(prospect), { contacts: [], suppressed: true });
  assert.deepEqual(await adapter.lookup(prospect), { contacts: [], suppressed: true });
  assert.equal(calls, 1);
});
