const ENDPOINT = 'https://api.hunter.io/v2/email-finder';
const CACHE_MS = 24 * 60 * 60 * 1000;
const CALL_GAP_MS = 125;
const { linkedInHandle, prospectSuppressionKeys } = require('./suppressions');

function publicUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.toString().length <= 2048 ? url.toString() : ''; } catch { return ''; } }
function professionalEmail(value) { const email = String(value || '').trim(); return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''; }
function safeDate(value) { const time = Date.parse(value || ''); return Number.isFinite(time) ? new Date(time).toISOString() : ''; }

function createHunterAdapter({ apiKey = '', commercialApproval = false, suppressionStore = null, fetchImpl = fetch, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const enabled = Boolean(apiKey && commercialApproval);
  if (enabled && (!suppressionStore || typeof suppressionStore.has !== 'function' || typeof suppressionStore.addMany !== 'function')) throw new Error('Hunter requires a durable suppression store.');
  const cache = new Map();
  const inflight = new Map();
  let queue = Promise.resolve();
  let nextCallAt = 0;
  let failedClosed = false;

  function schedule(task) {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }

  async function waitForCallSlot() {
    const wait = Math.max(0, nextCallAt - now());
    if (wait) await sleep(wait);
    nextCallAt = now() + CALL_GAP_MS;
  }

  function suppressionStatus(aliases, domainKey) {
    try {
      if (aliases.some((alias) => suppressionStore.has(alias))) return { contacts: [], suppressed: true };
      if (domainKey && suppressionStore.has(domainKey)) return { contacts: [], blockedDomain: true };
      return null;
    } catch {
      failedClosed = true;
      throw new Error('Hunter disabled because suppression storage is unavailable.');
    }
  }

  function persistSuppression(value, aliases, domainKey) {
    try {
      if (value.suppressed) suppressionStore.addMany(aliases);
      if (value.blockedDomain && domainKey) suppressionStore.addMany([domainKey]);
    } catch {
      failedClosed = true;
      throw new Error('Hunter disabled because suppression storage is unavailable.');
    }
  }

  async function request(prospect) {
    const url = new URL(ENDPOINT);
    const handle = linkedInHandle(prospect.profileUrl);
    if (handle) url.searchParams.set('linkedin_handle', handle);
    else { if (!prospect.domain || !prospect.firstName || !prospect.lastName) return { contacts: [] }; url.searchParams.set('domain', prospect.domain); url.searchParams.set('first_name', prospect.firstName); url.searchParams.set('last_name', prospect.lastName); }
    url.searchParams.set('max_duration', '10');
    let response;
    try { response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'x-api-key': apiKey } }); } catch { throw new Error('Hunter lookup unavailable.'); }
    const body = await response.json().catch(() => ({}));
    const errorId = body.errors?.[0]?.id || '';
    if (response.status === 451 || errorId === 'claimed_email') return { contacts: [], suppressed: true };
    if (errorId === 'invalid_domain') return { contacts: [], blockedDomain: true };
    if (!response.ok) { const messages = { 401: 'Hunter API key rejected.', 403: 'Hunter rate limit reached.', 429: 'Hunter credits exhausted.' }; throw Object.assign(new Error(messages[response.status] || `Hunter lookup failed (${response.status}).`), { statusCode: response.status >= 400 && response.status < 500 ? response.status : 502 }); }
    const data = body.data || {};
    const email = professionalEmail(data.email);
    if (!email) return { contacts: [] };
    const verificationStatus = ['valid', 'accept_all', 'unknown'].includes(data.verification?.status) ? data.verification.status : 'unknown';
    const source = (Array.isArray(data.sources) ? data.sources : []).map((item) => ({ uri: publicUrl(item?.uri), lastSeen: String(item?.last_seen_on || '').slice(0, 40) })).find((item) => item.uri) || {};
    return { contacts: [{ email, score: Number.isFinite(data.score) ? Math.max(0, Math.min(100, data.score)) : 0, verificationStatus, verificationDate: safeDate(data.verification?.date), sourceUrl: source.uri || '', evidenceSnippet: source.uri ? `Hunter source last seen ${source.lastSeen || 'date unavailable'}; mailbox status ${verificationStatus}.` : `Hunter returned no public source URL; mailbox status ${verificationStatus}.` }] };
  }

  async function lookup(prospect) {
    if (!enabled) return { contacts: [] };
    if (failedClosed) throw new Error('Hunter disabled because suppression storage is unavailable.');
    if (!prospect.domain || !prospect.firstName || !prospect.lastName) return { contacts: [] };
    const { aliases, domainKey } = prospectSuppressionKeys(prospect);
    const key = aliases[0];
    const stored = suppressionStatus(aliases, domainKey);
    if (stored) return stored;
    if (inflight.has(key)) return inflight.get(key);
    const pending = schedule(async () => {
      const queuedStatus = suppressionStatus(aliases, domainKey);
      if (queuedStatus) return queuedStatus;
      for (const [cacheKey, item] of cache) if (item.expiresAt <= now()) cache.delete(cacheKey);
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) return suppressionStatus(aliases, domainKey) || cached.value;
      await waitForCallSlot();
      const beforeRequest = suppressionStatus(aliases, domainKey);
      if (beforeRequest) return beforeRequest;
      const value = await request(prospect);
      persistSuppression(value, aliases, domainKey);
      const beforeCache = suppressionStatus(aliases, domainKey);
      if (beforeCache) { cache.delete(key); return beforeCache; }
      const cachedValue = { value, expiresAt: now() + CACHE_MS };
      cache.set(key, cachedValue);
      const expiry = setTimeout(() => { if (cache.get(key) === cachedValue) cache.delete(key); }, CACHE_MS);
      expiry.unref?.();
      const beforeReturn = suppressionStatus(aliases, domainKey);
      if (beforeReturn) { cache.delete(key); return beforeReturn; }
      return value;
    }).finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  }

  return { enabled, lookup };
}

module.exports = { createHunterAdapter, linkedInHandle };
