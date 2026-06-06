import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '@clipal/config';
import { captureException } from '@clipal/observability';
import { open } from 'maxmind';
import * as tar from 'tar';
import { initGeo } from '../lib/geo';

/**
 * §18.3 — keep the MaxMind GeoLite2 databases fresh. Gated on
 * MAXMIND_LICENSE_KEY (free with a MaxMind account); when unset the worker skips
 * this entirely (see index.ts) and geo stays best-effort (country=ZZ).
 *
 * Runs at startup (downloads anything missing/stale) and weekly thereafter. The
 * commercial GeoLite2 terms require the data be no more than 30 days old; weekly
 * gives comfortable headroom. Each edition is downloaded as the official
 * permalink tar.gz, verified against its published sha256, the .mmdb extracted to
 * a temp file and atomically renamed into place — so the live reader never sees a
 * half-written file. After a successful GeoLite2-City update the in-process
 * reader is hot-swapped via initGeo().
 */

const DOWNLOAD_BASE = 'https://download.maxmind.com/app/geoip_download';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // re-download if older than a week

function editionList(): string[] {
  return env.MAXMIND_EDITION_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function fmtSize(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)}MB`;
}

/** Build date (YYYY-MM-DD) from the mmdb metadata, or 'unknown'. */
async function readBuildDate(path: string): Promise<string> {
  try {
    const reader = await open(path);
    const built = reader.metadata.buildEpoch; // maxmind types this as a Date
    if (built instanceof Date) return built.toISOString().slice(0, 10);
  } catch {
    /* fall through */
  }
  return 'unknown';
}

interface UpdateResult {
  sizeBytes: number;
  buildDate: string;
  skipped: boolean;
}

async function updateEdition(edition: string): Promise<UpdateResult> {
  const dir = env.GEOIP_DIR;
  const finalPath = join(dir, `${edition}.mmdb`);

  // Skip if the local copy is still fresh (the weekly tick handles staleness).
  const existing = await stat(finalPath).catch(() => null);
  if (existing && Date.now() - existing.mtimeMs < MAX_AGE_MS) {
    return { sizeBytes: existing.size, buildDate: await readBuildDate(finalPath), skipped: true };
  }

  const key = env.MAXMIND_LICENSE_KEY;
  const tarUrl = `${DOWNLOAD_BASE}?edition_id=${encodeURIComponent(edition)}&license_key=${encodeURIComponent(key)}&suffix=tar.gz`;
  const shaUrl = `${tarUrl}.sha256`;

  const [tarRes, shaRes] = await Promise.all([fetch(tarUrl), fetch(shaUrl)]);
  if (!tarRes.ok) throw new Error(`download failed: HTTP ${tarRes.status}`);
  if (!shaRes.ok) throw new Error(`checksum fetch failed: HTTP ${shaRes.status}`);

  const buf = Buffer.from(await tarRes.arrayBuffer());
  const expected = (await shaRes.text()).trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(buf).digest('hex');
  if (!expected || actual !== expected) {
    throw new Error(`sha256 mismatch (expected ${expected ?? 'none'}, got ${actual})`);
  }

  await mkdir(dir, { recursive: true });
  const tmpDir = await mkdtemp(join(dir, '.geoip-'));
  try {
    const tgzPath = join(tmpDir, 'edition.tar.gz');
    await writeFile(tgzPath, buf);
    // Extract just the .mmdb, dropping the dated parent dir (strip:1).
    await tar.x({ file: tgzPath, cwd: tmpDir, strip: 1, filter: (p) => p.endsWith('.mmdb') });

    const extracted = join(tmpDir, `${edition}.mmdb`);
    const buildDate = await readBuildDate(extracted); // also validates it's a real mmdb

    // Atomic publish: copy into the target dir, then rename over the live file.
    const tmpFinal = `${finalPath}.tmp`;
    await copyFile(extracted, tmpFinal);
    await rename(tmpFinal, finalPath);

    const size = (await stat(finalPath)).size;
    return { sizeBytes: size, buildDate, skipped: false };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function refreshGeo(): Promise<void> {
  let cityUpdated = false;
  for (const edition of editionList()) {
    try {
      const { sizeBytes, buildDate, skipped } = await updateEdition(edition);
      if (skipped) {
        console.log(`[geo] ${edition}.mmdb already fresh (version: ${buildDate})`);
      } else {
        console.log(`[geo] ${edition}.mmdb updated (size: ${fmtSize(sizeBytes)}, version: ${buildDate})`);
        if (edition === 'GeoLite2-City') cityUpdated = true;
      }
    } catch (err) {
      console.error(`[geo] ${edition} refresh failed`, err);
      captureException(err, { job: 'geo-refresh', edition });
    }
  }
  // Hot-swap the live reader so the click pipeline picks up the new City data.
  if (cityUpdated) await initGeo();
}
