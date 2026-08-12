/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * Dumps the local `sals3` database to a timestamped file, so the recovery
 * documented in `sals3-portal-local-environment-recovery-and-database-guards`
 * - the local database was found simply gone one day, with no backup anywhere
 * - has something to restore from next time instead of starting from zero.
 *
 * Local only, on purpose. This is a convenience net for a developer's own
 * database, not a channel for pulling data off production - ADR-017 already
 * has a deliberate, scoped `pg_dump` restore path FROM Neon for that, run by
 * a person who means to. Reuses `classifyDatabaseTarget` from the remote-write
 * guard to refuse a REMOTE/MISSING/UNPARSEABLE target, but this script itself
 * is not one of the guarded write commands - there is no
 * `ALLOW_REMOTE_DB_WRITE` override here, because there is no legitimate reason
 * for this particular script to ever touch a remote database.
 *
 * Wired as `predev` (see package.json) so it runs by habit rather than by
 * memory, and throttled to once per `BACKUP_LOCAL_DB_MIN_INTERVAL_HOURS`
 * (default 6) so it does not re-dump on every single `next dev` restart.
 * Never blocks `npm run dev`: a missing `pg_dump` binary, an unreachable
 * database, or any other failure here prints a warning and exits 0 - a
 * skipped backup is not a reason to stop a developer from starting work.
 *
 * Imports only modules with no `server-only` guard - see
 * `bootstrap-sals3-official-cj.mts`'s header for why that guard breaks outside
 * Next.js's bundler.
 */
/* eslint-disable import/extensions -- extensionless is what actually works
   here, matching this codebase's own scripts/ convention. */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { classifyDatabaseTarget } from '../src/lib/db/remote-write-guard';

const BACKUP_DIR = join(process.cwd(), '.backups', 'local-db');
const KEEP_LAST = 7;
const MIN_INTERVAL_HOURS = Number(
  process.env.BACKUP_LOCAL_DB_MIN_INTERVAL_HOURS ?? '6',
);

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

function warnAndExit(message: string): never {
  console.warn(`[backup-local-db] ${message} - skipping backup.`);
  process.exit(0);
}

function stampFromDate(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * The Windows PostgreSQL installer does not add its `bin/` directory to
 * `PATH` by default - confirmed on this machine: `pg_dump` was on disk at
 * `C:\Program Files\PostgreSQL\17\bin\pg_dump.exe` but absent from `PATH` in
 * every shell tried. Falling back to a filesystem search on Windows only
 * means a fresh install still gets backed up, rather than this predev hook
 * silently doing nothing forever - which is the exact failure this script
 * exists to avoid repeating. macOS/Linux installs (Homebrew, apt) put
 * `pg_dump` on `PATH` themselves, so the fallback is Windows-specific.
 */
function resolvePgDump(): string {
  const onPath = spawnSync(
    process.platform === 'win32' ? 'where' : 'which',
    ['pg_dump'],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );

  if (onPath.status === 0) return 'pg_dump';

  if (process.platform === 'win32') {
    const root = 'C:\\Program Files\\PostgreSQL';
    let versions: string[];

    try {
      versions = readdirSync(root);
    } catch {
      return 'pg_dump';
    }

    const candidates = versions
      .map((v) => join(root, v, 'bin', 'pg_dump.exe'))
      .filter((p) => existsSync(p))
      // Highest version directory last from readdirSync's lexical order for
      // single/double-digit majors alike - '9' sorts after '17' otherwise.
      .sort((a, b) => Number(a.split('\\')[3]) - Number(b.split('\\')[3]));

    if (candidates.length > 0) return candidates[candidates.length - 1];
  }

  return 'pg_dump';
}

/**
 * Throttle check reads existing filenames rather than a separate state file -
 * one less thing that can drift from reality if a dump is deleted by hand.
 */
function mostRecentBackupAgeHours(): number | null {
  let entries: string[];

  try {
    entries = readdirSync(BACKUP_DIR);
  } catch {
    return null;
  }

  const dumps = entries.filter((name) => name.endsWith('.sql'));

  if (dumps.length === 0) return null;

  const mtimes = dumps.map((name) => statSync(join(BACKUP_DIR, name)).mtimeMs);
  const mostRecentMs = Math.max(...mtimes);

  return (Date.now() - mostRecentMs) / (1000 * 60 * 60);
}

function pruneOldBackups(): void {
  const dumps = readdirSync(BACKUP_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({
      name,
      mtimeMs: statSync(join(BACKUP_DIR, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  dumps.slice(KEEP_LAST).forEach((stale) => {
    unlinkSync(join(BACKUP_DIR, stale.name));
    console.log(`[backup-local-db] pruned ${stale.name}`);
  });
}

const connectionString = process.env.DATABASE_URL;
const target = classifyDatabaseTarget(connectionString);

if (target.kind !== 'LOCAL') {
  warnAndExit(
    target.kind === 'MISSING'
      ? 'DATABASE_URL is not set'
      : `DATABASE_URL does not point at this machine (${target.kind})`,
  );
}

const ageHours = mostRecentBackupAgeHours();

if (ageHours !== null && ageHours < MIN_INTERVAL_HOURS) {
  console.log(
    `[backup-local-db] last backup was ${ageHours.toFixed(1)}h ago (< ${MIN_INTERVAL_HOURS}h) - skipping.`,
  );
  process.exit(0);
}

mkdirSync(BACKUP_DIR, { recursive: true });

const outputPath = join(
  BACKUP_DIR,
  `${target.database}-${stampFromDate(new Date())}.sql`,
);

// --no-owner/--no-privileges: a restore onto a different local role (a
// teammate's machine, a freshly recreated `sals3_app`) should not fail on
// ownership statements for a role that may not exist there.
const result = spawnSync(
  resolvePgDump(),
  [
    '--no-owner',
    '--no-privileges',
    '--file',
    outputPath,
    connectionString as string,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

if (result.error) {
  warnAndExit(
    result.error.message.includes('ENOENT')
      ? 'pg_dump was not found on PATH - install the PostgreSQL client tools'
      : `could not run pg_dump (${result.error.message})`,
  );
}

if (result.status !== 0) {
  warnAndExit(
    `pg_dump exited ${result.status}: ${result.stderr?.toString().trim() ?? 'no output'}`,
  );
}

pruneOldBackups();
console.log(`[backup-local-db] wrote ${outputPath}`);
