const $ = (id) => document.getElementById(id);
const CONSENT_VERSION = 2;
let current = null;
let vault = null;
let passphrase = '';
let pendingHandoff = null;

function vaultDefault() { return { token: '', records: [], selectedRecordId: '' }; }
async function storage() { return chrome.storage.local.get(['apiUrl', 'vaultSalt', 'vaultData', 'consentVersion']); }
async function saveVault(value = vault) { if (!value || !passphrase) throw new Error('Unlock the secure local vault first.'); const { vaultSalt } = await storage(); await chrome.storage.local.set({ vaultData: await FindEmmState.seal(value, passphrase, vaultSalt) }); }
function clearHandoffPreview(message = 'No handoff previewed.') { pendingHandoff = null; $('merge-handoff').disabled = true; $('handoff-preview').textContent = message; }
async function unlockVault() {
  const entered = $('vault-passphrase').value;
  if (entered.length < 12) throw new Error('Use a vault passphrase with at least 12 characters.');
  clearHandoffPreview();
  const saved = await storage();
  const salt = saved.vaultSalt || FindEmmState.newSalt();
  vault = saved.vaultData ? await FindEmmState.open(saved.vaultData, entered, salt) : vaultDefault();
  passphrase = entered;
  if (!saved.vaultSalt) await chrome.storage.local.set({ vaultSalt: salt });
  const suppliedToken = $('token').value.trim();
  if (suppliedToken) vault.token = suppliedToken;
  $('token').value = vault.token || '';
  await saveVault();
  $('vault-status').textContent = 'Vault unlocked for this popup session.';
  renderShortlist();
  const selected = vault.records.find((record) => record.id === vault.selectedRecordId);
  if (selected) renderRecord(selected);
}
async function request(path, options = {}) {
  if (!vault?.token) throw new Error('Unlock the vault and save the local API pairing token first.');
  const { apiUrl = 'http://127.0.0.1:4317' } = await storage();
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
async function persist(record) { clearHandoffPreview(); const result = FindEmmState.upsertRecord(vault.records, record); const nextVault = { ...vault, records: result.records, selectedRecordId: result.record.id }; await saveVault(nextVault); vault = nextVault; current = result.record; return result; }
function switchView(view) { document.querySelectorAll('.view').forEach((node) => { node.hidden = node.id !== `${view}-view`; }); document.querySelectorAll('.tab').forEach((node) => node.classList.toggle('is-active', node.dataset.view === view)); if (view === 'shortlist') renderShortlist(); }
function confirmable(contact) { return contact.contactType === 'work_email' && contact.contactScope !== 'company' && ['provider_valid', 'provider_stale', 'provider_unverified', 'recruiter_imported', 'shared_candidate'].includes(contact.status); }
function recordSignal(record) {
  if (!FindEmmState.canContact(record)) return 'Opt-out safeguard';
  const contacts = (record.contacts || []).map((contact) => FindEmmState.contactView(contact));
  if (contacts.some((contact) => contact.status === 'user_confirmed' && contact.contactType === 'work_email')) return 'Recruiter-checked email';
  if (contacts.some((contact) => contact.status === 'provider_valid')) return 'Valid mailbox; identity unchecked';
  if (contacts.some((contact) => confirmable(contact))) return 'Contact needs identity check';
  if (contacts.some((contact) => contact.contactScope === 'company')) return 'Company contact channel';
  return 'No contact yet';
}
function renderRecord(record) {
  current = record; $('empty-record').hidden = true; $('record-card').hidden = false;
  const contactAllowed = FindEmmState.canContact(record);
  $('initials').textContent = initials(record.prospect.name); $('record-name').textContent = record.prospect.name; $('record-title').textContent = record.prospect.title || 'Role not supplied'; $('record-company').textContent = record.prospect.company || 'Company not supplied'; $('record-domain').textContent = record.prospect.domain || 'No company domain'; $('record-count').textContent = `${record.contacts.length} contact${record.contacts.length === 1 ? '' : 's'}`; $('record-note').value = record.note || ''; $('list-select').value = record.list || 'Saved prospects'; $('list-copy').textContent = record.saved ? `Saved in ${record.list}.` : 'Not yet saved to a list.'; $('save-label').textContent = record.saved ? `Saved to ${record.list}` : 'Save to local list'; $('save-record').textContent = record.saved ? 'Saved locally' : 'Save record'; $('sequence-copy').textContent = contactAllowed ? record.sequence?.length ? `${record.sequence.length} draft follow-up step(s) queued locally.` : 'Keep the next step local until you act.' : 'Opt-out active. Outreach actions are disabled.';
  $('draft-outreach').disabled = !contactAllowed; $('queue-followup').disabled = !contactAllowed;
  $('contacts').innerHTML = record.contacts.map((raw) => { const contact = FindEmmState.contactView(raw); const kind = contact.contactType === 'business_phone' ? 'kind-phone' : ['provider_unverified', 'provider_stale', 'shared_candidate'].includes(contact.status) ? 'kind-candidate' : contact.status === 'provider_valid' ? 'kind-provider' : 'kind-email'; const verification = contact.verifiedAt ? `<span>Mailbox status dated ${escape(dateLabel(contact.verifiedAt))}</span>` : ''; const action = confirmable(contact) ? `<button class="text-button confirm-contact" type="button" data-contact-id="${escape(contact.id)}">Confirm person match</button>` : ''; const source = contact.sourceUrl ? `<a href="${escape(contact.sourceUrl)}" target="_blank" rel="noreferrer">Evidence</a>` : contact.provider ? escape(contact.provider) : 'Recruiter input'; return `<article class="contact-row"><span class="contact-kind ${kind}">${contactKind(contact)}</span><div class="contact-main"><div class="contact-value">${escape(contact.value)}</div><div class="contact-meta"><span class="status-pill ${statusClass(contact.status)}">${escape(contact.statusLabel)}</span><span>${escape(scopeLabel(contact))}</span><span>${escape(contact.confidence)}% source confidence</span>${verification}<span>${escape(contact.reason)}</span>${contact.evidenceSnippet ? `<span>Source excerpt: ${escape(contact.evidenceSnippet)}</span>` : ''}</div>${action}</div><div class="contact-source">${source}<br>${escape(dateLabel(contact.retrievedAt))}</div></article>`; }).join('');
  $('no-contacts').hidden = record.contacts.length > 0; switchView('record');
  const recommendations = FindEmmState.recommendRelated(record, vault?.records);
  $('recommendations').innerHTML = recommendations.map(({ record: match, reason }) => `<article class="recommendation-row"><div><strong>${escape(match.prospect.name)}</strong><small>${escape(match.prospect.title || 'Role not supplied')} · ${escape(match.prospect.company || 'Company not supplied')}</small><span>${escape(reason)}</span></div><button class="text-button" type="button" data-record-id="${escape(match.id)}">Open</button></article>`).join('');
  $('no-recommendations').hidden = recommendations.length > 0;
  const history = record.employmentHistory || [];
  $('employment-history').innerHTML = history.map((item) => `<p>${escape(item.title || 'Role not supplied')} · ${escape(item.company || item.domain || 'Company not supplied')}<br><span class="muted">Detected ${escape(dateLabel(item.detectedAt))}</span></p>`).join('');
  $('employment-history-panel').hidden = history.length === 0;
  $('delete-record').hidden = !record.saved;
}
function renderShortlist() {
  const workspace = FindEmmState.workspaceRecords(vault?.records || [], $('shortlist-search').value, $('shortlist-filter').value);
  $('count-active').textContent = workspace.counts.active; $('count-followup').textContent = workspace.counts.followUp; $('count-dnc').textContent = workspace.counts.doNotContact;
  $('shortlist-summary').textContent = vault ? `${workspace.total} matching of ${workspace.counts.total} saved · ${workspace.counts.queued} queued draft(s) · ${workspace.counts.roleChanges} role-change record(s).` : 'Unlock the local vault from Research to view saved records.';
  $('shortlist-records').innerHTML = workspace.records.map((record) => { const queued = (record.sequence || []).filter((item) => item.status === 'queued').length; const changes = record.employmentHistory?.length || 0; const list = FindEmmState.canContact(record) ? record.list : 'Do not contact'; return `<article class="shortlist-row"><div><strong>${escape(record.prospect.name)}</strong><small>${escape(record.prospect.title || 'Role not supplied')} · ${escape(record.prospect.company || record.prospect.domain || 'Company not supplied')}</small><span><b>${escape(list)}</b> · ${escape(recordSignal(record))}${queued ? ` · ${queued} queued` : ''}${changes ? ` · ${changes} role change${changes === 1 ? '' : 's'}` : ''}</span></div><button class="text-button" type="button" data-shortlist-id="${escape(record.id)}">Open</button></article>`; }).join('');
  $('no-shortlist').hidden = workspace.records.length > 0;
}
function formProspect() { return ['name', 'company', 'title', 'domain', 'profileUrl', 'importedEmail', 'importedPhone'].reduce((out, id) => ({ ...out, [id]: $(id).value.trim() }), {}); }
function blockOptedOut(event) { if (!current || FindEmmState.canContact(current)) return; event.stopImmediatePropagation(); $('status').textContent = 'Opt-out active. Outreach action blocked.'; }
async function saveCurrent(message, changes = {}) { if (!current) return; const candidate = { ...current, ...changes, saved: true, updatedAt: new Date().toISOString() }; const saved = await persist(candidate); renderRecord(saved.record); $('status').textContent = saved.changeDetected ? 'Existing person updated; previous role or company recorded.' : saved.deduplicated ? 'Existing person updated; contacts and local context merged.' : message; }
function exportRecord(record) { const csv = FindEmmState.toCsv(record); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const link = Object.assign(document.createElement('a'), { href: url, download: `findemm-${record.prospect.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv` }); link.click(); URL.revokeObjectURL(url); }
async function exportHandoff() {
  if (!vault || !passphrase) throw new Error('Unlock the secure local vault first.');
  const sharePassphrase = $('share-passphrase').value;
  try {
    const handoff = await FindEmmState.createHandoff(vault.records, sharePassphrase, $('handoff-list').value);
    const url = URL.createObjectURL(new Blob([handoff.text], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `findemm-handoff-${new Date().toISOString().slice(0, 10)}.findemm` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    $('status').textContent = `Exported ${handoff.count} record(s) from ${$('handoff-list').value}. Unrelated opt-out identities and pairing token excluded. Share passphrase separately; delete file after handoff.`;
  } finally { $('share-passphrase').value = ''; }
}
async function previewHandoff(file) {
  const sharePassphrase = $('share-passphrase').value;
  clearHandoffPreview();
  if (!vault || !passphrase) throw new Error('Unlock the secure local vault first.');
  if (sharePassphrase.length < 12) throw new Error('Use a share passphrase with at least 12 characters.');
  if (file.size > 5_000_000) throw new Error('Handoff file exceeds 5 MB.');
  const opened = await FindEmmState.openHandoff(await file.text(), sharePassphrase);
  const preview = FindEmmState.mergeImportedRecords(vault.records, opened.records);
  pendingHandoff = { opened, preview };
  $('merge-handoff').disabled = false;
  const additions = preview.imported - preview.deduplicated;
  $('handoff-preview').textContent = `${opened.selectedCount} selected-list record(s). Preview: ${additions} new, ${preview.deduplicated} exact-profile merge(s), ${preview.conflicts} conflict(s), ${preview.suppressions} suppression(s), ${preview.removedContacts} contact(s) removed. Shared identity claims require local recheck. Nothing saved yet.`;
}
async function mergeHandoff() {
  if (!pendingHandoff || !vault) return;
  const handoff = pendingHandoff;
  const { preview } = handoff;
  pendingHandoff = null;
  $('merge-handoff').disabled = true;
  const selectedRecordId = preview.records.some((record) => record.id === vault.selectedRecordId) ? vault.selectedRecordId : preview.records[0]?.id || '';
  const nextVault = { ...vault, records: preview.records, selectedRecordId };
  try { await saveVault(nextVault); } catch (error) { pendingHandoff = handoff; $('merge-handoff').disabled = false; throw error; }
  vault = nextVault;
  $('handoff-preview').textContent = 'Handoff merged into encrypted local vault.';
  renderShortlist();
  const selected = vault.records.find((record) => record.id === selectedRecordId);
  if (selected) renderRecord(selected);
  $('status').textContent = `Merged handoff: ${preview.imported - preview.deduplicated} new, ${preview.deduplicated} updated, ${preview.conflicts} conflict(s) skipped. Saved once.`;
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
  const purged = FindEmmState.purgeProspect(vault.records, prospect);
  const selectedRecordId = purged.records.some((record) => record.id === vault.selectedRecordId) ? vault.selectedRecordId : '';
  const nextVault = { ...vault, records: purged.records, selectedRecordId };
  await saveVault(nextVault);
  vault = nextVault;
  current = null;
  clearResearchForm();
  $('record-card').hidden = true;
  $('empty-record').hidden = false;
  renderShortlist();
  switchView('research');
  $('status').textContent = `Provider opt-out honored. ${purged.removed} matching local record(s) removed; only a keyed suppression hash with no plaintext identity remains in local server storage.`;
}
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
$('consent-check').addEventListener('change', (event) => { $('accept-consent').disabled = !event.target.checked; });
$('consent-dialog').addEventListener('cancel', (event) => event.preventDefault());
$('consent-dialog').addEventListener('close', async () => { if ($('consent-dialog').returnValue === 'accept') await chrome.storage.local.set({ consentVersion: CONSENT_VERSION }); });
$('unlock-vault').addEventListener('click', async () => { try { await unlockVault(); } catch (error) { $('vault-status').textContent = error.message; } });
$('clear-vault').addEventListener('click', async () => { if (!confirm('Delete all encrypted findEmm records and the saved local API token from this Chrome profile? This cannot be undone.')) return; try { clearHandoffPreview(); await chrome.storage.local.remove(['vaultSalt', 'vaultData']); vault = null; passphrase = ''; current = null; clearResearchForm(); $('vault-passphrase').value = ''; $('token').value = ''; $('share-passphrase').value = ''; $('vault-status').textContent = 'Encrypted vault deleted from this device.'; $('record-card').hidden = true; $('empty-record').hidden = false; renderShortlist(); switchView('record'); } catch (error) { $('vault-status').textContent = `Vault not deleted: ${error.message}`; } });
$('prospect-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const prospect = formProspect();
  const localBlock = vault?.records.find((record) => !FindEmmState.canContact(record) && FindEmmState.matchesProspect(record.prospect, prospect));
  if (localBlock) { renderRecord(localBlock); $('status').textContent = 'Local Do not contact safeguard blocked Research before any provider or company-page request.'; return; }
  $('status').textContent = 'Researching permitted sources…';
  try { const data = await request('/v1/enrich', { method: 'POST', body: JSON.stringify({ prospect }) }); renderRecord(recordFrom(data.prospect, data.results)); $('status').textContent = data.results.length ? `${data.results.length} sourced contact result(s). Confirm any person-email match before drafting.` : 'No sourced contact returned. If Hunter is enabled, enter a full name and company domain; findEmm does not generate guesses.'; }
  catch (error) { if (error.code === 'provider_opt_out') { try { await honorProviderOptOut(prospect); } catch (storageError) { clearResearchForm(); $('status').textContent = `Provider opt-out was durably suppressed by the local API, but local vault purge failed: ${storageError.message}. Do not research or contact this person.`; } } else $('status').textContent = error.message; }
});
$('capture').addEventListener('click', async () => { clearResearchForm(); switchView('research'); try { const captured = await capturePage(); if (captured.kind === 'unsupported') { $('status').textContent = 'Capture supports LinkedIn profile and company pages. Enter details manually on other pages.'; return; } Object.entries(captured.prospect).forEach(([key, value]) => { if ($(key)) $(key).value = value; }); const kind = captured.kind === 'linkedin_profile' ? 'LinkedIn profile' : 'LinkedIn company'; const fields = captured.capturedFields.join(', '); $('status').textContent = `${kind} fields captured${fields ? `: ${fields}` : ''}. Review before Research; add company domain if optional Hunter is enabled.`; } catch { $('status').textContent = 'This page cannot be captured. Enter details manually.'; } });
$('save-record').addEventListener('click', async () => { try { await saveCurrent('Record encrypted and saved locally.'); } catch (error) { $('status').textContent = `Record not saved: ${error.message}`; } });
$('move-list').addEventListener('click', async () => { if (!current) return; const target = $('list-select').value; if (target === 'Do not contact' && current.list !== target && !confirm('Move this person to Do not contact? Saved contacts and queued drafts will be removed.')) { $('list-select').value = current.list || 'Saved prospects'; return; } try { await saveCurrent(`Moved to ${target}.`, { list: target }); } catch (error) { $('list-select').value = current.list || 'Saved prospects'; $('status').textContent = `List not changed: ${error.message}`; } });
$('save-note').addEventListener('click', async () => { if (!current) return; try { await saveCurrent('Note encrypted and saved locally.', { note: $('record-note').value.trim() }); } catch (error) { $('status').textContent = `Note not saved: ${error.message}`; } });
$('queue-followup').addEventListener('click', blockOptedOut, true);
$('draft-outreach').addEventListener('click', blockOptedOut, true);
$('queue-followup').addEventListener('click', async () => { if (!current) return; try { await saveCurrent('Draft follow-up queued locally. No message was sent.', { sequence: FindEmmState.queueDraft(current.sequence) }); } catch (error) { $('status').textContent = `Follow-up not queued: ${error.message}`; } });
$('draft-outreach').addEventListener('click', () => { if (!current) return; const email = FindEmmState.draftableEmail(current); if (!email) { $('status').textContent = 'Confirm a person-email match first. Provider mailbox status, imports, patterns, and shared claims are not enough.'; return; } window.open(`mailto:${encodeURIComponent(email.value)}?subject=${encodeURIComponent(`Connecting about ${current.prospect.company || 'your work'}`)}&body=${encodeURIComponent(`Hi ${current.prospect.name.split(' ')[0]},\n\nI’m reaching out about…\n\nBest,`)}`); });
$('export-record').addEventListener('click', () => { if (current) exportRecord(current); });
$('contacts').addEventListener('click', async (event) => {
  const contactId = event.target.closest('[data-contact-id]')?.dataset.contactId;
  const contact = current?.contacts?.find((item) => item.id === contactId);
  if (!contact || !confirm('Confirm this work email belongs to this person? Provider mailbox status, recruiter input, and shared data do not prove identity. Continue only if you independently checked the match.')) return;
  const confirmed = FindEmmState.confirmContact(current, contactId);
  if (confirmed === current) { $('status').textContent = 'This contact cannot be confirmed as a person-specific work email.'; return; }
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
  const nextVault = { ...vault, records, selectedRecordId: vault.selectedRecordId === current.id ? '' : vault.selectedRecordId };
  clearHandoffPreview('Handoff preview cleared because a local record changed.');
  try { await saveVault(nextVault); vault = nextVault; current = null; $('record-card').hidden = true; $('empty-record').hidden = false; renderShortlist(); switchView('shortlist'); $('status').textContent = 'Local record deleted.'; } catch (error) { $('status').textContent = `Record not deleted: ${error.message}`; }
});
$('export-handoff').addEventListener('click', async () => { try { await exportHandoff(); } catch (error) { $('share-passphrase').value = ''; $('status').textContent = error.message; } });
$('choose-handoff').addEventListener('click', () => { if (!vault || !passphrase) { $('status').textContent = 'Unlock the secure local vault first.'; return; } if ($('share-passphrase').value.length < 12) { $('status').textContent = 'Use a share passphrase with at least 12 characters.'; return; } clearHandoffPreview(); $('import-handoff').value = ''; $('import-handoff').click(); });
$('share-passphrase').addEventListener('input', () => { if (pendingHandoff) clearHandoffPreview(); });
$('import-handoff').addEventListener('change', async (event) => { const [file] = event.target.files; if (!file) return; try { await previewHandoff(file); $('status').textContent = 'Handoff decrypted and previewed. Confirm merge to save once.'; } catch (error) { pendingHandoff = null; $('merge-handoff').disabled = true; const localError = ['Unlock the secure local vault first.', 'Use a share passphrase with at least 12 characters.', 'Handoff file exceeds 5 MB.'].includes(error.message); const message = localError ? error.message : 'Could not open this handoff. Passphrase may be wrong or file may have changed.'; $('handoff-preview').textContent = message; $('status').textContent = message; } finally { $('share-passphrase').value = ''; event.target.value = ''; } });
$('merge-handoff').addEventListener('click', async () => { try { await mergeHandoff(); } catch (error) { $('status').textContent = `Handoff not saved: ${error.message}`; } });
$('health').addEventListener('click', async () => { try { const health = await request('/v1/health'); $('status').textContent = `Local API ${health.status}. Hunter ${health.providers?.hunter ? 'enabled' : 'disabled'}. Allowlisted company-page lookup ${health.providers?.companyPages ? 'enabled' : 'disabled'}.`; } catch (error) { $('status').textContent = error.message; } });
storage().then(({ consentVersion }) => { if (consentVersion !== CONSENT_VERSION) $('consent-dialog').showModal(); });
