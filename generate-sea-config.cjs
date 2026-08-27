const fs = require('fs');
const path = require('path');

const distPath = path.resolve('dist');

function getFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...getFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

const files = getFiles(distPath);

const assets = {};

for (const file of files) {
  const relativePath = path.relative(distPath, file).replace(/\\/g, '/');

  assets[`dist/${relativePath}`] = file;
}

const config = {
  main: path.resolve('build/server.cjs'),
  output: path.resolve('build/sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true,
  assets,
};

fs.writeFileSync('sea-config.json', JSON.stringify(config, null, 2));

console.log(`SEA config generated with ${files.length} assets.`);
