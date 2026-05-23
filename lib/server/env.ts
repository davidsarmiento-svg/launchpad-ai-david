import "server-only";

import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("must be a valid URL (e.g. https://xxxx.supabase.co)"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "must not be empty"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "must not be empty"),
  ANTHROPIC_API_KEY: z.string().min(1, "must not be empty"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  throw new Error(
    [
      "Invalid or missing server environment variables:",
      issues,
      "",
      "Fix locally with:",
      "  vercel env pull --environment=preview .env.local",
      "",
      "Or set the missing values manually in .env.local using your",
      "launchpad-dev Supabase + Anthropic keys.",
    ].join("\n"),
  );
}

export const serverEnv = parsed.data;
