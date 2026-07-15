chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ apiUrl: 'http://127.0.0.1:4317' });
  // Pre-release migration: never leave earlier plaintext record/token keys behind.
  chrome.storage.local.remove(['records', 'selectedRecordId', 'token', 'excludedIds']);
});
