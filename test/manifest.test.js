const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('manifest uses explicit icons and no broad content-script injection', () => {
  const root = path.join(__dirname, '..', 'extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(Object.keys(manifest.icons), ['16', '32', '48', '128']);
  for (const icon of Object.values(manifest.icons)) assert.ok(fs.existsSync(path.join(root, icon)), `missing ${icon}`);
});
