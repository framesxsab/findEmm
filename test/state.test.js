const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecord, canContact, draftableEmail, confirmContact, upsertRecord, matchesProspect, purgeProspect, recommendRelated, workspaceRecords, queueDraft, toCsv, createHandoff, openHandoff, mergeImportedRecords } = require('../extension/state');

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

test('blocks outreach for do-not-contact records', () => {
  assert.equal(canContact({ list: 'Do not contact' }), false);
  assert.equal(canContact({ list: 'Follow up', suppressed: true }), false);
  assert.equal(canContact({ list: 'Follow up' }), true);
});

test('keeps provider, imported, and shared email claims non-draftable', () => {
  const company = { value: 'talent@example.com', contactType: 'work_email', contactScope: 'company', status: 'publicly_found' };
  const provider = { value: 'provider@example.com', contactType: 'work_email', contactScope: 'person_attributed', status: 'provider_valid' };
  const imported = { value: 'imported@example.com', contactType: 'work_email', contactScope: 'person_claimed', status: 'recruiter_imported' };
  const shared = { value: 'shared@example.com', contactType: 'work_email', contactScope: 'person_candidate', status: 'shared_candidate' };
  assert.equal(draftableEmail({ contacts: [company, provider, imported, shared] }), undefined);
});

test('makes only a recruiter-confirmed person email draftable', () => {
  const provider = { id: 'provider-email', value: 'asha@example.com', contactType: 'work_email', contactScope: 'person_attributed', status: 'provider_valid', statusLabel: 'Provider-attributed deliverable', reason: 'Mailbox deliverable' };
  const phone = { id: 'phone', value: '+91 55555 0100', contactType: 'business_phone', contactScope: 'person_attributed', status: 'provider_valid' };
  const record = { ...createRecord({ name: 'Asha Rao', company: 'Example' }, [provider, phone]), saved: true };
  const confirmed = confirmContact(record, 'provider-email', '2026-07-17T10:00:00.000Z');
  assert.equal(draftableEmail(confirmed)?.value, 'asha@example.com');
  assert.equal(confirmed.contacts[0].status, 'user_confirmed');
  assert.equal(confirmed.contacts[0].contactScope, 'person_confirmed');
  assert.equal(confirmed.contacts[0].originStatus, 'provider_valid');
  assert.equal(confirmed.contacts[0].confirmedAt, '2026-07-17T10:00:00.000Z');
  assert.equal(confirmed.contacts[1], phone);
});

test('recommends relevant saved recruiters and excludes do-not-contact records', () => {
  const current = createRecord({ name: 'Asha Rao', company: 'Example', domain: 'example.com', title: 'Campus Hiring Manager' }, []);
  const recruiter = { ...createRecord({ name: 'Dev Shah', company: 'Example', domain: 'example.com', title: 'Senior Talent Recruiter' }, []), saved: true };
  const suppressed = { ...createRecord({ name: 'Mira Sen', company: 'Example', domain: 'example.com', title: 'Talent Lead' }, []), saved: true, list: 'Do not contact' };
  const unrelated = { ...createRecord({ name: 'Lee Chen', company: 'Elsewhere', domain: 'elsewhere.com', title: 'Engineer' }, []), saved: true };
  const matches = recommendRelated(current, [recruiter, suppressed, unrelated]);
  assert.deepEqual(matches.map(({ record }) => record.prospect.name), ['Dev Shah']);
  assert.match(matches[0].reason, /same company/);
  assert.match(matches[0].reason, /recruiting role/);
});

test('does not recommend the current saved record when it has no deduplication key', () => {
  const current = { ...createRecord({ name: 'Asha Rao', title: 'Talent Recruiter' }, []), saved: true };
  assert.deepEqual(recommendRelated(current, [current]), []);
});

test('recommends a possible successor at the current person\'s former company', () => {
  const moved = { ...createRecord({ name: 'Asha Rao', company: 'New Co', domain: 'new.example', title: 'Campus Hiring Manager' }, []), employmentHistory: [{ company: 'Example', domain: 'example.com', title: 'Campus Hiring Manager', detectedAt: '2026-07-01T00:00:00.000Z' }] };
  const successor = { ...createRecord({ name: 'Dev Shah', company: 'Example', domain: 'example.com', title: 'Campus Hiring Manager' }, []), saved: true };
  const engineer = { ...createRecord({ name: 'Mira Sen', company: 'Example', domain: 'example.com', title: 'Software Engineer' }, []), saved: true };
  const matches = recommendRelated(moved, [successor, engineer]);
  assert.equal(matches[0].record, successor);
  assert.match(matches[0].reason, /possible successor at former company/);
  assert.equal(matches.some(({ record }) => record === engineer), false);
});

