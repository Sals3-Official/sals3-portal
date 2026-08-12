/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * Refuses a destructive database command when `DATABASE_URL` is not local.
 *
 * Runs as a prefix to every write command in `package.json`:
 *
 *   "db:migrate": "tsx scripts/guard-remote-db.mts db:migrate && drizzle-kit migrate"
 *
 * A prefix rather than a check inside each script, for two reasons: it also
 * covers `drizzle-kit`, which is a third-party binary this repository cannot
 * add a check to; and the refusal happens before the guarded process starts, so
 * there is no window where a partially-run command has already written.
 *
 * All decision logic lives in `src/lib/db/remote-write-guard.ts` so it can be
 * unit-tested without a database. This file only reads the environment, prints,
 * and sets an exit code.
 *
 * See `scripts/bootstrap-sals3-official-cj.mts` for why this uses `tsx` and an
 * extensionless relative import.
 */
/* eslint-disable import/extensions -- extensionless is what actually works
   here, matching this codebase's own scripts/ convention. */
import {
  ALLOW_REMOTE_ENV_VAR,
  decideRemoteWrite,
} from '../src/lib/db/remote-write-guard';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

const command = process.argv[2] ?? 'this command';

const decision = decideRemoteWrite({
  command,
  connectionString: process.env.DATABASE_URL,
  allowRemote: process.env[ALLOW_REMOTE_ENV_VAR],
});

if (!decision.allowed) {
  console.error(`\n[db-guard] ${decision.message}\n`);
  process.exit(1);
}

// A remote write that was explicitly allowed is still worth one line in the
// log, so it is visible in scrollback and CI output afterwards.
if (decision.reason === 'REMOTE_EXPLICITLY_ALLOWED') {
  console.warn(`[db-guard] ${decision.message}`);
}
