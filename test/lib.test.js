const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { normalizeProspect, extractCompanyContacts, originAllowed, policyAllows, readBody, readLimitedText, robotsPermits, enrich, enrichBatch, screenImportedProspects, rejectSuppressedProspects, withSuppressionRecheck } = require('../server/lib');

function textResponse(body, status = 200, contentType = 'text/plain', length = Buffer.byteLength(body)) {
  return { status, headers: { get: (name) => name.toLowerCase() === 'content-length' ? length : name.toLowerCase() === 'content-type' ? contentType : null }, text: async () => body };
}

test('normalizes a valid prospect and domain', () => {
  const prospect = normalizeProspect({ name: ' Ada   Lovelace ', domain: 'HTTPS://Example.COM/team' });
  assert.equal(prospect.name, 'Ada Lovelace');
  assert.equal(prospect.firstName, 'ada');
  assert.equal(prospect.domain, 'example.com');
});
test('rejects malformed domains', () => assert.throws(() => normalizeProspect({ name: 'Ada', domain: 'not a domain' })));
test('hostname limiter blocks immediate repeat', () => { const limits = new Map(); assert.equal(policyAllows('example.com', limits), true); assert.equal(policyAllows('example.com', limits), false); });
test('loopback API accepts Chrome extensions and rejects webpage origins', () => {
  assert.equal(originAllowed(''), true);
  assert.equal(originAllowed('chrome-extension://abcdefghijklmnopabcdefghijklmnop'), true);
  assert.equal(originAllowed('https://example.com'), false);
});
test('retains recruiter-provided business contact fields', () => {
  const prospect = normalizeProspect({ name: 'Ada Lovelace', email: 'ada@example.com', businessPhone: '+1 555 0100' });
  assert.equal(prospect.importedEmail, 'ada@example.com');
  assert.equal(prospect.importedPhone, '+1 555 0100');
});
test('decodes request JSON only after joining split UTF-8 bytes', async () => {
  const encoded = Buffer.from(JSON.stringify({ name: 'José Rao' }));
  const character = Buffer.from('é');
  const index = encoded.indexOf(character);
  const request = Readable.from([encoded.subarray(0, index + 1), encoded.subarray(index + 1)]);
  assert.deepEqual(await readBody(request), { name: 'José Rao' });
});
test('returns imported contacts and never relabels them as verified', async () => {
  const results = await enrich(normalizeProspect({ name: 'Ada Lovelace', importedEmail: 'ada@example.com' }), new Map());
  assert.equal(results[0].status, 'recruiter_imported');
  assert.equal(results[0].value, 'ada@example.com');
});
test('does not generate person email guesses from a name and domain', async () => {
  const results = await enrich(normalizeProspect({ name: 'Ada Lovelace', domain: 'example.com' }), new Map());
  assert.deepEqual(results, []);
});
test('validates every batch prospect before starting enrichment', async () => {
  let lookups = 0;
  const provider = { lookup: async () => { lookups += 1; return { contacts: [] }; } };
  await assert.rejects(() => enrichBatch([{ name: 'Ada Lovelace', domain: 'example.com' }, { name: '', domain: 'example.com' }], new Map(), provider), /Name is required/);
  assert.equal(lookups, 0);
});
test('screens imported identities locally and reports which durable alias matched', () => {
  const matched = new Set(['person:asha|rao|example.com']);
  const store = { has() { throw new Error('single lookup not expected'); }, hasMany(keys) { return keys.map((key) => matched.has(key)); } };
  assert.deepEqual(screenImportedProspects([{ name: 'Asha Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha' }, { name: 'Dev Shah', domain: 'example.com' }], store), [
    { index: 0, checkable: true, suppressed: true, matchedLinkedIn: false, matchedPerson: true, blockedDomain: false },
    { index: 1, checkable: true, suppressed: false, matchedLinkedIn: false, matchedPerson: false, blockedDomain: false }
  ]);
  assert.deepEqual(screenImportedProspects([{ name: 'Asha Rao', profileUrl: 'https://linkedin.com/in/asha' }, { name: 'Single', importedEmail: 'single@example.com' }], store), [
    { index: 0, checkable: true, suppressed: false, matchedLinkedIn: false, matchedPerson: false, blockedDomain: false },
    { index: 1, checkable: false, suppressed: false, matchedLinkedIn: false, matchedPerson: false, blockedDomain: false }
  ]);
  assert.throws(() => screenImportedProspects([], store), /1–1,000/);
});
test('rejects a durable opt-out before disabled-provider research can return recruiter input', () => {
  const store = { hasMany(keys) { return keys.map((key) => key === 'person:asha|rao|example.com'); }, has() { return false; } };
  assert.throws(() => rejectSuppressedProspects([{ name: 'Asha Rao', domain: 'example.com', importedEmail: 'asha@example.com' }], store), (error) => error.statusCode === 451 && error.code === 'provider_opt_out');
});
test('requires a durable suppression alias before releasing imported contact data', async () => {
  let enrichments = 0;
  const store = { has() { return false; }, hasMany(keys) { return keys.map(() => false); } };
  await assert.rejects(
    () => withSuppressionRecheck([{ name: 'Single', importedEmail: 'single@example.com' }], store, async () => {
      enrichments += 1;
      return [{ value: 'single@example.com' }];
    }),
    (error) => error.statusCode === 422 && error.code === 'suppression_alias_required'
  );
  assert.equal(enrichments, 0);
});
test('rechecks imported contact aliases after asynchronous enrichment', async () => {
  const prospect = { name: 'Single' };
  const store = { has() { return false; }, hasMany(keys) { return keys.map(() => false); } };
  await assert.rejects(
    () => withSuppressionRecheck([prospect], store, async () => {
      await Promise.resolve();
      prospect.importedPhone = '+1 555 0100';
      return [{ value: prospect.importedPhone }];
    }),
    (error) => error.statusCode === 422 && error.code === 'suppression_alias_required'
  );
});
test('rechecks durable opt-outs after asynchronous enrichment before releasing results', async () => {
  let scans = 0;
  let enrichments = 0;
  const store = {
    has() { return false; },
    hasMany(keys) {
      scans += 1;
      return keys.map((key) => scans === 2 && key === 'person:asha|rao|example.com');
    }
  };
  await assert.rejects(
    () => withSuppressionRecheck([{ name: 'Asha Rao', domain: 'example.com' }], store, async () => {
      enrichments += 1;
      await Promise.resolve();
      return [{ value: 'asha@example.com' }];
    }),
    (error) => error.statusCode === 451 && error.code === 'provider_opt_out'
  );
  assert.equal(enrichments, 1);
  assert.equal(scans, 2);
});
test('maps only fresh dated provider validity without claiming person ownership', async () => {
  const now = Date.parse('2026-07-17T00:00:00.000Z');
  const provider = { lookup: async () => ({ contacts: [{ email: 'asha@example.com', score: 92, verificationStatus: 'valid', verificationDate: '2026-07-01T00:00:00.000Z', sourceUrl: 'https://example.com/team', evidenceSnippet: 'Hunter source last seen 2026-07-01; mailbox status valid.' }] }) };
  const results = await enrich(normalizeProspect({ name: 'Asha Rao', domain: 'example.com' }), new Map(), provider, { now: () => now });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'provider_valid');
  assert.equal(results[0].contactScope, 'person_candidate');
  assert.equal(results[0].provider, 'hunter');
  assert.equal(results[0].verifiedAt, '2026-07-01T00:00:00.000Z');
  assert.match(results[0].reason, /does not prove ownership/);
});
test('keeps stale or undated provider results explicitly unverified', async () => {
  const now = Date.parse('2026-07-17T00:00:00.000Z');
  const provider = { lookup: async () => ({ contacts: [
    { email: 'stale@example.com', score: 80, verificationStatus: 'valid', verificationDate: '2026-01-01T00:00:00.000Z' },
    { email: 'undated@example.com', score: 80, verificationStatus: 'valid' }
  ] }) };
  const results = await enrich(normalizeProspect({ name: 'Asha Rao', domain: 'example.com' }), new Map(), provider, { now: () => now });
  assert.deepEqual(results.map((result) => result.status), ['provider_unverified', 'provider_unverified']);
  assert.ok(results.every((result) => result.contactScope === 'person_candidate'));
  assert.equal(results[0].verifiedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(results[1].verifiedAt, '');
});
test('turns provider opt-outs into a durable suppression response', async () => {
  const provider = { lookup: async () => ({ contacts: [], suppressed: true }) };
  await assert.rejects(() => enrich(normalizeProspect({ name: 'Asha Rao', domain: 'example.com' }), new Map(), provider), (error) => error.statusCode === 451 && error.code === 'provider_opt_out');
});
test('retains company-contact scope and source evidence without claiming person ownership', () => {
  const results = extractCompanyContacts('<p>Campus recruiting desk: talent@example.com or +91 55555 0100</p>', 'example.com', 'https://example.com/contact');
  assert.equal(results.length, 2);
  assert.ok(results.every((result) => result.contactScope === 'company'));
  assert.ok(results.every((result) => result.evidenceSnippet.includes('Campus recruiting desk')));
  assert.match(results[0].reason, /not verified as belonging to the selected person/);
});

test('robots rules prefer the named agent and longest matching path', () => {
  const rules = 'User-agent: *\nDisallow: /\n\nUser-agent: findemm\nDisallow: /private\nAllow: /private/public$';
  assert.equal(robotsPermits(rules, '/private/file'), false);
  assert.equal(robotsPermits(rules, '/private/public'), true);
  assert.equal(robotsPermits(rules, '/private/public/more'), false);
  assert.equal(robotsPermits('User-agent: *\nDisallow: /hidden', '/hidden/page'), false);
});

test('limited reader rejects declared, streamed, and truncated oversize bodies', async () => {
  await assert.rejects(() => readLimitedText({ headers: { get: () => '7' }, text: async () => 'ignored' }, 6), /size limit/);
  const chunks = [new TextEncoder().encode('abcd'), new TextEncoder().encode('efgh')];
  let cancelled = false;
  const response = { headers: { get: () => null }, body: { getReader: () => ({ read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true }, cancel: async () => { cancelled = true; } }) } };
  await assert.rejects(() => readLimitedText(response, 6), /size limit/);
  assert.equal(cancelled, true);
  await assert.rejects(() => readLimitedText(textResponse('abc', 200, 'text/plain', 4), 6), /truncated/);
});

