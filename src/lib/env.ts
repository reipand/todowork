import { z } from 'zod';

/**
 * Environment validation.
 *
 * Fails loudly at module load rather than letting `undefined` propagate into a fetch URL,
 * which would surface much later as a confusing network error. A missing config should look
 * like a missing config.
 *
 * The exception to "fail loudly" is the Supabase pair, which is optional so that guest mode is
 * reachable with no configuration at all. See the note on the schema below.
 *
 * Note on what is safe to expose: `NEXT_PUBLIC_*` variables are inlined into the client
 * bundle at build time and are readable by anyone. Only the anon key belongs there. The
 * service-role key bypasses RLS entirely and must never appear in this project; see
 * .env.example.
 */
const envSchema = z.object({
  /*
   * The two Supabase values are optional, and that is deliberate rather than lenient.
   *
   * Guest mode is a supported, fully-functional state: the app runs entirely against IndexedDB
   * with no cloud at all. If these were required, `readEnv` would throw on import and the guest
   * path could never be reached — `isCloudConfigured()` would never get the chance to return
   * false, because the module would have thrown first. Making them optional is what lets the
   * local-only promise hold, and it is why a developer can clone this repo and run it before
   * creating a Supabase project.
   *
   * When a value IS supplied it is still validated strictly, so a malformed URL or a truncated
   * key is reported at startup rather than as a confusing network error later.
   */
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL, e.g. https://xyz.supabase.co')
    .optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, 'NEXT_PUBLIC_SUPABASE_ANON_KEY looks too short to be a real key')
    .optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_ENABLE_PWA_INSTALL_PROMPT: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  NEXT_PUBLIC_CONFLICT_RETENTION_DAYS: z
    .string()
    .default('30')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: 'NEXT_PUBLIC_CONFLICT_RETENTION_DAYS must be a positive integer',
    }),
});

export type Env = z.infer<typeof envSchema>;

function readEnv(): Env {
  // Supabase renamed "anon key" to "publishable key" — same value, different env var name.
  // Accept either so the Supabase wizard's output works without manual renaming.
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ENABLE_PWA_INSTALL_PROMPT: process.env.NEXT_PUBLIC_ENABLE_PWA_INSTALL_PROMPT,
    NEXT_PUBLIC_CONFLICT_RETENTION_DAYS: process.env.NEXT_PUBLIC_CONFLICT_RETENTION_DAYS,
  });

  if (!parsed.success) {
    // Report which variables are wrong, never their values, since this can end up in a build
    // log or a crash report.
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration.\n\n${issues}\n\n` +
        'Copy .env.example to .env.local and fill in your Supabase project values ' +
        '(Dashboard -> Project Settings -> API).',
    );
  }

  return parsed.data;
}

export const env: Env = readEnv();
