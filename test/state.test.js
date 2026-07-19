const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecord, canContact, draftableEmail, confirmContact, upsertRecord, matchesProspect, hasDurableSuppressionAlias, normalizeResearchProspect, purgeProspect, purgeSuppressedProspects, recommendRelated, workspaceRecords, queueDraft, toCsv, parseRecruiterCsv, mergeRecruiterImport, createHandoff, openHandoff, mergeImportedRecords } = require('../extension/state');

test('creates a local record with no implicit send state', () => {
  const record = createRecord({ name: 'Ada Lovelace', company: 'Example' }, []);
  assert.equal(record.saved, false);
  assert.deepEqual(record.sequence, []);
  assert.equal(record.list, 'Saved prospects');
});

test('normalizes the client Research identity before suppression screening', () => {
  const normalized = normalizeResearchProspect({ name: '  Asha   Priya Rao  ', company: '  Example   Inc  ', title: ' Talent\n Lead ', domain: 'HTTPS://Example.COM/team', profileUrl: ' https://linkedin.com/in/asha ', importedEmail: ' asha@example.com ', importedPhone: ' +91 55555 0100 ' });
  assert.deepEqual(normalized, { name: 'Asha Priya Rao', firstName: 'asha', lastName: 'rao', company: 'Example Inc', title: 'Talent Lead', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha', importedEmail: 'asha@example.com', importedPhone: '+91 55555 0100' });
  assert.equal(hasDurableSuppressionAlias(normalized), true);
  const domainless = normalizeResearchProspect({ name: 'Asha Rao' });
  assert.equal(domainless.domain, '');
  assert.equal(hasDurableSuppressionAlias(domainless), false);
  assert.equal(normalizeResearchProspect({ name: 'Asha Rao', domain: 'https://' }).domain, '');
  assert.throws(() => normalizeResearchProspect({ name: 'Asha Rao', domain: 'not a domain' }), /valid hostname/);
  assert.throws(() => normalizeResearchProspect({ name: 'Asha Rao', importedEmail: 'not-an-email' }), /Work email must be valid/);
  assert.throws(() => normalizeResearchProspect({ name: '   ' }), /Name is required/);
});

test('detects only identities the durable suppression screen can check', () => {
  assert.equal(hasDurableSuppressionAlias({ name: 'Asha Rao', domain: 'HTTPS://Example.COM/team' }), true);
  assert.equal(hasDurableSuppressionAlias({ name: 'Asha', profileUrl: 'https://www.linkedin.com/in/Asha-Rao/' }), true);
  assert.equal(hasDurableSuppressionAlias({ name: 'Asha', domain: 'example.com' }), false);
  assert.equal(hasDurableSuppressionAlias({ name: 'Asha Rao', domain: 'not a domain' }), false);
  assert.equal(hasDurableSuppressionAlias({ name: 'Asha Rao', profileUrl: 'https://linkedin.com/company/example' }), false);
  assert.equal(hasDurableSuppressionAlias({ name: 'Asha Rao', profileUrl: 'https://linkedin.com/in/asha%2Frao' }), false);
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

test('ordinary saves fail closed on first-last-domain DNC aliases in both directions', () => {
  const localDnc = { ...createRecord({ name: 'Asha Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha-one', importedEmail: 'old@example.com' }, [{ id: 'old', value: 'old@example.com' }]), saved: true, list: 'Do not contact', sequence: [{ status: 'queued' }] };
  const activeVariant = { ...createRecord({ name: 'Asha Priya Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha-two', importedEmail: 'new@example.com' }, [{ id: 'new', value: 'new@example.com' }]), saved: true, list: 'Follow up' };
  const blocked = upsertRecord([localDnc], activeVariant);
  assert.equal(blocked.suppressionAliasMatched, true);
  assert.equal(blocked.records.length, 1);
  assert.equal(blocked.record.id, localDnc.id);
  assert.equal(blocked.record.prospect.name, 'Asha Rao');
  assert.equal(blocked.record.prospect.profileUrl, 'https://linkedin.com/in/asha-one');
  assert.equal(blocked.record.list, 'Do not contact');
  assert.deepEqual(blocked.record.contacts, []);
  assert.deepEqual(blocked.record.sequence, []);

  const localActive = { ...createRecord({ name: 'Asha Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha-one', importedEmail: 'asha@example.com' }, [{ id: 'email', value: 'asha@example.com' }]), saved: true, list: 'Follow up', sequence: [{ status: 'queued' }] };
  const incomingDnc = { ...createRecord({ name: 'Asha Priya Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha-two' }, []), saved: true, list: 'Do not contact' };
  const applied = upsertRecord([localActive], incomingDnc);
  assert.equal(applied.suppressionAliasMatched, true);
  assert.equal(applied.records.length, 1);
  assert.equal(applied.record.id, localActive.id);
  assert.equal(applied.record.prospect.name, 'Asha Rao');
  assert.equal(applied.record.list, 'Do not contact');
  assert.deepEqual(applied.record.contacts, []);
  assert.deepEqual(applied.record.sequence, []);

  const distinctActive = upsertRecord([localActive], activeVariant);
  assert.equal(distinctActive.suppressionAliasMatched, false);
  assert.equal(distinctActive.records.length, 2);
});

test('ordinary saves prioritize any DNC alias over a conflicting exact LinkedIn match', () => {
  const localDnc = { ...createRecord({ name: 'Asha Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha' }, []), saved: true, list: 'Do not contact' };
  const exactActive = { ...createRecord({ name: 'Bob Smith', domain: 'other.example', profileUrl: 'https://linkedin.com/in/bob' }, [{ id: 'bob-email', value: 'bob@other.example' }]), saved: true, list: 'Follow up', note: 'Keep Bob' };
  const contradictory = { ...createRecord({ name: 'Asha Priya Rao', domain: 'example.com', profileUrl: 'https://www.linkedin.com/in/bob/', importedEmail: 'asha@example.com' }, [{ id: 'incoming', value: 'asha@example.com' }]), saved: true, list: 'Follow up' };
  const saved = upsertRecord([exactActive, localDnc], contradictory);
  assert.equal(saved.suppressionAliasMatched, true);
  assert.equal(saved.mixedIdentityConflict, true);
  assert.equal(saved.record.id, localDnc.id);
  assert.equal(saved.record.list, 'Do not contact');
  assert.equal(saved.record.prospect.name, 'Asha Rao');
  assert.deepEqual(saved.record.contacts, []);
  assert.equal(saved.records.length, 2);
  assert.deepEqual(saved.records.find(({ id }) => id === exactActive.id), exactActive);
  assert.equal(saved.records.some(({ prospect }) => prospect.name === 'Asha Priya Rao'), false);
});

test('exports contact provenance to CSV', () => {
  const record = createRecord({ name: '=WEBSERVICE("https://example.test")', company: 'Example', title: 'Engineer' }, [{ value: 'ada@example.com', contactType: 'work_email', status: 'publicly_found', confidence: 85, sourceUrl: 'https://example.com/contact', retrievedAt: '2026-07-15T00:00:00.000Z' }]);
  const csv = toCsv(record);
  assert.match(csv, /source_url/);
  assert.match(csv, /evidence_snippet/);
  assert.match(csv, /ada@example.com/);
  assert.match(csv, /publicly_found/);
  assert.match(csv, /domain,profile_url/);
  assert.match(csv, /"'=WEBSERVICE\(""https:\/\/example\.test""\)"/);
});

test('parses recruiter CSV locally with quoted fields, aliases, provenance, and untrusted claim downgrade', () => {
  const csv = '\uFEFFfull_name,company_name,job_title,company_domain,linkedin_url,business_email,work_phone,evidence_url,source_note,list,status,confirmed_at\r\n"Asha Rao","Example, Inc","Talent\nLead",example.com,https://www.linkedin.com/in/asha,asha@example.com,"+91 55555 0100",https://example.com/team,"ATS export",Follow up,user_confirmed,2026-07-01';
  const parsed = parseRecruiterCsv(csv, 'ats-export.csv', '2026-07-19T10:00:00.000Z');
  assert.equal(parsed.accepted, 1);
  assert.equal(parsed.rejected, 0);
  assert.deepEqual(parsed.ignoredColumns, ['status', 'confirmed_at']);
  const [record] = parsed.records;
  assert.equal(record.prospect.name, 'Asha Rao');
  assert.equal(record.prospect.company, 'Example, Inc');
  assert.equal(record.prospect.title, 'Talent Lead');
  assert.equal(record.prospect.domain, 'example.com');
  assert.equal(record.list, 'Follow up');
  assert.deepEqual(record.contacts.map(({ contactType }) => contactType), ['work_email', 'business_phone']);
  assert.ok(record.contacts.every((contact) => contact.status === 'recruiter_imported' && contact.contactScope === 'person_candidate' && contact.provider === 'recruiter_csv'));
  assert.match(record.contacts[0].reason, /ats-export\.csv, row 2/);
  assert.equal(record.contacts[0].evidenceSnippet, 'ATS export');
  assert.equal(record.contacts[0].confirmedAt, '');
  assert.deepEqual(record.importProvenance, { source: 'ats-export.csv', row: 2, importedAt: '2026-07-19T10:00:00.000Z' });
  assert.equal(draftableEmail(record), undefined);
});

test('rejects unsafe CSV schemas, malformed files, limits, and invalid work contacts', () => {
  assert.throws(() => parseRecruiterCsv('name,domain,personal_phone\nAsha Rao,example.com,+15550100'), /Personal-contact columns/);
  for (const header of ['email', 'phone', 'cell_phone', 'mobile_number', 'home_phone', 'private_email']) assert.throws(() => parseRecruiterCsv(`name,domain,${header}\nAsha Rao,example.com,value`), /Personal-contact columns/);
  assert.throws(() => parseRecruiterCsv('name,full_name,domain\nAsha Rao,Asha Rao,example.com'), /same field/);
  assert.throws(() => parseRecruiterCsv('name,domain\n"Asha Rao,example.com'), /unclosed quoted field/);
  assert.throws(() => parseRecruiterCsv('name,domain\nAsha Rao,example.\uFFFDcom'), /valid UTF-8/);
  assert.throws(() => parseRecruiterCsv(`name,domain\n${'x'.repeat(1_000_001)}`), /exceeds 1 MB/);
  const tooMany = ['name,domain', ...Array.from({ length: 1001 }, (_, index) => `Person ${index},example.com`)].join('\n');
  assert.throws(() => parseRecruiterCsv(tooMany), /more than 1,000/);
  const parsed = parseRecruiterCsv('name,domain,work_email,business_phone\nAsha Rao,example.com,asha@example.com,+91 55555 0100\nBroken Person,example.com,not-an-email,+91 55555 0100');
  assert.equal(parsed.accepted, 1);
  assert.equal(parsed.rejected, 1);
  assert.match(parsed.issues[0], /work email is invalid/);
  const generic = parseRecruiterCsv('name,domain,contact,contact_type\nAsha Rao,example.com,+91 55555 0100,business_phone');
  assert.deepEqual(generic.ignoredColumns, ['contact', 'contact_type']);
  assert.deepEqual(generic.records[0].contacts, []);
  for (const phone of ['texttext1234567', 'ext1234567', '+++++++1234567']) {
    assert.throws(() => parseRecruiterCsv(`name,domain,business_phone\nAsha Rao,example.com,${phone}`), /business phone is invalid/);
  }
  assert.throws(() => parseRecruiterCsv('name,domain,profile_url\nAsha Rao,example.com,https://example.com/shared'), /LinkedIn person URL/);
});

test('requires a suppression-screenable identity and strips contact data from CSV DNC rows', () => {
  assert.throws(() => parseRecruiterCsv('name,company,profile_url,work_email\nAsha Rao,Example,https:\/\/linkedin.com\/in\/asha,asha@example.com'), /full name and explicit company domain/);
  const parsed = parseRecruiterCsv('name,domain,work_email,business_phone,list\nAsha Rao,example.com,asha@example.com,+91 55555 0100,Do not contact');
  assert.equal(parsed.strippedContacts, 1);
  assert.equal(parsed.records[0].list, 'Do not contact');
  assert.deepEqual(parsed.records[0].contacts, []);
  assert.equal(parsed.records[0].prospect.importedEmail, '');
  assert.equal(parsed.records[0].prospect.importedPhone, '');
});

test('previews recruiter import without mutating and preserves stronger local context on exact merge', () => {
  const confirmed = { id: 'confirmed-email', value: 'asha@example.com', contactType: 'work_email', contactScope: 'person_confirmed', status: 'user_confirmed', statusLabel: 'Identity checked by recruiter' };
  const local = { ...createRecord({ name: 'Asha Rao', company: 'Example', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha' }, [confirmed]), saved: true, list: 'Follow up', note: 'Keep this', sequence: [{ id: 'queued', status: 'queued' }] };
  const imported = parseRecruiterCsv('name,company,title,domain,profile_url,work_email\nAsha Rao,Example,Talent Lead,example.com,https://www.linkedin.com/in/asha/,ASHA@example.com').records;
  const before = structuredClone([local]);
  const preview = mergeRecruiterImport([local], imported);
  assert.deepEqual([local], before);
  assert.equal(preview.added, 0);
  assert.equal(preview.deduplicated, 1);
  assert.equal(preview.records.length, 1);
  assert.equal(preview.records[0].contacts.length, 1);
  assert.equal(preview.records[0].contacts[0].status, 'user_confirmed');
  assert.equal(preview.records[0].note, 'Keep this');
  assert.equal(preview.records[0].list, 'Follow up');
  assert.deepEqual(preview.records[0].sequence, local.sequence);
});

test('recruiter import keeps local DNC sticky and applies an exact incoming DNC atomically', () => {
  const blocked = { ...createRecord({ name: 'Asha Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha', importedEmail: 'old@example.com' }, [{ id: 'old', value: 'old@example.com' }]), saved: true, list: 'Do not contact', sequence: [{ status: 'queued' }] };
  const activeImport = parseRecruiterCsv('name,domain,profile_url,work_email\nAsha Rao,example.com,https://linkedin.com/in/asha,new@example.com').records;
  const sticky = mergeRecruiterImport([blocked], activeImport);
  assert.equal(sticky.records[0].list, 'Do not contact');
  assert.deepEqual(sticky.records[0].contacts, []);
  assert.deepEqual(sticky.records[0].sequence, []);
  const active = { ...createRecord({ name: 'Dev Shah', domain: 'example.com', profileUrl: 'https://linkedin.com/in/dev', importedEmail: 'dev@example.com' }, [{ id: 'dev', value: 'dev@example.com' }]), saved: true, list: 'Follow up', sequence: [{ status: 'queued' }] };
  const dncImport = parseRecruiterCsv('name,domain,profile_url,do_not_contact\nDev Shah,example.com,https://linkedin.com/in/dev,true').records;
  const applied = mergeRecruiterImport([active], dncImport);
  assert.equal(applied.doNotContact, 1);
  assert.equal(applied.removedContacts, 1);
  assert.equal(applied.records[0].list, 'Do not contact');
  assert.deepEqual(applied.records[0].contacts, []);
  assert.deepEqual(applied.records[0].sequence, []);
});

test('blocks a recruiter import when an ambiguous incoming DNC cannot be safely applied', () => {
  const local = { ...createRecord({ name: 'Asha Rao', company: 'Example', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha-one' }, []), saved: true };
  const incoming = parseRecruiterCsv('name,company,domain,profile_url,do_not_contact\nAsha Rao,Example,example.com,https://linkedin.com/in/asha-two,true').records;
  const preview = mergeRecruiterImport([local], incoming);
  assert.equal(preview.conflicts, 1);
  assert.equal(preview.blockingConflicts, 1);
  assert.equal(preview.imported, 0);
  assert.deepEqual(preview.records, [local]);
});

test('does not trust a reused LinkedIn URL when the imported person name differs', () => {
  const victim = { ...createRecord({ name: 'Victim Person', domain: 'victim.example', profileUrl: 'https://linkedin.com/in/shared' }, [{ id: 'confirmed', value: 'victim@victim.example', contactType: 'work_email', contactScope: 'person_confirmed', status: 'user_confirmed' }]), saved: true, sequence: [{ status: 'queued' }] };
  const malicious = parseRecruiterCsv('name,domain,profile_url,do_not_contact\nDifferent Person,other.example,https://linkedin.com/in/shared,true').records;
  const preview = mergeRecruiterImport([victim], malicious);
  assert.equal(preview.imported, 0);
  assert.equal(preview.blockingConflicts, 1);
  assert.deepEqual(preview.records, [victim]);
});

test('blocks incomplete and name-variant collisions whenever either side is DNC', () => {
  const localDnc = { ...createRecord({ name: 'Asha Rao', company: 'Example' }, []), saved: true, list: 'Do not contact' };
  const activeImport = parseRecruiterCsv('name,domain,work_email\nAsha Rao,example.com,asha@example.com').records;
  const incomplete = mergeRecruiterImport([localDnc], activeImport);
  assert.equal(incomplete.imported, 0);
  assert.equal(incomplete.blockingConflicts, 1);
  const localActive = { ...createRecord({ name: 'Asha Rao', domain: 'example.com' }, []), saved: true };
  const variantDnc = parseRecruiterCsv('name,domain,do_not_contact\nAsha Priya Rao,example.com,true').records;
  const variant = mergeRecruiterImport([localActive], variantDnc);
  assert.equal(variant.imported, 0);
  assert.equal(variant.blockingConflicts, 1);
  const capturedDnc = { ...createRecord({ name: 'Asha Rao', company: 'Example' }, []), saved: true, list: 'Do not contact' };
  const domainOnlyVariant = parseRecruiterCsv('name,domain,work_email\nAsha Priya Rao,example.com,asha@example.com').records;
  const capturedCollision = mergeRecruiterImport([capturedDnc], domainOnlyVariant);
  assert.equal(capturedCollision.imported, 0);
  assert.equal(capturedCollision.blockingConflicts, 1);
});

test('allows clearly distinct same-name people when canonical profile URLs and domains differ', () => {
  const localDnc = { ...createRecord({ name: 'Alex Lee', domain: 'a.example', profileUrl: 'https://linkedin.com/in/alex-one' }, []), saved: true, list: 'Do not contact' };
  const incoming = parseRecruiterCsv('name,domain,profile_url,work_email\nAlex Lee,b.example,https://linkedin.com/in/alex-two,alex@b.example').records;
  const preview = mergeRecruiterImport([localDnc], incoming);
  assert.equal(preview.imported, 1);
  assert.equal(preview.blockingConflicts, 0);
});

test('purges saved records only by the suppression alias that actually matched', () => {
  const saved = { ...createRecord({ name: 'Asha Priya Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/old', importedEmail: 'asha@example.com' }, [{ value: 'asha@example.com' }]), saved: true, sequence: [{ status: 'queued' }] };
  const other = { ...createRecord({ name: 'Dev Shah', domain: 'example.com' }, []), saved: true };
  const purged = purgeSuppressedProspects([saved, other], [{ prospect: { name: 'Asha Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/new' }, matchedPerson: true, matchedLinkedIn: false }]);
  assert.equal(purged.removed, 1);
  assert.deepEqual(purged.records, [other]);
  const victim = { ...createRecord({ name: 'Victim Person', domain: 'victim.example', profileUrl: 'https://linkedin.com/in/victim' }, []), saved: true };
  const mixed = purgeSuppressedProspects([victim], [{ prospect: { name: 'Asha Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/victim' }, matchedPerson: true, matchedLinkedIn: false }]);
  assert.equal(mixed.removed, 0);
  const handle = purgeSuppressedProspects([victim], [{ prospect: { name: 'Different Person', profileUrl: 'https://linkedin.com/in/victim' }, matchedPerson: false, matchedLinkedIn: true }]);
  assert.equal(handle.removed, 1);

  const legacyUrlDomain = { ...createRecord({ name: 'Asha Rao', domain: 'HTTPS://Example.COM/team', importedEmail: 'asha@example.com' }, [{ value: 'asha@example.com' }]), saved: true, list: 'Follow up', sequence: [{ status: 'queued' }] };
  const canonicalSignal = [{ prospect: { name: 'Asha Priya Rao', domain: 'example.com' }, matchedPerson: true, matchedLinkedIn: false }];
  assert.equal(purgeSuppressedProspects([legacyUrlDomain], canonicalSignal).removed, 1);
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
  const record = { ...createRecord({ name: 'Asha Rao', company: 'Example', domain: 'example.com' }, [{ id: 'email', value: 'asha@example.com', contactType: 'work_email', contactScope: 'person_attributed', status: 'provider_valid', verifiedAt: 'not-a-date', retrievedAt: 'also-not-a-date' }]), saved: true, list: 'Follow up', createdAt: 'bad-created', updatedAt: 'bad-updated', employmentHistory: [{ company: 'Old Co', detectedAt: 'bad-detected' }] };
  const opened = await openHandoff((await createHandoff([record], 'separate share passphrase', 'Follow up')).text, 'separate share passphrase');
  assert.equal(opened.records[0].createdAt, '');
  assert.equal(opened.records[0].updatedAt, '');
  assert.equal(opened.records[0].contacts[0].verifiedAt, '');
  assert.equal(opened.records[0].contacts[0].retrievedAt, '');
  assert.equal(opened.records[0].employmentHistory[0].detectedAt, '');
});

test('handoff exports only the selected list and no unrelated opt-out identities', async () => {
  const selected = { ...createRecord({ name: 'Asha Rao', company: 'Example', domain: 'example.com' }, []), saved: true, list: 'Follow up' };
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

test('handoff rejects unscreenable active records but permits a selected DNC record', async () => {
  const legacyActive = { ...createRecord({ name: 'Asha Rao', company: 'Example' }, [{ id: 'email', value: 'asha@example.com', contactType: 'work_email', status: 'user_confirmed', contactScope: 'person_confirmed' }]), saved: true, list: 'Follow up' };
  await assert.rejects(() => createHandoff([legacyActive], 'separate share passphrase', 'Follow up'), /canonical LinkedIn person URL or a full name and valid company domain/);

  const dnc = { ...legacyActive, contacts: [], list: 'Do not contact', sequence: [] };
  const bundle = await createHandoff([dnc], 'separate share passphrase', 'Do not contact');
  const opened = await openHandoff(bundle.text, 'separate share passphrase');
  assert.equal(opened.records.length, 1);
  assert.equal(opened.records[0].list, 'Do not contact');
  assert.deepEqual(opened.records[0].contacts, []);
});

test('handoff exports are nondeterministic and reject version or cipher tampering', async () => {
  const record = { ...createRecord({ name: 'Asha Rao', company: 'Example', domain: 'example.com' }, []), saved: true, list: 'Follow up' };
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
  const records = Array.from({ length: 25 }, (_, index) => ({ ...createRecord({ name: `Person ${index}`, company: 'Example', domain: 'example.com' }, contacts), saved: true, list: 'Follow up' }));
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
  assert.equal(merged.blockingConflicts, 0);
  assert.equal(merged.imported, 0);
  assert.deepEqual(merged.records, [local]);
});

test('team import exposes an unresolved incoming DNC as a blocking conflict in a mixed handoff', () => {
  const local = { ...createRecord({ name: 'Asha Rao', company: 'Example', importedEmail: 'asha@example.com' }, [{ id: 'email', value: 'asha@example.com', contactType: 'work_email', status: 'user_confirmed', contactScope: 'person_confirmed' }]), saved: true, list: 'Follow up' };
  const ambiguousDnc = { ...createRecord({ name: 'Asha Rao', company: 'Example', domain: 'example.com' }, []), saved: true, list: 'Do not contact' };
  const unrelated = { ...createRecord({ name: 'Dev Shah', company: 'Other', domain: 'other.example', profileUrl: 'https://linkedin.com/in/dev' }, []), saved: true, list: 'Follow up' };
  const merged = mergeImportedRecords([local], [ambiguousDnc, unrelated]);
  assert.equal(merged.conflicts, 1);
  assert.equal(merged.blockingConflicts, 1);
  assert.equal(merged.imported, 1);
  assert.equal(merged.records.length, 2);
  assert.equal(merged.records.find(({ id }) => id === local.id).list, 'Follow up');
  assert.ok(merged.records.some(({ prospect }) => prospect.name === 'Dev Shah'));
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

test('team import applies an exact name-domain DNC even without a LinkedIn URL', () => {
  const local = { ...createRecord({ name: 'Asha Rao', domain: 'example.com', importedEmail: 'asha@example.com' }, [{ id: 'email', value: 'asha@example.com', contactType: 'work_email', status: 'user_confirmed', contactScope: 'person_confirmed' }]), saved: true, list: 'Follow up', sequence: [{ status: 'queued' }] };
  const sharedDnc = { ...createRecord({ name: 'Asha Rao', domain: 'example.com' }, []), saved: true, list: 'Do not contact' };
  const merged = mergeImportedRecords([local], [sharedDnc]);
  assert.equal(merged.imported, 1);
  assert.equal(merged.records[0].list, 'Do not contact');
  assert.deepEqual(merged.records[0].contacts, []);
  assert.deepEqual(merged.records[0].sequence, []);
});

test('team import blocks an active middle-name DNC alias and applies the reverse DNC alias', () => {
  const localDnc = { ...createRecord({ name: 'Asha Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha-one' }, []), saved: true, list: 'Do not contact' };
  const sharedActive = { ...createRecord({ name: 'Asha Priya Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha-two' }, [{ id: 'email', value: 'asha@example.com', contactType: 'work_email', status: 'shared_candidate', contactScope: 'person_candidate' }]), saved: true, list: 'Follow up' };
  const blocked = mergeImportedRecords([localDnc], [sharedActive]);
  assert.equal(blocked.conflicts, 1);
  assert.equal(blocked.imported, 0);
  assert.deepEqual(blocked.records, [localDnc]);

  const localActive = { ...createRecord({ name: 'Asha Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha-one', importedEmail: 'asha@example.com' }, [{ id: 'email', value: 'asha@example.com', contactType: 'work_email', status: 'user_confirmed', contactScope: 'person_confirmed' }]), saved: true, list: 'Follow up', sequence: [{ status: 'queued' }] };
  const sharedDnc = { ...createRecord({ name: 'Asha Priya Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha-two' }, []), saved: true, list: 'Do not contact' };
  const applied = mergeImportedRecords([localActive], [sharedDnc]);
  assert.equal(applied.conflicts, 0);
  assert.equal(applied.imported, 1);
  assert.equal(applied.deduplicated, 1);
  assert.equal(applied.suppressions, 1);
  assert.equal(applied.removedContacts, 1);
  assert.equal(applied.records.length, 1);
  assert.equal(applied.records[0].id, localActive.id);
  assert.equal(applied.records[0].prospect.name, 'Asha Rao');
  assert.equal(applied.records[0].prospect.profileUrl, 'https://linkedin.com/in/asha-one');
  assert.equal(applied.records[0].list, 'Do not contact');
  assert.deepEqual(applied.records[0].contacts, []);
  assert.deepEqual(applied.records[0].sequence, []);
});

test('team import applies a same-LinkedIn DNC despite identity drift but rejects an active mismatch', () => {
  const local = { ...createRecord({ name: 'Asha Rao', company: 'Example', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha', importedEmail: 'asha@example.com' }, [{ id: 'email', value: 'asha@example.com', contactType: 'work_email', status: 'user_confirmed', contactScope: 'person_confirmed' }]), saved: true, list: 'Follow up', sequence: [{ status: 'queued' }], note: 'Keep local identity' };
  const activeMismatch = { ...createRecord({ name: 'Asha Sharma', company: 'Other', domain: 'other.example', profileUrl: 'https://www.linkedin.com/in/asha/' }, []), saved: true, list: 'Follow up' };
  const blocked = mergeImportedRecords([local], [activeMismatch]);
  assert.equal(blocked.conflicts, 1);
  assert.equal(blocked.imported, 0);
  assert.deepEqual(blocked.records, [local]);

  const incomingDnc = { ...activeMismatch, list: 'Do not contact' };
  const applied = mergeImportedRecords([local], [incomingDnc]);
  assert.equal(applied.conflicts, 0);
  assert.equal(applied.imported, 1);
  assert.equal(applied.deduplicated, 1);
  assert.equal(applied.suppressions, 1);
  assert.equal(applied.removedContacts, 1);
  assert.equal(applied.records.length, 1);
  assert.equal(applied.records[0].id, local.id);
  assert.deepEqual(applied.records[0].prospect, { ...local.prospect, importedEmail: '', importedPhone: '' });
  assert.equal(applied.records[0].note, 'Keep local identity');
  assert.equal(applied.records[0].list, 'Do not contact');
  assert.deepEqual(applied.records[0].contacts, []);
  assert.deepEqual(applied.records[0].sequence, []);
});

test('team import keeps middle-name variants distinct while neither record is DNC', () => {
  const local = { ...createRecord({ name: 'Asha Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha-one' }, []), saved: true };
  const shared = { ...createRecord({ name: 'Asha Priya Rao', domain: 'example.com', profileUrl: 'https://linkedin.com/in/asha-two' }, []), saved: true };
  const merged = mergeImportedRecords([local], [shared]);
  assert.equal(merged.conflicts, 0);
  assert.equal(merged.imported, 1);
  assert.equal(merged.records.length, 2);
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