test('company lookup stays off without approval or an exact allowlist match', async () => {
  const prospect = normalizeProspect({ name: 'Ada Lovelace', domain: 'example.com' });
  let lookups = 0;
  const lookup = async () => { lookups += 1; return [{ address: '93.184.216.34', family: 4 }]; };
  assert.deepEqual(await enrich(prospect, new Map(), null, { companyPages: { enabled: false, allowedDomains: new Set(['example.com']), lookup } }), []);
  assert.deepEqual(await enrich(prospect, new Map(), null, { companyPages: { enabled: true, allowedDomains: new Set(['other.example']), lookup } }), []);
  assert.equal(lookups, 0);
});

test('company lookup rejects private, reserved, or mixed DNS answers before HTTP', async () => {
  const prospect = normalizeProspect({ name: 'Ada Lovelace', domain: 'example.com' });
  const answers = [
    [{ address: '127.0.0.1', family: 4 }],
    [{ address: '192.0.2.1', family: 4 }],
    [{ address: 'fc00::1', family: 6 }],
    [{ address: '2001:db8::1', family: 6 }],
    [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]
  ];
  let requests = 0;
  for (const records of answers) {
    const companyPages = { enabled: true, allowedDomains: new Set(['example.com']), lookup: async () => records, request: async () => { requests += 1; return textResponse(''); } };
    assert.deepEqual(await enrich(prospect, new Map(), null, { companyPages }), []);
  }
  assert.equal(requests, 0);
});

