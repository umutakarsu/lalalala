import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. Uses the anon key and is fully gated by RLS —
 * safe to ship to the client. Use inside Client Components / event handlers.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
