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

    const email = row?.email ?? user.email ?? '';
    // Todo usuário do domínio Legacy tem acesso ao Meet (entrar + criar reuniões),
    // mesmo sem meet_user_profile. Cobre legacyeducacaocorp / legacyeducacao e o
    // typo "leagacy". Sector e is_admin continuam vindo do profile quando existir.
    // Compara o DOMÍNIO exato (ancorado ^...$) — não substring, senão
    // "x@legacyeducacaocorp.com.br.evil.com" passaria como staff.
    const domain = email.split('@').pop()?.toLowerCase() ?? '';
    const isLegacyStaff = /^lea?gacyeducacao(corp)?\.com\.br$/.test(domain);
    return {
      id: user.id,
      email,
      name: row?.name ?? null,
      role: (row?.role as string) ?? 'CLIENT',
      isStaff: !!profile || isLegacyStaff,
      isAdmin: profile?.is_admin ?? false,
      sector: (profile?.sector as Sector | undefined) ?? null,
    };
  } catch {
    return null;
  }
}
