(function (root, factory) { const api = factory(); if (typeof module !== 'undefined') module.exports = api; root.FindEmmState = api; }(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PROVIDER_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;
  function createRecord(prospect, contacts) { return { id: crypto.randomUUID(), prospect, contacts: Array.isArray(contacts) ? contacts : [], employmentHistory: [], suppressed: false, saved: false, list: 'Saved prospects', sequence: [], note: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; }
  function canContact(record) { return !record?.suppressed && record?.list !== 'Do not contact'; }
  function contactView(contact, now = Date.now()) {
    if (!contact) return contact;
    if (contact.status === 'provider_verified') return { ...contact, status: 'provider_unverified', statusLabel: 'Legacy provider claim — identity recheck required', contactScope: 'person_candidate' };
    const verified = Date.parse(contact.verifiedAt || '');
    return contact.status === 'provider_valid' && (!Number.isFinite(verified) || verified > now || now - verified > PROVIDER_VALIDITY_MS) ? { ...contact, status: 'provider_stale', statusLabel: 'Provider validity stale — recheck required', contactScope: 'person_candidate' } : contact;
  }
  function draftableEmail(record) { return record?.contacts?.find((contact) => contact.contactType === 'work_email' && contact.status === 'user_confirmed' && contact.contactScope === 'person_confirmed'); }
  function confirmContact(record, contactId, confirmedAt = new Date().toISOString()) {
    if (!canContact(record)) return record;
    const allowed = new Set(['provider_valid', 'provider_stale', 'provider_unverified', 'recruiter_imported', 'shared_candidate']);
    const when = safeDate(confirmedAt);
    if (!when) return record;
    let changed = false;
    const contacts = (record?.contacts || []).map((contact) => {
      const display = contactView(contact);
      if (contact.id !== contactId || contact.contactType !== 'work_email' || contact.contactScope === 'company' || !allowed.has(display.status)) return contact;
      changed = true;
      return { ...contact, originStatus: contact.originStatus || contact.status, status: 'user_confirmed', statusLabel: 'Identity checked by recruiter', contactScope: 'person_confirmed', confirmedAt: when, reason: `${contact.reason || ''} Recruiter confirmed the person match on ${when.slice(0, 10)}; this is a local human attestation.`.trim() };
    });
    return changed ? { ...record, contacts, updatedAt: when } : record;
  }
  function personKey(prospect = {}) {
    const name = String(prospect.name || '').trim().toLowerCase();
    const company = String(prospect.domain || prospect.company || '').trim().toLowerCase();
    return name && company ? `person:${name}|${company}` : '';
  }
  function sameNamedOrganization(left = {}, right = {}) {
    const normalized = (value) => String(value || '').trim().toLowerCase();
    const leftName = normalized(left.name);
    if (!leftName || leftName !== normalized(right.name)) return false;
    const leftOrganizations = new Set([left.domain, left.company].map(normalized).filter(Boolean));
    return [right.domain, right.company].map(normalized).filter(Boolean).some((value) => leftOrganizations.has(value));
  }
  function matchesProspect(left = {}, right = {}) {
    const leftUrl = prospectKey({ profileUrl: left.profileUrl });
    const rightUrl = prospectKey({ profileUrl: right.profileUrl });
    if (leftUrl && rightUrl) return leftUrl === rightUrl;
    const normalized = (value) => String(value || '').trim().toLowerCase();
    if (!normalized(left.name) || normalized(left.name) !== normalized(right.name)) return false;
    const leftOrganizations = new Set([left.domain, left.company].map(normalized).filter(Boolean));
    return [right.domain, right.company].map(normalized).filter(Boolean).some((value) => leftOrganizations.has(value));
  }
  function prospectKey(prospect = {}) {
    if (prospect.profileUrl) { try { const url = new URL(prospect.profileUrl); if (url.hostname.toLowerCase() === 'www.linkedin.com') url.hostname = 'linkedin.com'; url.search = ''; url.hash = ''; url.pathname = url.pathname.replace(/\/$/, ''); return `url:${url.toString().toLowerCase()}`; } catch { /* use person fallback */ } }
    // ponytail: name + company is fallback until authorized providers supply stable person IDs.
    return personKey(prospect);
  }
  function purgeProspect(records, prospect) {
    const kept = (Array.isArray(records) ? records : []).filter((record) => !matchesProspect(record?.prospect, prospect));
    return { records: kept, removed: (Array.isArray(records) ? records.length : 0) - kept.length };
  }
  function upsertRecord(records, record) {
    const list = Array.isArray(records) ? records : [];
    const key = prospectKey(record.prospect);
    const duplicate = key && list.find((item) => item.id !== record.id && prospectKey(item.prospect) === key);
    if (!duplicate) { const blocked = record.suppressed || record.list === 'Do not contact'; const prospect = { ...record.prospect, ...(blocked ? { importedEmail: '', importedPhone: '' } : {}) }; const saved = blocked ? { ...record, prospect, contacts: [], sequence: [], list: 'Do not contact' } : record; return { record: saved, records: [saved, ...list.filter((item) => item.id !== saved.id)], deduplicated: false }; }
    const suppressed = Boolean(record.suppressed || duplicate.suppressed);
    const doNotContact = suppressed || record.list === 'Do not contact' || duplicate.list === 'Do not contact';
    const contactKeys = new Set();
    const contacts = doNotContact ? [] : [...(record.contacts || []), ...(duplicate.contacts || [])].filter((contact) => { const contactKey = `${contact.contactType}|${contact.value}|${contact.contactScope || ''}|${contact.sourceUrl || ''}`.toLowerCase(); if (contactKeys.has(contactKey)) return false; contactKeys.add(contactKey); return true; });
    const supplied = Object.fromEntries(Object.entries(record.prospect).filter(([, value]) => value !== ''));
    const prospect = { ...duplicate.prospect, ...supplied };
    if (doNotContact) { prospect.importedEmail = ''; prospect.importedPhone = ''; }
    const normalized = (value) => String(value || '').trim().toLowerCase();
    const changeDetected = ['company', 'domain', 'title'].some((field) => normalized(duplicate.prospect[field]) !== normalized(prospect[field]));
    const previousEmployment = { company: duplicate.prospect.company, domain: duplicate.prospect.domain, title: duplicate.prospect.title, detectedAt: record.updatedAt };
    const employmentHistory = changeDetected ? [previousEmployment, ...(duplicate.employmentHistory || [])] : duplicate.employmentHistory || [];
    const merged = { ...duplicate, ...record, id: duplicate.id, prospect, contacts, employmentHistory, suppressed, list: doNotContact ? 'Do not contact' : record.list === 'Saved prospects' ? duplicate.list || record.list : record.list, note: record.note || duplicate.note, sequence: doNotContact ? [] : record.sequence?.length ? record.sequence : duplicate.sequence || [], saved: true, createdAt: duplicate.createdAt };
    return { record: merged, records: [merged, ...list.filter((item) => item.id !== record.id && item.id !== duplicate.id)], deduplicated: true, changeDetected };
  }
  function recommendRelated(current, records, limit = 3) {
    const words = (value) => new Set(String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []);
    const normalized = (value) => String(value || '').trim().toLowerCase();
    const sameOrganization = (left = {}, right = {}) => Boolean(left.domain && right.domain && normalized(left.domain) === normalized(right.domain) || left.company && right.company && normalized(left.company) === normalized(right.company));
    const roleWords = new Set(['acquisition', 'campus', 'careers', 'graduate', 'hiring', 'hr', 'human', 'people', 'recruiter', 'recruiting', 'recruitment', 'resources', 'staffing', 'talent', 'university']);
    const genericWords = new Set(['assistant', 'associate', 'chief', 'director', 'head', 'lead', 'manager', 'of', 'principal', 'senior', 'specialist', 'the', 'vice', 'vp']);
    const seniority = (tokens) => tokens.has('chief') || tokens.has('vp') || tokens.has('vice') ? 5 : tokens.has('director') || tokens.has('head') ? 4 : tokens.has('manager') || tokens.has('lead') ? 3 : tokens.has('senior') || tokens.has('principal') ? 2 : tokens.size ? 1 : 0;
    const target = current?.prospect || {};
    const targetTitle = words(target.title);
    const former = current?.employmentHistory?.[0] || null;
    const formerTitle = words(former?.title);
    const seen = new Set([prospectKey(target)].filter(Boolean));
    return (Array.isArray(records) ? records : []).filter((record) => { const key = prospectKey(record?.prospect); return record?.id !== current?.id && record?.saved && canContact(record) && (!key || !seen.has(key)); }).map((record) => {
      const prospect = record.prospect || {};
      const candidateTitle = words(prospect.title);
      const sameCompany = sameOrganization(target, prospect);
      const formerCompany = Boolean(former && sameOrganization(former, prospect) && !sameCompany);
      const recruitingSignals = [...candidateTitle].filter((word) => roleWords.has(word));
      const referenceTitle = formerCompany ? formerTitle : targetTitle;
      const titleOverlap = [...candidateTitle].filter((word) => referenceTitle.has(word) && !genericWords.has(word));
      const targetRecruitingSignals = [...referenceTitle].filter((word) => roleWords.has(word));
      const sameFunction = titleOverlap.length > 0 || recruitingSignals.some((word) => targetRecruitingSignals.includes(word));
      const candidateSeniority = seniority(candidateTitle);
      const targetSeniority = seniority(referenceTitle);
      const similarSeniority = candidateSeniority && targetSeniority && Math.abs(candidateSeniority - targetSeniority) <= 1;
      const decisionMaker = candidateSeniority >= 3 && recruitingSignals.length > 0;
      const score = (formerCompany && sameFunction ? 75 : 0) + (sameCompany ? 55 : 0) + Math.min(recruitingSignals.length * 8, 24) + Math.min(titleOverlap.length * 8, 24) + (similarSeniority ? 8 : 0) + (decisionMaker ? 8 : 0);
      const reasons = [formerCompany && sameFunction && 'possible successor at former company', sameCompany && 'same company', recruitingSignals.length && 'recruiting role', titleOverlap.length && 'similar title', similarSeniority && 'similar seniority', decisionMaker && 'hiring decision-maker'].filter(Boolean);
      return { record, score, relevant: sameFunction || recruitingSignals.length > 0, reason: reasons.slice(0, 4).join(' · ') };
    }).filter(({ score, relevant }) => relevant && score >= 20).sort((a, b) => b.score - a.score || String(a.record.prospect.name).localeCompare(String(b.record.prospect.name))).filter(({ record }) => { const key = prospectKey(record.prospect); if (key && seen.has(key)) return false; if (key) seen.add(key); return true; }).slice(0, limit);
  }
  function workspaceRecords(records, query = '', filter = 'Active', limit = 100) {
    const saved = (Array.isArray(records) ? records : []).filter((record) => record?.saved);
    const counts = { total: saved.length, active: saved.filter(canContact).length, saved: saved.filter((record) => canContact(record) && record.list === 'Saved prospects').length, followUp: saved.filter((record) => canContact(record) && record.list === 'Follow up').length, doNotContact: saved.filter((record) => !canContact(record)).length, queued: saved.reduce((count, record) => count + (record.sequence || []).filter((item) => item.status === 'queued').length, 0), roleChanges: saved.filter((record) => record.employmentHistory?.length).length };
    const needle = String(query || '').trim().toLowerCase();
    const filtered = saved.filter((record) => filter === 'All' || (filter === 'Active' && canContact(record)) || (filter === 'Do not contact' && !canContact(record)) || (canContact(record) && record.list === filter)).filter((record) => !needle || [record.prospect?.name, record.prospect?.title, record.prospect?.company, record.prospect?.domain].some((value) => String(value || '').toLowerCase().includes(needle)));
    const priority = { 'Follow up': 0, 'Saved prospects': 1, 'Do not contact': 2 };
    const updated = (record) => Number.isFinite(Date.parse(record.updatedAt || '')) ? Date.parse(record.updatedAt) : 0;
    filtered.sort((left, right) => (canContact(left) ? (priority[left.list] ?? 1) : 2) - (canContact(right) ? (priority[right.list] ?? 1) : 2) || updated(right) - updated(left) || String(left.prospect?.name || '').localeCompare(String(right.prospect?.name || '')));
    const cap = Math.max(1, Math.min(500, Number(limit) || 100));
    return { counts, total: filtered.length, records: filtered.slice(0, cap) };
  }
  function queueDraft(sequence) { const next = Array.isArray(sequence) ? sequence.slice() : []; next.push({ id: crypto.randomUUID(), kind: 'draft_outreach', dueAt: new Date().toISOString(), status: 'queued' }); return next; }
  function csvCell(value) { const raw = String(value ?? ''); const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw; return `"${safe.replace(/"/g, '""')}"`; }
  function toCsv(record) { const columns = ['name', 'company', 'title', 'list', 'contact', 'contact_type', 'contact_scope', 'status', 'confidence', 'provider', 'verified_at', 'confirmed_at', 'source_url', 'evidence_snippet', 'retrieved_at']; const rows = record.contacts.length ? record.contacts : [{}]; return [columns.join(','), ...rows.map((raw) => { const contact = contactView(raw) || {}; return [record.prospect.name, record.prospect.company, record.prospect.title, record.list, contact.value, contact.contactType, contact.contactScope, contact.status, contact.confidence, contact.provider, contact.verifiedAt, contact.confirmedAt, contact.sourceUrl, contact.evidenceSnippet, contact.retrievedAt].map(csvCell).join(','); })].join('\n'); }
  function bytesToBase64(bytes) { let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary); }
  function base64ToBytes(value) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
  async function keyFor(passphrase, salt) { return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: base64ToBytes(salt), iterations: 250000, hash: 'SHA-256' }, await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
  function newSalt() { return bytesToBase64(crypto.getRandomValues(new Uint8Array(16))); }
  async function seal(value, passphrase, salt, authenticatedHeader = '') { const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await keyFor(passphrase, salt); const algorithm = { name: 'AES-GCM', iv, ...(authenticatedHeader ? { additionalData: new TextEncoder().encode(authenticatedHeader) } : {}) }; const cipher = await crypto.subtle.encrypt(algorithm, key, new TextEncoder().encode(JSON.stringify(value))); return { iv: bytesToBase64(iv), cipher: bytesToBase64(new Uint8Array(cipher)) }; }
  async function open(sealed, passphrase, salt, authenticatedHeader = '') { const key = await keyFor(passphrase, salt); const algorithm = { name: 'AES-GCM', iv: base64ToBytes(sealed.iv), ...(authenticatedHeader ? { additionalData: new TextEncoder().encode(authenticatedHeader) } : {}) }; const plain = await crypto.subtle.decrypt(algorithm, key, base64ToBytes(sealed.cipher)); return JSON.parse(new TextDecoder().decode(plain)); }
  function safeText(value, max = 1000) { return String(value || '').trim().slice(0, max); }
  function safeEmail(value) { const email = safeText(value, 320); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''; }
  function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.toString().length <= 2048 ? url.toString() : ''; } catch { return ''; } }
  function safeDate(value) { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? date.toISOString() : ''; }
  function sanitizeSharedRecord(input = {}) {
    const source = input.prospect || {};
    const name = safeText(source.name, 200);
    if (!name) return null;
    const suppressed = Boolean(input.suppressed);
    const blocked = suppressed || input.list === 'Do not contact';
    const lists = new Set(['Saved prospects', 'Follow up', 'Do not contact']);
    const sharedClaims = new Set(['provider_valid', 'provider_stale', 'provider_verified', 'provider_unverified', 'recruiter_imported', 'user_confirmed', 'shared_candidate']);
    const statuses = new Set(['publicly_found', ...sharedClaims]);
    const labels = { publicly_found: 'Publicly found company channel', shared_candidate: 'Shared contact — recheck required' };
    const scopeByStatus = { publicly_found: 'company', shared_candidate: 'person_candidate' };
    const contacts = blocked ? [] : (Array.isArray(input.contacts) ? input.contacts : []).slice(0, 100).map((contact) => { const suppliedStatus = statuses.has(contact.status) ? contact.status : ''; const status = sharedClaims.has(suppliedStatus) ? 'shared_candidate' : suppliedStatus; const contactType = ['work_email', 'business_phone'].includes(contact.contactType) ? contact.contactType : ''; const value = contactType === 'work_email' ? safeEmail(contact.value) : safeText(contact.value, 100); if (!status || !contactType || !value) return null; return { id: crypto.randomUUID(), value, contactType, contactScope: scopeByStatus[status], status, statusLabel: labels[status], confidence: Math.max(0, Math.min(100, Number(contact.confidence) || 0)), reason: safeText(contact.reason, 1000), provider: safeText(contact.provider, 80), verifiedAt: safeDate(contact.verifiedAt), confirmedAt: '', sourceUrl: safeUrl(contact.sourceUrl), evidenceSnippet: safeText(contact.evidenceSnippet, 1000), retrievedAt: safeDate(contact.retrievedAt) }; }).filter(Boolean);
    const history = (Array.isArray(input.employmentHistory) ? input.employmentHistory : []).slice(0, 100).map((item) => ({ company: safeText(item.company, 200), domain: safeText(item.domain, 253), title: safeText(item.title, 200), detectedAt: safeDate(item.detectedAt) }));
    return { id: crypto.randomUUID(), prospect: { name, firstName: safeText(source.firstName, 100), lastName: safeText(source.lastName, 100), company: safeText(source.company, 200), title: safeText(source.title, 200), domain: safeText(source.domain, 253), profileUrl: safeUrl(source.profileUrl), importedEmail: blocked ? '' : safeEmail(source.importedEmail), importedPhone: blocked ? '' : safeText(source.importedPhone, 100) }, contacts, employmentHistory: history, suppressed, saved: true, list: blocked ? 'Do not contact' : lists.has(input.list) ? input.list : 'Saved prospects', sequence: [], note: '', createdAt: safeDate(input.createdAt), updatedAt: safeDate(input.updatedAt) };
  }
  async function createHandoff(records, passphrase, list) {
    if (String(passphrase || '').length < 12) throw new Error('Share passphrase must contain at least 12 characters.');
    const source = Array.isArray(records) ? records : [];
    const chosen = source.filter((record) => record?.saved && record.list === list);
    if (!chosen.length) throw new Error('Selected list has no saved records.');
    const selected = chosen.map(sanitizeSharedRecord).filter(Boolean);
    if (selected.length !== chosen.length) throw new Error('Selected list contains an invalid record.');
    if (selected.length > 1000) throw new Error('Handoff cannot contain more than 1,000 records.');
    const salt = newSalt();
    const sealed = await seal({ schema: 1, exportedAt: new Date().toISOString(), list: safeText(list, 80), selectedCount: chosen.length, safeguardCount: 0, records: selected }, passphrase, salt, 'findemm-team-handoff:v1');
    const text = JSON.stringify({ format: 'findemm-team-handoff', version: 1, salt, sealed });
    if (new TextEncoder().encode(text).byteLength > 5_000_000) throw new Error('Handoff file exceeds 5 MB. Export a smaller list.');
    return { text, count: chosen.length, safeguards: 0 };
  }
  async function openHandoff(text, passphrase) {
    if (String(passphrase || '').length < 12) throw new Error('Share passphrase must contain at least 12 characters.');
    if (typeof text !== 'string' || text.length > 5_000_000) throw new Error('Handoff file is too large or invalid.');
    let bundle;
    try { bundle = JSON.parse(text); } catch { throw new Error('Handoff file is not valid JSON.'); }
    if (bundle?.format !== 'findemm-team-handoff' || bundle.version !== 1 || typeof bundle.salt !== 'string' || !bundle.sealed?.iv || !bundle.sealed?.cipher) throw new Error('Unsupported handoff format.');
    const payload = await open(bundle.sealed, passphrase, bundle.salt, 'findemm-team-handoff:v1');
    if (payload?.schema !== 1 || !Array.isArray(payload.records) || !payload.records.length || payload.records.length > 1000) throw new Error('Invalid handoff payload.');
    const records = payload.records.map(sanitizeSharedRecord);
    if (records.some((record) => !record) || !Number.isInteger(payload.selectedCount) || !Number.isInteger(payload.safeguardCount) || payload.selectedCount < 0 || payload.safeguardCount < 0 || payload.selectedCount + payload.safeguardCount !== records.length) throw new Error('Invalid handoff payload.');
    return { exportedAt: safeDate(payload.exportedAt), list: safeText(payload.list, 80), selectedCount: payload.selectedCount, safeguardCount: payload.safeguardCount, records };
  }
  function mergeImportedRecords(records, imported) {
    let merged = Array.isArray(records) ? records : [];
    let deduplicated = 0;
    let conflicts = 0;
    let suppressions = 0;
    let removedContacts = 0;
    let importedCount = 0;
    for (const candidate of Array.isArray(imported) ? imported : []) {
      const record = sanitizeSharedRecord(candidate);
      if (!record) continue;
      const key = prospectKey(record.prospect);
      const duplicate = key && merged.find((item) => prospectKey(item.prospect) === key);
      const ambiguous = !duplicate && merged.some((item) => sameNamedOrganization(item.prospect, record.prospect));
      if (ambiguous || (duplicate && !key.startsWith('url:'))) { conflicts += 1; continue; }
      const wasBlocked = duplicate ? !canContact(duplicate) : false;
      const previousContacts = duplicate?.contacts?.length || 0;
      const result = upsertRecord(merged, record);
      merged = result.records;
      importedCount += 1;
      if (result.deduplicated) deduplicated += 1;
      if (!wasBlocked && !canContact(result.record)) suppressions += 1;
      removedContacts += Math.max(0, previousContacts - (result.record.contacts?.length || 0));
    }
    return { records: merged, imported: importedCount, deduplicated, conflicts, suppressions, removedContacts };
  }
  return { createRecord, canContact, contactView, confirmContact, draftableEmail, matchesProspect, purgeProspect, upsertRecord, recommendRelated, workspaceRecords, queueDraft, toCsv, newSalt, seal, open, createHandoff, openHandoff, mergeImportedRecords };
}));