test('summarizes, filters, and searches the saved recruiter workspace', () => {
  const followUp = { ...createRecord({ name: 'Asha Rao', company: 'Example', title: 'Campus Talent Lead' }, []), saved: true, list: 'Follow up', sequence: [{ status: 'queued' }], employmentHistory: [{ company: 'Old Co' }], updatedAt: '2026-07-17T10:00:00.000Z' };
  const saved = { ...createRecord({ name: 'Dev Shah', company: 'Another', title: 'Recruiter' }, []), saved: true, updatedAt: '2026-07-16T10:00:00.000Z' };
  const blocked = { ...createRecord({ name: 'Mira Sen', company: 'Example', title: 'HR Manager' }, []), saved: true, list: 'Do not contact' };
  const unsaved = createRecord({ name: 'Hidden Person', company: 'Example' }, []);
  const workspace = workspaceRecords([followUp, saved, blocked, unsaved]);
  assert.deepEqual(workspace.counts, { total: 3, active: 2, saved: 1, followUp: 1, doNotContact: 1, queued: 1, roleChanges: 1 });
  assert.deepEqual(workspace.records.map(({ prospect }) => prospect.name), ['Asha Rao', 'Dev Shah']);
  assert.deepEqual(workspaceRecords([followUp, saved, blocked], 'talent', 'All').records, [followUp]);
  assert.deepEqual(workspaceRecords([followUp, saved, blocked], '', 'Do not contact').records, [blocked]);
});

