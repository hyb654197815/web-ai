#!/usr/bin/env node

import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const readmePath = join(projectRoot, 'README.md');
const githubReadmePath = join(projectRoot, 'README.github.md');
const npmReadmePath = join(projectRoot, 'README.npm.md');
const statePath = join(projectRoot, '.readme-state.json');

const mode = process.argv[2];

if (!mode || !['github', 'npm'].includes(mode)) {
  console.error('Usage: node scripts/sync-readme.js <github|npm>');
  process.exit(1);
}

if (!existsSync(githubReadmePath) || !existsSync(npmReadmePath)) {
  console.error('Missing README.github.md or README.npm.md');
  process.exit(1);
}

if (mode === 'npm') {
  const currentReadme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
  const githubReadme = readFileSync(githubReadmePath, 'utf8');

  if (currentReadme === githubReadme) {
    writeFileSync(
      statePath,
      `${JSON.stringify({ restore: 'github' }, null, 2)}\n`,
      'utf8',
    );
  }

  copyFileSync(npmReadmePath, readmePath);
  process.exit(0);
}

copyFileSync(githubReadmePath, readmePath);

if (existsSync(statePath)) {
  try {
    rmSync(statePath, { force: true });
  } catch {
    // ignore state cleanup errors
  }
}
