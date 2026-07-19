const $ = (id) => document.getElementById(id);
const CONSENT_VERSION = 4;
let current = null;
let vault = null;
let passphrase = '';
let pendingHandoff = null;
let pendingContactImport = null;
let vaultWriteInProgress = false;
let vaultUnlockInProgress = false;
let vaultRevision = 0;
let pendingVaultRevision = null;
let vaultStale = false;
let previewGeneration = 0;
let researchInProgress = false;
const sessionSuppressionSignals = [];

function vaultDefault() { return { token: '', records: [], selectedRecordId: '' }; }
async function storage() { return chrome.storage.local.get(['apiUrl', 'vaultSalt', 'vaultData', 'vaultRevision', 'consentVersion']); }
function normalizedRevision(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
async function ensureVaultSalt(candidate) { const result = await chrome.runtime.sendMessage({ type: 'findemm-vault-salt', candidate }); if (!result?.ok || !result.vaultSalt) throw new Error(result?.error || 'Could not initialize the vault salt.'); return result.vaultSalt; }
async function saveVault(value = vault, expectedVault = vault, encryptionPassphrase = passphrase, expectedStorageRevision = vaultRevision) {
  if (!value || !encryptionPassphrase) throw new Error('Unlock the secure local vault first.');
  if (vault !== expectedVault) throw new Error('Vault changed. Refresh the preview and try again.');
  if (vaultWriteInProgress) throw new Error('Another vault change is still saving. Try again.');
  const expectedRevision = expectedStorageRevision;
  vaultWriteInProgress = true;
  try {
    const { vaultSalt } = await storage();
    if (!vaultSalt) throw new Error('Vault salt is unavailable. Unlock the vault again.');
    const vaultData = await FindEmmState.seal(value, encryptionPassphrase, vaultSalt);
    if (vault !== expectedVault) throw new Error('Vault changed. Refresh the preview and try again.');
    pendingVaultRevision = expectedRevision + 1;
    const result = await chrome.runtime.sendMessage({ type: 'findemm-vault-cas', expectedRevision, vaultData });
    if (!result?.ok) { if (result?.stale) vaultStale = true; throw new Error(result?.stale ? 'Vault changed in another popup. Unlock it again before saving.' : result?.error || 'Encrypted vault write failed.'); }
    vaultRevision = result.revision;
  }
  finally { pendingVaultRevision = null; vaultWriteInProgress = false; }
}
async function removeVaultStorage(expectedVault) {
  if (vault !== expectedVault) throw new Error('Vault changed. Try again.');
  if (vaultWriteInProgress) throw new Error('Another vault change is still saving. Try again.');
  const expectedRevision = vaultRevision;
  vaultWriteInProgress = true;
  try { pendingVaultRevision = expectedRevision + 1; const result = await chrome.runtime.sendMessage({ type: 'findemm-vault-remove', expectedRevision }); if (!result?.ok) { if (result?.stale) vaultStale = true; throw new Error(result?.stale ? 'Vault changed in another popup. Unlock it again before deleting.' : result?.error || 'Encrypted vault delete failed.'); } vaultRevision = result.revision; }
  finally { pendingVaultRevision = null; vaultWriteInProgress = false; }
}
function clearHandoffPreview(message = 'No handoff previewed.') { previewGeneration += 1; pendingHandoff = null; $('merge-handoff').disabled = true; $('handoff-preview').textContent = message; }
function clearContactImportPreview(message = 'No contact CSV previewed.') { previewGeneration += 1; pendingContactImport = null; $('merge-contact-import').disabled = true; $('contact-import-preview').textContent = message; }
function clearPendingPreviews() { clearHandoffPreview(); clearContactImportPreview(); }
function assertActivePreview(generation) { if (generation !== previewGeneration) throw Object.assign(new Error('A newer file preview replaced this one.'), { stalePreview: true }); }
function assertVaultSnapshot(expectedVault, expectedRevision) { if (vaultStale || vaultWriteInProgress || vaultUnlockInProgress || vault !== expectedVault || vaultRevision !== expectedRevision) throw new Error('Encrypted vault changed during this operation. Review the current vault and try again.'); }
function invalidateStaleVault() {
  vaultStale = true;
  clearHandoffPreview('Handoff preview cleared because the encrypted vault changed in another popup.');
  clearContactImportPreview('Contact import preview cleared because the encrypted vault changed in another popup.');
  if (current) renderRecord(current, false);
  renderShortlist();
  $('status').textContent = 'Encrypted vault changed in another popup. Unlock again before researching, exporting, or drafting.';
}
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.vaultRevision) return;
  const nextRevision = normalizedRevision(changes.vaultRevision.newValue);
  if (nextRevision !== vaultRevision && nextRevision !== pendingVaultRevision) invalidateStaleVault();
});
async function unlockVault() {
  if (vaultUnlockInProgress) throw new Error('Vault unlock is already in progress.');
  if (vaultWriteInProgress) throw new Error('Wait for the current vault change to finish before unlocking again.');
  vaultUnlockInProgress = true;
  try {
    const entered = $('vault-passphrase').value;
    if (entered.length < 12) throw new Error('Use a vault passphrase with at least 12 characters.');
    clearPendingPreviews();
    const saved = await storage();
    const salt = saved.vaultSalt || await ensureVaultSalt(FindEmmState.newSalt());
    const previousVault = vault;
    const nextVault = saved.vaultData ? await FindEmmState.open(saved.vaultData, entered, salt) : vaultDefault();
    const loadedRevision = normalizedRevision(saved.vaultRevision);
    const suppliedToken = $('token').value.trim();
    if (suppliedToken) nextVault.token = suppliedToken;
    await saveVault(nextVault, previousVault, entered, loadedRevision);
    vault = nextVault;
    passphrase = entered;
    vaultStale = false;
    let reconciled;
    try { reconciled = await reconcileUnlockedVault(); }
    catch (error) {
      vaultStale = true;
      if (current) renderRecord(current, false);
      renderShortlist();
      throw new Error(`Vault decrypted, but the required suppression reconciliation failed: ${error.message}. Unlock again before researching, exporting, or drafting.`);
    }
    vaultUnlockInProgress = false;
    $('token').value = vault.token || '';
    const reconciliationNotes = [reconciled.removed && `${reconciled.removed} newly matched provider opt-out record(s) deleted`, reconciled.quarantined && `${reconciled.quarantined} active record(s) quarantined until a company domain or LinkedIn /in/ URL is added`].filter(Boolean);
    $('vault-status').textContent = reconciliationNotes.length ? `Vault unlocked; ${reconciliationNotes.join('; ')}.` : 'Vault unlocked and suppression-reconciled for this popup session.';
    renderShortlist();
    const selected = vault.records.find((record) => record.id === vault.selectedRecordId);
    if (selected) renderRecord(selected);
    else clearCurrentDisplay();
  } finally { vaultUnlockInProgress = false; }
}
async function request(path, options = {}, allowDuringUnlock = false) {
  if (vaultStale) throw new Error('Encrypted vault changed in another popup. Unlock it again first.');
  if (vaultUnlockInProgress && !allowDuringUnlock) throw new Error('Wait for vault suppression reconciliation to finish.');
  if (vaultWriteInProgress) throw new Error('Wait for the current encrypted-vault change to finish.');
  if (!vault?.token) throw new Error('Unlock the vault and save the local API pairing token first.');
  const requestVault = vault;
  const requestRevision = vaultRevision;
  const { apiUrl = 'http://127.0.0.1:4317' } = await storage();
  if (vaultStale || vaultWriteInProgress || vault !== requestVault || vaultRevision !== requestRevision) throw new Error('Encrypted vault changed before the request could start. Review the current record and try again.');
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', 'x-findemm-token': vault.token, ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({ error: 'Server returned invalid JSON' }));
  if (!response.ok) { const error = new Error(body.error || `Request failed (${response.status})`); error.status = response.status; error.code = body.code; throw error; }
  return body;
}
function escape(value = '') { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function initials(name = '') { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '??'; }
function statusClass(status) { const classes = { publicly_found: 'publicly_found', provider_valid: 'provider_valid', user_confirmed: 'user_confirmed', recruiter_imported: 'recruiter_imported' }; return `status-${classes[status] || 'unverified'}`; }
function contactKind(contact) { return contact.contactType === 'business_phone' ? '☎' : '✉'; }
function scopeLabel(contact) { const labels = { company: 'Company-level', candidate: 'Pattern only', person_candidate: 'Attributed person candidate', person_confirmed: 'Recruiter-checked person match' }; return labels[contact.contactScope] || 'Identity unchecked'; }
function dateLabel(value) { const time = Date.parse(value || ''); return Number.isFinite(time) ? new Date(time).toLocaleDateString() : 'Date unavailable'; }
function recordFrom(prospect, contacts) { return FindEmmState.createRecord(prospect, contacts); }
async function persist(record) { if (vaultStale || vaultUnlockInProgress) throw new Error('Unlock and suppression-reconcile the current vault before saving.'); clearPendingPreviews(); const baseVault = vault; const result = FindEmmState.upsertRecord(baseVault.records, record); const nextVault = { ...baseVault, records: result.records, selectedRecordId: result.record.id }; await saveVault(nextVault, baseVault); vault = nextVault; current = result.record; return result; }
function switchView(view) { document.querySelectorAll('.view').forEach((node) => { node.hidden = node.id !== `${view}-view`; }); document.querySelectorAll('.tab').forEach((node) => { const active = node.dataset.view === view; node.classList.toggle('is-active', active); node.setAttribute('aria-selected', String(active)); node.tabIndex = active ? 0 : -1; }); if (view === 'shortlist') renderShortlist(); }
function confirmable(contact) { return contact.contactType === 'work_email' && contact.contactScope !== 'company' && ['provider_valid', 'provider_stale', 'provider_unverified', 'recruiter_imported', 'shared_candidate'].includes(contact.status); }
function recordSignal(record) {
  if (record && FindEmmState.canContact(record) && !FindEmmState.hasDurableSuppressionAlias(record.prospect)) return 'Suppression identity incomplete';
  if (!mayContact(record)) return isSessionSuppressed(record.prospect) ? 'Provider opt-out — purge pending' : 'Opt-out safeguard';
  const contacts = (record.contacts || []).map((contact) => FindEmmState.contactView(contact));
  if (contacts.some((contact) => contact.status === 'user_confirmed' && contact.contactType === 'work_email')) return 'Recruiter-checked email';
  if (contacts.some((contact) => contact.status === 'provider_valid')) return 'Valid mailbox; identity unchecked';
  if (contacts.some((contact) => confirmable(contact))) return 'Contact needs identity check';
  if (contacts.some((contact) => contact.contactScope === 'company')) return 'Company contact channel';
  return 'No contact yet';
}
function isSessionSuppressed(prospect) { return FindEmmState.purgeSuppressedProspects([{ prospect }], sessionSuppressionSignals).removed > 0; }
function mayResearch(record) { return Boolean(record) && !vaultStale && !vaultUnlockInProgress && !vaultWriteInProgress && FindEmmState.canContact(record) && !localDncRecord(record.prospect) && !isSessionSuppressed(record.prospect); }
function mayContact(record) { return mayResearch(record) && FindEmmState.hasDurableSuppressionAlias(record.prospect); }
function currentVaultRecord() { return current?.saved ? vault?.records.find((record) => record.id === current.id) || null : current; }
function clearCurrentDisplay() { current = null; $('record-card').hidden = true; $('empty-record').hidden = false; }
function renderRecord(record, openView = true) {
  current = record; $('empty-record').hidden = true; $('record-card').hidden = false;
  const contactAllowed = mayContact(record);
  $('initials').textContent = initials(record.prospect.name); $('record-name').textContent = record.prospect.name; $('record-title').textContent = record.prospect.title || 'Role not supplied'; $('record-company').textContent = record.prospect.company || 'Company not supplied'; $('record-domain').textContent = record.prospect.domain || 'No company domain'; $('record-count').textContent = `${record.contacts.length} contact${record.contacts.length === 1 ? '' : 's'}`; $('record-note').value = record.note || ''; $('list-select').value = record.list || 'Saved prospects'; $('list-copy').textContent = record.saved ? `Saved in ${record.list}.` : 'Not yet saved to a list.'; $('save-label').textContent = record.saved ? `Saved to ${record.list}` : 'Save to local list'; $('save-record').textContent = record.saved ? 'Saved locally' : 'Save record'; $('sequence-copy').textContent = contactAllowed ? record.sequence?.length ? `${record.sequence.length} draft follow-up step(s) queued locally.` : 'Keep the next step local until you act.' : 'Opt-out active. Outreach actions are disabled.';
  $('draft-outreach').disabled = !contactAllowed; $('queue-followup').disabled = !contactAllowed; $('research-record').disabled = !mayResearch(record);
  if (!contactAllowed && FindEmmState.canContact(record) && !FindEmmState.hasDurableSuppressionAlias(record.prospect)) $('sequence-copy').textContent = 'Add a company domain or LinkedIn /in/ person URL through Research before contact or export actions.';
  $('contacts').innerHTML = record.contacts.map((raw) => { const contact = FindEmmState.contactView(raw); const kind = contact.contactType === 'business_phone' ? 'kind-phone' : ['provider_unverified', 'provider_stale', 'shared_candidate'].includes(contact.status) ? 'kind-candidate' : contact.status === 'provider_valid' ? 'kind-provider' : 'kind-email'; const verification = contact.verifiedAt ? `<span>Mailbox status dated ${escape(dateLabel(contact.verifiedAt))}</span>` : ''; const action = contactAllowed && confirmable(contact) ? `<button class="text-button confirm-contact" type="button" data-contact-id="${escape(contact.id)}">Confirm person match</button>` : ''; const source = contact.sourceUrl ? `<a href="${escape(contact.sourceUrl)}" target="_blank" rel="noreferrer">Evidence</a>` : contact.provider ? escape(contact.provider) : 'Recruiter input'; return `<article class="contact-row"><span class="contact-kind ${kind}">${contactKind(contact)}</span><div class="contact-main"><div class="contact-value">${escape(contact.value)}</div><div class="contact-meta"><span class="status-pill ${statusClass(contact.status)}">${escape(contact.statusLabel)}</span><span>${escape(scopeLabel(contact))}</span><span>${escape(contact.confidence)}% source confidence</span>${verification}<span>${escape(contact.reason)}</span>${contact.evidenceSnippet ? `<span>Source excerpt: ${escape(contact.evidenceSnippet)}</span>` : ''}</div>${action}</div><div class="contact-source">${source}<br>${escape(dateLabel(contact.retrievedAt))}</div></article>`; }).join('');
  $('no-contacts').hidden = record.contacts.length > 0; if (openView) switchView('record');
  const recommendations = FindEmmState.recommendRelated(record, vault?.records);
  $('recommendations').innerHTML = recommendations.map(({ record: match, reason }) => `<article class="recommendation-row"><div><strong>${escape(match.prospect.name)}</strong><small>${escape(match.prospect.title || 'Role not supplied')} · ${escape(match.prospect.company || 'Company not supplied')}</small><span>${escape(reason)}</span></div><button class="text-button" type="button" data-record-id="${escape(match.id)}">Open</button></article>`).join('');
  $('no-recommendations').hidden = recommendations.length > 0;
  const history = record.employmentHistory || [];
  $('employment-history').innerHTML = history.map((item) => `<p>${escape(item.title || 'Role not supplied')} · ${escape(item.company || item.domain || 'Company not supplied')}<br><span class="muted">Detected ${escape(dateLabel(item.detectedAt))}</span></p>`).join('');
  $('employment-history-panel').hidden = history.length === 0;
  $('delete-record').hidden = !record.saved;
}
function reconcileCurrentFromVault() {
  if (!current?.saved) return current;
  const refreshed = currentVaultRecord();
  if (!refreshed) { clearCurrentDisplay(); return null; }
  renderRecord(refreshed, false);
  return refreshed;
}
function renderShortlist() {
  const workspace = FindEmmState.workspaceRecords(vault?.records || [], $('shortlist-search').value, $('shortlist-filter').value);
  $('count-active').textContent = workspace.counts.active; $('count-followup').textContent = workspace.counts.followUp; $('count-dnc').textContent = workspace.counts.doNotContact;
  $('shortlist-summary').textContent = vault ? `${workspace.total} matching of ${workspace.counts.total} saved · ${workspace.counts.queued} queued draft(s) · ${workspace.counts.roleChanges} role-change record(s).` : 'Unlock the local vault from Research to view saved records.';
  $('shortlist-records').innerHTML = workspace.records.map((record) => { const queued = (record.sequence || []).filter((item) => item.status === 'queued').length; const changes = record.employmentHistory?.length || 0; const list = FindEmmState.canContact(record) ? record.list : 'Do not contact'; return `<article class="shortlist-row"><div><strong>${escape(record.prospect.name)}</strong><small>${escape(record.prospect.title || 'Role not supplied')} · ${escape(record.prospect.company || record.prospect.domain || 'Company not supplied')}</small><span><b>${escape(list)}</b> · ${escape(recordSignal(record))}${queued ? ` · ${queued} queued` : ''}${changes ? ` · ${changes} role change${changes === 1 ? '' : 's'}` : ''}</span></div><button class="text-button" type="button" data-shortlist-id="${escape(record.id)}">Open</button></article>`; }).join('');
  $('no-shortlist').hidden = workspace.records.length > 0;
}
function formProspect() { return ['name', 'company', 'title', 'domain', 'profileUrl', 'importedEmail', 'importedPhone'].reduce((out, id) => ({ ...out, [id]: $(id).value.trim() }), {}); }
function localDncRecord(prospect) {
  if (!vault) return null;
  const candidate = recordFrom(prospect, []);
  return vault.records.find((record) => {
    if (FindEmmState.canContact(record)) return false;
    if (FindEmmState.matchesProspect(record.prospect, prospect)) return true;
    const isolated = FindEmmState.upsertRecord([record], candidate);
    return isolated.deduplicated && !FindEmmState.canContact(isolated.record);
  }) || null;
}
function blockOptedOut(event) { const live = currentVaultRecord(); if (live && mayContact(live)) { current = live; return; } event.stopImmediatePropagation(); if (!live) clearCurrentDisplay(); else renderRecord(live, false); $('status').textContent = 'Opt-out active. Outreach action blocked.'; }
async function saveCurrent(message, changes = {}) { const live = currentVaultRecord(); if (!live) return; if (isSessionSuppressed(live.prospect)) throw new Error('Provider opt-out is active; this record cannot be changed or used.'); current = live; const candidate = { ...live, ...changes, saved: true, updatedAt: new Date().toISOString() }; const saved = await persist(candidate); renderRecord(saved.record); $('status').textContent = saved.changeDetected ? 'Existing person updated; previous role or company recorded.' : saved.deduplicated ? 'Existing person updated; contacts and local context merged.' : message; }
function exportRecord(record) { const csv = FindEmmState.toCsv(record); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const link = Object.assign(document.createElement('a'), { href: url, download: `findemm-${record.prospect.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv` }); link.click(); URL.revokeObjectURL(url); }
function downloadContactTemplate() {
  const headers = 'name,company,title,domain,profile_url,work_email,business_phone,source_url,source_note,list,do_not_contact\n';
  const url = URL.createObjectURL(new Blob([headers], { type: 'text/csv' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'findemm-contact-import-template.csv' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function screeningChanged(left, right) {
  const fields = ['checkable', 'suppressed', 'matchedLinkedIn', 'matchedPerson', 'blockedDomain'];
  return !Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.some((result, index) => fields.some((field) => result?.[field] !== right[index]?.[field]));
}
function suppressionSignals(records, screening) {
  return screening.flatMap((result, index) => result.suppressed ? [{ prospect: records[index].prospect, matchedLinkedIn: result.matchedLinkedIn, matchedPerson: result.matchedPerson }] : []);
}
function rememberSuppressionSignals(records, screening) {
  const signals = suppressionSignals(records, screening);
  if (!signals.length) return signals;
  sessionSuppressionSignals.push(...signals);
  if (current && FindEmmState.purgeSuppressedProspects([current], signals).removed) renderRecord(current, false);
  renderShortlist();
  return signals;
}
async function enforceScreenedSuppressions(records, screening, expectedVault = vault) {
  if (vault !== expectedVault) throw new Error('Vault changed. Refresh the preview and try again.');
  const signals = suppressionSignals(records, screening);
  if (!signals.length) return { removed: 0, currentRemoved: false };
  const purged = FindEmmState.purgeSuppressedProspects(expectedVault.records, signals);
  const currentRemoved = Boolean(current && FindEmmState.purgeSuppressedProspects([current], signals).removed);
  if (purged.removed) {
    const selectedRecordId = purged.records.some((record) => record.id === expectedVault.selectedRecordId) ? expectedVault.selectedRecordId : '';
    const nextVault = { ...expectedVault, records: purged.records, selectedRecordId };
    await saveVault(nextVault, expectedVault);
    vault = nextVault;
  }
  if (currentRemoved) clearCurrentDisplay();
  else if (purged.removed) reconcileCurrentFromVault();
  if (purged.removed || currentRemoved) renderShortlist();
  return { removed: purged.removed, currentRemoved };
}
async function screenContactRecords(records, requireCheckable = true, allowDuringUnlock = false) {
  const screening = await request('/v1/suppressions/screen', { method: 'POST', body: JSON.stringify({ prospects: records.map(({ prospect }) => ({ name: prospect.name, domain: prospect.domain, profileUrl: FindEmmState.linkedInPersonUrl(prospect.profileUrl) })) }) }, allowDuringUnlock);
  const invalid = !Array.isArray(screening.results) || screening.results.length !== records.length || screening.results.some((result, index) => result?.index !== index || typeof result.checkable !== 'boolean' || typeof result.suppressed !== 'boolean' || typeof result.matchedLinkedIn !== 'boolean' || typeof result.matchedPerson !== 'boolean' || typeof result.blockedDomain !== 'boolean' || result.suppressed !== (result.matchedLinkedIn || result.matchedPerson));
  if (invalid) throw new Error('Local suppression screen returned an invalid result. Update the companion API before importing.');
  rememberSuppressionSignals(records, screening.results);
  if (requireCheckable && screening.results.some((result) => !result.checkable)) throw new Error('At least one imported identity could not be suppression-screened.');
  return screening.results;
}
async function reconcileUnlockedVault() {
  const records = [...(vault?.records || [])];
  let removed = 0;
  let quarantined = 0;
  for (let offset = 0; offset < records.length; offset += 1000) {
    const chunk = records.slice(offset, offset + 1000);
    const screening = await screenContactRecords(chunk, false, true);
    quarantined += screening.filter((result, index) => !result.checkable && FindEmmState.canContact(chunk[index])).length;
    const purged = await enforceScreenedSuppressions(chunk, screening, vault);
    removed += purged.removed;
  }
  return { removed, quarantined };
}
async function reconcileAfterImportWrite(records, writtenVault, rollbackVault, requireCheckable) {
  let screening;
  try { screening = await screenContactRecords(records, requireCheckable); if (vaultStale) throw new Error('Encrypted vault changed during the final suppression screen.'); }
  catch (screenError) {
    try {
      await saveVault(rollbackVault, writtenVault);
      vault = rollbackVault;
      reconcileCurrentFromVault();
      renderShortlist();
      throw new Error(`Final suppression screen failed, so incoming additions were rolled back: ${screenError.message}`);
    } catch (rollbackError) {
      if (/rolled back/.test(rollbackError.message)) throw rollbackError;
      vaultStale = true;
      if (current) renderRecord(current, false);
      throw new Error(`Final suppression screen failed and the rollback could not safely win the vault revision: ${rollbackError.message}. Unlock again before any outreach.`);
    }
  }
  const purged = await enforceScreenedSuppressions(records, screening, writtenVault);
  reconcileCurrentFromVault();
  renderShortlist();
  return purged;
}
async function previewContactImport(file) {
  if (!vault || !passphrase) throw new Error('Unlock the secure local vault first.');
  if (file.size > 1_000_000) throw new Error('CSV file exceeds 1 MB.');
  clearPendingPreviews();
  const generation = previewGeneration;
  const previewVault = vault;
  const previewRevision = vaultRevision;
  let parsed;
  let screening;
  let purged;
  try {
    const content = await file.text();
    assertActivePreview(generation);
    assertVaultSnapshot(previewVault, previewRevision);
    parsed = FindEmmState.parseRecruiterCsv(content, file.name);
    screening = await screenContactRecords(parsed.records);
    purged = await enforceScreenedSuppressions(parsed.records, screening, previewVault);
    assertActivePreview(generation);
    assertVaultSnapshot(vault, vaultRevision);
  } catch (error) { if (generation !== previewGeneration) error.stalePreview = true; throw error; }
  const suppressed = new Set(screening.filter((result) => result.suppressed).map((result) => result.index));
  const blockedDomains = screening.filter((result) => result.blockedDomain).length;
  const candidates = parsed.records.filter((_record, index) => !suppressed.has(index));
  const preview = FindEmmState.mergeRecruiterImport(vault.records, candidates);
  const canMerge = preview.imported > 0 && preview.blockingConflicts === 0;
  pendingContactImport = canMerge ? { parsed, preview, screening, suppressed: suppressed.size, blockedDomains, purged: purged.removed, vaultRevision } : null;
  $('merge-contact-import').disabled = !canMerge;
  const extras = [parsed.rejected && `${parsed.rejected} invalid row(s) rejected`, parsed.strippedContacts && `${parsed.strippedContacts} DNC row contact set(s) stripped`, parsed.ignoredColumns.length && `${parsed.ignoredColumns.length} untrusted/unknown column(s) ignored`, parsed.issues.length && `First issue: ${parsed.issues[0]}`].filter(Boolean).join(' ');
  const conflictExample = preview.conflictDetails?.length ? ` First conflict: ${preview.conflictDetails[0]}.` : '';
  const blocked = preview.blockingConflicts ? ` Import blocked: ${preview.blockingConflicts} row(s) involving Do not contact need a matching LinkedIn person URL or identity correction.` : '';
  const purgeCopy = purged.removed ? `${purged.removed} already-saved provider opt-out record(s) deleted immediately. ` : '';
  const pendingCopy = canMerge ? 'Remaining additions are not saved until confirmation.' : 'No eligible additions are ready to confirm.';
  $('contact-import-preview').textContent = `${parsed.accepted} valid row(s). ${purgeCopy}Preview: ${preview.added} new, ${preview.deduplicated} updated, ${preview.conflicts} conflict(s) skipped, ${preview.doNotContact} Do not contact safeguard(s), ${suppressed.size} provider opt-out row(s) excluded, ${blockedDomains} provider-blocked domain row(s) retained for local use only. ${extras}${conflictExample}${blocked} ${pendingCopy}`.replace(/\s+/g, ' ').trim();
  return { canMerge, purged: purged.removed, suppressed: suppressed.size };
}
async function mergeContactImport() {
  if (!pendingContactImport || !vault) return;
  const pending = pendingContactImport;
  const baseVault = vault;
  const baseRevision = vaultRevision;
  if (pending.vaultRevision !== baseRevision) throw new Error('Vault changed after preview. Preview the CSV again before confirming.');
  $('merge-contact-import').disabled = true;
  let latestScreening;
  try { latestScreening = await screenContactRecords(pending.parsed.records); }
  catch (error) { if (pendingContactImport === pending && vault === baseVault) $('merge-contact-import').disabled = false; throw error; }
  const purged = await enforceScreenedSuppressions(pending.parsed.records, latestScreening, baseVault);
  if (purged.removed) assertVaultSnapshot(vault, vaultRevision); else assertVaultSnapshot(baseVault, baseRevision);
  if (pendingContactImport !== pending) throw new Error('Vault or preview changed during confirmation. Review the current preview and try again.');
  const changed = screeningChanged(latestScreening, pending.screening) || purged.removed > 0;
  if (changed) {
    const suppressed = new Set(latestScreening.filter((result) => result.suppressed).map((result) => result.index));
    const candidates = pending.parsed.records.filter((_record, index) => !suppressed.has(index));
    const preview = FindEmmState.mergeRecruiterImport(vault.records, candidates);
    const blockedDomains = latestScreening.filter((result) => result.blockedDomain).length;
    const canMerge = preview.imported > 0 && preview.blockingConflicts === 0;
    pendingContactImport = canMerge ? { ...pending, preview, screening: latestScreening, suppressed: suppressed.size, blockedDomains, purged: pending.purged + purged.removed, vaultRevision } : null;
    $('merge-contact-import').disabled = !canMerge;
    $('contact-import-preview').textContent = `Suppression state changed; ${purged.removed} newly matched saved record(s) deleted and preview refreshed. ${preview.added} new, ${preview.deduplicated} updated, ${preview.conflicts} conflict(s), ${suppressed.size} provider opt-out row(s) excluded, ${blockedDomains} provider-blocked domain row(s). ${canMerge ? 'Review and confirm again.' : 'No eligible additions remain.'}`;
    throw new Error('Suppression state changed. Review the refreshed preview before confirming again.');
  }
  pendingContactImport = null;
  const { preview } = pending;
  const selectedRecordId = preview.records.some((record) => record.id === baseVault.selectedRecordId) ? baseVault.selectedRecordId : preview.records[0]?.id || '';
  const nextVault = { ...baseVault, records: preview.records, selectedRecordId };
  try { await saveVault(nextVault, baseVault); } catch (error) { if (vault === baseVault) { pendingContactImport = pending; $('merge-contact-import').disabled = false; } throw error; }
  vault = nextVault;
  const postWrite = await reconcileAfterImportWrite(pending.parsed.records, nextVault, baseVault, true);
  $('contact-import-preview').textContent = `CSV imported: ${preview.added} new, ${preview.deduplicated} updated, ${preview.conflicts} conflict(s) skipped, ${pending.suppressed} provider opt-out row(s) excluded${postWrite.removed ? `, ${postWrite.removed} post-write opt-out match(es) purged` : ''}.`;
  $('status').textContent = `Saved ${preview.imported} imported row(s) to the encrypted local vault${postWrite.removed ? ` and immediately purged ${postWrite.removed} newly suppressed match(es)` : ''}. Imported contacts still require a person-match check before email drafting.`;
}
async function exportHandoff() {
  if (!vault || !passphrase) throw new Error('Unlock the secure local vault first.');
  if (vaultStale || vaultUnlockInProgress || vaultWriteInProgress) throw new Error('Unlock and suppression-reconcile the current encrypted vault before exporting.');
  if (vault.records.some((record) => isSessionSuppressed(record.prospect))) throw new Error('Known provider opt-out purge is still pending. Unlock again to reconcile the vault before exporting any handoff.');
  const exportVault = vault;
  const exportRevision = vaultRevision;
  const sharePassphrase = $('share-passphrase').value;
  const selectedList = $('handoff-list').value;
  if (exportVault.records.some((record) => record.saved && record.list === selectedList && FindEmmState.canContact(record) && !FindEmmState.hasDurableSuppressionAlias(record.prospect))) throw new Error('Selected list contains an active record without a durable suppression identity. Add a company domain or LinkedIn /in/ URL before export.');
  try {
    const handoff = await FindEmmState.createHandoff(exportVault.records, sharePassphrase, selectedList);
    assertVaultSnapshot(exportVault, exportRevision);
    if (exportVault.records.some((record) => isSessionSuppressed(record.prospect))) throw new Error('A provider opt-out matched during export. Reconcile the vault before creating a handoff.');
    const url = URL.createObjectURL(new Blob([handoff.text], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `findemm-handoff-${new Date().toISOString().slice(0, 10)}.findemm` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    $('status').textContent = `Exported ${handoff.count} record(s) from ${selectedList}. Unrelated opt-out identities and pairing token excluded. Share passphrase separately; delete file after handoff.`;
  } finally { $('share-passphrase').value = ''; }
}
async function previewHandoff(file) {
  const sharePassphrase = $('share-passphrase').value;
  clearPendingPreviews();
  const generation = previewGeneration;
  const previewVault = vault;
  const previewRevision = vaultRevision;
  if (!vault || !passphrase) throw new Error('Unlock the secure local vault first.');
  if (!vault.token) throw new Error('Save the local API pairing token before importing a handoff.');
  if (sharePassphrase.length < 12) throw new Error('Use a share passphrase with at least 12 characters.');
  if (file.size > 5_000_000) throw new Error('Handoff file exceeds 5 MB.');
  let opened;
  let screening;
  let purged;
  try {
    const content = await file.text();
    assertActivePreview(generation);
    assertVaultSnapshot(previewVault, previewRevision);
    opened = await FindEmmState.openHandoff(content, sharePassphrase);
    assertActivePreview(generation);
    assertVaultSnapshot(previewVault, previewRevision);
    screening = await screenContactRecords(opened.records, false);
    purged = await enforceScreenedSuppressions(opened.records, screening, previewVault);
    assertActivePreview(generation);
    assertVaultSnapshot(vault, vaultRevision);
  } catch (error) { if (generation !== previewGeneration) error.stalePreview = true; throw error; }
  const suppressed = new Set(screening.filter((result) => result.suppressed).map((result) => result.index));
  const candidates = opened.records.filter((record, index) => !suppressed.has(index) && (screening[index].checkable || !FindEmmState.canContact(record)));
  const preview = FindEmmState.mergeImportedRecords(vault.records, candidates);
  const uncheckable = screening.filter((result, index) => !result.checkable && FindEmmState.canContact(opened.records[index])).length;
  const blockedDomains = screening.filter((result) => result.blockedDomain).length;
  const canMerge = preview.imported > 0 && preview.blockingConflicts === 0;
  pendingHandoff = canMerge ? { opened, preview, screening, suppressed: suppressed.size, uncheckable, blockedDomains, purged: purged.removed, vaultRevision } : null;
  $('merge-handoff').disabled = !canMerge;
  const additions = preview.imported - preview.deduplicated;
  const purgeCopy = purged.removed ? `${purged.removed} already-saved provider opt-out record(s) deleted immediately. ` : '';
  $('handoff-preview').textContent = `${opened.selectedCount} selected-list record(s). ${purgeCopy}Preview: ${additions} new, ${preview.deduplicated} exact-profile merge(s), ${preview.conflicts} conflict(s), ${preview.blockingConflicts} blocking DNC conflict(s), ${preview.suppressions} suppression(s), ${preview.removedContacts} contact(s) removed, ${suppressed.size} provider opt-out record(s) excluded, ${uncheckable} active record(s) without a durable suppression alias excluded, ${blockedDomains} provider-blocked domain record(s) retained locally. Shared identity claims require local recheck. ${canMerge ? 'Remaining additions are not saved until confirmation.' : preview.blockingConflicts ? 'Correct the ambiguous DNC identity before merging any row from this file.' : 'No eligible additions are ready to confirm.'}`;
  return { canMerge, purged: purged.removed, suppressed: suppressed.size };
}
async function mergeHandoff() {
  if (!pendingHandoff || !vault) return;
  const handoff = pendingHandoff;
  const baseVault = vault;
  const baseRevision = vaultRevision;
  if (handoff.vaultRevision !== baseRevision) throw new Error('Vault changed after preview. Preview the handoff again before confirming.');
  $('merge-handoff').disabled = true;
  let latestScreening;
  try { latestScreening = await screenContactRecords(handoff.opened.records, false); }
  catch (error) { if (pendingHandoff === handoff && vault === baseVault) $('merge-handoff').disabled = false; throw error; }
  const purged = await enforceScreenedSuppressions(handoff.opened.records, latestScreening, baseVault);
  if (purged.removed) assertVaultSnapshot(vault, vaultRevision); else assertVaultSnapshot(baseVault, baseRevision);
  if (pendingHandoff !== handoff) throw new Error('Vault or handoff preview changed during confirmation. Review the current preview and try again.');
  if (screeningChanged(latestScreening, handoff.screening) || purged.removed > 0) {
    const suppressed = new Set(latestScreening.filter((result) => result.suppressed).map((result) => result.index));
    const candidates = handoff.opened.records.filter((record, index) => !suppressed.has(index) && (latestScreening[index].checkable || !FindEmmState.canContact(record)));
    const preview = FindEmmState.mergeImportedRecords(vault.records, candidates);
    const uncheckable = latestScreening.filter((result, index) => !result.checkable && FindEmmState.canContact(handoff.opened.records[index])).length;
    const blockedDomains = latestScreening.filter((result) => result.blockedDomain).length;
    const canMerge = preview.imported > 0 && preview.blockingConflicts === 0;
    pendingHandoff = canMerge ? { ...handoff, preview, screening: latestScreening, suppressed: suppressed.size, uncheckable, blockedDomains, purged: handoff.purged + purged.removed, vaultRevision } : null;
    $('merge-handoff').disabled = !canMerge;
    $('handoff-preview').textContent = `Suppression state changed; ${purged.removed} newly matched saved record(s) deleted and handoff preview refreshed. ${preview.imported - preview.deduplicated} new, ${preview.deduplicated} updated, ${preview.conflicts} conflict(s), ${preview.blockingConflicts} blocking DNC conflict(s), ${suppressed.size} provider opt-out record(s) excluded. ${canMerge ? 'Review and confirm again.' : preview.blockingConflicts ? 'Correct the ambiguous DNC identity before merging any row from this file.' : 'No eligible additions remain.'}`;
    throw new Error('Suppression state changed. Review the refreshed handoff before confirming again.');
  }
  const { preview } = handoff;
  pendingHandoff = null;
  const selectedRecordId = preview.records.some((record) => record.id === baseVault.selectedRecordId) ? baseVault.selectedRecordId : preview.records[0]?.id || '';
  const nextVault = { ...baseVault, records: preview.records, selectedRecordId };
  try { await saveVault(nextVault, baseVault); } catch (error) { if (vault === baseVault) { pendingHandoff = handoff; $('merge-handoff').disabled = false; } throw error; }
  vault = nextVault;
  const postWrite = await reconcileAfterImportWrite(handoff.opened.records, nextVault, baseVault, false);
  $('handoff-preview').textContent = `Handoff merged into encrypted local vault${postWrite.removed ? `; ${postWrite.removed} post-write opt-out match(es) were purged` : ''}.`;
  const selected = vault.records.find((record) => record.id === selectedRecordId);
  if (selected) renderRecord(selected);
  $('status').textContent = `Merged handoff: ${preview.imported - preview.deduplicated} new, ${preview.deduplicated} updated, ${preview.conflicts} conflict(s) skipped${postWrite.removed ? `, ${postWrite.removed} newly suppressed match(es) purged` : ''}.`;
}
function clearResearchForm() { ['name', 'company', 'title', 'domain', 'profileUrl', 'importedEmail', 'importedPhone'].forEach((id) => { $(id).value = ''; }); }
async function capturePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) throw new Error('No active page is available.');
  const page = FindEmmCapture.parseCapturedPage({ url: tab.url });
  if (page.kind === 'unsupported') return page;
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
    const host = location.hostname.toLowerCase().replace(/\.$/, '');
    const linkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com');
    if (!linkedIn || !/^\/(?:in|company)\/[^/]+(?:\/|$)/i.test(location.pathname)) return { url: location.href };
    const visibleText = (node) => {
      if (!node || !node.getClientRects().length) return '';
      const style = getComputedStyle(node);
      return style.display === 'none' || style.visibility === 'hidden' ? '' : (node.textContent || '').replace(/\s+/g, ' ').trim();
    };
    const h1 = document.querySelector('h1');
    const scope = h1?.closest('section') || h1?.parentElement?.parentElement?.parentElement || document.querySelector('main');
    const firstVisible = (selectors) => selectors.flatMap((selector) => [...(scope?.querySelectorAll(selector) || [])]).map(visibleText).find(Boolean) || '';
    const companyNode = [...(scope?.querySelectorAll('a[href*="/company/"]') || [])].find((node) => visibleText(node));
    return {
      url: location.href,
      h1: visibleText(h1),
      headline: firstVisible(['.text-body-medium.break-words', '.pv-text-details__left-panel .text-body-medium']),
      company: visibleText(companyNode).replace(/\blogo\b/ig, '').trim(),
      documentTitle: document.title
    };
  } });
  return FindEmmCapture.parseCapturedPage(result);
}
async function honorProviderOptOut(prospect) {
  clearHandoffPreview('Handoff preview cleared because a provider opt-out changed the vault.');
  clearContactImportPreview('Contact import preview cleared because a provider opt-out changed the vault.');
  if (!vault || vaultStale || vaultUnlockInProgress || vaultWriteInProgress) throw new Error('Current vault is not safe to reconcile. Unlock it again.');
  const normalized = FindEmmState.normalizeResearchProspect(prospect);
  const baseVault = vault;
  const baseRevision = vaultRevision;
  const record = recordFrom(normalized, []);
  const screening = await screenContactRecords([record]);
  if (!screening[0]?.suppressed) throw new Error('Durable provider opt-out could not be confirmed by the local suppression screen.');
  const purged = await enforceScreenedSuppressions([record], screening, baseVault);
  assertVaultSnapshot(vault, vaultRevision);
  if (!purged.removed) assertVaultSnapshot(baseVault, baseRevision);
  clearResearchForm();
  switchView('research');
  $('status').textContent = `Provider opt-out honored. ${purged.removed} matching local record(s) removed; only a keyed suppression hash with no plaintext identity remains in local server storage.`;
}
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelector('.mode-tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('.mode-tabs [role="tab"]')];
  const currentIndex = tabs.indexOf(document.activeElement);
  if (currentIndex < 0) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  const next = tabs[nextIndex];
  switchView(next.dataset.view);
  next.focus();
});
$('consent-check').addEventListener('change', (event) => { $('accept-consent').disabled = !event.target.checked; });
$('consent-dialog').addEventListener('cancel', (event) => event.preventDefault());
$('consent-dialog').addEventListener('close', async () => { if ($('consent-dialog').returnValue === 'accept') await chrome.storage.local.set({ consentVersion: CONSENT_VERSION }); });
$('unlock-vault').addEventListener('click', async () => { try { await unlockVault(); } catch (error) { $('vault-status').textContent = error.message; } });
$('clear-vault').addEventListener('click', async () => { if (!confirm('Delete all encrypted findEmm records and the saved local API token from this Chrome profile? This cannot be undone.')) return; const baseVault = vault; try { clearPendingPreviews(); await removeVaultStorage(baseVault); vault = null; passphrase = ''; current = null; clearResearchForm(); $('vault-passphrase').value = ''; $('token').value = ''; $('share-passphrase').value = ''; $('vault-status').textContent = 'Encrypted vault deleted from this device.'; $('record-card').hidden = true; $('empty-record').hidden = false; renderShortlist(); switchView('record'); } catch (error) { $('vault-status').textContent = `Vault not deleted: ${error.message}`; } });
$('prospect-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (researchInProgress) { $('status').textContent = 'Research is already running. Wait for the current result before starting another request.'; return; }
  let prospect;
  try { prospect = FindEmmState.normalizeResearchProspect(formProspect()); }
  catch (error) { $('status').textContent = error.message; return; }
  if ((prospect.importedEmail || prospect.importedPhone) && !FindEmmState.hasDurableSuppressionAlias(prospect)) { $('status').textContent = 'Add a full name plus company domain, or a LinkedIn /in/ person URL, before researching a person-specific work contact.'; return; }
  const localBlock = localDncRecord(prospect);
  if (localBlock) { renderRecord(localBlock); $('status').textContent = 'Local Do not contact safeguard, including a matching first name + last name + domain alias, blocked Research before any provider or company-page request.'; return; }
  if (isSessionSuppressed(prospect)) { $('status').textContent = 'Provider opt-out is active in this popup session. Research and outreach are blocked even though the encrypted-vault purge still needs attention.'; return; }
  const researchVault = vault;
  const researchRevision = vaultRevision;
  const researchButton = $('prospect-form').querySelector('button[type="submit"]');
  researchInProgress = true;
  researchButton.disabled = true;
  researchButton.setAttribute('aria-busy', 'true');
  $('status').textContent = 'Researching permitted sources…';
  try {
    const data = await request('/v1/enrich', { method: 'POST', body: JSON.stringify({ prospect }) });
    assertVaultSnapshot(researchVault, researchRevision);
    const normalizedResult = FindEmmState.normalizeResearchProspect(data.prospect);
    if (['name', 'domain', 'profileUrl'].some((field) => normalizedResult[field] !== prospect[field])) throw new Error('Local API returned a mismatched prospect identity. No result was opened.');
    if (vaultStale || vaultUnlockInProgress || vaultWriteInProgress) throw new Error('Vault changed while Research was running. Review the current vault and try again.');
    const latestLocalBlock = localDncRecord(normalizedResult);
    if (latestLocalBlock) { renderRecord(latestLocalBlock); $('status').textContent = 'Research result discarded because the current vault now contains a matching Do not contact safeguard.'; return; }
    if (isSessionSuppressed(normalizedResult)) { $('status').textContent = 'Research result discarded because a provider opt-out is active for this identity.'; return; }
    const results = Array.isArray(data.results) ? data.results : [];
    renderRecord(recordFrom(normalizedResult, results));
    $('status').textContent = results.length ? `${results.length} sourced contact result(s). Confirm any person-email match before drafting.` : 'No sourced contact returned. If Hunter is enabled, enter a full name and company domain; findEmm does not generate guesses.';
  }
  catch (error) {
    if (error.code === 'provider_opt_out') {
      try { await honorProviderOptOut(prospect); }
      catch (storageError) { vaultStale = true; clearPendingPreviews(); clearResearchForm(); if (current) renderRecord(current, false); renderShortlist(); $('status').textContent = `Provider opt-out was durably suppressed by the local API, but exact-alias vault reconciliation failed: ${storageError.message}. Unlock again before Research, outreach, or export.`; }
    } else $('status').textContent = error.message;
  }
  finally {
    researchInProgress = false;
    researchButton.disabled = false;
    researchButton.removeAttribute('aria-busy');
  }
});
$('capture').addEventListener('click', async () => { clearResearchForm(); switchView('research'); try { const captured = await capturePage(); if (captured.kind === 'unsupported') { $('status').textContent = 'Capture supports LinkedIn profile and company pages. Enter details manually on other pages.'; return; } Object.entries(captured.prospect).forEach(([key, value]) => { if ($(key)) $(key).value = value; }); const kind = captured.kind === 'linkedin_profile' ? 'LinkedIn profile' : 'LinkedIn company'; const fields = captured.capturedFields.join(', '); $('status').textContent = `${kind} fields captured${fields ? `: ${fields}` : ''}. Review before Research; add company domain if optional Hunter is enabled.`; } catch { $('status').textContent = 'This page cannot be captured. Enter details manually.'; } });
$('research-record').addEventListener('click', () => { const live = currentVaultRecord(); if (!live || !mayResearch(live)) return; current = live; clearResearchForm(); Object.entries(live.prospect || {}).forEach(([key, value]) => { if ($(key) && ['name', 'company', 'title', 'domain', 'profileUrl'].includes(key)) $(key).value = value || ''; }); switchView('research'); $('status').textContent = FindEmmState.hasDurableSuppressionAlias(live.prospect) ? 'Identity fields are ready for review. Existing imported contacts stay in the encrypted record; no source runs until you submit Research.' : 'This record is quarantined. Add a company domain or LinkedIn /in/ person URL, then run Research before contact or export actions.'; });
$('save-record').addEventListener('click', async () => { try { await saveCurrent('Record encrypted and saved locally.'); } catch (error) { $('status').textContent = `Record not saved: ${error.message}`; } });
$('move-list').addEventListener('click', async () => { if (!current) return; const target = $('list-select').value; if (target === 'Do not contact' && current.list !== target && !confirm('Move this person to Do not contact? Saved contacts and queued drafts will be removed.')) { $('list-select').value = current.list || 'Saved prospects'; return; } try { await saveCurrent(`Moved to ${target}.`, { list: target }); } catch (error) { $('list-select').value = current.list || 'Saved prospects'; $('status').textContent = `List not changed: ${error.message}`; } });
$('save-note').addEventListener('click', async () => { if (!current) return; try { await saveCurrent('Note encrypted and saved locally.', { note: $('record-note').value.trim() }); } catch (error) { $('status').textContent = `Note not saved: ${error.message}`; } });
$('queue-followup').addEventListener('click', blockOptedOut, true);
$('draft-outreach').addEventListener('click', blockOptedOut, true);
$('queue-followup').addEventListener('click', async () => { const live = currentVaultRecord(); if (!live) return; current = live; try { await saveCurrent('Draft follow-up queued locally. No message was sent.', { sequence: FindEmmState.queueDraft(live.sequence) }); } catch (error) { $('status').textContent = `Follow-up not queued: ${error.message}`; } });
$('draft-outreach').addEventListener('click', () => { const live = currentVaultRecord(); if (!live || !mayContact(live)) { $('status').textContent = 'Opt-out active. Outreach action blocked.'; return; } current = live; const email = FindEmmState.draftableEmail(live); if (!email) { $('status').textContent = 'Confirm a person-email match first. Provider mailbox status, imports, patterns, and shared claims are not enough.'; return; } window.open(`mailto:${encodeURIComponent(email.value)}?subject=${encodeURIComponent(`Connecting about ${live.prospect.company || 'your work'}`)}&body=${encodeURIComponent(`Hi ${live.prospect.name.split(' ')[0]},\n\nI’m reaching out about…\n\nBest,`)}`); });
$('export-record').addEventListener('click', () => { const live = currentVaultRecord(); if (live && mayContact(live)) exportRecord(live); else $('status').textContent = 'Record export blocked until the current encrypted vault is unlocked and opt-out-safe.'; });
$('contacts').addEventListener('click', async (event) => {
  const contactId = event.target.closest('[data-contact-id]')?.dataset.contactId;
  const live = currentVaultRecord();
  const contact = live?.contacts?.find((item) => item.id === contactId);
  if (!contact) return;
  if (!mayContact(live)) { $('status').textContent = 'Opt-out active. Contact confirmation blocked.'; return; }
  if (!confirm('Confirm this work email belongs to this person? Provider mailbox status, recruiter input, and shared data do not prove identity. Continue only if you independently checked the match.')) return;
  current = live;
  const confirmed = FindEmmState.confirmContact(live, contactId);
  if (confirmed === live) { $('status').textContent = 'This contact cannot be confirmed as a person-specific work email.'; return; }
  try {
    if (current.saved) { const saved = await persist(confirmed); renderRecord(saved.record); $('status').textContent = 'Person-email match confirmed and saved as a local recruiter attestation.'; }
    else { current = confirmed; renderRecord(confirmed); $('status').textContent = 'Person-email match confirmed for this record. Save the record to retain the attestation.'; }
  } catch (error) { $('status').textContent = `Confirmation not saved: ${error.message}`; }
});
$('recommendations').addEventListener('click', (event) => { const id = event.target.closest('[data-record-id]')?.dataset.recordId; const record = vault?.records.find((item) => item.id === id); if (record) renderRecord(record); });
$('shortlist-search').addEventListener('input', renderShortlist);
$('shortlist-filter').addEventListener('change', renderShortlist);
document.querySelectorAll('[data-shortlist-filter]').forEach((button) => button.addEventListener('click', () => { $('shortlist-filter').value = button.dataset.shortlistFilter; renderShortlist(); }));
$('shortlist-records').addEventListener('click', (event) => { const id = event.target.closest('[data-shortlist-id]')?.dataset.shortlistId; const record = vault?.records.find((item) => item.id === id); if (record) renderRecord(record); });
$('delete-record').addEventListener('click', async () => {
  if (!current?.saved || !vault) return;
  const blocked = !FindEmmState.canContact(current);
  const warning = blocked ? 'Delete this Do not contact record? This removes the opt-out safeguard from this Chrome vault and cannot be undone.' : 'Delete this encrypted local record? This cannot be undone.';
  if (!confirm(warning)) return;
  const records = vault.records.filter((record) => record.id !== current.id);
  const baseVault = vault;
  const nextVault = { ...baseVault, records, selectedRecordId: baseVault.selectedRecordId === current.id ? '' : baseVault.selectedRecordId };
  clearHandoffPreview('Handoff preview cleared because a local record changed.');
  clearContactImportPreview('Contact import preview cleared because a local record changed.');
  try { await saveVault(nextVault, baseVault); vault = nextVault; current = null; $('record-card').hidden = true; $('empty-record').hidden = false; renderShortlist(); switchView('shortlist'); $('status').textContent = 'Local record deleted.'; } catch (error) { $('status').textContent = `Record not deleted: ${error.message}`; }
});
$('download-contact-template').addEventListener('click', downloadContactTemplate);
$('choose-contact-import').addEventListener('click', () => { if (!vault || !passphrase) { $('status').textContent = 'Unlock the secure local vault first.'; return; } if (!vault.token) { $('status').textContent = 'Save the local API pairing token first so provider opt-outs can be screened.'; return; } clearPendingPreviews(); $('contact-import-file').value = ''; $('contact-import-file').click(); });
$('contact-import-file').addEventListener('change', async (event) => { const [file] = event.target.files; if (!file) return; try { const result = await previewContactImport(file); $('status').textContent = result.canMerge ? 'CSV validated and suppression-screened locally. Confirm the remaining import to save once.' : result.purged || result.suppressed ? 'CSV screened. Known provider opt-outs were enforced; no eligible additions remain.' : 'CSV preview has conflicts or invalid rows that need correction.'; } catch (error) { if (!error.stalePreview) { clearContactImportPreview(error.message); $('status').textContent = `CSV not ready: ${error.message}`; } } finally { event.target.value = ''; } });
$('merge-contact-import').addEventListener('click', async () => { try { await mergeContactImport(); } catch (error) { $('status').textContent = `CSV import not saved: ${error.message}`; } });
$('export-handoff').addEventListener('click', async () => { try { await exportHandoff(); } catch (error) { $('share-passphrase').value = ''; $('status').textContent = error.message; } });
$('choose-handoff').addEventListener('click', () => { if (!vault || !passphrase) { $('status').textContent = 'Unlock the secure local vault first.'; return; } if (!vault.token) { $('status').textContent = 'Save the local API pairing token first so handoff opt-outs can be screened.'; return; } if ($('share-passphrase').value.length < 12) { $('status').textContent = 'Use a share passphrase with at least 12 characters.'; return; } clearHandoffPreview(); $('import-handoff').value = ''; $('import-handoff').click(); });
$('share-passphrase').addEventListener('input', () => { clearHandoffPreview(); });
$('import-handoff').addEventListener('change', async (event) => { const [file] = event.target.files; if (!file) return; try { const result = await previewHandoff(file); $('status').textContent = result.canMerge ? 'Handoff decrypted and suppression-screened locally. Confirm the remaining merge to save once.' : result.purged || result.suppressed ? 'Handoff screened. Known provider opt-outs were enforced; no eligible additions remain.' : 'Handoff has no non-conflicting records ready to merge.'; } catch (error) { if (!error.stalePreview) { pendingHandoff = null; $('merge-handoff').disabled = true; const localError = ['Unlock the secure local vault first.', 'Save the local API pairing token before importing a handoff.', 'Use a share passphrase with at least 12 characters.', 'Handoff file exceeds 5 MB.'].includes(error.message) || /suppression screen|companion API/i.test(error.message); const message = localError ? error.message : 'Could not open this handoff. Passphrase may be wrong or file may have changed.'; $('handoff-preview').textContent = message; $('status').textContent = message; } } finally { $('share-passphrase').value = ''; event.target.value = ''; } });
$('merge-handoff').addEventListener('click', async () => { try { await mergeHandoff(); } catch (error) { $('status').textContent = `Handoff not saved: ${error.message}`; } });
$('health').addEventListener('click', async () => { try { const health = await request('/v1/health'); $('status').textContent = `Local API ${health.status}. Hunter ${health.providers?.hunter ? 'enabled' : 'disabled'}. Allowlisted company-page lookup ${health.providers?.companyPages ? 'enabled' : 'disabled'}.`; } catch (error) { $('status').textContent = error.message; } });
storage().then(({ consentVersion }) => { if (consentVersion !== CONSENT_VERSION) $('consent-dialog').showModal(); });
