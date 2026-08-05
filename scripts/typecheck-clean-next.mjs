import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.cwd();
const nextDir = join(projectRoot, '.next');
// Use a same-drive temp dir, not os.tmpdir(): on Windows, the OS temp
// folder is usually on a different drive than the project (e.g. C: vs
// E:), and fs.renameSync cannot rename across drives/filesystems
// (EXDEV). Keeping the temp swap on the same drive as the project
// works on every platform.
const temporaryNextDir = join(
  projectRoot,
  `.next-typecheck-tmp-${process.pid}-${Date.now()}`,
);
const tscBin = join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
);

let movedNextDir = false;

try {
  if (existsSync(nextDir)) {
    rmSync(temporaryNextDir, { force: true, recursive: true });
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
    rmSync(nextDir, { force: true, recursive: true });
    renameSync(temporaryNextDir, nextDir);
  }
}
