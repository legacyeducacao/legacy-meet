import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { CAPACIDADE_PADRAO, DURACAO_PADRAO_MIN, organizadorDoKickoff } from '@/lib/kickoff/regras';
import { estruturaDoKickoff, listarSessoesKickoff } from '@/lib/kickoff/servidor';
import { estruturaDasReservas, listarReservas } from '@/lib/kickoff/reservas';
import { gestorDeKickoff } from '@/lib/kickoff/rota';
import { estruturaDosConvites } from '@/lib/kickoff/convites';
import { acessosDoPainel } from '@/lib/kickoff/zoomAcesso';

export const dynamic = 'force-dynamic';

/**
 * Seção "Kickoffs Impulsão": configuração do tipo de evento, sessões na agenda e
 * as reservas de cada uma (empresa, participante principal, estado). Só quem
 * gerencia kickoffs.
 */
export async function GET() {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;

  const organizadorId = organizadorDoKickoff();
  let organizadorNome: string | null = null;
  if (organizadorId) {
    const { data } = await createAdminSupabase().from('client_tenants').select('name').eq('id', organizadorId).maybeSingle();
    organizadorNome = (data?.name as string | undefined)?.trim() || null;
  }

  const estrutura = await estruturaDoKickoff();
  const agora = Date.now();
  const sessoes =
    (estrutura === 'ok' ? await listarSessoesKickoff(new Date(agora - 30 * 86_400_000), new Date(agora + 120 * 86_400_000)) : null) ?? [];
  const estruturaReservas = estrutura === 'ok' ? await estruturaDasReservas() : 'pendente';
  const reservas = estruturaReservas === 'ok' ? ((await listarReservas(sessoes.map((s) => s.id))) ?? []) : [];
  const estruturaConvites = estruturaReservas === 'ok' ? await estruturaDosConvites() : 'pendente';
  // Acesso Zoom das reservas ativas: só o banco (abrir o painel nunca chama o Zoom)
  // e nunca o link individual, só o estado e o endereço da Legacy.
  const zoom =
    estruturaReservas === 'ok'
      ? await acessosDoPainel(reservas.map((r) => ({ id: r.id, tenantId: r.empresa.id, status: r.status })))
      : null;

  return NextResponse.json({
    estrutura,
    estruturaReservas,
    estruturaConvites,
    zoom: zoom ? { estrutura: zoom.estrutura, integracao: zoom.integracao, sala: zoom.sala } : null,
    configuracao: {
      organizador: { configurado: !!organizadorId, encontrado: !!organizadorNome, nome: organizadorNome },
      capacidadePadrao: CAPACIDADE_PADRAO,
      duracaoPadraoMin: DURACAO_PADRAO_MIN,
      googleAgenda: false,
      salaDoMeet: false,
    },
    sessoes: sessoes.map((s) => {
      const daSessao = reservas.filter((r) => r.sessaoId === s.id).map((r) => ({ ...r, acesso: zoom?.acessos[r.id] ?? null }));
      // Vagas ocupadas: tudo que não foi cancelado (como no banco).
      return { ...s, ocupadas: daSessao.filter((r) => r.status !== 'cancelada').length, reservas: daSessao };
    }),
  });
}
