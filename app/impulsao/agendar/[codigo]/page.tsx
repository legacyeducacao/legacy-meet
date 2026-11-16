import type { Metadata } from 'next';
import { AgendamentoPublico } from '@/components/impulsao/AgendamentoPublico';

export const dynamic = 'force-dynamic';

/** Link individual: não aparece em buscador nem passa o endereço adiante. */
export const metadata: Metadata = {
  title: 'Agendar kickoff · Legacy Executoria',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * PÚBLICA (sem login): /impulsao/agendar/<código do convite>. A empresa vem do
 * convite, no servidor; esta página só repassa o código para /api/impulsao.
 */
export default async function Page(ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  // `key`: trocar de link não herda escolha nem dados digitados do anterior.
  return <AgendamentoPublico key={codigo} codigo={codigo} />;
}
