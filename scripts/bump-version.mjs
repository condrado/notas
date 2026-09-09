import fs from 'node:fs';

const commitMessage = process.argv.slice(2).join(' ');
const packageFile = 'package.json';
const readmeFile = 'README.md';
const htmlFile = 'index.html';
const packageData = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
const versionData = packageData;
const versionParts = versionData.version.split('.').map(Number);

if (versionParts.length !== 3 || versionParts.some(Number.isNaN)) {
  throw new Error(`Version invalida en ${packageFile}: ${versionData.version}`);
}

const releaseType = commitMessage.match(/feat\((major|minor|minior)\)/i)?.[1].toLowerCase();

if (releaseType === 'major') {
  versionParts[0] += 1;
  versionParts[1] = 0;
  versionParts[2] = 0;
} else if (releaseType === 'minor' || releaseType === 'minior') {
  versionParts[1] += 1;
  versionParts[2] = 0;
} else {
  versionParts[2] += 1;
}

const nextVersion = versionParts.join('.');
packageData.version = nextVersion;
fs.writeFileSync(packageFile, `${JSON.stringify(packageData, null, 2)}\n`);

let readme = fs.readFileSync(readmeFile, 'utf8');
readme = readme.replace(/Versión actual: \*\*[^*]+\*\*/, `Versión actual: **${nextVersion}**`);
fs.writeFileSync(readmeFile, readme);

let html = fs.readFileSync(htmlFile, 'utf8');
html = html.replace(/(<span id="app-version" class="app-version">)v[^<]*(<\/span>)/, `$1v${nextVersion}$2`);
fs.writeFileSync(htmlFile, html);

console.log(`Version actualizada a ${nextVersion} (${releaseType || 'patch'})`);