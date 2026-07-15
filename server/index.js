const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeProspect, enrich, newBatch, sourceRegistry } = require('./lib');

const dataDir = path.join(__dirname, 'data');
const configPath = path.join(dataDir, 'config.json');
fs.mkdirSync(dataDir, { recursive: true });
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : { token: crypto.randomBytes(32).toString('hex') };
if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
const batches = new Map();
const limits = new Map();
function json(response, status, body) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-findemm-token' }); response.end(JSON.stringify(body)); }
function audit(label, prospect) { console.info(`[audit] ${label} ${crypto.createHash('sha256').update(`${prospect.name || ''}|${prospect.domain || ''}`).digest('hex').slice(0, 12)}`); }
function readBody(request) { return new Promise((resolve, reject) => { let body = ''; request.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) request.destroy(); }); request.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON body')); } }); request.on('error', reject); }); }
function authorize(request) { const supplied = request.headers['x-findemm-token']; return typeof supplied === 'string' && supplied.length === config.token.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(config.token)); }
const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return json(response, 204, {});
  if (!authorize(request)) return json(response, 401, { error: 'Pairing token required. Start the server and save its token in extension Settings.' });
  try {
    if (request.method === 'GET' && request.url === '/v1/health') return json(response, 200, { status: 'ok', bind: '127.0.0.1' });
    if (request.method === 'GET' && request.url === '/v1/sources') return json(response, 200, { sources: sourceRegistry });
    if (request.method === 'POST' && request.url === '/v1/enrich') { const { prospect } = await readBody(request); const normalized = normalizeProspect(prospect); audit('enrich', normalized); return json(response, 200, { prospect: normalized, results: await enrich(normalized, limits) }); }
    if (request.method === 'POST' && request.url === '/v1/batches') { const { prospects } = await readBody(request); if (!Array.isArray(prospects) || prospects.length > 100) throw new Error('Batch must contain 1–100 prospects.'); const id = crypto.randomUUID(); const results = await Promise.all(prospects.map(async (item) => enrich(normalizeProspect(item), limits))); batches.set(id, { id, createdAt: new Date().toISOString(), results: newBatch(prospects, results) }); return json(response, 201, batches.get(id)); }
    const batch = request.url.match(/^\/v1\/batches\/([\w-]+)$/); if (request.method === 'GET' && batch) return batches.has(batch[1]) ? json(response, 200, batches.get(batch[1])) : json(response, 404, { error: 'Batch not found. Batches are memory-only.' });
    return json(response, 404, { error: 'Not found' });
  } catch (error) { return json(response, 400, { error: error.message || 'Request failed' }); }
});
server.listen(4317, '127.0.0.1', () => { console.log('findEmm local API listening on http://127.0.0.1:4317'); console.log(`Pairing token: ${config.token}`); });
