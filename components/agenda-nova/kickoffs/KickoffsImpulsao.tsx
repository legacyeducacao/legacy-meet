'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarPlus, CheckCircle2, CircleSlash, History, Loader2, MoveRight, Pencil, Plus, Undo2, UserCheck, UserX, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/custom-toast';
import { cn } from '@/lib/utils';
import { acoesDaReserva, pendenciasDaSessao, ROTULO_SITUACAO, rotuloReserva, situacaoDaSessao, type SituacaoSessao } from '@/lib/kickoff/reservasRegras';
import { ReservasDialogos, type AcaoKickoff } from './ReservasDialogos';
import { ConvitesKickoff } from './ConvitesKickoff';
import { SalaZoomKickoff } from './SalaZoomKickoff';
import { AcoesDoAcessoZoom, EstadoDoAcessoZoom } from './AcessoZoomReserva';
import { quando, textoErro, type RespostaKickoffs, type SessaoTela, type ZoomDoPainel } from './tipos';

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="w-56 shrink-0 text-sm text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

const COR_SITUACAO: Record<SituacaoSessao, string> = {
  aberta: 'border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-200',
  lotada: 'border-amber-300 text-amber-900 dark:border-amber-800 dark:text-amber-100',
  bloqueada: 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200',
  em_andamento: 'border-sky-300 text-sky-800 dark:border-sky-800 dark:text-sky-200',
  encerrada: '',
  cancelada: '',
};

