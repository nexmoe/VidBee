import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve('dist/public');
const englishDir = path.join(outputDir, 'en');

/** Recursively merge a generated English route directory into an existing public asset directory. */
async function mergeDirectory(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await mergeDirectory(sourcePath, targetPath);
      continue;
    }

    await cp(sourcePath, targetPath, { force: true });
  }
}

/** Copy default-locale pages from /en to the site root for backwards-compatible URLs. */
async function promoteEnglishRoutes() {
  try {
    await stat(englishDir);
  } catch {
    console.log('[post-build] No /en output directory, skipping locale promotion.');
    return;
  }

  const entries = await readdir(englishDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(englishDir, entry.name);
    const targetPath = path.join(outputDir, entry.name);

    if (!entry.isDirectory()) {
      try {
        await stat(targetPath);
        console.log(`[post-build] Skipping file ${entry.name} (already exists at root).`);
      } catch {
        await cp(sourcePath, targetPath);
        console.log(`[post-build] Copied file ${entry.name}.`);
      }
      continue;
    }

    try {
      const targetStat = await stat(targetPath);
      if (targetStat.isDirectory()) {
        await mergeDirectory(sourcePath, targetPath);
        console.log(`[post-build] Merged directory ${entry.name}.`);
        continue;
      }
    } catch {
      // target does not exist
    }

    await cp(sourcePath, targetPath, { recursive: true });
    console.log(`[post-build] Copied directory ${entry.name}.`);
  }
}

/** Remove duplicate /en URLs from sitemap after promoting English routes to root. */
async function dedupeSitemap() {
  const sitemapPath = path.join(outputDir, 'sitemap.xml');

  try {
    const xml = await readFile(sitemapPath, 'utf8');
    const cleaned = xml.replace(/<url><loc>https:\/\/docs\.vidbee\.org\/en[^<]*<\/loc>.*?<\/url>/g, '');
    await writeFile(sitemapPath, cleaned);
    console.log('[post-build] Removed /en URLs from sitemap.xml.');
  } catch {
    console.log('[post-build] No sitemap.xml found, skipping sitemap cleanup.');
  }
}

await promoteEnglishRoutes();
await dedupeSitemap();
