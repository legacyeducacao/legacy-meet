'use client';

import * as React from 'react';
import { Loader2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { toast } from '@/components/ui/custom-toast';
import { cn } from '@/lib/utils';
import { ROTULO_DO_ACESSO, podeGerarAcesso, type EstadoDoAcesso } from '@/lib/kickoff/zoomAcessoRegras';
import { textoErro, type ReservaTela, type ZoomDoPainel } from './tipos';

const COR: Record<EstadoDoAcesso, string> = {
  pronto: 'text-emerald-700 dark:text-emerald-300',
  preparando: 'text-sky-700 dark:text-sky-300',
  pendente: 'text-amber-700 dark:text-amber-300',
  sem_sala: 'text-amber-700 dark:text-amber-300',
  conflito: 'text-destructive',
  erro: 'text-destructive',
  inativo: 'text-muted-foreground',
};

/** O acesso desta reserva aparece no painel? Só reserva ativa, com a estrutura da E2. */
const visivel = (r: ReservaTela, zoom: ZoomDoPainel | null | undefined) => !!zoom && zoom.estrutura === 'ok' && r.status === 'ativa' && !!r.acesso;

/** Estado do acesso Zoom da reserva (célula "Estado"). Nunca mostra o link individual do Zoom. */
export function EstadoDoAcessoZoom({ reserva: r, zoom }: { reserva: ReservaTela; zoom: ZoomDoPainel | null | undefined }) {
  if (!visivel(r, zoom) || !r.acesso) return null;
  const a = r.acesso;
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      <div className={cn('flex items-center gap-1', COR[a.estado])}>
        <Video className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {ROTULO_DO_ACESSO[a.estado]}
      </div>
      {a.erro && <div className="text-muted-foreground">{a.erro}</div>}
      {a.salaAnterior && <div className="text-muted-foreground">O acesso era da sala Zoom anterior: gere de novo para a sala atual.</div>}
      {a.estado !== 'pronto' && a.estado !== 'sem_sala' && a.salaComProblemas && (
        <div className="text-muted-foreground">A sala Zoom ativa está com problemas: confira o quadro Sala Zoom.</div>
      )}
      {a.nomeDifere && a.nomeNoZoom && (
        <div className="text-muted-foreground">No Zoom o nome continua “{a.nomeNoZoom}” (o Zoom não altera uma inscrição).</div>
      )}
      {a.estado === 'pronto' && !a.endereco && <div className="text-muted-foreground">Sem endereço para enviar: gere o acesso para criar o convite da empresa.</div>}
    </div>
  );
}

/** Copiar o endereço da Legacy e gerar/recuperar o acesso (célula das ações). */
export function AcoesDoAcessoZoom({ reserva: r, zoom, recarregar }: { reserva: ReservaTela; zoom: ZoomDoPainel | null | undefined; recarregar: () => void }) {
  const [enviando, setEnviando] = React.useState(false);
  if (!visivel(r, zoom) || !r.acesso || !zoom) return null;
  const a = r.acesso;
  // Gerar fala com o Zoom: só com a integração configurada e uma sala ativa.
  const podeGerar = podeGerarAcesso(a) && zoom.integracao.configurada && !!zoom.sala;

  const gerar = async () => {
    setEnviando(true);
    const res = await fetch(`/api/agenda/kickoffs/reservas/${r.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'gerarAcesso' }),
    });
    setEnviando(false);
    if (!res.ok) return toast.error('Não foi possível gerar o acesso', { description: await textoErro(res) });
    const j = (await res.json().catch(() => null)) as { acesso?: { estado: string; mensagem: string; avisoDoEndereco: string | null } } | null;
    const g = j?.acesso;
    if (g?.estado === 'pronto') toast.success(`${r.empresa.nome}: acesso Zoom pronto`, { description: g.avisoDoEndereco ?? 'Copie o endereço da reunião e envie à empresa.' });
    else toast.error(`${r.empresa.nome}: acesso Zoom não gerado`, { description: g?.mensagem ?? 'Tente de novo.' });
    recarregar();
  };

  return (
    <>
      {a.endereco && (
        <CopyButton value={a.endereco} label="Endereço da reunião" size="sm" variant="ghost" aria-label={`Copiar o endereço da reunião de ${r.empresa.nome}`} />
      )}
      {podeGerar && (
        <Button size="sm" variant="ghost" disabled={enviando} onClick={() => void gerar()}>
          {enviando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Video className="mr-1 h-4 w-4" />}
          {a.estado === 'pendente' || a.estado === 'pronto' ? 'Gerar acesso Zoom' : 'Tentar de novo o acesso'}
        </Button>
      )}
    </>
  );
}
