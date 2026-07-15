const fs = require('node:fs');
const path = require('node:path');
const source = path.join(process.cwd(), 'extension');
const target = path.join(process.cwd(), 'dist', 'extension');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log(`Chrome extension copied to ${target}`);
