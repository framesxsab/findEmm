const $ = (id) => document.getElementById(id);
let current = null;
let vault = null;
let passphrase = '';

function vaultDefault() { return { token: '', records: [], selectedRecordId: '' }; }
async function storage() { return chrome.storage.local.get(['apiUrl', 'vaultSalt', 'vaultData', 'consentVersion']); }
async function saveVault() { if (!vault || !passphrase) throw new Error('Unlock the secure local vault first.'); const { vaultSalt } = await storage(); await chrome.storage.local.set({ vaultData: await FindEmmState.seal(vault, passphrase, vaultSalt) }); }
async function unlockVault() {
  const entered = $('vault-passphrase').value;
  if (entered.length < 12) throw new Error('Use a vault passphrase with at least 12 characters.');
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
  const selected = vault.records.find((record) => record.id === vault.selectedRecordId);
  if (selected) renderRecord(selected);
}
async function request(path, options = {}) {
  if (!vault?.token) throw new Error('Unlock the vault and save the local API pairing token first.');
  const { apiUrl = 'http://127.0.0.1:4317' } = await storage();
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', 'x-findemm-token': vault.token, ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({ error: 'Server returned invalid JSON' }));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function escape(value = '') { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function initials(name = '') { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '??'; }
function statusClass(status) { return `status-${status}`; }
function contactKind(contact) { return contact.contactType === 'business_phone' ? '☎' : contact.status === 'pattern_candidate' ? '✦' : '✉'; }
function recordFrom(prospect, contacts) { return FindEmmState.createRecord(prospect, contacts); }
async function persist(record) { const rest = vault.records.filter((item) => item.id !== record.id); vault.records = [record, ...rest]; vault.selectedRecordId = record.id; await saveVault(); }
function switchView(view) { document.querySelectorAll('.view').forEach((node) => { node.hidden = node.id !== `${view}-view`; }); document.querySelectorAll('.tab').forEach((node) => node.classList.toggle('is-active', node.dataset.view === view)); }
function renderRecord(record) {
  current = record; $('empty-record').hidden = true; $('record-card').hidden = false;
  $('initials').textContent = initials(record.prospect.name); $('record-name').textContent = record.prospect.name; $('record-title').textContent = record.prospect.title || 'Role not supplied'; $('record-company').textContent = record.prospect.company || 'Company not supplied'; $('record-domain').textContent = record.prospect.domain || 'No company domain'; $('record-count').textContent = `${record.contacts.length} contact${record.contacts.length === 1 ? '' : 's'}`; $('record-note').value = record.note || ''; $('list-select').value = record.list || 'Saved prospects'; $('list-copy').textContent = record.saved ? `Saved in ${record.list}.` : 'Not yet saved to a list.'; $('save-label').textContent = record.saved ? `Saved to ${record.list}` : 'Save to local list'; $('save-record').textContent = record.saved ? 'Saved locally' : 'Save record'; $('sequence-copy').textContent = record.sequence?.length ? `${record.sequence.length} draft follow-up step(s) queued locally.` : 'Keep the next step local until you act.';
  $('contacts').innerHTML = record.contacts.map((contact) => `<article class="contact-row"><span class="contact-kind ${contact.contactType === 'business_phone' ? 'kind-phone' : contact.status === 'pattern_candidate' ? 'kind-candidate' : contact.status === 'provider_verified' ? 'kind-provider' : 'kind-email'}">${contactKind(contact)}</span><div class="contact-main"><div class="contact-value">${escape(contact.value)}</div><div class="contact-meta"><span class="status-pill ${statusClass(contact.status)}">${escape(contact.statusLabel)}</span><span>${escape(contact.reason)}</span></div></div><div class="contact-source">${contact.sourceUrl ? `<a href="${escape(contact.sourceUrl)}" target="_blank" rel="noreferrer">Evidence</a>` : 'Recruiter input'}<br>${escape(new Date(contact.retrievedAt).toLocaleDateString())}</div></article>`).join('');
  $('no-contacts').hidden = record.contacts.length > 0; switchView('record');
}
function formProspect() { return ['name', 'company', 'title', 'domain', 'profileUrl', 'importedEmail', 'importedPhone'].reduce((out, id) => ({ ...out, [id]: $(id).value.trim() }), {}); }
async function saveCurrent(message) { if (!current) return; current.saved = true; current.updatedAt = new Date().toISOString(); await persist(current); renderRecord(current); $('status').textContent = message; }
function exportRecord(record) { const csv = FindEmmState.toCsv(record); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const link = Object.assign(document.createElement('a'), { href: url, download: `findemm-${record.prospect.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv` }); link.click(); URL.revokeObjectURL(url); }
async function capturePage() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ profileUrl: location.href, name: document.querySelector('h1')?.textContent?.trim() || document.title, pageText: `${document.title} ${document.querySelector('meta[name="description"]')?.content || ''}`.trim().slice(0, 500) }) }); return result; }
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
$('consent-check').addEventListener('change', (event) => { $('accept-consent').disabled = !event.target.checked; });
$('consent-dialog').addEventListener('close', async () => { if ($('consent-dialog').returnValue === 'accept') await chrome.storage.local.set({ consentVersion: 1 }); });
$('unlock-vault').addEventListener('click', async () => { try { await unlockVault(); } catch (error) { $('vault-status').textContent = error.message; } });
$('clear-vault').addEventListener('click', async () => { if (!confirm('Delete all encrypted findEmm records and the saved local API token from this Chrome profile?')) return; await chrome.storage.local.remove(['vaultSalt', 'vaultData']); vault = null; passphrase = ''; current = null; $('vault-passphrase').value = ''; $('token').value = ''; $('vault-status').textContent = 'Encrypted vault deleted from this device.'; $('record-card').hidden = true; $('empty-record').hidden = false; switchView('record'); });
$('prospect-form').addEventListener('submit', async (event) => { event.preventDefault(); $('status').textContent = 'Researching permitted sources…'; try { const data = await request('/v1/enrich', { method: 'POST', body: JSON.stringify({ prospect: formProspect() }) }); renderRecord(recordFrom(data.prospect, data.results)); $('status').textContent = `${data.results.length} contact result(s) with provenance.`; } catch (error) { $('status').textContent = error.message; } });
$('capture').addEventListener('click', async () => { try { const captured = await capturePage(); Object.entries(captured).forEach(([key, value]) => { if ($(key)) $(key).value = value; }); switchView('research'); $('status').textContent = 'Page details added. Review them before research.'; } catch { switchView('research'); $('status').textContent = 'This page cannot be captured. Enter details manually.'; } });
$('save-record').addEventListener('click', () => saveCurrent('Record encrypted and saved locally.'));
$('move-list').addEventListener('click', async () => { if (!current) return; current.list = $('list-select').value; await saveCurrent(`Moved to ${current.list}.`); });
$('save-note').addEventListener('click', async () => { if (!current) return; current.note = $('record-note').value.trim(); await saveCurrent('Note encrypted and saved locally.'); });
$('queue-followup').addEventListener('click', async () => { if (!current) return; current.sequence = FindEmmState.queueDraft(current.sequence); await saveCurrent('Draft follow-up queued locally. No message was sent.'); });
$('draft-outreach').addEventListener('click', () => { if (!current) return; const email = current.contacts.find((contact) => contact.contactType === 'work_email' && contact.status !== 'pattern_candidate'); if (!email) { $('status').textContent = 'No sourced email available for a draft.'; return; } window.open(`mailto:${encodeURIComponent(email.value)}?subject=${encodeURIComponent(`Connecting about ${current.prospect.company || 'your work'}`)}&body=${encodeURIComponent(`Hi ${current.prospect.name.split(' ')[0]},\n\nI’m reaching out about…\n\nBest,`)}`); });
$('export-record').addEventListener('click', () => { if (current) exportRecord(current); });
$('health').addEventListener('click', async () => { try { const health = await request('/v1/health'); $('status').textContent = `Local API ${health.status}.`; } catch (error) { $('status').textContent = error.message; } });
storage().then(({ consentVersion }) => { if (!consentVersion) $('consent-dialog').showModal(); });
