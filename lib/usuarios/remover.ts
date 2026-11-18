/**
 * Remoção de usuário da equipe (quem saiu da empresa), feita pelo admin do Meet.
 *
 * O login é o mesmo em todos os projetos (Meet, Plan, ExecScore, LegacyFin):
 * apagar a linha de auth.users apagaria em cascata public.users, deixaria as
 * reuniões antigas sem dono e apagaria as notas de NPS sobre a pessoa. Por
 * decisão do usuário (18/11/2026), a remoção apaga o ACESSO e mantém o nome:
 * - e-mail trocado por um endereço que não existe (o e-mail real fica livre);
 * - senha trocada por uma aleatória e login bloqueado em todos os projetos;
 * - telefone, CPF/CNPJ e foto apagados; perfil do Meet apagado;
 * - sai dos anfitriões das reuniões futuras;
 * - nome e código continuam em public.users para reuniões, gravações e NPS.
 * Fica registrado em meet_usuarios_removidos (quem removeu e quando).
 */
import { randomBytes } from 'node:crypto';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const DOMINIO_REMOVIDO = 'usuarios-removidos.invalid';
export const emailDeRemovido = (id: string) => `removido-${id}@${DOMINIO_REMOVIDO}`;

/** Mesmos domínios que contam como equipe no login (lib/auth.ts). */
export const ehEmailDaEquipe = (email: string | null | undefined) =>
  /@lea?gacyeducacao(corp)?\.com\.br$/i.test((email ?? '').trim());

/** Login bloqueado por ~100 anos (o Supabase não tem "para sempre"). */
const BLOQUEIO = '876000h';

export type ResultadoRemocao =
  | { ok: true; nome: string | null }
  | { ok: false; status: number; message: string };

export async function removerUsuario(alvoId: string, adminId: string): Promise<ResultadoRemocao> {
  if (!alvoId) return { ok: false, status: 400, message: 'Usuário não informado' };
  if (alvoId === adminId) return { ok: false, status: 400, message: 'Você não pode remover o próprio acesso' };
  const admin = createAdminSupabase();

  const { data: u, error: eu } = await admin.from('users').select('id, name, email').eq('id', alvoId).maybeSingle();
  if (eu) return { ok: false, status: 500, message: 'Falha ao ler o usuário: ' + eu.message };
  if (!u) return { ok: false, status: 404, message: 'Usuário não encontrado' };
  const nome = (u.name as string | null)?.trim() || null;
  const emailAntigo = String(u.email ?? '');
  // Só a equipe Legacy: clientes do Plan não se removem por aqui.
  if (!ehEmailDaEquipe(emailAntigo)) return { ok: false, status: 400, message: 'Só usuários da equipe Legacy podem ser removidos aqui' };

  // Reunião futura sem dono ficaria órfã na agenda: passar ou cancelar antes.
  const { count, error: ec } = await admin
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('host_id', alvoId)
    .eq('status', 'scheduled')
    .gte('scheduled_start_at', new Date().toISOString());
  if (ec) return { ok: false, status: 500, message: 'Falha ao conferir as reuniões: ' + ec.message };
  if (count) {
    const qtd = count === 1 ? '1 reunião futura' : `${count} reuniões futuras`;
    return { ok: false, status: 409, message: `${nome ?? 'Este usuário'} ainda tem ${qtd} na agenda. Passe para outra pessoa ou cancele antes de remover.` };
  }

  const { error: er } = await admin
    .from('meet_usuarios_removidos')
    .upsert({ user_id: alvoId, nome, email_antigo: emailAntigo, removido_por: adminId || null, removido_em: new Date().toISOString() });
  if (er) return { ok: false, status: 500, message: 'Falha ao registrar a remoção: ' + er.message };

  // Login: some o e-mail, troca a senha e bloqueia (vale para todos os projetos).
  const { error: ea } = await admin.auth.admin.updateUserById(alvoId, {
    email: emailDeRemovido(alvoId),
    email_confirm: true,
    password: randomBytes(36).toString('base64url'),
    ban_duration: BLOQUEIO,
  });
  if (ea && !/not.?found/i.test(ea.message)) return { ok: false, status: 500, message: 'Falha ao apagar o login: ' + ea.message };

  const { error: ep } = await admin
    .from('users')
    .update({ email: emailDeRemovido(alvoId), phone: null, cpf_cnpj: null, avatar_url: null, updated_at: new Date().toISOString() })
    .eq('id', alvoId);
  if (ep) return { ok: false, status: 500, message: 'Login bloqueado, mas falhou ao limpar o cadastro: ' + ep.message };

  await admin.from('meet_user_profile').delete().eq('user_id', alvoId);

  // Sai dos anfitriões das reuniões que ainda vão acontecer (o histórico fica).
  const { data: futuras } = await admin
    .from('meetings')
    .select('id, meet_meeting_hosts!inner(user_id)')
    .eq('meet_meeting_hosts.user_id', alvoId)
    .eq('status', 'scheduled')
    .gte('scheduled_start_at', new Date().toISOString());
  const ids = ((futuras ?? []) as Array<{ id: string }>).map((m) => m.id);
  if (ids.length) await admin.from('meet_meeting_hosts').delete().eq('user_id', alvoId).in('meeting_id', ids);

  return { ok: true, nome };
}