test('company workflows pin public DNS and serialize every request start by host', async () => {
  const prospect = normalizeProspect({ name: 'Ada Lovelace', domain: 'example.com' });
  const limits = new Map();
  const starts = [];
  let clock = 0;
  const companyPages = {
    enabled: true,
    allowedDomains: new Set(['example.com']),
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    request: async (details) => {
      starts.push({ at: clock, ...details });
      return details.pathname === '/robots.txt' ? textResponse('User-agent: *\nAllow: /contact') : textResponse('<p>Campus desk: talent@example.com</p>', 200, 'text/html; charset=utf-8');
    }
  };
  const results = await Promise.all([enrich(prospect, limits, null, { companyPages }), enrich(prospect, limits, null, { companyPages })]);
  assert.ok(results.every((result) => result[0]?.value === 'talent@example.com'));
  assert.deepEqual(starts.map((start) => start.pathname), ['/robots.txt', '/contact', '/robots.txt', '/contact']);
  assert.deepEqual(starts.map((start) => start.at), [0, 1000, 2000, 3000]);
  assert.ok(starts.every((start) => start.host === 'example.com' && start.address === '93.184.216.34' && start.family === 4));
});

test('robots redirect, overflow, or truncation fails closed before contact fetch', async () => {
  const prospect = normalizeProspect({ name: 'Ada Lovelace', domain: 'example.com' });
  const overflow = () => { let sent = false; return { status: 200, headers: { get: () => null }, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(100_001) }), cancel: async () => {} }) } }; };
  const cases = [() => textResponse('', 302), overflow, () => textResponse('abc', 200, 'text/plain', 4)];
  for (const makeResponse of cases) {
    const paths = [];
    const companyPages = { enabled: true, allowedDomains: new Set(['example.com']), lookup: async () => [{ address: '93.184.216.34', family: 4 }], request: async ({ pathname }) => { paths.push(pathname); return makeResponse(); } };
    assert.deepEqual(await enrich(prospect, new Map(), null, { companyPages }), []);
    assert.deepEqual(paths, ['/robots.txt']);
  }
});
