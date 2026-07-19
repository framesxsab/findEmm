const test = require('node:test');
const assert = require('node:assert/strict');

function loadBackground() {
  const values = {};
  let messageHandler;
  global.chrome = {
    runtime: {
      id: 'findemm-test-extension',
      onInstalled: { addListener() {} },
      onMessage: { addListener(handler) { messageHandler = handler; } }
    },
    storage: {
      local: {
        async get(keys) { return Object.fromEntries(keys.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]])); },
        async set(next) { Object.assign(values, next); },
        async remove(keys) { keys.forEach((key) => { delete values[key]; }); }
      }
    }
  };
  delete require.cache[require.resolve('../extension/background')];
  require('../extension/background');
  const send = (message) => new Promise((resolve, reject) => {
    const accepted = messageHandler(message, { id: chrome.runtime.id }, resolve);
    if (!accepted) reject(new Error('Message was not accepted.'));
  });
  return { send, values, handler: (...args) => messageHandler(...args) };
}

test('background worker serializes vault salts and rejects stale encrypted writes', async () => {
  const { send, values, handler } = loadBackground();
  const firstSalt = 'AAAAAAAAAAAAAAAAAAAAAA==';
  const secondSalt = 'BBBBBBBBBBBBBBBBBBBBBB==';
  const salts = await Promise.all([send({ type: 'findemm-vault-salt', candidate: firstSalt }), send({ type: 'findemm-vault-salt', candidate: secondSalt })]);
  assert.deepEqual(salts.map(({ vaultSalt }) => vaultSalt), [firstSalt, firstSalt]);
  const payload = { iv: 'AAAAAAAAAAAAAAAA', cipher: 'ciphertext' };
  const writes = await Promise.all([send({ type: 'findemm-vault-cas', expectedRevision: 0, vaultData: payload }), send({ type: 'findemm-vault-cas', expectedRevision: 0, vaultData: payload })]);
  assert.equal(writes.filter(({ ok }) => ok).length, 1);
  assert.equal(writes.filter(({ stale }) => stale).length, 1);
  assert.equal(values.vaultRevision, 1);
  assert.equal(handler({ type: 'findemm-vault-cas', expectedRevision: 1, vaultData: payload }, { id: 'another-extension' }, () => {}), false);
});

test('background worker revision-checks destructive vault removal', async () => {
  const { send, values } = loadBackground();
  await send({ type: 'findemm-vault-salt', candidate: 'AAAAAAAAAAAAAAAAAAAAAA==' });
  await send({ type: 'findemm-vault-cas', expectedRevision: 0, vaultData: { iv: 'AAAAAAAAAAAAAAAA', cipher: 'ciphertext' } });
  assert.equal((await send({ type: 'findemm-vault-remove', expectedRevision: 0 })).stale, true);
  assert.equal((await send({ type: 'findemm-vault-remove', expectedRevision: 1 })).ok, true);
  assert.equal(values.vaultData, undefined);
  assert.equal(values.vaultSalt, undefined);
  assert.equal(values.vaultRevision, 2);
});
