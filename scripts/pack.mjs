// Zip dist/ into legion-3d-<version>.zip for the Chrome Web Store / releases.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const v = JSON.parse(readFileSync('dist/manifest.json', 'utf8')).version;
execSync(`cd dist && zip -qr ../legion-3d-${v}.zip .`, { stdio: 'inherit' });
console.log(`legion-3d-${v}.zip`);
