import { createServerSupabase } from '@/lib/supabase/server';

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: string; // 'MASTER' | 'EXECUTOR' | 'CLIENT' | ...
};

export function isInternalRole(role: string | null | undefined): boolean {
  return role === 'MASTER' || role === 'EXECUTOR';
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: row } = await supabase
      .from('users')
      .select('name, email, role')
      .eq('id', user.id)
      .maybeSingle();
    return {
      id: user.id,
      email: row?.email ?? user.email ?? '',
      name: row?.name ?? null,
      role: (row?.role as string) ?? 'CLIENT',
    };
  } catch {
    return null;
  }
}
