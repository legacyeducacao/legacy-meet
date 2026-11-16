import { NextRequest } from 'next/server';
import { agendarPeloConvite } from '@/lib/kickoff/convites';
import { FALHA_PUBLICA, origemOuFalha, respostaPublica } from '@/lib/kickoff/respostaPublica';
import { acessoDoConvite } from '@/lib/kickoff/zoomAcesso';

export const dynamic = 'force-dynamic';

/**
 * PÚBLICA (sem login): agenda o kickoff da empresa do convite.
 * Corpo: { sessaoId, nome, email, telefone }. Qualquer empresa ou tenant no corpo
 * é ignorado: a empresa sai do convite, no banco.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  const o = origemOuFalha(req.headers);
  if ('falha' in o) return o.falha;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const r = await agendarPeloConvite(codigo, o.origem, {
    sessaoId: b.sessaoId,
    nome: b.nome,
    email: b.email,
    telefone: b.telefone,
  });
  if (!r) return respostaPublica(FALHA_PUBLICA, 503);
  // A reserva já está gravada. Agora o servidor tenta garantir a inscrição no Zoom;
  // se falhar ou demorar, a reserva continua valendo e o acesso fica "preparando"
  // (a página tenta de novo, e a equipe pode recuperar pelo painel).
  if ((r.status === 'ok' || r.status === 'ja_inscrita') && r.reserva) {
    const a = await acessoDoConvite(codigo, o.origem, { tentar: r.status === 'ok' });
    if (a?.status === 'ok') return respostaPublica({ ...r, acesso: a.acesso });
  }
  return respostaPublica(r);
}
