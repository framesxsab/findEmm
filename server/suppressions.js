const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_ENTRIES = 100_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const VERSION = 2;
const VERIFIER_CONTEXT = 'findemm-suppression-store:v2';

function normalize(key) {
  if (typeof key !== 'string') throw new TypeError('Suppression key must be a string.');
  const value = key.normalize('NFKC').trim().toLowerCase();
  if (!value) throw new Error('Suppression key is required.');
  return value;
}

function createSuppressionStore({ filePath, secret } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('Suppression file path is required.');
  if (!(typeof secret === 'string' || Buffer.isBuffer(secret)) || !secret.length) throw new Error('Suppression secret is required.');

  const target = path.resolve(filePath);
  const lockPath = `${target}.lock`;
  const verifier = crypto.createHmac('sha256', secret).update(VERIFIER_CONTEXT).digest('hex');
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(target, `${JSON.stringify({ version: VERSION, verifier, hashes: [] })}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Suppression path must be a regular file.');
  fs.chmodSync(target, 0o600);
  const descriptor = fs.openSync(target, 'r+');
  fs.closeSync(descriptor);

  function load() {
    if (fs.statSync(target).size > MAX_FILE_BYTES) throw new Error('Suppression file exceeds the safe size limit.');
    let data;
    try {
      data = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
      throw new Error('Suppression file is corrupt.');
    }
    const legacyEmpty = data?.version === 1 && Array.isArray(data.hashes) && data.hashes.length === 0 && Object.keys(data).sort().join(',') === 'hashes,version';
    if (legacyEmpty) return { hashes: new Set(), legacy: true };
    if (!data || Array.isArray(data) || Object.keys(data).sort().join(',') !== 'hashes,verifier,version' || data.version !== VERSION || !HASH.test(data.verifier || '') || !Array.isArray(data.hashes) || data.hashes.length > MAX_ENTRIES || data.hashes.some((hash) => typeof hash !== 'string' || !HASH.test(hash)) || new Set(data.hashes).size !== data.hashes.length) {
      throw new Error('Suppression file is corrupt.');
    }
    if (!crypto.timingSafeEqual(Buffer.from(data.verifier, 'hex'), Buffer.from(verifier, 'hex'))) throw new Error('Suppression secret does not match this store.');
    return { hashes: new Set(data.hashes), legacy: false };
  }

  function hash(key) {
    return crypto.createHmac('sha256', secret).update(normalize(key)).digest('hex');
  }

  function save(hashes) {
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify({ version: VERSION, verifier, hashes: [...hashes].sort() })}\n`, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, target);
      fs.chmodSync(target, 0o600);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch {}
      throw error;
    }
  }

  function withLock(task) {
    let descriptor;
    try { descriptor = fs.openSync(lockPath, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw new Error('Suppression store is locked.'); throw error; }
    try { return task(); } finally { fs.closeSync(descriptor); try { fs.unlinkSync(lockPath); } catch {} }
  }

  withLock(() => { const current = load(); if (current.legacy) save(current.hashes); });
  function addMany(keys) {
    const values = [...new Set((Array.isArray(keys) ? keys : []).map(hash))];
    if (!values.length) return 0;
    return withLock(() => {
      const hashes = load().hashes;
      const additions = values.filter((value) => !hashes.has(value));
      if (!additions.length) return 0;
      if (hashes.size + additions.length > MAX_ENTRIES) throw new Error('Suppression store is full.');
      additions.forEach((value) => hashes.add(value));
      save(hashes);
      return additions.length;
    });
  }
  return {
    has(key) { return load().hashes.has(hash(key)); },
    add(key) { return addMany([key]) > 0; },
    addMany
  };
}

module.exports = { createSuppressionStore };
