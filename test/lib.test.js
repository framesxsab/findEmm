const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProspect, policyAllows, enrich } = require('../server/lib');

test('normalizes a valid prospect and domain', () => {
  const prospect = normalizeProspect({ name: ' Ada   Lovelace ', domain: 'HTTPS://Example.COM/team' });
  assert.equal(prospect.name, 'Ada Lovelace');
  assert.equal(prospect.firstName, 'ada');
  assert.equal(prospect.domain, 'example.com');
});
test('rejects malformed domains', () => assert.throws(() => normalizeProspect({ name: 'Ada', domain: 'not a domain' })));
test('hostname limiter blocks immediate repeat', () => { const limits = new Map(); assert.equal(policyAllows('example.com', limits), true); assert.equal(policyAllows('example.com', limits), false); });
test('retains recruiter-provided business contact fields', () => {
  const prospect = normalizeProspect({ name: 'Ada Lovelace', email: 'ada@example.com', businessPhone: '+1 555 0100' });
  assert.equal(prospect.importedEmail, 'ada@example.com');
  assert.equal(prospect.importedPhone, '+1 555 0100');
});
test('returns imported contacts and never relabels them as verified', async () => {
  const results = await enrich(normalizeProspect({ name: 'Ada Lovelace', importedEmail: 'ada@example.com' }), new Map());
  assert.equal(results[0].status, 'recruiter_imported');
  assert.equal(results[0].value, 'ada@example.com');
});
