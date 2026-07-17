const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeProspect, enrich, enrichBatch, originAllowed, readBody, sourceRegistry } = require('./lib');
const { createHunterAdapter } = require('./hunter');
const { createSuppressionStore } = require('./suppressions');

const dataDir = path.join(__dirname, 'data');
const configPath = path.join(dataDir, 'config.json');
const suppressionPath = path.join(dataDir, 'suppressions.json');
fs.mkdirSync(dataDir, { recursive: true });
const configLock = `${configPath}.lock`;
let configLockDescriptor;
try { configLockDescriptor = fs.openSync(configLock, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw new Error('Local API config is locked by another startup.'); throw error; }
let config;
try {
  config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : { token: crypto.randomBytes(32).toString('hex') };
  if (!/^[a-f0-9]{64}$/.test(config.token || '')) throw new Error('Local API config token is invalid.');
  if (!config.suppressionSecret) {
    const existing = fs.existsSync(suppressionPath) ? JSON.parse(fs.readFileSync(suppressionPath, 'utf8')) : null;
    if (existing && (existing.version >= 2 || existing.hashes?.length)) throw new Error('Suppression secret is missing. Restore server/data/config.json before starting the API.');
    config.suppressionSecret = crypto.randomBytes(32).toString('hex');
  }
  if (!/^[a-f0-9]{64}$/.test(config.suppressionSecret)) throw new Error('Local suppression secret is invalid.');
  const temporaryConfig = `${configPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try { fs.writeFileSync(temporaryConfig, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporaryConfig, configPath); fs.chmodSync(configPath, 0o600); } catch (error) { try { fs.unlinkSync(temporaryConfig); } catch {} throw error; }
} finally { fs.closeSync(configLockDescriptor); try { fs.unlinkSync(configLock); } catch {} }
const batches = new Map();
const limits = new Map();
const suppressionStore = createSuppressionStore({ filePath: suppressionPath, secret: config.suppressionSecret });
const companyDomains = new Set(String(process.env.FINDEMM_PUBLIC_COMPANY_DOMAINS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
const companyPages = { enabled: process.env.FINDEMM_PUBLIC_COMPANY_FETCH_APPROVAL === 'confirmed' && companyDomains.size > 0, allowedDomains: companyDomains };
const hunter = createHunterAdapter({ apiKey: process.env.FINDEMM_HUNTER_API_KEY, commercialApproval: process.env.FINDEMM_HUNTER_COMMERCIAL_APPROVAL === 'confirmed', suppressionStore });
const BATCH_TTL_MS = 60 * 60 * 1000;
const MAX_BATCHES = 20;
function json(response, status, body) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-headers': 'content-type,x-findemm-token', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); response.end(JSON.stringify(body)); }
function authorize(request) { const supplied = request.headers['x-findemm-token']; if (typeof supplied !== 'string') return false; const actual = Buffer.from(supplied); const expected = Buffer.from(config.token); return actual.length === expected.length && crypto.timingSafeEqual(actual, expected); }
function pruneBatches(makeRoom = false) { const now = Date.now(); for (const [id, batch] of batches) if (Date.parse(batch.expiresAt) <= now) batches.delete(id); while (batches.size > MAX_BATCHES || (makeRoom && batches.size >= MAX_BATCHES)) batches.delete(batches.keys().next().value); }
const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin || '';
  if (!originAllowed(origin)) return json(response, 403, { error: 'Browser origin not allowed.' });
  if (origin) { response.setHeader('access-control-allow-origin', origin); response.setHeader('vary', 'origin'); }
  if (request.method === 'OPTIONS') return json(response, 204, {});
  if (!authorize(request)) return json(response, 401, { error: 'Pairing token required. Start the server and save its token in extension Settings.' });
  try {
    if (request.method === 'GET' && request.url === '/v1/health') return json(response, 200, { status: 'ok', bind: '127.0.0.1', providers: { hunter: hunter.enabled, companyPages: companyPages.enabled } });
    if (request.method === 'GET' && request.url === '/v1/sources') return json(response, 200, { sources: sourceRegistry.map((source) => ({ ...source, enabled: source.id === 'hunter-email-finder' ? hunter.enabled : source.id === 'company-contact-page' ? companyPages.enabled : true })) });
    if (request.method === 'POST' && request.url === '/v1/enrich') { const { prospect } = await readBody(request); const normalized = normalizeProspect(prospect); return json(response, 200, { prospect: normalized, results: await enrich(normalized, limits, hunter, { companyPages }) }); }
    if (request.method === 'POST' && request.url === '/v1/batches') { const { prospects } = await readBody(request); const results = await enrichBatch(prospects, limits, hunter, { companyPages }); const id = crypto.randomUUID(); const createdAt = new Date(); pruneBatches(true); batches.set(id, { id, createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + BATCH_TTL_MS).toISOString(), results }); const expiry = setTimeout(() => batches.delete(id), BATCH_TTL_MS); expiry.unref(); return json(response, 201, batches.get(id)); }
    const batch = request.url.match(/^\/v1\/batches\/([\w-]+)$/); if (request.method === 'GET' && batch) { pruneBatches(); return batches.has(batch[1]) ? json(response, 200, batches.get(batch[1])) : json(response, 404, { error: 'Batch not found. Batches expire after one hour or restart.' }); }
    return json(response, 404, { error: 'Not found' });
  } catch (error) { return json(response, error.statusCode || 400, { error: error.message || 'Request failed', code: error.code || 'request_failed' }); }
});
server.listen(4317, '127.0.0.1', () => { console.log('findEmm local API listening on http://127.0.0.1:4317'); console.log(`Pairing token: ${config.token}`); });
