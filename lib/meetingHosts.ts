/**
 * Anfitriões adicionais programados na reunião (tabela meet_meeting_hosts).
 * Caso real: o SDR agenda a "Sessão Estratégica" e o Closer conduz — marcado
 * aqui, o Closer vê a reunião na própria Agenda, recebe o convite do Google
 * Agenda e vê a gravação/transcrição. Na sala ele já entra como anfitrião por
 * estar logado (todo colaborador logado é anfitrião).
 */
import { chunkArray } from './chunk';
import { createAdminSupabase } from './supabase/admin';

/** Embed do PostgREST com os anfitriões adicionais (nome de cada um). */
export const CO_HOSTS_SELECT = 'meet_meeting_hosts(user_id, users(name))';

export function parseCoHosts(raw: unknown): { id: string; name: string }[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((h: any) => {
      const u = Array.isArray(h?.users) ? h.users[0] : h?.users;
      return { id: String(h?.user_id ?? ''), name: String(u?.name ?? '').trim() };
    })
    .filter((h) => h.id);
}

export const MAX_CO_HOSTS = 10;

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  sector: string | null;
}

// Mesmos domínios que contam como equipe no login (lib/auth.ts).
const STAFF_EMAIL_FILTER = [
  'legacyeducacaocorp.com.br',
  'legacyeducacao.com.br',
  'leagacyeducacaocorp.com.br',
  'leagacyeducacao.com.br',
]
  .map((d) => `email.ilike.%@${d}`)
  .join(',');

export async function listTeamMembers(): Promise<TeamMember[]> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from('users')
    .select('id, name, email, meet_user_profile(sector)')
    .or(STAFF_EMAIL_FILTER)
    .order('name');
  return ((data ?? []) as any[])
    .filter((u) => (u.name ?? '').trim())
    .map((u) => {
      const p = Array.isArray(u.meet_user_profile) ? u.meet_user_profile[0] : u.meet_user_profile;
      return {
        id: u.id as string,
        name: (u.name as string).trim(),
        email: (u.email as string) ?? '',
        sector: (p?.sector as string | undefined) ?? null,
      };
    });
}

/**
 * Lista de anfitriões adicionais vinda do formulário: só ids de colaboradores
 * conhecidos, sem repetição, sem o próprio criador (já é o anfitrião) e com
 * teto — o corpo da requisição não é confiável.
 */
export function normalizeCoHostIds(raw: unknown, allowed: Set<string>, creatorId: string): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || v === creatorId || !allowed.has(v) || out.includes(v)) continue;
    out.push(v);
    if (out.length >= MAX_CO_HOSTS) break;
  }
  return out;
}

/** Quem entra e quem sai ao trocar a lista de anfitriões de uma reunião. */
export function diffCoHosts(current: string[], next: string[]): { added: string[]; removed: string[] } {
  return {
    added: next.filter((id) => !current.includes(id)),
    removed: current.filter((id) => !next.includes(id)),
  };
}

/** Reuniões em que o usuário foi marcado como anfitrião adicional. */
export async function coHostedMeetingIds(userId: string): Promise<string[]> {
  const admin = createAdminSupabase();
  const { data } = await admin.from('meet_meeting_hosts').select('meeting_id').eq('user_id', userId);
  return ((data ?? []) as { meeting_id: string }[]).map((r) => r.meeting_id);
}

/**
 * Reuniões de um usuário: as que ele criou + as em que é anfitrião adicional.
 * `build` devolve uma consulta NOVA a cada chamada (com filtros/ordem); os ids
 * vão em lotes de 100 — .in() com centenas de ids estoura a URL do PostgREST.
 */
export async function ownAndCoHosted(
  build: () => any,
  userId: string,
): Promise<{ data: any[]; error: { message: string } | null }> {
  const coIds = await coHostedMeetingIds(userId);
  const results = await Promise.all([
    build().eq('host_id', userId),
    ...chunkArray(coIds, 100).map((batch) => build().in('id', batch)),
  ]);
  const error = results.find((r: any) => r.error)?.error ?? null;
  const byId = new Map<string, any>();
  for (const r of results) for (const m of (r.data ?? []) as any[]) byId.set(m.id, m);
  return { data: [...byId.values()], error };
}

/** O usuário é dono ou anfitrião adicional desta reunião? */
export async function isMeetingHost(
  meeting: { id: string; host_id: string | null },
  userId: string,
): Promise<boolean> {
  if (meeting.host_id === userId) return true;
  const admin = createAdminSupabase();
  const { data } = await admin
    .from('meet_meeting_hosts')
    .select('user_id')
    .eq('meeting_id', meeting.id)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}