test('purges every local record matching a person without touching others', () => {
  const exact = { ...createRecord({ name: 'Asha Rao', company: 'Example', profileUrl: 'https://www.linkedin.com/in/asha/' }, []), saved: true };
  const duplicate = { ...createRecord({ name: 'Asha Rao', company: 'Example', profileUrl: 'https://linkedin.com/in/asha?trk=profile' }, []), saved: true };
  const unrelated = { ...createRecord({ name: 'Dev Shah', company: 'Example', profileUrl: 'https://linkedin.com/in/dev' }, []), saved: true };
  const purged = purgeProspect([exact, duplicate, unrelated], exact.prospect);
  assert.equal(purged.removed, 2);
  assert.deepEqual(purged.records, [unrelated]);
  const companyOnly = { ...createRecord({ name: 'Asha Rao', company: 'Example' }, []), saved: true };
  const incoming = { name: 'Asha Rao', company: 'Example', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha' };
  assert.equal(matchesProspect(companyOnly.prospect, incoming), true);
  assert.equal(purgeProspect([companyOnly, unrelated], incoming).removed, 1);
  assert.equal(matchesProspect({ name: 'Alex Lee', company: 'Example', profileUrl: 'https://linkedin.com/in/alex-one' }, { name: 'Alex Lee', company: 'Example', profileUrl: 'https://linkedin.com/in/alex-two' }), false);
});

test('merges repeat profile saves and records employment changes without losing local context', () => {
  const existing = { ...createRecord({ name: 'Asha Rao', company: 'Example', title: 'Talent Recruiter', profileUrl: 'https://www.linkedin.com/in/asha/' }, [{ id: 'old', value: 'asha@example.com' }]), saved: true, list: 'Follow up', note: 'Campus lead' };
  const repeat = { ...createRecord({ name: 'Asha Rao', company: 'Example', title: 'Senior Campus Recruiter', profileUrl: 'https://linkedin.com/in/asha?trk=profile' }, [{ id: 'new', value: '+91 55555 0100' }]), saved: true };
  const saved = upsertRecord([existing], repeat);
  assert.equal(saved.deduplicated, true);
  assert.equal(saved.records.length, 1);
  assert.equal(saved.record.id, existing.id);
  assert.equal(saved.record.list, 'Follow up');
  assert.equal(saved.record.note, 'Campus lead');
  assert.deepEqual(saved.record.contacts.map(({ id }) => id), ['new', 'old']);
  assert.equal(saved.changeDetected, true);
  assert.equal(saved.record.employmentHistory[0].title, 'Talent Recruiter');
});

test('provider suppression clears previously saved contact data', () => {
  const existing = { ...createRecord({ name: 'Asha Rao', company: 'Example', profileUrl: 'https://linkedin.com/in/asha', importedEmail: 'asha@example.com' }, [{ id: 'old', value: 'asha@example.com' }]), saved: true };
  const suppression = { ...createRecord({ name: 'Asha Rao', company: 'Example', profileUrl: 'https://linkedin.com/in/asha', importedEmail: '' }, []), saved: true, suppressed: true, list: 'Do not contact' };
  const saved = upsertRecord([existing], suppression);
  assert.deepEqual(saved.record.contacts, []);
  assert.equal(saved.record.prospect.importedEmail, '');
  assert.equal(canContact(saved.record), false);
});

test('exports contact provenance to CSV', () => {
  const record = createRecord({ name: '=WEBSERVICE("https://example.test")', company: 'Example', title: 'Engineer' }, [{ value: 'ada@example.com', contactType: 'work_email', status: 'publicly_found', confidence: 85, sourceUrl: 'https://example.com/contact', retrievedAt: '2026-07-15T00:00:00.000Z' }]);
  const csv = toCsv(record);
  assert.match(csv, /source_url/);
  assert.match(csv, /evidence_snippet/);
  assert.match(csv, /ada@example.com/);
  assert.match(csv, /publicly_found/);
  assert.match(csv, /"'=WEBSERVICE\(""https:\/\/example\.test""\)"/);
});

test('seals and opens a vault payload with AES-GCM', async () => {
  const salt = FindEmmState.newSalt();
  const sealed = await FindEmmState.seal({ token: 'local-token', records: [{ id: '1' }] }, 'a long passphrase', salt);
  assert.notEqual(sealed.cipher, 'local-token');
  assert.deepEqual(await FindEmmState.open(sealed, 'a long passphrase', salt), { token: 'local-token', records: [{ id: '1' }] });
  await assert.rejects(() => FindEmmState.open(sealed, 'wrong passphrase', salt));
});

test('exports an encrypted list and sanitizes imported records', async () => {
  const record = { ...createRecord({ name: 'Asha Rao', company: 'Example', profileUrl: 'https://linkedin.com/in/asha' }, [{ id: 'contact-id', value: 'asha@example.com', contactType: 'work_email', contactScope: 'person_verified', status: 'provider_verified', statusLabel: 'Provider verified', confidence: 95, reason: 'Verified', sourceUrl: 'javascript:alert(1)', retrievedAt: '2026-07-17T00:00:00.000Z' }]), id: 'local-id', saved: true, list: 'Follow up', note: 'Campus lead', sequence: [{ id: 'queued-draft-id', kind: 'draft_outreach', status: 'queued' }] };
  const bundle = await createHandoff([record], 'separate share passphrase', 'Follow up');
  assert.equal(bundle.count, 1);
  assert.doesNotMatch(bundle.text, /asha@example\.com|Campus lead|local-id|queued-draft-id/);
  const opened = await openHandoff(bundle.text, 'separate share passphrase');
  assert.equal(opened.records[0].prospect.name, 'Asha Rao');
  assert.equal(opened.records[0].contacts[0].sourceUrl, '');
  assert.equal(opened.records[0].contacts[0].status, 'shared_candidate');
  assert.equal(draftableEmail(opened.records[0]), undefined);
  assert.equal(opened.records[0].note, '');
  assert.deepEqual(opened.records[0].sequence, []);
  assert.notEqual(opened.records[0].id, 'local-id');
  await assert.rejects(() => openHandoff(bundle.text, 'wrong passphrase value'));
});

test('handoff rejects invalid dates instead of replacing them with the current time', async () => {
  const record = { ...createRecord({ name: 'Asha Rao', company: 'Example' }, [{ id: 'email', value: 'asha@example.com', contactType: 'work_email', contactScope: 'person_attributed', status: 'provider_valid', verifiedAt: 'not-a-date', retrievedAt: 'also-not-a-date' }]), saved: true, list: 'Follow up', createdAt: 'bad-created', updatedAt: 'bad-updated', employmentHistory: [{ company: 'Old Co', detectedAt: 'bad-detected' }] };
  const opened = await openHandoff((await createHandoff([record], 'separate share passphrase', 'Follow up')).text, 'separate share passphrase');
  assert.equal(opened.records[0].createdAt, '');
  assert.equal(opened.records[0].updatedAt, '');
  assert.equal(opened.records[0].contacts[0].verifiedAt, '');
  assert.equal(opened.records[0].contacts[0].retrievedAt, '');
  assert.equal(opened.records[0].employmentHistory[0].detectedAt, '');
});

test('handoff exports only the selected list and no unrelated opt-out identities', async () => {
  const selected = { ...createRecord({ name: 'Asha Rao', company: 'Example' }, []), saved: true, list: 'Follow up' };
  const optOut = { ...createRecord({ name: 'Private Opt Out', company: 'Elsewhere' }, []), saved: true, suppressed: true, list: 'Do not contact' };
  const handoff = await createHandoff([selected, optOut], 'separate share passphrase', 'Follow up');
  assert.equal(handoff.count, 1);
  assert.equal(handoff.safeguards, 0);
  assert.doesNotMatch(handoff.text, /Private Opt Out|Elsewhere/);
  const opened = await openHandoff(handoff.text, 'separate share passphrase');
  assert.equal(opened.selectedCount, 1);
  assert.equal(opened.safeguardCount, 0);
  assert.deepEqual(opened.records.map(({ prospect }) => prospect.name), ['Asha Rao']);
});

test('handoff exports are nondeterministic and reject version or cipher tampering', async () => {
  const record = { ...createRecord({ name: 'Asha Rao', company: 'Example' }, []), saved: true, list: 'Follow up' };
  const first = JSON.parse((await createHandoff([record], 'separate share passphrase', 'Follow up')).text);
  const second = JSON.parse((await createHandoff([record], 'separate share passphrase', 'Follow up')).text);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.sealed.iv, second.sealed.iv);
  assert.notEqual(first.sealed.cipher, second.sealed.cipher);
  await assert.rejects(() => openHandoff(JSON.stringify({ ...first, version: 2 }), 'separate share passphrase'), /Unsupported handoff format/);
  const cipher = first.sealed.cipher;
  const tampered = { ...first, sealed: { ...first.sealed, cipher: `${cipher[0] === 'A' ? 'B' : 'A'}${cipher.slice(1)}` } };
  await assert.rejects(() => openHandoff(JSON.stringify(tampered), 'separate share passphrase'));
});

