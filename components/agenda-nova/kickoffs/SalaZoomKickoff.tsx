'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search, Video, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/custom-toast';
import type { EstadoDaSalaZoom, SalaTela, Verificacao } from '@/lib/kickoff/zoomSalaServidor';
import type { ResumoDaSala } from '@/lib/kickoff/zoomSala';
import { textoErro } from './tipos';

const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : '—';
const idLegivel = (id: string) => id.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1 $2 $3');

const RECORRENCIA: Record<number, string> = { 1: 'diária', 2: 'semanal', 3: 'mensal' };
const ACAO: Record<string, string> = { ativada: 'Ativada', reativada: 'Reativada', desativada: 'Desativada', verificada: 'Verificada' };

function Resumo({ r }: { r: Partial<ResumoDaSala> }) {
  const sim = (v: boolean | null | undefined) => (v === true ? 'sim' : v === false ? 'não' : '—');
  const itens: Array<[string, string]> = [
    ['Recorrência', r.recorrencia?.tipo ? `${RECORRENCIA[r.recorrencia.tipo] ?? 'outra'}, horário fixo` : '—'],
    ['Inscrição', r.aprovacao === 0 ? 'obrigatória, aprovação automática' : r.aprovacao === 1 ? 'aprovação manual' : 'desligada'],
    ['Inscrever-se', r.inscricao === 1 || (r.inscricao == null && r.tipo === 8) ? 'uma vez, vale para todas as ocorrências' : 'por ocorrência'],
    ['Ocorrências futuras', r.ocorrenciasFuturas != null ? String(r.ocorrenciasFuturas) : '—'],
    ['Próxima / última', `${dataHora(r.proxima)} / ${dataHora(r.ultima)}`],
    ['Fuso e duração', `${r.fuso ?? '—'}${r.duracaoMin ? `, ${r.duracaoMin} min` : ''}`],
    ['Sala de espera / login exigido', `${sim(r.salaDeEspera)} / ${sim(r.autenticacao)}`],
  ];
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[14rem_1fr]">
      {itens.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function Apontamentos({ itens, tipo }: { itens: Array<{ codigo: string; titulo: string; orientacao: string }>; tipo: 'problema' | 'aviso' }) {
  if (!itens.length) return null;
  const Icone = tipo === 'problema' ? XCircle : AlertTriangle;
  return (
    <ul className="space-y-2">
      {itens.map((p) => (
        <li key={p.codigo} className="flex gap-2 text-sm">
          <Icone className={tipo === 'problema' ? 'mt-0.5 h-4 w-4 shrink-0 text-destructive' : 'mt-0.5 h-4 w-4 shrink-0 text-amber-600'} />
          <span>
            <strong className="font-medium">{p.titulo}</strong> <span className="text-muted-foreground">{p.orientacao}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

async function postar<T>(corpo: Record<string, unknown>): Promise<T | null> {
  const res = await fetch('/api/agenda/kickoffs/zoom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!res.ok) {
    toast.error('Não foi possível concluir', { description: await textoErro(res) });
    return null;
  }
  return (await res.json()) as T;
}

/**
 * Sala Zoom dos kickoffs (Zoom E1): uma reunião recorrente do Zoom, exclusiva do
 * Impulsão, para todas as sessões. Aqui só se lê o Zoom; nada é criado nele.
 */
export function SalaZoomKickoff() {
  const [estado, setEstado] = React.useState<EstadoDaSalaZoom | null>(null);
  const [erro, setErro] = React.useState('');
  const [entrada, setEntrada] = React.useState('');
  const [verificacao, setVerificacao] = React.useState<Verificacao | null>(null);
  const [ocupado, setOcupado] = React.useState<'' | 'verificar' | 'ativar' | 'verificar_ativa'>('');
  const [troca, setTroca] = React.useState(false);
  const [motivo, setMotivo] = React.useState('');

  const carregar = React.useCallback(() => {
    fetch('/api/agenda/kickoffs/zoom')
      .then(async (r) => (r.ok ? ((await r.json()) as EstadoDaSalaZoom) : Promise.reject(new Error(await textoErro(r)))))
      .then((e) => {
        setEstado(e);
        setErro('');
      })
      .catch((e) => setErro(e instanceof Error && e.message ? e.message : 'Não foi possível carregar a sala Zoom'));
  }, []);
  React.useEffect(carregar, [carregar]);

  const verificar = async () => {
    setOcupado('verificar');
    setVerificacao(null);
    const r = await postar<{ verificacao: Verificacao }>({ acao: 'verificar', entrada });
    setOcupado('');
    if (r) setVerificacao(r.verificacao);
  };

  const ativa = estado?.ativa ?? null;
  const v = verificacao?.status === 'verificada' ? verificacao : null;
  const ehATual = !!(v && ativa && v.meetingId === ativa.meetingId);
  const precisaMotivo = !!(v && ativa && !ehATual);

  const ativar = async () => {
    setOcupado('ativar');
    const r = await postar<{ acao: string; anterior: string | null }>({ acao: 'ativar', entrada, motivo: precisaMotivo ? motivo : null });
    setOcupado('');
    if (!r) return;
    toast.success(r.anterior ? 'Sala trocada' : r.acao === 'verificada' ? 'Verificação registrada' : 'Sala ativada', {
      description: r.anterior ? `A sala ${idLegivel(r.anterior)} foi desativada e fica no histórico.` : undefined,
    });
    setTroca(false);
    setMotivo('');
    setEntrada('');
    setVerificacao(null);
    carregar();
  };

  const verificarAtiva = async () => {
    setOcupado('verificar_ativa');
    const r = await postar<{ verificacao: Verificacao }>({ acao: 'verificar_ativa' });
    setOcupado('');
    if (!r) return;
    const ok = r.verificacao.status === 'verificada' && r.verificacao.ok;
    if (ok) toast.success('Sala conferida no Zoom', { description: 'A configuração continua adequada.' });
    else toast.error('A sala ativa tem problemas', { description: 'Veja os detalhes no quadro da sala.' });
    carregar();
  };

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <Video className="h-4 w-4" /> Sala Zoom
        </h2>
        <p className="text-sm text-muted-foreground">
          Uma reunião recorrente do Zoom, exclusiva do Impulsão, serve todas as sessões de kickoff. O Meet só consulta a reunião: nada é criado nem
          alterado no Zoom. Os links individuais das empresas entram na etapa seguinte.
        </p>
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {!estado && !erro && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Carregando" />}

      {estado && (
        <>
          {!estado.integracao.configurada && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              Integração Zoom não configurada no servidor. Falta: {estado.integracao.faltando.join(', ')}. Até lá, não dá para verificar nem ativar
              salas.
            </p>
          )}
          {estado.estrutura === 'pendente' && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              A sala Zoom depende da migration 006 (ainda não aplicada). Dá para verificar uma reunião, mas não para ativá-la.
            </p>
          )}

          <QuadroDaSala sala={ativa} verificando={ocupado === 'verificar_ativa'} podeVerificar={estado.integracao.configurada} verificar={verificarAtiva} />

          <div className="space-y-2">
            <Label htmlFor="zoom-entrada">{ativa ? 'Trocar ou conferir uma sala' : 'Configurar a sala'}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="zoom-entrada"
                placeholder="Meeting ID (ex.: 812 3456 7890) ou link de entrada /j/..."
                value={entrada}
                onChange={(e) => {
                  setEntrada(e.target.value);
                  setVerificacao(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && entrada.trim() && estado.integracao.configurada && verificar()}
                className="sm:max-w-md"
              />
              <Button onClick={verificar} disabled={!entrada.trim() || !estado.integracao.configurada || !!ocupado}>
                {ocupado === 'verificar' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />} Verificar no Zoom
              </Button>
            </div>
          </div>

          {verificacao && verificacao.status !== 'verificada' && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {verificacao.status === 'nao_configurada' ? `Integração Zoom não configurada: falta ${verificacao.faltando.join(', ')}.` : verificacao.mensagem}
            </p>
          )}

          {v && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                {v.ok ? <Badge className="bg-emerald-600 hover:bg-emerald-600">Configuração aprovada</Badge> : <Badge variant="destructive">Configuração incompatível</Badge>}
                <span className="text-sm font-medium">{v.topico ?? 'Reunião sem título'}</span>
                <span className="text-sm tabular-nums text-muted-foreground">ID {idLegivel(v.meetingId)}</span>
              </div>
              <Apontamentos itens={v.problemas} tipo="problema" />
              <Apontamentos itens={v.avisos} tipo="aviso" />
              <Resumo r={v.resumo} />
              {v.ok && estado.estrutura === 'ok' && (
                <div className="flex justify-end">
                  <Button onClick={() => (precisaMotivo ? setTroca(true) : ativar())} disabled={!!ocupado}>
                    {ocupado === 'ativar' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    {ehATual ? 'Registrar esta verificação' : ativa ? 'Trocar para esta sala' : 'Ativar esta sala'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {(estado.anteriores.length > 0 || estado.historico.length > 0) && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Histórico da sala</summary>
              <ul className="mt-2 space-y-1">
                {estado.historico.map((h) => (
                  <li key={h.id} className="text-muted-foreground">
                    <span className="tabular-nums">{dataHora(h.em)}</span> · {ACAO[h.acao] ?? h.acao}
                    {h.meetingId && <> · ID {idLegivel(h.meetingId)}</>}
                    {h.acao === 'verificada' && h.ok === false && <> · com problemas{h.problemas.length ? `: ${h.problemas.join(' ')}` : ''}</>}
                    {h.motivo && <> · motivo: {h.motivo}</>}
                    {h.usuario && <> · {h.usuario}</>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <Dialog open={troca} onOpenChange={(o) => !o && setTroca(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trocar a sala Zoom</DialogTitle>
            <DialogDescription>
              A sala {ativa ? idLegivel(ativa.meetingId) : ''} deixa de ser usada e fica no histórico. As próximas sessões passam a usar a sala{' '}
              {v ? idLegivel(v.meetingId) : ''}. Quando os links individuais existirem (etapa seguinte), as empresas já inscritas precisarão de um novo
              link.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="zoom-motivo">Motivo da troca</Label>
            <Textarea id="zoom-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} placeholder="Ex.: sala anterior chegou à última ocorrência" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTroca(false)}>
              Voltar
            </Button>
            <Button onClick={ativar} disabled={!motivo.trim() || !!ocupado}>
              {ocupado === 'ativar' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Trocar sala
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function QuadroDaSala({ sala, verificando, podeVerificar, verificar }: { sala: SalaTela | null; verificando: boolean; podeVerificar: boolean; verificar: () => void }) {
  if (!sala) return <p className="text-sm text-muted-foreground">Nenhuma sala ativa. Sem ela, os kickoffs ainda não têm videoconferência.</p>;
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Sala ativa</Badge>
          <span className="text-sm font-medium">{sala.topico ?? 'Reunião sem título'}</span>
          <span className="text-sm tabular-nums text-muted-foreground">ID {idLegivel(sala.meetingId)}</span>
        </div>
        <Button size="sm" variant="outline" onClick={verificar} disabled={!podeVerificar || verificando}>
          {verificando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Verificar de novo
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-sm">
        {sala.verificacao.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-destructive" />}
        {sala.verificacao.ok ? 'Configuração aprovada' : 'Configuração com problemas'} na última verificação ({dataHora(sala.verificacao.em)}). Ativa desde{' '}
        {dataHora(sala.ativadaEm)}.
      </p>
      <Apontamentos itens={sala.verificacao.problemas} tipo="problema" />
      <Resumo r={sala.verificacao.resumo} />
    </div>
  );
}
