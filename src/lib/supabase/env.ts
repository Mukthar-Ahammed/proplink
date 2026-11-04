const missingSupabaseEnv = (name: string): never => {
  throw new Error(`${name} is not configured for Supabase Auth`);
};

export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  return {
    url: url || missingSupabaseEnv("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey:
      publishableKey ||
      missingSupabaseEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}
