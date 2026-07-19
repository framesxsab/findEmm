const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const { screenProspectSuppressions } = require('./suppressions');
const PROVIDER_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;
const NON_PUBLIC_V4 = new net.BlockList();
const NON_PUBLIC_V6 = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) NON_PUBLIC_V4.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) NON_PUBLIC_V6.addSubnet(address, prefix, 'ipv6');

function text(value, max = 1000) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max); }
function domain(value) { const candidate = text(value).replace(/^https?:\/\//i, '').split('/')[0].toLowerCase(); if (!candidate) return ''; if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(candidate)) throw new Error('Company domain must be a valid hostname.'); return candidate; }
function workEmail(value) { const email = text(value, 320); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Work email must be valid.'); return email; }
function readBody(request, maximum = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let rejected = false;
    request.on('data', (chunk) => {
      if (rejected) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.byteLength;
      if (bytes > maximum) {
        rejected = true;
        chunks.length = 0;
        reject(Object.assign(new Error('Request body exceeds 1 MB.'), { statusCode: 413 }));
        return;
      }
      chunks.push(value);
    });
    request.on('end', () => {
      if (rejected) return;
      try {
        const body = Buffer.concat(chunks, bytes).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    request.on('error', (error) => { if (!rejected) reject(error); });
  });
}
function normalizeProspect(input = {}) { const name = text(input.name, 200); if (!name) throw new Error('Name is required.'); const parts = name.split(' '); return { name, firstName: parts[0].toLowerCase(), lastName: parts.length > 1 ? parts.at(-1).toLowerCase() : '', company: text(input.company, 200), title: text(input.title, 200), domain: domain(input.domain), profileUrl: text(input.profileUrl, 2048), importedEmail: workEmail(input.importedEmail || input.email || input.workEmail), importedPhone: text(input.importedPhone || input.phone || input.businessPhone, 100) }; }
function id(result) { return crypto.createHash('sha256').update(`${result.value}|${result.sourceUrl || ''}`).digest('hex').slice(0, 16); }
function make(value, contactType, status, confidence, reason, sourceUrl = '', evidenceSnippet = '', contactScope = 'person_candidate', details = {}) { const labels = { publicly_found: 'Publicly found company channel', provider_valid: 'Provider-valid mailbox — identity unconfirmed', provider_unverified: 'Provider candidate — not verified', recruiter_imported: 'Recruiter supplied — identity unchecked' }; return { id: id({ value, sourceUrl }), value, contactType, contactScope, status, statusLabel: labels[status] || status, confidence, reason, sourceUrl, evidenceSnippet, provider: details.provider || '', verifiedAt: details.verifiedAt || '', retrievedAt: new Date().toISOString() }; }
function policyAllows(host, limits) { const now = Date.now(); const last = limits.get(host) || 0; if (now - last < 1000) return false; limits.set(host, now); return true; }
function originAllowed(origin) { return !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin); }
function responseHeader(response, name) { return response.headers?.get ? response.headers.get(name) : response.headers?.[name.toLowerCase()]; }
async function stopBody(response, reader) { try { await reader?.cancel?.(); } catch {} try { await response.body?.cancel?.(); } catch {} try { response.destroy?.(); } catch {} }
async function readLimitedText(response, maximum) {
  const rawLength = responseHeader(response, 'content-length');
  const declared = rawLength === undefined || rawLength === null || rawLength === '' ? null : Number(rawLength);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) throw new Error('Response has an invalid content length.');
  if (declared > maximum) { await stopBody(response); throw new Error('Response exceeds size limit.'); }
  let reader;
  let bytes = 0;
  const chunks = [];
  const append = (value) => { const chunk = Buffer.from(value); bytes += chunk.byteLength; if (bytes > maximum) throw new Error('Response exceeds size limit.'); chunks.push(chunk); };
  try {
    if (response.body?.getReader) {
      reader = response.body.getReader();
      while (true) { const { done, value } = await reader.read(); if (done) break; append(value); }
    } else if (response[Symbol.asyncIterator]) {
      for await (const chunk of response) append(chunk);
    } else if (typeof response.text === 'function') append(await response.text());
    else throw new Error('Response body is unreadable.');
  } catch (error) {
    await stopBody(response, reader);
    throw error;
  }
  if (declared !== null && bytes !== declared) throw new Error('Response body was truncated.');
  return Buffer.concat(chunks, bytes).toString('utf8');
}
function robotsPermits(body, pathname, agent = 'findemm') {
  const groups = [];
  let agents = [];
  let rules = [];
  const push = () => { if (agents.length) groups.push({ agents, rules }); agents = []; rules = []; };
  for (const raw of String(body || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const userAgent = line.match(/^user-agent\s*:\s*(.+)$/i);
    if (userAgent) { if (rules.length) push(); agents.push(userAgent[1].trim().toLowerCase()); continue; }
    const rule = line.match(/^(allow|disallow)\s*:\s*(.*)$/i);
    if (rule && agents.length) rules.push({ kind: rule[1].toLowerCase(), path: rule[2].trim() });
  }
  push();
  const exact = groups.filter((group) => group.agents.includes(agent.toLowerCase()));
  const relevant = exact.length ? exact : groups.filter((group) => group.agents.includes('*'));
  const matches = relevant.flatMap((group) => group.rules).filter((rule) => rule.path).filter((rule) => { const anchored = rule.path.endsWith('$'); const source = (anchored ? rule.path.slice(0, -1) : rule.path).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'); return new RegExp(`^${source}${anchored ? '$' : ''}`).test(pathname); }).sort((left, right) => right.path.length - left.path.length || (left.kind === 'allow' ? -1 : 1));
  return !matches.length || matches[0].kind === 'allow';
}
function isPublicAddress(record) {
  const address = String(record?.address || '');
  const family = Number(record?.family);
  if (net.isIP(address) !== family) return false;
  if (family === 4) return !NON_PUBLIC_V4.check(address, 'ipv4');
  const first = Number.parseInt(address.split(':')[0], 16);
  return first >= 0x2000 && first <= 0x3fff && !NON_PUBLIC_V6.check(address, 'ipv6');
}
async function resolvePublicHost(host, lookup = dns.lookup) {
  const records = await lookup(host, { all: true, verbatim: true });
  if (!Array.isArray(records) || !records.length || !records.every(isPublicAddress)) throw new Error('Company host did not resolve only to public addresses.');
  const selected = records.find((record) => Number(record.family) === 4) || records[0];
  return { address: selected.address, family: Number(selected.family) };
}
function pinnedRequest({ host, address, family, pathname, headers, timeout }) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: host, servername: host, family, lookup: (_hostname, _options, callback) => callback(null, address, family), autoSelectFamily: false, port: 443, path: pathname, method: 'GET', redirect: 'error', rejectUnauthorized: true, agent: false, headers: { ...headers, 'accept-encoding': 'identity', connection: 'close' } }, resolve);
    request.once('error', reject);
    request.setTimeout(timeout, () => request.destroy(new Error('Company request timed out.')));
    request.end();
  });
}
async function requestStart(state, policy) {
  const now = policy.now || Date.now;
  const sleep = policy.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  while (true) { const current = Number(now()); if (!Number.isFinite(current)) throw new Error('Company request clock is invalid.'); const wait = state.nextStart - current; if (wait <= 0) { state.nextStart = current + 1000; return; } await sleep(wait); }
}
async function requestText(host, pin, pathname, maximum, state, policy, headers, timeout) {
  await requestStart(state, policy);
  const response = await (policy.request || pinnedRequest)({ host, ...pin, pathname, headers, timeout });
  const status = Number(response.statusCode ?? response.status);
  if (!Number.isInteger(status) || response.redirected || status >= 300 && status < 400) { await stopBody(response); throw new Error('Company redirects are not allowed.'); }
  return { status, contentType: String(responseHeader(response, 'content-type') || ''), body: await readLimitedText(response, maximum) };
}
function withHostWorkflow(host, limits, task) {
  let state = limits.get(host);
  if (!state || typeof state !== 'object' || !state.queue) { state = { nextStart: 0, queue: Promise.resolve() }; limits.set(host, state); }
  const run = state.queue.then(() => task(state));
  state.queue = run.catch(() => {});
  return run;
}
function evidenceFor(page, value) { const index = page.toLowerCase().indexOf(value.toLowerCase()); return page.slice(Math.max(0, index - 90), index + value.length + 90).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220); }
function extractCompanyContacts(page, host, url) { const emails = [...new Set(page.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])].filter((email) => email.toLowerCase().endsWith(`@${host}`)).slice(0, 5); const phones = [...new Set(page.match(/\+?[0-9][0-9 ()-]{7,}[0-9]/g) || [])].slice(0, 3); const reason = 'Found on a permitted company page; this company-level channel is not verified as belonging to the selected person.'; return [...emails.map((value) => make(value, 'work_email', 'publicly_found', 70, reason, url, evidenceFor(page, value), 'company')), ...phones.map((value) => make(value, 'business_phone', 'publicly_found', 60, reason, url, evidenceFor(page, value), 'company'))]; }
async function publicCompanyPage(prospect, limits, policy = {}) {
  if (!policy.enabled || !prospect.domain || !policy.allowedDomains?.has(prospect.domain) || !limits?.get) return [];
  return withHostWorkflow(prospect.domain, limits, async (state) => {
    try {
      const pin = await resolvePublicHost(prospect.domain, policy.lookup);
      const robots = await requestText(prospect.domain, pin, '/robots.txt', 100_000, state, policy, { 'user-agent': 'findEmm/0.1', accept: 'text/plain' }, 4000);
      if (robots.status < 200 || robots.status >= 300 || !robotsPermits(robots.body, '/contact')) return [];
      const page = await requestText(prospect.domain, pin, '/contact', 300_000, state, policy, { 'user-agent': 'findEmm/0.1 permitted-company-page lookup', accept: 'text/html' }, 5000);
      if (page.status < 200 || page.status >= 300 || !/^text\/html/i.test(page.contentType)) return [];
      return extractCompanyContacts(page.body, prospect.domain, `https://${prospect.domain}/contact`);
    } catch { return []; }
  });
}
const sourceRegistry = Object.freeze([
  { id: 'recruiter-import', permission: 'recruiter-supplied local data', rateLimit: 'none' },
  { id: 'company-contact-page', permission: 'explicit operator approval and exact domain allowlist, plus robots rules', rateLimit: 'requests to one host are spaced by at least one second' },
  { id: 'hunter-email-finder', permission: 'user-owned API key plus written commercial approval required', rateLimit: 'local gate: eight requests per second; provider limit: 15 per second and 500 per minute' }
]);
async function enrich(prospect, limits, provider = null, options = {}) {
  const providerLookup = provider ? await provider.lookup(prospect) : { contacts: [] };
  if (providerLookup.suppressed) throw Object.assign(new Error('Provider opt-out received. No identity or contact data may be retained; this lookup is durably suppressed locally.'), { statusCode: 451, code: 'provider_opt_out' });
  if (providerLookup.blockedDomain) throw Object.assign(new Error('Provider processing is blocked for this domain. No provider result or generated address was returned.'), { statusCode: 422, code: 'provider_domain_blocked' });
  const now = typeof options.now === 'function' ? options.now() : Date.now();
  const providerResults = (providerLookup.contacts || []).map((contact) => { const verifiedAt = contact.verificationDate || ''; const verifiedTime = Date.parse(verifiedAt); const fresh = contact.verificationStatus === 'valid' && Number.isFinite(verifiedTime) && verifiedTime <= now && now - verifiedTime <= PROVIDER_VALIDITY_MS; const reason = fresh ? `Hunter returned this as the most likely address and reported the mailbox valid on ${verifiedAt.slice(0, 10)}. This does not prove ownership by the selected person.` : `Hunter returned this address with ${contact.verificationStatus || 'unknown'} mailbox status${verifiedAt ? ` dated ${verifiedAt.slice(0, 10)}` : ''}. Treat it as an identity-unconfirmed candidate and recheck it.`; return make(contact.email, 'work_email', fresh ? 'provider_valid' : 'provider_unverified', contact.score, reason, contact.sourceUrl, contact.evidenceSnippet, 'person_candidate', { provider: 'hunter', verifiedAt }); });
  const imported = [prospect.importedEmail && make(prospect.importedEmail, 'work_email', 'recruiter_imported', 50, 'Supplied by a recruiter; identity and deliverability have not been verified.'), prospect.importedPhone && make(prospect.importedPhone, 'business_phone', 'recruiter_imported', 40, 'Supplied by a recruiter; ownership and currency have not been verified.')].filter(Boolean);
  const publicResults = await publicCompanyPage(prospect, limits, options.companyPages);
  return [...providerResults, ...imported, ...publicResults].filter((result, index, list) => list.findIndex((other) => other.contactType === result.contactType && other.value.toLowerCase() === result.value.toLowerCase()) === index);
}
function newBatch(prospects, results) { return prospects.map((prospect, index) => ({ prospect: normalizeProspect(prospect), results: results[index] })); }
async function enrichBatch(prospects, limits, provider = null, options = {}) {
  if (!Array.isArray(prospects) || prospects.length < 1 || prospects.length > 100) throw new Error('Batch must contain 1–100 prospects.');
  const normalized = prospects.map((prospect) => normalizeProspect(prospect));
  const results = await Promise.all(normalized.map((prospect) => enrich(prospect, limits, provider, options)));
  return newBatch(normalized, results);
}
function prepareSuppressionScreen(prospects, suppressionStore) {
  if (!Array.isArray(prospects) || prospects.length < 1 || prospects.length > 1000) throw new Error('Suppression screen requires 1–1,000 prospects.');
  const normalized = prospects.map(normalizeProspect);
  return { normalized, results: screenProspectSuppressions(normalized, suppressionStore) };
}
function screenImportedProspects(prospects, suppressionStore) {
  return prepareSuppressionScreen(prospects, suppressionStore).results;
}
function rejectSuppressedProspects(prospects, suppressionStore) {
  const { normalized, results } = prepareSuppressionScreen(prospects, suppressionStore);
  if (results.some((result, index) => !result.checkable && (normalized[index].importedEmail || normalized[index].importedPhone))) throw Object.assign(new Error('Imported work contact data requires a durable suppression alias: a canonical LinkedIn profile or a full name plus company domain.'), { statusCode: 422, code: 'suppression_alias_required' });
  if (results.some((result) => result.suppressed)) throw Object.assign(new Error('Provider opt-out received. No identity or contact data may be retained; this lookup is durably suppressed locally.'), { statusCode: 451, code: 'provider_opt_out' });
  return results;
}
async function withSuppressionRecheck(prospects, suppressionStore, task) {
  if (typeof task !== 'function') throw new TypeError('Suppression-guarded task is required.');
  rejectSuppressedProspects(prospects, suppressionStore);
  const result = await task();
  rejectSuppressedProspects(prospects, suppressionStore);
  return result;
}
module.exports = { normalizeProspect, extractCompanyContacts, enrich, enrichBatch, screenImportedProspects, rejectSuppressedProspects, withSuppressionRecheck, newBatch, originAllowed, policyAllows, readBody, readLimitedText, robotsPermits, sourceRegistry };
