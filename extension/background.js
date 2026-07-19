chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ apiUrl: 'http://127.0.0.1:4317' });
  // Pre-release migration: never leave earlier plaintext record/token keys behind.
  chrome.storage.local.remove(['records', 'selectedRecordId', 'token', 'excludedIds']);
});

let vaultQueue = Promise.resolve();
function serializeVault(task) {
  const run = vaultQueue.then(task, task);
  vaultQueue = run.catch(() => {});
  return run;
}
function revision(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function validVaultData(value) { return value && typeof value === 'object' && typeof value.iv === 'string' && value.iv.length <= 64 && typeof value.cipher === 'string' && value.cipher.length <= 8_000_000; }

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return false;
  if (message.type === 'findemm-vault-salt') {
    serializeVault(async () => {
      if (typeof message.candidate !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(message.candidate)) throw new Error('Vault salt is invalid.');
      const stored = await chrome.storage.local.get(['vaultSalt']);
      const vaultSalt = stored.vaultSalt || message.candidate;
      if (!stored.vaultSalt) await chrome.storage.local.set({ vaultSalt });
      return { ok: true, vaultSalt };
    }).then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'findemm-vault-cas') {
    serializeVault(async () => {
      if (!validVaultData(message.vaultData)) throw new Error('Encrypted vault payload is invalid.');
      const stored = await chrome.storage.local.get(['vaultRevision']);
      const currentRevision = revision(stored.vaultRevision);
      if (revision(message.expectedRevision) !== currentRevision) return { ok: false, stale: true, currentRevision };
      const nextRevision = currentRevision + 1;
      await chrome.storage.local.set({ vaultData: message.vaultData, vaultRevision: nextRevision });
      return { ok: true, revision: nextRevision };
    }).then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'findemm-vault-remove') {
    serializeVault(async () => {
      const stored = await chrome.storage.local.get(['vaultRevision']);
      const currentRevision = revision(stored.vaultRevision);
      if (revision(message.expectedRevision) !== currentRevision) return { ok: false, stale: true, currentRevision };
      const nextRevision = currentRevision + 1;
      await chrome.storage.local.set({ vaultSalt: null, vaultData: null, vaultRevision: nextRevision });
      await chrome.storage.local.remove(['vaultSalt', 'vaultData']);
      return { ok: true, revision: nextRevision };
    }).then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});
