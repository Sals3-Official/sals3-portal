import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

const projectRoot = process.cwd();
const nextDir = join(projectRoot, '.next');

/**
 * Why `.next` is moved aside at all: `tsconfig.json` includes
 * `.next/types` and `.next/dev/types`, so a stale generated route type from an
 * older build would be type-checked as if it were source. The check is "clean"
 * in the sense that it runs with no generated types present.
 */
const TEMPORARY_PREFIX = '.next-typecheck-tmp-';

// Use a same-drive temp dir, not os.tmpdir(): on Windows, the OS temp
// folder is usually on a different drive than the project (e.g. C: vs
// E:), and fs.renameSync cannot rename across drives/filesystems
// (EXDEV). Keeping the temp swap on the same drive as the project
// works on every platform.
const temporaryNextDir = join(
  projectRoot,
  `${TEMPORARY_PREFIX}${process.pid}-${Date.now()}`,
);
const tscBin = join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
);

/**
 * Windows keeps a directory handle open for a short while after the process
 * writing to it lets go, and something recreates `.next` while `tsc` runs — a
 * dev server, or Next's own type generation. Removing it then fails with
 * `ENOTEMPTY` or `EBUSY` on the first attempt and succeeds moments later.
 *
 * `rmSync`'s own retry loop exists for exactly this, so use it rather than a
 * hand-rolled sleep. The values are small on purpose: a second of patience is
 * worth spending, a stalled gate is not.
 */
const REMOVE_OPTIONS = {
  force: true,
  recursive: true,
  maxRetries: 10,
  retryDelay: 100,
};

/** Never throws. Cleanup must not decide whether the type check passed. */
function removeQuietly(target, whatFailed) {
  try {
    rmSync(target, REMOVE_OPTIONS);

    return true;
  } catch (error) {
    console.warn(
      `[typecheck:clean] ${whatFailed}: ${error.code ?? error.message}`,
    );

    return false;
  }
}

/**
 * Temp directories left behind by an interrupted run.
 *
 * They are named per-process, so a run killed between the rename and the
 * restore leaves one behind for good — and they accumulate, each holding a
 * whole `.next` build. Sweeping at the start rather than the end is what makes
 * a crashed run self-healing instead of permanent.
 *
 * Concurrent `typecheck:clean` runs in one working tree were never supported —
 * both would move the same `.next` aside and one would lose it — so this does
 * not try to tell a sibling's temp directory from an abandoned one.
 */
function sweepAbandonedTemporaries() {
  let entries;

  try {
    entries = readdirSync(projectRoot, { withFileTypes: true });
  } catch (error) {
    console.warn(
      `[typecheck:clean] could not scan for leftover temp directories: ${
        error.code ?? error.message
      }`,
    );

    return;
  }

  entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith(TEMPORARY_PREFIX) &&
        entry.name !== basename(temporaryNextDir),
    )
    .forEach((entry) => {
      const abandoned = join(projectRoot, entry.name);

      if (removeQuietly(abandoned, `could not remove ${entry.name}`)) {
        console.warn(`[typecheck:clean] removed leftover ${entry.name}`);
      }
    });
}

/**
 * Puts the real `.next` back, and **never** changes the exit code.
 *
 * This is the point of the rewrite: `rmSync` throwing `ENOTEMPTY` out of a
 * `finally` block used to replace a passing type check with a failed npm
 * script, so `npm run typecheck:clean` exited 1 on Windows while
 * `tsc --noEmit` exited 0 with no errors to show. A cleanup problem is a
 * cleanup problem; it is reported, and it is not a type error.
 *
 * When `.next` cannot be removed the temp directory is deliberately left where
 * it is rather than renamed over a directory that still exists — the next run's
 * sweep collects it.
 */
function restoreNextDir() {
  if (
    !removeQuietly(
      nextDir,
      'could not remove the .next recreated while the check ran',
    )
  ) {
    console.warn(
      `[typecheck:clean] leaving ${basename(
        temporaryNextDir,
      )} in place; the next run sweeps it.`,
    );

    return;
  }

  try {
    renameSync(temporaryNextDir, nextDir);
  } catch (error) {
    console.warn(
      `[typecheck:clean] could not restore .next from ${basename(
        temporaryNextDir,
      )}: ${error.code ?? error.message}`,
    );
  }
}

sweepAbandonedTemporaries();

let movedNextDir = false;

try {
  if (existsSync(nextDir)) {
    removeQuietly(
      temporaryNextDir,
      'could not clear the temp path before moving .next aside',
    );
    renameSync(nextDir, temporaryNextDir);
    movedNextDir = true;
  }

  // On Windows, spawning a .cmd file directly (without shell: true)
  // fails with EINVAL - .cmd/.bat files aren't real executables, they
  // need to go through the shell. Only enable it on win32 so behavior
  // on Mac/Linux is unchanged.
  const result = spawnSync(tscBin, ['--noEmit'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  process.exitCode = result.status ?? 1;
} finally {
  if (movedNextDir) {
    restoreNextDir();
  }
}
