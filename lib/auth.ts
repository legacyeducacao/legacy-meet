import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';

export type Sector = 'comercial' | 'executoria' | 'ambos';

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: string; // deprecado: consumidores migram p/ isAdmin/isStaff/sector nas Tasks 4–5
  isStaff: boolean;
  isAdmin: boolean;
  sector: Sector | null;
};

export function canSeeComercial(u: CurrentUser | null): boolean {
  if (!u || !u.isStaff) return false;
  return u.isAdmin || u.sector === 'comercial' || u.sector === 'ambos';
}

export function canSeeExecutoria(u: CurrentUser | null): boolean {
  if (!u || !u.isStaff) return false;
  return u.isAdmin || u.sector === 'executoria' || u.sector === 'ambos';
}

export function canSeeNps(u: CurrentUser | null): boolean {
  return canSeeExecutoria(u);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: row } = await supabase
      .from('users')
      .select('name, email, role')
      .eq('id', user.id)
      .maybeSingle();

    // meet_user_profile via service_role (RLS bloqueia a sessão)
    const admin = createAdminSupabase();
    const { data: profile } = await admin
      .from('meet_user_profile')
      .select('is_admin, sector')
      .eq('user_id', user.id)
      .maybeSingle();

    return {
      id: user.id,
      email: row?.email ?? user.email ?? '',
      name: row?.name ?? null,
      role: (row?.role as string) ?? 'CLIENT',
      isStaff: !!profile,
      isAdmin: profile?.is_admin ?? false,
      sector: (profile?.sector as Sector | undefined) ?? null,
    };
  } catch {
    return null;
  }
}
