#!/usr/bin/env node

/**
 * Post-export script to copy English content to root directory
 * This allows the default language (en) to be accessible without language prefix
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const outDir = join(__dirname, '../out');
const enDir = join(outDir, 'en');

console.log('Copying English content to root directory...');

if (!existsSync(enDir)) {
  console.error('Error: /en directory not found in output');
  process.exit(1);
}

// Get all items in /en directory
const fs = await import('node:fs/promises');
const items = await fs.readdir(enDir);

// Copy each item to root, excluding already existing root items
for (const item of items) {
  const source = join(enDir, item);
  const dest = join(outDir, item);

  // Skip if item already exists at root (like _next, api, etc.)
  if (existsSync(dest)) {
    console.log(`Skipping ${item} (already exists at root)`);
    continue;
  }

  try {
    cpSync(source, dest, { recursive: true });
    console.log(`Copied ${item}`);
  } catch (error) {
    console.error(`Error copying ${item}:`, error.message);
  }
}

console.log('English content copied to root directory successfully!');