test('handoff export rejects a UTF-8 envelope larger than the import limit', async () => {
  const contacts = Array.from({ length: 100 }, (_, index) => ({ value: `person${index}@example.com`, contactType: 'work_email', status: 'provider_valid', reason: 'r'.repeat(1000), evidenceSnippet: 'e'.repeat(1000) }));
  const records = Array.from({ length: 25 }, (_, index) => ({ ...createRecord({ name: `Person ${index}`, company: 'Example' }, contacts), saved: true, list: 'Follow up' }));
  await assert.rejects(() => createHandoff(records, 'separate share passphrase', 'Follow up'), /Handoff file exceeds 5 MB/);
});

test('handoff import sanitizes records and regenerates colliding external ids', () => {
  const local = { ...createRecord({ name: 'Local Recruiter', company: 'Local Co', profileUrl: 'https://linkedin.com/in/local' }, []), id: 'collision-id', saved: true };
  const shared = { ...createRecord({ name: 'Shared Recruiter', company: 'Shared Co', profileUrl: 'https://linkedin.com/in/shared', importedEmail: '=not-an-email' }, [{ id: 'bad-contact', value: '=cmd', contactType: 'work_email', status: 'recruiter_imported' }]), id: 'collision-id', saved: true, list: 'Follow up', note: 'Must not cross devices', sequence: [{ id: 'queued-draft' }] };
  const merged = mergeImportedRecords([local], [shared]);
  const imported = merged.records.find(({ prospect }) => prospect.name === 'Shared Recruiter');
  assert.notEqual(imported.id, 'collision-id');
  assert.equal(imported.note, '');
  assert.deepEqual(imported.sequence, []);
  assert.equal(imported.prospect.importedEmail, '');
  assert.deepEqual(imported.contacts, []);
  assert.equal(merged.records.length, 2);
  assert.equal(merged.records.find(({ id }) => id === 'collision-id').prospect.name, 'Local Recruiter');
});

