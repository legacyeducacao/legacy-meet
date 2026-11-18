import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { lerCapacidades, PERMISSAO_KICKOFF } from '@/lib/kickoff/regras';
import { funcaoParaSetor, type FuncaoComercial } from '@/lib/comercial/funcao';

export type Sector = 'comercial' | 'executoria' | 'ambos';

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: string; // deprecado: consumidores migram p/ isAdmin/isStaff/sector nas Tasks 4–5
  isStaff: boolean;
  isAdmin: boolean;
  sector: Sector | null;
  /** Permissões funcionais do perfil do Meet (ex.: 'kickoff_impulsao.manage'). */
  capacidades?: string[];
  /** Comercial: 'sdr' agenda para um Closer; 'closer' conduz. null = sem função. */
  funcaoComercial?: FuncaoComercial | null;
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

/**
 * Gerencia os kickoffs do Impulsão: equipe do Meet com a permissão
 * 'kickoff_impulsao.manage' no perfil. O admin global do Meet também pode
 * (é ele quem concede e revoga a permissão).
 */
export function podeGerenciarKickoff(u: Pick<CurrentUser, 'isStaff' | 'isAdmin' | 'capacidades'> | null): boolean {
  if (!u || !u.isStaff) return false;
  return u.isAdmin || (u.capacidades ?? []).includes(PERMISSAO_KICKOFF);
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
    // select('*'): a coluna capacidades só existe depois da migration do
    // kickoff; pedir a coluna pelo nome antes disso derrubaria o perfil inteiro.
    const { data: profile } = await admin
      .from('meet_user_profile')
      .select('*')
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
      capacidades: lerCapacidades(profile),
      funcaoComercial: funcaoParaSetor(profile?.funcao_comercial, profile?.sector),
    };
  } catch {
    return null;
  }
}
