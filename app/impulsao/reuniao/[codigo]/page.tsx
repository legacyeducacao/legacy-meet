import type { Metadata } from 'next';
import { EntradaNaReuniao } from '@/components/impulsao/EntradaNaReuniao';

export const dynamic = 'force-dynamic';

/** Endereço individual: não aparece em buscador nem passa o endereço adiante (nem ao Zoom). */
export const metadata: Metadata = {
  title: 'Entrar na reunião · Legacy Executoria',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const RETORNOS = ['expirou', 'pendente', 'recusa', 'falha'];

/**
 * PÚBLICA (sem login): /impulsao/reuniao/<código do convite>, a página de entrada da
 * reunião do kickoff.
 *
 * Abrir esta página (GET) não consulta o banco no servidor, não chama o Zoom, não
 * cria inscrição e não encaminha a lugar nenhum: o HTML não traz dado nenhum da
 * empresa nem link de reunião. No navegador, a página lê a reserva pela mesma rota
 * pública do agendamento e mostra o botão "Entrar na reunião" só no horário da sessão.
 * A entrada é a operação POST de ./entrar/route.ts.
 */
export default async function Page(ctx: { params: Promise<{ codigo: string }>; searchParams: Promise<{ retorno?: string | string[] }> }) {
  const { codigo } = await ctx.params;
  const { retorno } = await ctx.searchParams;
  return <EntradaNaReuniao key={codigo} codigo={codigo} retorno={typeof retorno === 'string' && RETORNOS.includes(retorno) ? retorno : null} />;
}