test('team import deduplicates matching shared candidates independent of external ids', () => {
  const localDetails = { contactType: 'work_email', contactScope: 'person_candidate', status: 'shared_candidate', confidence: 95, sourceUrl: 'https://example.com/team' };
  const sharedDetails = { contactType: 'work_email', contactScope: 'person_attributed', status: 'provider_valid', confidence: 95, sourceUrl: 'https://example.com/team' };
  const local = { ...createRecord({ name: 'Asha Rao', company: 'Example', profileUrl: 'https://linkedin.com/in/asha' }, [{ ...localDetails, id: 'local-contact', value: 'asha@example.com' }]), saved: true };
  const shared = { ...createRecord({ name: 'Asha Rao', company: 'Example', profileUrl: 'https://linkedin.com/in/asha' }, [{ ...sharedDetails, id: 'external-contact', value: 'ASHA@example.com' }]), saved: true };
  const merged = mergeImportedRecords([local], [shared]);
  assert.equal(merged.records[0].contacts.length, 1);
  assert.equal(merged.records[0].contacts[0].value, 'ASHA@example.com');
  assert.equal(merged.records[0].contacts[0].status, 'shared_candidate');
  assert.equal(draftableEmail(merged.records[0]), undefined);
});

test('team import deduplicates people and keeps local do-not-contact state', () => {
  const local = { ...createRecord({ name: 'Asha Rao', company: 'Example', profileUrl: 'https://linkedin.com/in/asha', importedEmail: 'old@example.com', importedPhone: '+91 55555 0100' }, [{ id: 'old-contact', value: 'old@example.com' }]), saved: true, suppressed: true, list: 'Do not contact', sequence: [{ id: 'old-draft', status: 'queued' }] };
  const shared = { ...createRecord({ name: 'Asha Rao', company: 'Example', profileUrl: 'https://linkedin.com/in/asha', importedEmail: 'new@example.com' }, [{ id: 'new-contact', value: 'new@example.com' }]), saved: true, list: 'Follow up', sequence: [{ id: 'new-draft', status: 'queued' }] };
  const merged = mergeImportedRecords([local], [shared]);
  assert.equal(merged.records.length, 1);
  assert.equal(merged.deduplicated, 1);
  assert.equal(merged.records[0].list, 'Do not contact');
  assert.equal(merged.records[0].suppressed, true);
  assert.deepEqual(merged.records[0].contacts, []);
  assert.deepEqual(merged.records[0].sequence, []);
  assert.equal(merged.records[0].prospect.importedEmail, '');
  assert.equal(merged.records[0].prospect.importedPhone, '');
  assert.equal(canContact(merged.records[0]), false);
});

test('team import reports ambiguous name and company matches as conflicts', () => {
  const local = { ...createRecord({ name: 'Asha Rao', company: 'Example' }, []), saved: true, note: 'Keep local' };
  const shared = { ...createRecord({ name: 'Asha Rao', company: 'Example' }, []), saved: true, note: 'Shared value' };
  const merged = mergeImportedRecords([local], [shared]);
  assert.equal(merged.conflicts, 1);
  assert.equal(merged.imported, 0);
  assert.deepEqual(merged.records, [local]);
});

test('team import cannot bypass do-not-contact when only one side has a domain', () => {
  const local = { ...createRecord({ name: 'Asha Rao', company: 'Example', domain: 'example.com' }, []), saved: true, suppressed: true, list: 'Do not contact' };
  const shared = { ...createRecord({ name: 'Asha Rao', company: 'Example' }, [{ id: 'shared-email', value: 'asha@example.com', contactType: 'work_email', status: 'shared_candidate' }]), saved: true, list: 'Follow up' };
  const merged = mergeImportedRecords([local], [shared]);
  assert.equal(merged.conflicts, 1);
  assert.equal(merged.imported, 0);
  assert.deepEqual(merged.records, [local]);
  assert.equal(canContact(merged.records[0]), false);
});

test('team import preview does not mutate current records', () => {
  const local = { ...createRecord({ name: 'Asha Rao', company: 'Example', title: 'Recruiter', profileUrl: 'https://linkedin.com/in/asha' }, []), saved: true, note: 'Keep local' };
  const shared = { ...createRecord({ name: 'Asha Rao', company: 'Example', title: 'Campus Recruiter', profileUrl: 'https://linkedin.com/in/asha' }, []), saved: true };
  const current = [local];
  const before = structuredClone(current);
  const preview = mergeImportedRecords(current, [shared]);
  assert.deepEqual(current, before);
  assert.equal(preview.records[0].prospect.title, 'Campus Recruiter');
});