/** Seção "Kickoffs Impulsão": configuração, sessões da agenda e reservas das empresas. */
export function KickoffsImpulsao() {
  const [dados, setDados] = React.useState<RespostaKickoffs | null>(null);
  const [erro, setErro] = React.useState('');
  const [acao, setAcao] = React.useState<AcaoKickoff | null>(null);
  const [todas, setTodas] = React.useState(false);
  const [canceladas, setCanceladas] = React.useState(false);

  const carregar = React.useCallback(() => {
    fetch('/api/agenda/kickoffs')
      .then(async (r) => (r.ok ? ((await r.json()) as RespostaKickoffs) : Promise.reject(new Error(await textoErro(r)))))
      .then((d) => {
        setDados(d);
        setErro('');
      })
      .catch((e) => setErro(e instanceof Error && e.message ? e.message : 'Não foi possível carregar'));
  }, []);
  React.useEffect(carregar, [carregar]);

  // Link "Ver empresas e reservas" da agenda: rola até a sessão.
  React.useEffect(() => {
    if (!dados || typeof window === 'undefined' || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [dados]);

  const org = dados?.configuracao.organizador;
  const reservasOk = dados?.estruturaReservas === 'ok';
  // Padrão: sessões futuras e as passadas que ainda esperam o resultado das empresas.
  const visiveis = (dados?.sessoes ?? []).filter(
    (s) => todas || ['aberta', 'lotada', 'bloqueada', 'em_andamento'].includes(situacaoDaSessao(s)) || pendenciasDaSessao(s) > 0,
  );
  const pendentes = (dados?.sessoes ?? []).map((s) => ({ s, n: pendenciasDaSessao(s) })).filter((p) => p.n > 0);

  return (
    <div className="space-y-6">
      <Link href="/agenda" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar para a agenda
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Kickoffs Impulsão</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sessões coletivas de kickoff, na mesma agenda das outras reuniões, e as empresas inscritas em cada uma. Para criar uma sessão: na agenda, Criar →
          Kickoff Impulsão.
        </p>
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {!dados && !erro && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Carregando" />}

      {dados && (
        <>
          {dados.estrutura === 'pendente' && (
            <Aviso>
              Estrutura pendente: a migration do kickoff (integracoes/kickoff/001) ainda não foi aplicada no banco. Até lá, não dá para criar sessões.
            </Aviso>
          )}
          {dados.estrutura === 'ok' && !reservasOk && (
            <Aviso>
              Reservas pendentes: a migration das reservas (integracoes/kickoff/003) ainda não foi aplicada no banco. As sessões aparecem, mas ainda não
              recebem empresas.
            </Aviso>
          )}
          {pendentes.length > 0 && (
            <Aviso>
              <strong>Resultado pendente:</strong> {pendentes.reduce((t, p) => t + p.n, 0)} empresa(s) em {pendentes.length} sessão(ões) que já
              terminaram estão sem resultado registrado (compareceu, não compareceu, concluiu ou não concluiu). Nada é concluído pelo horário.
              <span className="mt-1 flex flex-wrap gap-x-3">
                {pendentes.map(({ s, n }) => (
                  <a key={s.id} href={`#sessao-${s.id}`} className="underline underline-offset-2 first-letter:uppercase">
                    {quando(s.inicio)} ({n})
                  </a>
                ))}
              </span>
            </Aviso>
          )}

          <section className="rounded-lg border p-4">
            <h2 className="mb-2 font-semibold">Configuração do tipo de evento</h2>
            <dl className="divide-y">
              <Linha rotulo="Empresa organizadora">
                {org?.configurado ? (
                  org.encontrado ? (
                    <>
                      {org.nome} <span className="text-muted-foreground">(interna; não é participante)</span>
                    </>
                  ) : (
                    <span className="text-destructive">Configurada, mas não encontrada</span>
                  )
                ) : (
                  <span className="text-destructive">Não configurada (MEET_KICKOFF_TENANT_ID)</span>
                )}
              </Linha>
              <Linha rotulo="Empresas por sessão (padrão)">{dados.configuracao.capacidadePadrao}</Linha>
              <Linha rotulo="Duração (padrão)">{dados.configuracao.duracaoPadraoMin} min</Linha>
              <Linha rotulo="Reservas">
                O kickoff acontece uma vez por empresa: uma reserva por vez e, depois de concluído, nenhuma outra. A equipe inscreve, remaneja e cancela
                aqui.
              </Linha>
              <Linha rotulo="Presença e conclusão">
                Registradas aqui, à mão: compareceu ou não; e, para quem compareceu, a conclusão do kickoff (definitiva) ou a participação não
                concluída (com motivo; a empresa pode ser reagendada). Depois de comparecer, a reserva não se cancela. Enganos de presença se
                corrigem com motivo. O horário da sessão não conclui nada sozinho.
              </Linha>
              <Linha rotulo="Videoconferência">
                Zoom: uma reunião recorrente, exclusiva do Impulsão, para todas as sessões (quadro “Sala Zoom”). A sala do Meet não é usada. Cada
                empresa com reserva ativa tem um acesso individual: ao agendar pelo convite ele é gerado sozinho; nas reservas feitas aqui, use
                “Gerar acesso Zoom”. A empresa entra pelo endereço da Legacy (/impulsao/reuniao/…): uma página com o botão “Entrar na reunião”, que
                só aparece de 30 minutos antes até 30 minutos depois da sessão dela.
              </Linha>
              <Linha rotulo="Agendamento pela empresa">
                Pelo link individual do convite (/impulsao/agendar/…), sem login. A empresa escolhe um horário com vaga; as regras são as mesmas da
                reserva feita aqui.
              </Linha>
              <Linha rotulo="Avisos às empresas">Nenhum e-mail ou WhatsApp é enviado automaticamente nesta etapa: a equipe envia o link.</Linha>
            </dl>
          </section>

          <ConvitesKickoff habilitado={dados.estruturaConvites === 'ok'} />

          <SalaZoomKickoff />

          <AvisoDoAcessoZoom dados={dados} />

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Sessões</h2>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <Switch checked={todas} onCheckedChange={setTodas} aria-label="Mostrar sessões encerradas e canceladas" />
                  Todas as encerradas e canceladas
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={canceladas} onCheckedChange={setCanceladas} aria-label="Mostrar reservas canceladas" />
                  Reservas canceladas
                </label>
                <Button asChild size="sm" variant="outline">
                  <Link href="/agenda">Abrir agenda</Link>
                </Button>
              </div>
            </div>
            {visiveis.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma sessão de kickoff {todas ? 'no período' : 'futura'}.</p>
            ) : (
              visiveis.map((s) => (
                <CartaoSessao key={s.id} sessao={s} reservasOk={reservasOk} zoom={dados.zoom} mostrarCanceladas={canceladas} abrir={setAcao} recarregar={carregar} />
              ))
            )}
          </section>

          <ReservasDialogos acao={acao} sessoes={dados.sessoes} fechar={() => setAcao(null)} feito={carregar} />
        </>
      )}
    </div>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      {children}
    </p>
  );
}

/** O que impede as reservas ativas de terem acesso Zoom agora (estrutura, credenciais, sala). */
function AvisoDoAcessoZoom({ dados }: { dados: RespostaKickoffs }) {
  const z = dados.zoom;
  if (!z) return null;
  const ativas = dados.sessoes.flatMap((s) => s.reservas).filter((r) => r.status === 'ativa');
  if (z.estrutura === 'pendente') {
    return (
      <Aviso>
        Acesso Zoom pendente: a migration das inscrições (integracoes/kickoff/007) ainda não foi aplicada no banco. As reservas funcionam, mas
        ainda não geram acesso individual.
      </Aviso>
    );
  }
  if (ativas.length === 0) return null;
  if (!z.integracao.configurada) {
    return <Aviso>Integração Zoom não configurada no servidor (falta {z.integracao.faltando.join(', ')}): as reservas não geram acesso Zoom.</Aviso>;
  }
  if (!z.sala) {
    return (
      <Aviso>
        <strong>Sem sala Zoom ativa:</strong> {ativas.length} reserva(s) ativa(s) estão sem acesso à reunião. Ative a sala no quadro “Sala Zoom” e
        depois use “Gerar acesso Zoom” em cada reserva (ou a empresa gera ao abrir o endereço da reunião).
      </Aviso>
    );
  }
  const semAcesso = ativas.filter((r) => r.acesso && r.acesso.estado !== 'pronto' && r.acesso.estado !== 'preparando').length;
  if (semAcesso === 0) return null;
  return (
    <Aviso>
      <strong>Acesso Zoom pendente:</strong> {semAcesso} reserva(s) ativa(s) ainda sem acesso pronto na sala atual. Use “Gerar acesso Zoom” na
      linha de cada empresa.
    </Aviso>
  );
}

function CartaoSessao({
  sessao: s,
  reservasOk,
  zoom,
  mostrarCanceladas,
  abrir,
  recarregar,
}: {
  sessao: SessaoTela;
  reservasOk: boolean;
  zoom: ZoomDoPainel | null | undefined;
  mostrarCanceladas: boolean;
  abrir: (a: AcaoKickoff) => void;
  recarregar: () => void;
}) {
  const situacao = situacaoDaSessao(s);
  const pendencias = pendenciasDaSessao(s);
  // Capacidade, bloqueio, inscrição e cancelamento: só antes da sessão começar.
  const editavel = reservasOk && ['aberta', 'lotada', 'bloqueada'].includes(situacao);
  const [enviando, setEnviando] = React.useState('');

  const presente = async (reservaId: string, empresa: string) => {
    setEnviando(reservaId);
    const res = await fetch(`/api/agenda/kickoffs/reservas/${reservaId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'presenca', presenca: 'presente' }),
    });
    setEnviando('');
    if (!res.ok) return toast.error('Não foi possível registrar', { description: await textoErro(res) });
    toast.success(`${empresa}: comparecimento registrado`, { description: 'Para encerrar o kickoff da empresa, use Concluir.' });
    recarregar();
  };
  const [capacidade, setCapacidade] = React.useState(String(s.capacidade));
  const [salvando, setSalvando] = React.useState(false);
  React.useEffect(() => setCapacidade(String(s.capacidade)), [s.capacidade]);

  const configurar = async (corpo: { capacidade?: number; aceitaReservas?: boolean }) => {
    setSalvando(true);
    const res = await fetch(`/api/agenda/kickoffs/sessoes/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    setSalvando(false);
    if (!res.ok) {
      toast.error('Não foi possível salvar', { description: await textoErro(res) });
      setCapacidade(String(s.capacidade));
      return;
    }
    toast.success('Sessão atualizada');
    recarregar();
  };

  const reservas = s.reservas.filter((r) => mostrarCanceladas || r.status !== 'cancelada');
  return (
    <article id={`sessao-${s.id}`} className="scroll-mt-20 rounded-lg border">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <h3 className="font-semibold first-letter:uppercase">{quando(s.inicio)}</h3>
          <p className="text-sm text-muted-foreground">
            {s.titulo}
            {s.serieId && ' · série'}
            {s.anfitriao && ` · ${s.anfitriao}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium tabular-nums">
            {s.ocupadas} de {s.capacidade} empresas
          </span>
          <Badge variant="outline" className={cn(COR_SITUACAO[situacao])}>
            {ROTULO_SITUACAO[situacao]}
          </Badge>
          {pendencias > 0 && (
            <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              Resultado pendente: {pendencias} empresa(s)
            </Badge>
          )}
        </div>
      </header>

      {editavel && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b px-4 py-3 text-sm">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(capacidade);
              if (n !== s.capacidade) void configurar({ capacidade: n });
            }}
          >
            <label htmlFor={`cap-${s.id}`}>Capacidade</label>
            <Input
              id={`cap-${s.id}`}
              type="number"
              min={Math.max(1, s.ocupadas)}
              max={50}
              className="h-8 w-20"
              value={capacidade}
              onChange={(e) => setCapacidade(e.target.value)}
            />
            <Button type="submit" size="sm" variant="outline" disabled={salvando || Number(capacidade) === s.capacidade}>
              Salvar
            </Button>
          </form>
          <label className="flex items-center gap-2">
            <Switch checked={s.aceitaReservas} disabled={salvando} onCheckedChange={(v) => void configurar({ aceitaReservas: v })} />
            Aceita novas reservas
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={() => abrir({ tipo: 'adicionar', sessao: s })} disabled={situacao !== 'aberta'}>
              <Plus className="mr-1 h-4 w-4" /> Adicionar empresa
            </Button>
            {s.reservas.some((r) => r.status === 'ativa') && (
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => abrir({ tipo: 'cancelarSessao', sessao: s })}>
                Cancelar sessão e reservas
              </Button>
            )}
          </div>
        </div>
      )}

      {reservas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Nenhuma empresa inscrita.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Empresa</th>
                <th className="px-4 py-2 font-medium">Participante principal</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {reservas.map((r) => {
                const pode = reservasOk ? acoesDaReserva(r, s) : null;
                const ativa = r.status === 'ativa' || r.status === 'concluida';
                return (
                  <tr key={r.id} className={cn('border-t align-top', !ativa && 'text-muted-foreground')}>
                    <td className="px-4 py-2 font-medium">
                      {r.empresa.nome}
                      {r.origemReservaId && <div className="text-xs font-normal text-muted-foreground">reagendada</div>}
                    </td>
                    <td className="px-4 py-2">
                      <div>{r.participante.nome}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.participante.email}
                        {r.participante.telefone ? ` · ${r.participante.telefone}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={r.status === 'concluida' ? 'default' : r.status === 'ativa' ? 'outline' : 'secondary'}>{rotuloReserva(r)}</Badge>
                      {r.status === 'cancelada' && r.motivoCancelamento && <div className="mt-1 text-xs">{r.motivoCancelamento}</div>}
                      {r.status === 'interrompida' && r.motivoInterrupcao && <div className="mt-1 text-xs">{r.motivoInterrupcao}</div>}
                      {(r.status === 'ausente' || r.status === 'interrompida') && r.reagendada && <div className="mt-1 text-xs">já reagendada</div>}
                      {pendencias > 0 && r.status === 'ativa' && <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">resultado pendente</div>}
                      <EstadoDoAcessoZoom reserva={r} zoom={zoom} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        <AcoesDoAcessoZoom reserva={r} zoom={zoom} recarregar={recarregar} />
                        {pode?.presente && (
                          <Button size="sm" variant="ghost" disabled={enviando === r.id} onClick={() => void presente(r.id, r.empresa.nome)}>
                            <UserCheck className="mr-1 h-4 w-4" /> Compareceu
                          </Button>
                        )}
                        {pode?.ausente && (
                          <Button size="sm" variant="ghost" onClick={() => abrir({ tipo: 'ausente', reserva: r })}>
                            <UserX className="mr-1 h-4 w-4" /> Não compareceu
                          </Button>
                        )}
                        {pode?.concluir && (
                          <Button size="sm" variant="ghost" onClick={() => abrir({ tipo: 'concluir', reserva: r })}>
                            <CheckCircle2 className="mr-1 h-4 w-4" /> Concluir kickoff
                          </Button>
                        )}
                        {pode?.interromper && (
                          <Button size="sm" variant="ghost" onClick={() => abrir({ tipo: 'interromper', reserva: r })}>
                            <CircleSlash className="mr-1 h-4 w-4" /> Não concluiu
                          </Button>
                        )}
                        {pode?.corrigirPresenca && (
                          <Button size="sm" variant="ghost" onClick={() => abrir({ tipo: 'corrigirPresenca', reserva: r })}>
                            <Undo2 className="mr-1 h-4 w-4" /> Corrigir presença
                          </Button>
                        )}
                        {pode?.reagendar && (
                          <Button size="sm" variant="ghost" onClick={() => abrir({ tipo: 'reagendar', reserva: r })}>
                            <CalendarPlus className="mr-1 h-4 w-4" /> Reagendar
                          </Button>
                        )}
                        {pode?.participante && (
                          <Button size="sm" variant="ghost" onClick={() => abrir({ tipo: 'participante', reserva: r })} aria-label={`Editar participante de ${r.empresa.nome}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {pode?.remanejar && (
                          <Button size="sm" variant="ghost" onClick={() => abrir({ tipo: 'remanejar', reserva: r })}>
                            <MoveRight className="mr-1 h-4 w-4" /> Remanejar
                          </Button>
                        )}
                        {pode?.cancelar && (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => abrir({ tipo: 'cancelarReserva', reserva: r })}>
                            <XCircle className="mr-1 h-4 w-4" /> Cancelar
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => abrir({ tipo: 'historico', reserva: r })} aria-label={`Histórico de ${r.empresa.nome}`}>
                          <History className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
