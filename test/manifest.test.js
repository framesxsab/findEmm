const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('manifest uses explicit icons and no broad content-script injection', () => {
  const root = path.join(__dirname, '..', 'extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab', 'scripting']);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:4317/*']);
  assert.deepEqual(Object.keys(manifest.icons), ['16', '32', '48', '128']);
  for (const icon of Object.values(manifest.icons)) assert.ok(fs.existsSync(path.join(root, icon)), `missing ${icon}`);
});

test('popup exposes preview-first recruiter CSV import without a new browser permission', () => {
  const root = path.join(__dirname, '..', 'extension');
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  for (const id of ['choose-contact-import', 'download-contact-template', 'contact-import-file', 'contact-import-preview', 'merge-contact-import', 'research-record']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /never calls Hunter or a website/i);
  assert.match(html, /Imported additions wait for confirmation/i);
  assert.match(html, /known provider opt-out.*immediately/i);
  assert.match(html, /Generic or personal email\/phone columns are rejected/i);
});

test('popup provides keyboard-accessible view tabs', () => {
  const root = path.join(__dirname, '..', 'extension');
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
  assert.match(html, /role="tablist"/);
  for (const view of ['record', 'shortlist', 'research']) {
    assert.match(html, new RegExp(`id="${view}-tab" role="tab"[^>]*aria-controls="${view}-view"`));
    assert.match(html, new RegExp(`id="${view}-view" class="view" role="tabpanel" aria-labelledby="${view}-tab"`));
  }
  assert.match(popup, /aria-selected/);
  assert.match(popup, /ArrowLeft.*ArrowRight.*Home.*End/);
  assert.match(popup, /next\.focus\(\)/);
});

test('popup and background enforce suppression-screened imports with revision-checked vault writes', () => {
  const root = path.join(__dirname, '..', 'extension');
  const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  assert.match(popup, /screenContactRecords\(opened\.records, false\)/);
  assert.match(popup, /purgeSuppressedProspects/);
  assert.match(popup, /reconcileCurrentFromVault/);
  assert.match(popup, /reconcileAfterImportWrite/);
  assert.match(popup, /chrome\.storage\.onChanged/);
  assert.match(popup, /vaultStale/);
  assert.match(popup, /rememberSuppressionSignals\(records, screening\.results\)/);
  assert.match(popup, /reconcileUnlockedVault/);
  assert.match(popup, /vault\.records\.some\(\(record\) => isSessionSuppressed\(record\.prospect\)\)/);
  assert.match(popup, /FindEmmState\.normalizeResearchProspect\(formProspect\(\)\)/);
  assert.match(popup, /function mayContact\(record\).*hasDurableSuppressionAlias/);
  assert.match(popup, /function localDncRecord/);
  assert.match(popup, /const screening = await screenContactRecords\(\[record\]\)/);
  assert.match(popup, /assertVaultSnapshot\(exportVault, exportRevision\)/);
  assert.match(popup, /pendingContactImport = canMerge \?.*vaultRevision/);
  assert.match(popup, /preview\.imported > 0 && preview\.blockingConflicts === 0/);
  const csvScreen = popup.indexOf('screening = await screenContactRecords(parsed.records)');
  const csvEnforce = popup.indexOf('purged = await enforceScreenedSuppressions(parsed.records, screening', csvScreen);
  const csvFreshness = popup.indexOf('assertActivePreview(generation)', csvEnforce);
  assert.ok(csvScreen >= 0 && csvScreen < csvEnforce && csvEnforce < csvFreshness, 'CSV suppression must be enforced before preview freshness can discard it');
  const handoffScreen = popup.indexOf('screening = await screenContactRecords(opened.records, false)');
  const handoffEnforce = popup.indexOf('purged = await enforceScreenedSuppressions(opened.records, screening', handoffScreen);
  const handoffFreshness = popup.indexOf('assertActivePreview(generation)', handoffEnforce);
  assert.ok(handoffScreen >= 0 && handoffScreen < handoffEnforce && handoffEnforce < handoffFreshness, 'handoff suppression must be enforced before preview freshness can discard it');
  const researchRequest = popup.indexOf("const data = await request('/v1/enrich'");
  const researchSnapshot = popup.indexOf('assertVaultSnapshot(researchVault, researchRevision)', researchRequest);
  const researchRender = popup.indexOf('renderRecord(recordFrom(normalizedResult, results))', researchSnapshot);
  assert.ok(researchRequest >= 0 && researchRequest < researchSnapshot && researchSnapshot < researchRender, 'Research must discard a result when the vault changes in flight');
  assert.match(background, /findemm-vault-cas/);
  assert.match(background, /expectedRevision/);
});
