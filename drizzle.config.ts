import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config — used only by the `drizzle-kit` CLI (`db:generate`,
 * `db:migrate`), never by the running app. The app connects through
 * `src/lib/db/client.ts` instead.
 *
 * `.env.local` is loaded explicitly because the CLI runs outside Next.js,
 * which is what normally loads it. `process.loadEnvFile` is a Node built-in
 * (20.6+), so this needs no `dotenv` dependency.
 */
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local — fine when DATABASE_URL is already exported in the shell.
}

const connectionString = process.env.DATABASE_URL;

if (connectionString === undefined || connectionString === '') {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: connectionString },
  // Fail loudly on a destructive diff instead of silently dropping data.
  strict: true,
  verbose: true,
});
