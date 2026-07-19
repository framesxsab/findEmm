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
  function linkedInPersonKey(profileUrl) {
    try {
      const url = new URL(profileUrl);
      if (!['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase())) return '';
      const rawHandle = url.pathname.match(/^\/in\/([^/]+)\/?$/i)?.[1] || '';
      const handle = decodeURIComponent(rawHandle).normalize('NFKC').trim().toLowerCase();
      return handle && !/[\/\\\u0000-\u001f\u007f]/.test(handle) ? `url:linkedin:${handle}` : '';
    } catch { return ''; }
  }
  function canonicalResearchDomain(value) {
    const raw = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 1000);
    const candidate = raw.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    return !candidate || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(candidate) ? candidate : '';
  }
  function hasDurableSuppressionAlias(prospect = {}) {
    if (linkedInPersonKey(prospect.profileUrl)) return true;
    const nameParts = String(prospect.name || '').normalize('NFKC').trim().split(/\s+/).filter(Boolean);
    return nameParts.length >= 2 && Boolean(canonicalResearchDomain(prospect.domain));
  }
  function matchesProspect(left = {}, right = {}) {
    const leftUrl = linkedInPersonKey(left.profileUrl);
    const rightUrl = linkedInPersonKey(right.profileUrl);
    if (leftUrl && rightUrl) return leftUrl === rightUrl;
    const normalized = (value) => String(value || '').trim().toLowerCase();
    if (!normalized(left.name) || normalized(left.name) !== normalized(right.name)) return false;
    const leftOrganizations = new Set([left.domain, left.company].map(normalized).filter(Boolean));
    return [right.domain, right.company].map(normalized).filter(Boolean).some((value) => leftOrganizations.has(value));
  }
  function suppressionIdentityKey(prospect = {}) {
    const parts = String(prospect.name || '').normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const domain = canonicalResearchDomain(prospect.domain);
    return parts.length > 1 && domain ? `person:${parts[0]}|${parts.at(-1)}|${domain}` : '';
  }
  function suppressionAliasRecord(records, record) {
    const key = suppressionIdentityKey(record?.prospect);
    if (!key) return null;
    return (Array.isArray(records) ? records : []).find((item) => item.id !== record?.id && suppressionIdentityKey(item?.prospect) === key && (!canContact(item) || !canContact(record))) || null;
  }
  function nameIdentityKey(prospect = {}) {
    const parts = String(prospect.name || '').normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return parts.length > 1 ? `name:${parts[0]}|${parts.at(-1)}` : '';
  }
  function purgeSuppressedProspects(records, screenedProspects) {
    const blocked = (Array.isArray(screenedProspects) ? screenedProspects : []).filter((item) => item?.prospect && (item.matchedPerson || item.matchedLinkedIn));
    const source = Array.isArray(records) ? records : [];
    const kept = source.filter((record) => !blocked.some((item) => item.matchedPerson && suppressionIdentityKey(item.prospect) && suppressionIdentityKey(item.prospect) === suppressionIdentityKey(record?.prospect) || item.matchedLinkedIn && linkedInPersonKey(item.prospect.profileUrl) && linkedInPersonKey(item.prospect.profileUrl) === linkedInPersonKey(record?.prospect?.profileUrl)));
    return { records: kept, removed: source.length - kept.length };
  }
  function prospectKey(prospect = {}) {
    const linkedInKey = linkedInPersonKey(prospect.profileUrl);
    if (linkedInKey) return linkedInKey;
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
    const exactDuplicate = key && list.find((item) => item.id !== record.id && prospectKey(item.prospect) === key);
    // Evaluate the person suppression alias even when another record matches
    // the supplied LinkedIn key. Contradictory identifiers must never let an
    // active exact-key record outrank a known DNC identity.
    const suppressionAlias = suppressionAliasRecord(list, record);
    const mixedIdentityConflict = Boolean(exactDuplicate && suppressionAlias && exactDuplicate.id !== suppressionAlias.id);
    const duplicate = suppressionAlias || exactDuplicate;
    if (!duplicate) {
      const blocked = record.suppressed || record.list === 'Do not contact';
      const prospect = { ...record.prospect, ...(blocked ? { importedEmail: '', importedPhone: '' } : {}) };
      const saved = blocked ? { ...record, prospect, contacts: [], sequence: [], list: 'Do not contact' } : record;
      return { record: saved, records: [saved, ...list.filter((item) => item.id !== saved.id)], deduplicated: false, suppressionAliasMatched: false };
    }
    // A first-name + last-name + domain DNC match is deliberately fail-closed.
    // Preserve the local identity instead of letting a middle-name or profile-URL
    // variation overwrite it, while applying the strongest suppression state.
    const incoming = suppressionAlias ? { ...record, prospect: { ...duplicate.prospect, importedEmail: '', importedPhone: '' }, contacts: [], sequence: [], list: 'Do not contact' } : record;
    const suppressed = Boolean(incoming.suppressed || duplicate.suppressed);
    const doNotContact = suppressed || incoming.list === 'Do not contact' || duplicate.list === 'Do not contact';
    const contactKeys = new Set();
    const contacts = doNotContact ? [] : [...(incoming.contacts || []), ...(duplicate.contacts || [])].filter((contact) => { const contactKey = `${contact.contactType}|${contact.value}|${contact.contactScope || ''}|${contact.sourceUrl || ''}`.toLowerCase(); if (contactKeys.has(contactKey)) return false; contactKeys.add(contactKey); return true; });
    const supplied = Object.fromEntries(Object.entries(incoming.prospect).filter(([, value]) => value !== ''));
    const prospect = { ...duplicate.prospect, ...supplied };
    if (doNotContact) { prospect.importedEmail = ''; prospect.importedPhone = ''; }
    const normalized = (value) => String(value || '').trim().toLowerCase();
    const changeDetected = ['company', 'domain', 'title'].some((field) => normalized(duplicate.prospect[field]) !== normalized(prospect[field]));
    const previousEmployment = { company: duplicate.prospect.company, domain: duplicate.prospect.domain, title: duplicate.prospect.title, detectedAt: incoming.updatedAt };
    const employmentHistory = changeDetected ? [previousEmployment, ...(duplicate.employmentHistory || [])] : duplicate.employmentHistory || [];
    const merged = { ...duplicate, ...incoming, id: duplicate.id, prospect, contacts, employmentHistory, suppressed, list: doNotContact ? 'Do not contact' : incoming.list === 'Saved prospects' ? duplicate.list || incoming.list : incoming.list, note: incoming.note || duplicate.note, sequence: doNotContact ? [] : incoming.sequence?.length ? incoming.sequence : duplicate.sequence || [], saved: true, createdAt: duplicate.createdAt };
    return { record: merged, records: [merged, ...list.filter((item) => item.id !== record.id && item.id !== duplicate.id)], deduplicated: true, changeDetected, suppressionAliasMatched: Boolean(suppressionAlias), mixedIdentityConflict };
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
  function toCsv(record) { const columns = ['name', 'company', 'title', 'domain', 'profile_url', 'list', 'contact', 'contact_type', 'contact_scope', 'status', 'confidence', 'provider', 'verified_at', 'confirmed_at', 'source_url', 'evidence_snippet', 'retrieved_at']; const rows = record.contacts.length ? record.contacts : [{}]; return [columns.join(','), ...rows.map((raw) => { const contact = contactView(raw) || {}; return [record.prospect.name, record.prospect.company, record.prospect.title, record.prospect.domain, record.prospect.profileUrl, record.list, contact.value, contact.contactType, contact.contactScope, contact.status, contact.confidence, contact.provider, contact.verifiedAt, contact.confirmedAt, contact.sourceUrl, contact.evidenceSnippet, contact.retrievedAt].map(csvCell).join(','); })].join('\n'); }
  function bytesToBase64(bytes) { let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary); }
  function base64ToBytes(value) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
  async function keyFor(passphrase, salt) { return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: base64ToBytes(salt), iterations: 250000, hash: 'SHA-256' }, await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
  function newSalt() { return bytesToBase64(crypto.getRandomValues(new Uint8Array(16))); }
  async function seal(value, passphrase, salt, authenticatedHeader = '') { const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await keyFor(passphrase, salt); const algorithm = { name: 'AES-GCM', iv, ...(authenticatedHeader ? { additionalData: new TextEncoder().encode(authenticatedHeader) } : {}) }; const cipher = await crypto.subtle.encrypt(algorithm, key, new TextEncoder().encode(JSON.stringify(value))); return { iv: bytesToBase64(iv), cipher: bytesToBase64(new Uint8Array(cipher)) }; }
  async function open(sealed, passphrase, salt, authenticatedHeader = '') { const key = await keyFor(passphrase, salt); const algorithm = { name: 'AES-GCM', iv: base64ToBytes(sealed.iv), ...(authenticatedHeader ? { additionalData: new TextEncoder().encode(authenticatedHeader) } : {}) }; const plain = await crypto.subtle.decrypt(algorithm, key, base64ToBytes(sealed.cipher)); return JSON.parse(new TextDecoder().decode(plain)); }
  function safeText(value, max = 1000) { return String(value || '').trim().slice(0, max); }
  function safeEmail(value) { const email = safeText(value, 320); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''; }
  function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.toString().length <= 2048 ? url.toString() : ''; } catch { return ''; } }
  function safeLinkedInPersonUrl(value) {
    const key = linkedInPersonKey(value);
    if (!key) return '';
    return `https://www.linkedin.com/in/${encodeURIComponent(key.slice('url:linkedin:'.length))}`;
  }
  function safeDate(value) { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? date.toISOString() : ''; }
  function safeCsvText(value, max) { return safeText(value, max).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' '); }
  function safeDomain(value) {
    const raw = safeCsvText(value, 500);
    if (!raw) return '';
    let candidate = raw;
    try { if (/^https?:\/\//i.test(raw)) { const url = new URL(raw); if (url.username || url.password) return ''; candidate = url.hostname; } else candidate = raw.split('/')[0].split(':')[0]; } catch { return ''; }
    candidate = candidate.toLowerCase().replace(/\.$/, '');
    return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(candidate) ? candidate : '';
  }
  function normalizeResearchProspect(input = {}) {
    const normalizeText = (value, max) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
    const name = normalizeText(input.name, 200);
    if (!name) throw new Error('Name is required.');
    const rawDomain = normalizeText(input.domain, 1000);
    const domain = canonicalResearchDomain(rawDomain);
    const domainCandidate = rawDomain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    if (domainCandidate && !domain) throw new Error('Company domain must be a valid hostname.');
    const rawEmail = input.importedEmail || input.email || input.workEmail;
    const importedEmail = normalizeText(rawEmail, 320);
    if (importedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(importedEmail)) throw new Error('Work email must be valid.');
    const parts = name.split(' ');
    return { name, firstName: parts[0].toLowerCase(), lastName: parts.length > 1 ? parts.at(-1).toLowerCase() : '', company: normalizeText(input.company, 200), title: normalizeText(input.title, 200), domain, profileUrl: normalizeText(input.profileUrl, 2048), importedEmail, importedPhone: normalizeText(input.importedPhone || input.phone || input.businessPhone, 100) };
  }
  function safeBusinessPhone(value) {
    const phone = safeCsvText(value, 50);
    const match = phone.match(/^(\+?[\d().\-\s]*\d[\d().\-\s]*?)(?:\s*(?:ext\.?|x|#)\s*\d{1,8})?$/i);
    const baseDigits = match?.[1].replace(/\D/g, '') || '';
    const allDigits = phone.replace(/\D/g, '');
    return match && baseDigits.length >= 7 && baseDigits.length <= 15 && allDigits.length <= 20 ? phone : '';
  }
  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    let afterQuote = false;
    const finishCell = () => { row.push(cell); cell = ''; afterQuote = false; };
    const finishRow = () => { finishCell(); rows.push(row); row = []; if (rows.length > 1001) throw new Error('CSV cannot contain more than 1,000 data rows.'); };
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
        else if (character === '"') { quoted = false; afterQuote = true; }
        else cell += character;
        continue;
      }
      if (afterQuote) {
        if (character === ',') finishCell();
        else if (character === '\n' || character === '\r') { finishRow(); if (character === '\r' && text[index + 1] === '\n') index += 1; }
        else if (!/[\t ]/.test(character)) throw new Error('CSV contains characters after a closing quote.');
      } else if (character === '"') {
        if (cell) throw new Error('CSV contains a quote inside an unquoted field.');
        quoted = true;
      } else if (character === ',') finishCell();
      else if (character === '\n' || character === '\r') { finishRow(); if (character === '\r' && text[index + 1] === '\n') index += 1; }
      else cell += character;
    }
    if (quoted) throw new Error('CSV contains an unclosed quoted field.');
    if (cell || row.length) finishRow();
    return rows.filter((values) => values.some((value) => String(value).trim()));
  }
  const CSV_HEADER_FIELDS = Object.freeze({
    name: 'name', full_name: 'name', contact_name: 'name', first_name: 'firstName', firstname: 'firstName', given_name: 'firstName', last_name: 'lastName', lastname: 'lastName', family_name: 'lastName', company: 'company', company_name: 'company', organization: 'company', account: 'company', title: 'title', job_title: 'title', role: 'title', domain: 'domain', company_domain: 'domain', website: 'domain', profile_url: 'profileUrl', linkedin_url: 'profileUrl', linkedin: 'profileUrl', work_email: 'workEmail', business_email: 'workEmail', business_phone: 'businessPhone', work_phone: 'businessPhone', source_url: 'sourceUrl', evidence_url: 'sourceUrl', source_note: 'evidenceSnippet', evidence_snippet: 'evidenceSnippet', evidence: 'evidenceSnippet', list: 'list', do_not_contact: 'doNotContact', dnc: 'doNotContact'
  });
  function normalizedCsvHeader(value) { return String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  function csvList(value) {
    const normalized = safeCsvText(value, 80).toLowerCase().replace(/[_-]+/g, ' ');
    if (!normalized || normalized === 'saved' || normalized === 'saved prospects') return 'Saved prospects';
    if (normalized === 'follow up' || normalized === 'followup') return 'Follow up';
    if (normalized === 'do not contact' || normalized === 'dnc') return 'Do not contact';
    return '';
  }
  function csvBoolean(value) {
    const normalized = safeCsvText(value, 30).toLowerCase();
    if (!normalized || ['0', 'false', 'no', 'n'].includes(normalized)) return false;
    if (['1', 'true', 'yes', 'y', 'dnc', 'do not contact'].includes(normalized)) return true;
    return null;
  }
  function parseRecruiterCsv(text, sourceName = 'recruiter CSV', importedAt = new Date().toISOString()) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('CSV file is empty.');
    if (new TextEncoder().encode(text).byteLength > 1_000_000) throw new Error('CSV file exceeds 1 MB.');
    if (text.includes('\uFFFD')) throw new Error('CSV must be valid UTF-8.');
    const rows = parseCsvRows(text);
    if (rows.length < 2) throw new Error('CSV needs a header and at least one data row.');
    const headers = rows[0].map(normalizedCsvHeader);
    if (!headers.length || headers.length > 50 || headers.some((header) => !header)) throw new Error('CSV header is missing or invalid.');
    if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate headers.');
    const forbidden = headers.filter((header) => ['email', 'phone'].includes(header) || /(?:^|_)(?:personal|private|home|mobile|cell|cellular|whatsapp)(?:_|$)/.test(header));
    if (forbidden.length) throw new Error('Personal-contact columns are not supported. Use work_email and business_phone only.');
    const fields = headers.map((header) => CSV_HEADER_FIELDS[header] || '');
    const mapped = fields.filter(Boolean);
    if (new Set(mapped).size !== mapped.length) throw new Error('CSV contains more than one column for the same field.');
    if (!mapped.includes('name') && !(mapped.includes('firstName') && mapped.includes('lastName'))) throw new Error('CSV needs name, or both first_name and last_name.');
    const source = safeCsvText(sourceName, 120) || 'recruiter CSV';
    const when = safeDate(importedAt);
    if (!when) throw new Error('Import time is invalid.');
    const records = [];
    const issues = [];
    let rejected = 0;
    let strippedContacts = 0;
    const addIssue = (rowNumber, message) => { if (issues.length < 20) issues.push(`Row ${rowNumber}: ${message}`); };
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const values = rows[rowIndex];
      const rowNumber = rowIndex + 1;
      if (values.length > headers.length) { rejected += 1; addIssue(rowNumber, 'has more cells than the header.'); continue; }
      const row = {};
      fields.forEach((field, index) => { if (field) row[field] = values[index] || ''; });
      const suppliedFirstName = safeCsvText(row.firstName, 100);
      const suppliedLastName = safeCsvText(row.lastName, 100);
      const rawName = safeCsvText(row.name, 200);
      const composedName = [suppliedFirstName, suppliedLastName].filter(Boolean).join(' ');
      const name = rawName.split(/\s+/).filter(Boolean).length > 1 ? rawName : composedName || rawName;
      const nameParts = name.split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.length > 1 ? nameParts.at(-1) : '';
      const rawDomain = safeCsvText(row.domain, 500);
      const domain = safeDomain(rawDomain);
      const rawProfileUrl = safeCsvText(row.profileUrl, 2048);
      const profileUrl = safeLinkedInPersonUrl(rawProfileUrl);
      const rawSourceUrl = safeCsvText(row.sourceUrl, 2048);
      const sourceUrl = safeUrl(rawSourceUrl);
      const dnc = csvBoolean(row.doNotContact);
      const list = csvList(row.list);
      if (!name) { rejected += 1; addIssue(rowNumber, 'name is required.'); continue; }
      if (rawDomain && !domain) { rejected += 1; addIssue(rowNumber, 'company domain is invalid.'); continue; }
      if (rawProfileUrl && !profileUrl) { rejected += 1; addIssue(rowNumber, 'profile_url must be a LinkedIn person URL (/in/...).'); continue; }
      if (rawSourceUrl && !sourceUrl) { rejected += 1; addIssue(rowNumber, 'source URL must be HTTP(S) without credentials.'); continue; }
      if (dnc === null) { rejected += 1; addIssue(rowNumber, 'do_not_contact must be yes/no or true/false.'); continue; }
      if (!list) { rejected += 1; addIssue(rowNumber, 'list must be Saved prospects, Follow up, or Do not contact.'); continue; }
      if (!(domain && firstName && lastName)) { rejected += 1; addIssue(rowNumber, 'needs a full name and explicit company domain for opt-out screening.'); continue; }
      let emailValue = safeCsvText(row.workEmail, 320);
      let phoneValue = safeCsvText(row.businessPhone, 50);
      const email = safeEmail(emailValue);
      const phone = safeBusinessPhone(phoneValue);
      const blocked = dnc || list === 'Do not contact';
      if (!blocked && emailValue && !email) { rejected += 1; addIssue(rowNumber, 'work email is invalid.'); continue; }
      if (!blocked && phoneValue && !phone) { rejected += 1; addIssue(rowNumber, 'business phone is invalid.'); continue; }
      if (blocked && (emailValue || phoneValue)) strippedContacts += 1;
      const evidenceSnippet = safeCsvText(row.evidenceSnippet, 1000) || `Imported from ${source}, row ${rowNumber}.`;
      const reason = `Imported from recruiter-controlled CSV (${source}, row ${rowNumber}); identity, deliverability, ownership, and permission to contact are not verified.`;
      const contacts = blocked ? [] : [email && { id: crypto.randomUUID(), value: email, contactType: 'work_email', contactScope: 'person_candidate', status: 'recruiter_imported', statusLabel: 'Recruiter supplied — identity unchecked', confidence: 50, reason, provider: 'recruiter_csv', verifiedAt: '', confirmedAt: '', sourceUrl, evidenceSnippet, retrievedAt: when }, phone && { id: crypto.randomUUID(), value: phone, contactType: 'business_phone', contactScope: 'person_candidate', status: 'recruiter_imported', statusLabel: 'Recruiter supplied — identity unchecked', confidence: 40, reason, provider: 'recruiter_csv', verifiedAt: '', confirmedAt: '', sourceUrl, evidenceSnippet, retrievedAt: when }].filter(Boolean);
      records.push({ id: crypto.randomUUID(), prospect: { name, firstName, lastName, company: safeCsvText(row.company, 200), title: safeCsvText(row.title, 200), domain, profileUrl, importedEmail: blocked ? '' : email, importedPhone: blocked ? '' : phone }, contacts, employmentHistory: [], suppressed: false, saved: true, list: blocked ? 'Do not contact' : list, sequence: [], note: '', importProvenance: { source, row: rowNumber, importedAt: when }, createdAt: when, updatedAt: when });
    }
    if (!records.length) throw new Error(issues[0] || 'CSV contains no valid records.');
    return { records, accepted: records.length, rejected, strippedContacts, ignoredColumns: headers.filter((header, index) => !fields[index]), issues };
  }
  function recruiterImportRecord(input = {}) {
    const source = input.prospect || {};
    const name = safeCsvText(source.name, 200);
    const nameParts = name.split(/\s+/).filter(Boolean);
    const domain = safeDomain(source.domain);
    const profileUrl = safeLinkedInPersonUrl(source.profileUrl);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.length > 1 ? nameParts.at(-1) : '';
    if (!name || !(domain && firstName && lastName)) return null;
    const blocked = Boolean(input.suppressed) || input.list === 'Do not contact';
    const when = safeDate(input.updatedAt) || new Date().toISOString();
    const contacts = blocked ? [] : (Array.isArray(input.contacts) ? input.contacts : []).slice(0, 100).map((contact) => {
      const contactType = ['work_email', 'business_phone'].includes(contact.contactType) ? contact.contactType : '';
      const value = contactType === 'work_email' ? safeEmail(contact.value) : safeBusinessPhone(contact.value);
      if (!contactType || !value) return null;
      return { id: crypto.randomUUID(), value, contactType, contactScope: 'person_candidate', status: 'recruiter_imported', statusLabel: 'Recruiter supplied — identity unchecked', confidence: contactType === 'work_email' ? 50 : 40, reason: safeCsvText(contact.reason, 1000) || 'Imported from recruiter-controlled CSV; identity and ownership are not verified.', provider: 'recruiter_csv', verifiedAt: '', confirmedAt: '', sourceUrl: safeUrl(contact.sourceUrl), evidenceSnippet: safeCsvText(contact.evidenceSnippet, 1000), retrievedAt: safeDate(contact.retrievedAt) || when };
    }).filter(Boolean);
    const email = contacts.find((contact) => contact.contactType === 'work_email')?.value || '';
    const phone = contacts.find((contact) => contact.contactType === 'business_phone')?.value || '';
    const provenance = input.importProvenance || {};
    return { id: crypto.randomUUID(), prospect: { name, firstName, lastName, company: safeCsvText(source.company, 200), title: safeCsvText(source.title, 200), domain, profileUrl, importedEmail: blocked ? '' : email, importedPhone: blocked ? '' : phone }, contacts, employmentHistory: [], suppressed: Boolean(input.suppressed), saved: true, list: blocked ? 'Do not contact' : input.list === 'Follow up' ? 'Follow up' : 'Saved prospects', sequence: [], note: '', importProvenance: { source: safeCsvText(provenance.source, 120), row: Number.isInteger(provenance.row) && provenance.row > 1 ? provenance.row : 0, importedAt: safeDate(provenance.importedAt) || when }, createdAt: safeDate(input.createdAt) || when, updatedAt: when };
  }
  function contactIdentityKey(contact = {}) { const value = contact.contactType === 'work_email' ? String(contact.value || '').trim().toLowerCase() : String(contact.value || '').replace(/\D/g, ''); return contact.contactType && value ? `${contact.contactType}|${value}` : ''; }
  function mergeRecruiterImport(records, imported) {
    let merged = Array.isArray(records) ? records : [];
    let added = 0;
    let deduplicated = 0;
    let conflicts = 0;
    let blockingConflicts = 0;
    let doNotContact = 0;
    let removedContacts = 0;
    const conflictDetails = [];
    for (const candidate of Array.isArray(imported) ? imported : []) {
      let record = recruiterImportRecord(candidate);
      if (!record) { conflicts += 1; continue; }
      const key = prospectKey(record.prospect);
      const duplicate = key && merged.find((item) => prospectKey(item.prospect) === key);
      const normalizedName = (prospect) => String(prospect?.name || '').trim().toLowerCase();
      if (duplicate && normalizedName(duplicate.prospect) !== normalizedName(record.prospect)) { conflicts += 1; if (!canContact(duplicate) || !canContact(record)) blockingConflicts += 1; if (conflictDetails.length < 20) conflictDetails.push(`${record.prospect.name}${record.importProvenance?.row ? ` (row ${record.importProvenance.row})` : ''}`); continue; }
      const sameNames = !duplicate ? merged.filter((item) => normalizedName(item.prospect) && normalizedName(item.prospect) === normalizedName(record.prospect)) : [];
      const suppressionKey = suppressionIdentityKey(record.prospect);
      const sameSuppressionAlias = !duplicate && suppressionKey ? merged.find((item) => suppressionIdentityKey(item.prospect) === suppressionKey) : null;
      const nameKey = nameIdentityKey(record.prospect);
      const canDisambiguate = (item) => { const localUrl = linkedInPersonKey(item?.prospect?.profileUrl); const incomingUrl = linkedInPersonKey(record.prospect.profileUrl); return localUrl && incomingUrl && localUrl !== incomingUrl; };
      const dncNameAlias = !duplicate && nameKey ? merged.find((item) => nameIdentityKey(item.prospect) === nameKey && (!canContact(item) || !canContact(record)) && !canDisambiguate(item)) : null;
      const dncAmbiguous = sameNames.some((item) => (!canContact(item) || !canContact(record)) && !canDisambiguate(item)) || Boolean(sameSuppressionAlias && (!canContact(sameSuppressionAlias) || !canContact(record))) || Boolean(dncNameAlias);
      const ambiguous = !duplicate && (merged.some((item) => sameNamedOrganization(item.prospect, record.prospect)) || sameSuppressionAlias || dncAmbiguous);
      if (ambiguous) { conflicts += 1; if (dncAmbiguous || !canContact(record)) blockingConflicts += 1; if (conflictDetails.length < 20) conflictDetails.push(`${record.prospect.name}${record.importProvenance?.row ? ` (row ${record.importProvenance.row})` : ''}`); continue; }
      const existingContactKeys = new Set((duplicate?.contacts || []).map(contactIdentityKey).filter(Boolean));
      if (duplicate && canContact(duplicate) && canContact(record)) record = { ...record, contacts: record.contacts.filter((contact) => !existingContactKeys.has(contactIdentityKey(contact))) };
      const previousContacts = duplicate?.contacts?.length || 0;
      const result = upsertRecord(merged, record);
      merged = result.records;
      if (result.deduplicated) deduplicated += 1; else added += 1;
      if (!canContact(result.record)) doNotContact += 1;
      removedContacts += Math.max(0, previousContacts - (result.record.contacts?.length || 0));
    }
    return { records: merged, imported: added + deduplicated, added, deduplicated, conflicts, conflictDetails, blockingConflicts, doNotContact, removedContacts };
  }
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
    return { id: crypto.randomUUID(), prospect: { name, firstName: safeText(source.firstName, 100), lastName: safeText(source.lastName, 100), company: safeText(source.company, 200), title: safeText(source.title, 200), domain: safeDomain(source.domain), profileUrl: safeUrl(source.profileUrl), importedEmail: blocked ? '' : safeEmail(source.importedEmail), importedPhone: blocked ? '' : safeBusinessPhone(source.importedPhone) }, contacts, employmentHistory: history, suppressed, saved: true, list: blocked ? 'Do not contact' : lists.has(input.list) ? input.list : 'Saved prospects', sequence: [], note: '', createdAt: safeDate(input.createdAt), updatedAt: safeDate(input.updatedAt) };
  }
  async function createHandoff(records, passphrase, list) {
    if (String(passphrase || '').length < 12) throw new Error('Share passphrase must contain at least 12 characters.');
    const source = Array.isArray(records) ? records : [];
    const chosen = source.filter((record) => record?.saved && record.list === list);
    if (!chosen.length) throw new Error('Selected list has no saved records.');
    if (chosen.some((record) => canContact(record) && !hasDurableSuppressionAlias(record.prospect))) throw new Error('Every active handoff record needs a canonical LinkedIn person URL or a full name and valid company domain.');
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
    let blockingConflicts = 0;
    let suppressions = 0;
    let removedContacts = 0;
    let importedCount = 0;
    for (const candidate of Array.isArray(imported) ? imported : []) {
      const record = sanitizeSharedRecord(candidate);
      if (!record) continue;
      const addConflict = () => { conflicts += 1; if (!canContact(record)) blockingConflicts += 1; };
      const key = prospectKey(record.prospect);
      const exactDuplicate = key && merged.find((item) => prospectKey(item.prospect) === key);
      const suppressionAlias = exactDuplicate ? null : suppressionAliasRecord(merged, record);
      const duplicate = exactDuplicate || suppressionAlias;
      const exactNameMismatch = exactDuplicate && String(exactDuplicate.prospect?.name || '').trim().toLowerCase() !== String(record.prospect?.name || '').trim().toLowerCase();
      if (exactNameMismatch && canContact(record)) { addConflict(); continue; }
      // Never import an active middle-name/profile variation over a matching DNC.
      // An incoming DNC, however, is allowed to suppress the local alias below.
      if (suppressionAlias && canContact(record)) { addConflict(); continue; }
      const ambiguous = !duplicate && merged.some((item) => sameNamedOrganization(item.prospect, record.prospect));
      if (ambiguous || (exactDuplicate && !key.startsWith('url:') && canContact(record))) { addConflict(); continue; }
      const wasBlocked = duplicate ? !canContact(duplicate) : false;
      const previousContacts = duplicate?.contacts?.length || 0;
      // A DNC attached to the same canonical LinkedIn person key must win even
      // if the shared display name/domain drifted. Keep the trusted local
      // identity so the handoff cannot overwrite it while applying suppression.
      const incoming = exactNameMismatch ? { ...record, prospect: { ...exactDuplicate.prospect, importedEmail: '', importedPhone: '' } } : record;
      const result = upsertRecord(merged, incoming);
      merged = result.records;
      importedCount += 1;
      if (result.deduplicated) deduplicated += 1;
      if (!wasBlocked && !canContact(result.record)) suppressions += 1;
      removedContacts += Math.max(0, previousContacts - (result.record.contacts?.length || 0));
    }
    return { records: merged, imported: importedCount, deduplicated, conflicts, blockingConflicts, suppressions, removedContacts };
  }
  return { createRecord, canContact, contactView, confirmContact, draftableEmail, matchesProspect, linkedInPersonUrl: safeLinkedInPersonUrl, hasDurableSuppressionAlias, normalizeResearchProspect, purgeProspect, purgeSuppressedProspects, upsertRecord, recommendRelated, workspaceRecords, queueDraft, toCsv, parseRecruiterCsv, mergeRecruiterImport, newSalt, seal, open, createHandoff, openHandoff, mergeImportedRecords };
}));
