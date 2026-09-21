#!/usr/bin/env node
/* Incrémente automatiquement js/version.js (patch + build + date). */
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'js', 'version.js');
let content = fs.readFileSync(file, 'utf8');

const versionMatch = content.match(/number:\s*'(\d+)\.(\d+)\.(\d+)'/);
const buildMatch = content.match(/build:\s*(\d+)/);

if (!versionMatch || !buildMatch) {
  console.error('bump-version: champs introuvables dans js/version.js');
  process.exit(1);
}

const [, major, minor, patch] = versionMatch;
const newVersion = `${major}.${minor}.${parseInt(patch, 10) + 1}`;
const newBuild = parseInt(buildMatch[1], 10) + 1;
const today = new Date().toISOString().slice(0, 10);

content = content
  .replace(/number:\s*'[^']*'/, `number: '${newVersion}'`)
  .replace(/build:\s*\d+/, `build: ${newBuild}`)
  .replace(/date:\s*'[^']*'/, `date: '${today}'`);

fs.writeFileSync(file, content);
console.log(`Version bumpée -> v${newVersion} (build ${newBuild}, ${today})`);
