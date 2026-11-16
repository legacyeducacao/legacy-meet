'use client';

import * as React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/custom-toast';
import type { ResumoDaSincronizacao } from '@/lib/kickoff/zoomPresencaServidor';
import { textoErro } from './tipos';

const ROTULO: Record<ResumoDaSincronizacao['empresas'][number]['resultado'], string> = {
  registrada: 'Presença registrada agora',
  ja_registrada: 'Presença já registrada',
  preservada: 'Mantida (correção manual)',
  revisar: 'Conferir',
};

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * "Sincronizar presença do Zoom" (Zoom E3), no cartão da sessão. Registra só
 * "presente" com evidência confiável; nunca ausência, nunca conclusão. O resumo
 * fica no cartão até recarregar a página.
 */
export function PresencaZoomSessao({ sessaoId, recarregar }: { sessaoId: string; recarregar: () => void }) {
  const [enviando, setEnviando] = React.useState(false);
  const [resumo, setResumo] = React.useState<ResumoDaSincronizacao | null>(null);

  const sincronizar = async () => {
    setEnviando(true);
    const res = await fetch(`/api/agenda/kickoffs/sessoes/${sessaoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'sincronizarPresenca' }),
    }).catch(() => null);
    setEnviando(false);
    if (!res) return toast.error('Não foi possível sincronizar', { description: 'Sem conexão com o servidor.' });
    if (!res.ok) return toast.error('Não foi possível sincronizar', { description: await textoErro(res) });
    const r = ((await res.json()) as { resumo: ResumoDaSincronizacao }).resumo;
    setResumo(r);
    const novas = r.empresas.filter((e) => e.resultado === 'registrada').length;
    toast.success(novas ? `${novas} presença(s) registrada(s) pelo Zoom` : 'Sincronizado: nenhuma presença nova');
    recarregar();
  };

  return (
    <div className="space-y-2 border-b px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" disabled={enviando} onClick={() => void sincronizar()}>
          {enviando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
          Sincronizar presença do Zoom
        </Button>
        <span className="text-xs text-muted-foreground">
          Lê o relatório do Zoom e marca “Compareceu” para quem entrou pelo acesso da empresa. Não marca ausência nem conclui o kickoff.
        </span>
      </div>

      {resumo && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          {resumo.incompleta && (
            <p className="text-amber-800 dark:text-amber-200">
              O relatório do Zoom ainda pode mudar (sessão em andamento ou relatório ainda não gerado). Sincronize de novo depois do fim.
            </p>
          )}
          <p className="text-muted-foreground">
            {resumo.execucoes.length === 0
              ? 'Nenhuma execução da sala Zoom encontrada no horário desta sessão.'
              : `Execução(ões) do Zoom no horário: ${resumo.execucoes
                  .map((e) => `${hora(e.inicio)}–${e.fim ? hora(e.fim) : '…'}${e.relatorio === 'indisponivel' ? ' (relatório indisponível)' : ''}${e.compartilhada ? ' (cruza outra sessão)' : ''}`)
                  .join(', ')}.`}
          </p>
          {resumo.empresas.length > 0 && (
            <ul className="space-y-1">
              {resumo.empresas.map((e) => (
                <li key={e.reservaId}>
                  <span className="font-medium">{e.empresa}</span>: {ROTULO[e.resultado]}
                  <span className="text-muted-foreground">
                    {' '}
                    · {e.entradas} entrada(s), cerca de {e.duracaoMin} min{e.evidencia === 'email' ? ' · reconhecida pelo e-mail' : ''}
                  </span>
                  {e.detalhe && <div className="text-xs text-amber-800 dark:text-amber-200">{e.detalhe}</div>}
                </li>
              ))}
            </ul>
          )}
          {resumo.pendentes.length > 0 && (
            <p>
              <span className="font-medium">Sem participação identificada:</span> {resumo.pendentes.join(', ')}. Continuam sem registro; se a empresa
              participou, marque “Compareceu”.
            </p>
          )}
          {resumo.foraDaSessao.length > 0 && (
            <p>
              <span className="font-medium">Entraram, mas a reserva não é desta sessão:</span> {resumo.foraDaSessao.join(', ')}. Nada foi registrado.
            </p>
          )}
          {resumo.naoIdentificados.length > 0 && (
            <p>
              <span className="font-medium">Não identificados no Zoom:</span>{' '}
              {resumo.naoIdentificados.map((n) => (n.sugestao ? `${n.nome} (parece ser ${n.sugestao})` : n.nome)).join(', ')}. Confira e registre à mão
              se for o caso.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
