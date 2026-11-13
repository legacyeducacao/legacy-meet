'use client';

import * as React from 'react';
import { AlertCircle, ArrowRight, CalendarClock, Check, CheckCircle2, Clock, Globe, Loader2, RefreshCw } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { validarParticipante } from '@/lib/kickoff/reservasRegras';
import {
  AVISO_DA_RECUSA,
  KICKOFF_CONCLUIDO,
  RECUSAS,
  anfitriaoComum,
  avisoDoAgendamento,
  dataCurta,
  dataPorExtenso,
  duracaoComum,
  duracaoPorExtenso,
  hojeEmSaoPaulo,
  iniciais,
  minutosEntre,
  type AnfitriaoPublico,
  type PaginaDoConvite,
  type RecusaDoConvite,
  type ReservaPublica,
  type RespostaDoAgendamento,
  type RespostaDoConvite,
  type SessaoPublica,
} from '@/lib/kickoff/publico';
import { CalendarioPublico } from './CalendarioPublico';
import { AcessoDaReuniao } from './AcessoDaReuniao';
import type { AcessoPublico } from '@/lib/kickoff/zoomAcessoRegras';
import { mostrarNaTela, visaoInicial, type VisaoDoCalendario } from '@/lib/kickoff/publicoCalendario';

const ERRO_GENERICO = 'Não foi possível abrir o agendamento agora. Verifique a conexão e tente de novo.';

async function lerConvite(codigo: string): Promise<RespostaDoConvite> {
  const r = await fetch(`/api/impulsao/convites/${encodeURIComponent(codigo)}`, { cache: 'no-store' });
  const j = (await r.json().catch(() => null)) as RespostaDoConvite | { status: 'erro' } | null;
  if (!r.ok || !j || j.status === 'erro') throw new Error(ERRO_GENERICO);
  return j as RespostaDoConvite;
}

async function agendarKickoff(
  codigo: string,
  sessaoId: string,
  p: { nome: string; email: string; telefone: string | null },
): Promise<RespostaDoAgendamento> {
  const r = await fetch(`/api/impulsao/convites/${encodeURIComponent(codigo)}/agendar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessaoId, nome: p.nome, email: p.email, telefone: p.telefone }),
  });
  const j = (await r.json().catch(() => null)) as RespostaDoAgendamento | { status: 'erro' } | null;
  if (!r.ok || !j || j.status === 'erro') throw new Error('Não foi possível agendar agora. Tente de novo em instantes.');
  return j as RespostaDoAgendamento;
}

function useConvite(codigo: string) {
  const [resposta, setResposta] = React.useState<RespostaDoConvite | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(true);
  const recarregar = React.useCallback(async () => {
    setCarregando(true);
    try {
      setResposta(await lerConvite(codigo));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : ERRO_GENERICO);
    } finally {
      setCarregando(false);
    }
  }, [codigo]);
  React.useEffect(() => {
    void recarregar();
  }, [recarregar]);
  return { resposta, erro, carregando, recarregar };
}

/**
 * Página pública do link do kickoff (/impulsao/agendar/<código>). Sem login: a
 * empresa vem do convite e o cliente só escolhe o horário e diz quem vai
 * participar. Quem decide se dá para marcar é o banco. (Adaptado do Legacy CS.)
 */
export function AgendamentoPublico({ codigo }: { codigo: string }) {
  const { resposta, carregando, erro, recarregar } = useConvite(codigo);
  const [agendada, setAgendada] = React.useState<{ reserva: ReservaPublica; jaExistia: boolean; acesso: AcessoPublico | undefined } | null>(null);
  const [recusa, setRecusa] = React.useState<RecusaDoConvite | null>(null);
  const [concluida, setConcluida] = React.useState(false);

  if (!resposta) {
    return (
      <Moldura>
        {erro ? (
          <Aviso titulo="Não foi possível abrir" texto={erro}>
            <Button variant="outline" onClick={() => void recarregar()}>
              <RefreshCw className="mr-2 size-4" />
              Tentar de novo
            </Button>
          </Aviso>
        ) : (
          <div role="status" className="flex items-center justify-center gap-2 py-16 text-base text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            Carregando os horários…
          </div>
        )}
      </Moldura>
    );
  }
  if (recusa || resposta.status !== 'ok') {
    const motivo = recusa ?? (RECUSAS.includes(resposta.status as RecusaDoConvite) ? (resposta.status as RecusaDoConvite) : 'convite_invalido');
    return (
      <Moldura>
        <Aviso {...AVISO_DA_RECUSA[motivo]} />
      </Moldura>
    );
  }

  const pagina = resposta;
  if (concluida || pagina.situacao === 'concluida') {
    return (
      <Moldura largo>
        <PainelDuplo lateral={<PainelDoAnfitriao pagina={pagina} anfitriao={null} duracao={null} />}>
          <div className="space-y-6">
            <Titulo>Kickoff concluído</Titulo>
            <div role="status" className="space-y-2 rounded-2xl border border-success/30 bg-success/5 p-6 text-center">
              <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
              <p className="text-base">{KICKOFF_CONCLUIDO}</p>
            </div>
          </div>
        </PainelDuplo>
      </Moldura>
    );
  }

  const reserva = agendada?.reserva ?? pagina.reserva;
  if (reserva) {
    return (
      <Moldura largo>
        <PainelDuplo lateral={<PainelDoAnfitriao pagina={pagina} anfitriao={reserva.anfitriao} duracao={minutosEntre(reserva.inicio, reserva.fim)} />}>
          <Confirmacao
            codigo={codigo}
            reserva={reserva}
            acesso={agendada ? agendada.acesso : pagina.acesso}
            acabouDeAgendar={agendada !== null && !agendada.jaExistia}
            expirado={pagina.expirado}
          />
        </PainelDuplo>
      </Moldura>
    );
  }

  if (pagina.sessoes.length === 0) {
    return (
      <Moldura largo>
        <PainelDuplo lateral={<PainelDoAnfitriao pagina={pagina} anfitriao={null} duracao={null} />}>
          <div className="space-y-6">
            <Titulo>Agende seu kickoff</Titulo>
            <div className="space-y-2 rounded-2xl border border-dashed border-border p-6 text-center">
              <CalendarClock className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <p className="text-lg font-medium">Ainda não há horários abertos</p>
              <p className="text-base text-muted-foreground">
                Novas turmas são abertas com frequência. Abra este link de novo em alguns dias ou fale com o time da Legacy.
              </p>
            </div>
          </div>
        </PainelDuplo>
      </Moldura>
    );
  }

  return (
    <Moldura largo>
      <Formulario
        codigo={codigo}
        pagina={pagina}
        atualizando={carregando}
        onAgendado={(r, jaExistia, acesso) => setAgendada({ reserva: r, jaExistia, acesso })}
        onRecusa={setRecusa}
        onConcluida={() => setConcluida(true)}
        onRecarregar={() => void recarregar()}
      />
    </Moldura>
  );
}

/** Marca da Legacy no alto; conteúdo largo (agendamento) ou estreito (avisos). */
export function Moldura({ largo = false, children }: { largo?: boolean; children: React.ReactNode }) {
  const largura = largo ? 'max-w-6xl' : 'max-w-xl';
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-background via-muted/40 to-background text-foreground">
      <header className={cn('mx-auto flex w-full items-center gap-3 px-4 pt-5 sm:px-6 sm:pt-8', largura)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/favicon.svg" alt="" className="size-9 rounded-lg" />
        <div className="leading-tight">
          <p className="text-sm font-semibold">Legacy Executoria</p>
          <p className="text-xs text-muted-foreground">Impulsão Empresarial</p>
        </div>
      </header>
      <main className={cn('mx-auto w-full flex-1 px-4 py-5 sm:px-6 sm:py-8', largura)}>{children}</main>
      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground">Link individual da sua empresa. Compartilhe só com quem vai participar.</footer>
    </div>
  );
}

/** Contexto à esquerda (no celular, em cima) e a ação à direita. */
function PainelDuplo({ lateral, children }: { lateral: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="rounded-t-2xl border-b border-border bg-muted/40 p-5 sm:p-6 lg:rounded-l-2xl lg:rounded-tr-none lg:border-b-0 lg:border-r lg:p-8">{lateral}</aside>
      <div className="min-w-0 p-5 sm:p-6 lg:p-8">{children}</div>
    </div>
  );
}

function FotoDoAnfitriao({ anfitriao, className }: { anfitriao: AnfitriaoPublico; className?: string }) {
  return (
    <Avatar className={className}>
      {anfitriao.foto && <AvatarImage src={anfitriao.foto} alt="" className="object-cover" />}
      <AvatarFallback className="bg-primary font-semibold text-primary-foreground">{iniciais(anfitriao.nome)}</AvatarFallback>
    </Avatar>
  );
}

/** Quem conduz (quando se sabe), o que é a reunião e para qual empresa. */
function PainelDoAnfitriao({
  pagina,
  anfitriao,
  duracao,
  convidando = false,
}: {
  pagina: PaginaDoConvite;
  anfitriao: AnfitriaoPublico | null;
  duracao: number | null;
  convidando?: boolean;
}) {
  return (
    <div className="space-y-5 lg:sticky lg:top-8">
      {anfitriao && (
        <div className="flex items-center gap-4 lg:flex-col lg:items-start lg:gap-4">
          <FotoDoAnfitriao anfitriao={anfitriao} className="size-14 text-lg lg:size-20 lg:text-2xl" />
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Reunião conduzida por</p>
            <p className="text-lg font-semibold leading-snug">{anfitriao.nome}</p>
            <p className="text-sm text-muted-foreground">Customer Success · Legacy Executoria</p>
          </div>
        </div>
      )}
      <div className={cn('space-y-3', anfitriao && 'lg:border-t lg:border-border lg:pt-5')}>
        <p className="text-xl font-semibold leading-snug tracking-tight">Kickoff do Impulsão</p>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground lg:flex-col">
          {duracao !== null && (
            <li className="flex items-center gap-2">
              <Clock className="size-4 shrink-0" aria-hidden />
              {duracaoPorExtenso(duracao)}
            </li>
          )}
          <li className="flex items-center gap-2">
            <Globe className="size-4 shrink-0" aria-hidden />
            Horário de Brasília
          </li>
        </ul>
        {convidando && (
          <p className="hidden text-sm leading-relaxed text-foreground/80 lg:block">
            Que bom ter a sua empresa no Impulsão! Escolha o horário que fica melhor para você e vamos começar juntos.
          </p>
        )}
      </div>
      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agendando para a empresa</p>
        <p className="text-base font-semibold leading-snug">{pagina.empresa.nome}</p>
      </div>
    </div>
  );
}

const Titulo = React.forwardRef<HTMLHeadingElement, { children: React.ReactNode }>(function Titulo({ children }, ref) {
  return (
    <h1 ref={ref} tabIndex={-1} className="scroll-mt-4 text-2xl font-semibold tracking-tight focus:outline-none sm:text-3xl">
      {children}
    </h1>
  );
});

type Etapa = 'horario' | 'confirmar';

function Etapas({ atual }: { atual: Etapa }) {
  const itens: { valor: Etapa; rotulo: string }[] = [
    { valor: 'horario', rotulo: 'Dia e horário' },
    { valor: 'confirmar', rotulo: 'Confirmação' },
  ];
  const indice = itens.findIndex((i) => i.valor === atual);
  return (
    <ol aria-label="Etapas do agendamento" className="flex items-center gap-2 text-sm">
      {itens.map((item, i) => {
        const feita = i < indice;
        const ativa = i === indice;
        return (
          <li key={item.valor} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden className="h-px w-6 bg-border sm:w-10" />}
            <span aria-current={ativa ? 'step' : undefined} className={cn('flex items-center gap-2', ativa ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              <span
                aria-hidden
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                  ativa && 'bg-primary text-primary-foreground',
                  feita && 'bg-primary/15 text-primary',
                  !ativa && !feita && 'border border-border',
                )}
              >
                {feita ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span>
                <span className="sr-only">{`Etapa ${i + 1} de ${itens.length}: `}</span>
                {item.rotulo}
                {feita && <span className="sr-only"> (feita)</span>}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const telaLarga = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches === true;

function Formulario({
  codigo,
  pagina,
  atualizando,
  onAgendado,
  onRecusa,
  onConcluida,
  onRecarregar,
}: {
  codigo: string;
  pagina: PaginaDoConvite;
  atualizando: boolean;
  onAgendado: (r: ReservaPublica, jaExistia: boolean, acesso: AcessoPublico | undefined) => void;
  onRecusa: (r: RecusaDoConvite) => void;
  onConcluida: () => void;
  onRecarregar: () => void;
}) {
  const hoje = hojeEmSaoPaulo();
  const [visao, setVisao] = React.useState<VisaoDoCalendario>(() => visaoInicial(telaLarga()));
  const [dia, setDia] = React.useState(() => pagina.sessoes[0]?.data ?? hoje);
  const [escolhida, setEscolhida] = React.useState<string | null>(null);
  const [etapa, setEtapa] = React.useState<Etapa>('horario');
  const [p, setP] = React.useState({ nome: '', email: '', telefone: '' });
  const [enviando, setEnviando] = React.useState(false);
  const [aviso, setAviso] = React.useState<string | null>(null);
  const [avisoDoHorario, setAvisoDoHorario] = React.useState<string | null>(null);
  // Se a lista foi relida e o horário sumiu, a escolha deixa de valer.
  const sessao = pagina.sessoes.find((s) => s.id === escolhida) ?? null;
  const naConfirmacao = etapa === 'confirmar' && sessao !== null;
  const topo = React.useRef<HTMLDivElement>(null);
  const titulo = React.useRef<HTMLHeadingElement>(null);
  const trocouDeEtapa = React.useRef(false);

  React.useEffect(() => {
    if (!trocouDeEtapa.current) return;
    trocouDeEtapa.current = false;
    mostrarNaTela(topo.current, true);
    titulo.current?.focus({ preventScroll: true });
  }, [etapa]);

  function irPara(nova: Etapa) {
    trocouDeEtapa.current = true;
    setEtapa(nova);
  }

  function escolher(s: SessaoPublica) {
    setEscolhida(s.id);
    setDia(s.data);
    setAviso(null);
    setAvisoDoHorario(null);
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!sessao) return irPara('horario');
    const v = validarParticipante(p);
    if (!v.ok) return setAviso(v.message);
    setEnviando(true);
    setAviso(null);
    try {
      const r = await agendarKickoff(codigo, sessao.id, v.participante);
      if ((r.status === 'ok' || r.status === 'ja_inscrita') && r.reserva) return onAgendado(r.reserva, r.status === 'ja_inscrita', r.acesso);
      if (r.status === 'concluida') return onConcluida();
      if (RECUSAS.includes(r.status as RecusaDoConvite)) return onRecusa(r.status as RecusaDoConvite);
      if (r.status === 'sessao_lotada' || r.status === 'sessao_indisponivel') {
        // O horário caiu: volta ao calendário (relido) com o aviso; os dados ficam.
        setEscolhida(null);
        setAvisoDoHorario(avisoDoAgendamento(r));
        onRecarregar();
        return irPara('horario');
      }
      setAviso(avisoDoAgendamento(r) ?? 'Não foi possível agendar. Tente de novo.');
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Não foi possível agendar. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  const duracao = sessao ? minutosEntre(sessao.inicio, sessao.fim) : duracaoComum(pagina.sessoes);
  const anfitriao = sessao ? sessao.anfitriao : anfitriaoComum(pagina.sessoes);

  return (
    <PainelDuplo lateral={<PainelDoAnfitriao pagina={pagina} anfitriao={anfitriao} duracao={duracao} convidando />}>
      <div ref={topo} className="scroll-mt-4 space-y-6">
        <Etapas atual={naConfirmacao ? 'confirmar' : 'horario'} />
        <p className="sr-only" aria-live="polite">
          {sessao ? `Horário escolhido: ${dataPorExtenso(sessao.data)}, das ${sessao.inicio} às ${sessao.fim}.` : ''}
        </p>

        {naConfirmacao && sessao ? (
          <form onSubmit={confirmar} noValidate className="space-y-7">
            <div className="space-y-1">
              <Titulo ref={titulo}>Confirme seu agendamento</Titulo>
              <p className="text-base text-muted-foreground">Confira o horário e diga quem vai participar.</p>
            </div>

            <ResumoDoHorario pagina={pagina} sessao={sessao} onTrocar={() => irPara('horario')} />

            <section aria-labelledby="quem-participa" className="space-y-4">
              <div className="space-y-1">
                <h2 id="quem-participa" className="text-lg font-semibold">
                  Quem vai participar
                </h2>
                <p className="text-sm text-muted-foreground">Pode ser você ou outra pessoa da empresa.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="agendar-nome" className="text-base">
                    Nome <span className="text-destructive">*</span>
                  </Label>
                  <Input id="agendar-nome" autoComplete="name" maxLength={200} className="h-12 text-base" value={p.nome} onChange={(e) => setP({ ...p, nome: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agendar-email" className="text-base">
                    E-mail <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="agendar-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    maxLength={254}
                    className="h-12 text-base"
                    value={p.email}
                    onChange={(e) => setP({ ...p, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agendar-telefone" className="text-base">
                    WhatsApp
                  </Label>
                  <Input
                    id="agendar-telefone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={30}
                    placeholder="(11) 99999-9999"
                    className="h-12 text-base"
                    value={p.telefone}
                    onChange={(e) => setP({ ...p, telefone: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">O e-mail é obrigatório. O WhatsApp é opcional.</p>
            </section>

            <div className="space-y-3 border-t border-border pt-6">
              {aviso && <AvisoNaPagina texto={aviso} />}
              <Button type="submit" size="lg" className="h-14 w-full text-lg shadow-md" disabled={enviando}>
                {enviando && <Loader2 className="animate-spin" aria-hidden />}
                {enviando ? 'Confirmando…' : 'Confirmar agendamento'}
              </Button>
              <p className="text-center text-sm text-muted-foreground">Ao confirmar, a vaga da sua empresa fica reservada.</p>
            </div>
          </form>
        ) : (
          <>
            <div className="space-y-1">
              <Titulo ref={titulo}>Agende seu kickoff</Titulo>
              <p className="text-base text-muted-foreground">Escolha o melhor dia e horário para sua reunião.</p>
            </div>
            {avisoDoHorario && <AvisoNaPagina texto={avisoDoHorario} />}
            <div aria-busy={atualizando} className={cn('transition-opacity', atualizando && 'pointer-events-none opacity-60')}>
              <CalendarioPublico
                sessoes={pagina.sessoes}
                hoje={hoje}
                visao={visao}
                onVisao={setVisao}
                dia={dia}
                onDia={setDia}
                escolhida={escolhida}
                onEscolher={escolher}
              />
            </div>
            <BarraDaEscolha sessao={sessao} onContinuar={() => irPara('confirmar')} />
          </>
        )}
      </div>
    </PainelDuplo>
  );
}

/** Rodapé da etapa 1: grudado no pé da tela para o celular não precisar procurar. */
function BarraDaEscolha({ sessao, onContinuar }: { sessao: SessaoPublica | null; onContinuar: () => void }) {
  if (!sessao) {
    return <p className="rounded-xl bg-muted/60 p-4 text-center text-base text-muted-foreground">Escolha um dia e um horário para continuar.</p>;
  }
  return (
    <div className="sticky bottom-0 z-10 -mx-5 -mb-5 rounded-b-2xl border-t border-border bg-card/95 px-5 py-3 backdrop-blur sm:-mx-6 sm:-mb-6 sm:px-6 sm:py-4 lg:-mx-8 lg:-mb-8 lg:rounded-bl-none lg:px-8">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground sm:text-sm">Horário escolhido</p>
          <p className="text-base font-semibold leading-snug">
            <span className="sm:hidden">{dataCurta(sessao.data)}</span>
            <span className="hidden sm:inline">{dataPorExtenso(sessao.data)}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="tabular-nums">
              {sessao.inicio}
              <span className="hidden sm:inline"> às {sessao.fim}</span>
            </span>
          </p>
        </div>
        <Button size="lg" className="h-12 shrink-0 px-5 text-base sm:px-6" onClick={onContinuar}>
          Continuar
          <ArrowRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{rotulo}</dt>
      <dd className="text-base font-medium leading-snug">{children}</dd>
    </div>
  );
}

function ConduzidoPor({ anfitriao }: { anfitriao: AnfitriaoPublico | null }) {
  if (!anfitriao) return <span>Equipe Legacy</span>;
  return (
    <span className="flex items-center gap-2">
      <FotoDoAnfitriao anfitriao={anfitriao} className="size-7 text-[11px]" />
      {anfitriao.nome}
    </span>
  );
}

function ResumoDoHorario({ pagina, sessao, onTrocar }: { pagina: PaginaDoConvite; sessao: SessaoPublica; onTrocar: () => void }) {
  return (
    <section aria-label="Resumo do agendamento" className="rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">Seu horário</p>
          <p className="text-xl font-semibold leading-snug sm:text-2xl">{dataPorExtenso(sessao.data)}</p>
          <p className="text-lg">
            <span className="tabular-nums">
              {sessao.inicio} às {sessao.fim}
            </span>{' '}
            <span className="text-sm text-muted-foreground">(horário de Brasília)</span>
          </p>
        </div>
        <Button type="button" variant="outline" className="h-11 bg-card px-4" onClick={onTrocar}>
          Trocar horário
        </Button>
      </div>
      <dl className="mt-5 grid gap-4 border-t border-primary/20 pt-5 sm:grid-cols-3">
        <Item rotulo="Empresa">{pagina.empresa.nome}</Item>
        <Item rotulo="Conduzido por">
          <ConduzidoPor anfitriao={sessao.anfitriao} />
        </Item>
        <Item rotulo="Duração">{duracaoPorExtenso(minutosEntre(sessao.inicio, sessao.fim))}</Item>
      </dl>
    </section>
  );
}

/** Reserva feita agora ou já existente (recuperação pelo mesmo link). */
function Confirmacao({
  codigo,
  reserva,
  acesso,
  acabouDeAgendar,
  expirado,
}: {
  codigo: string;
  reserva: ReservaPublica;
  acesso: AcessoPublico | undefined;
  acabouDeAgendar: boolean;
  expirado: boolean;
}) {
  return (
    <div className="space-y-6">
      <div role="status" className="space-y-5 rounded-2xl border border-success/30 bg-success/5 p-6 text-center sm:p-8">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
        <div className="space-y-2">
          <Titulo>{acabouDeAgendar ? 'Kickoff agendado!' : 'O kickoff da sua empresa está marcado'}</Titulo>
          <p className="text-xl font-semibold">{dataPorExtenso(reserva.data)}</p>
          <p className="text-lg">
            <span className="tabular-nums">
              {reserva.inicio} às {reserva.fim}
            </span>{' '}
            <span className="text-base text-muted-foreground">(horário de Brasília)</span>
          </p>
        </div>
        <dl className="mx-auto grid max-w-2xl gap-4 border-t border-success/20 pt-5 text-left sm:grid-cols-3">
          <Item rotulo="Participante">{reserva.participante}</Item>
          <Item rotulo="Conduzido por">
            <ConduzidoPor anfitriao={reserva.anfitriao} />
          </Item>
          <Item rotulo="Duração">{duracaoPorExtenso(minutosEntre(reserva.inicio, reserva.fim))}</Item>
        </dl>
      </div>
      <AcessoDaReuniao codigo={codigo} inicial={acesso} />
      {expirado && (
        <p className="text-center text-sm text-muted-foreground">
          O prazo deste link para novos agendamentos acabou, mas ele continua mostrando o seu kickoff marcado.
        </p>
      )}
      <p className="text-center text-base text-muted-foreground">
        Guarde este link: por ele você confere o seu agendamento. Precisa trocar o horário ou quem vai participar? Fale com o time da Legacy.
      </p>
    </div>
  );
}

/** O link não abre: tela com o motivo. */
export function Aviso({ titulo, texto, children }: { titulo: string; texto: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
      <AlertCircle className="mx-auto size-8 text-destructive" aria-hidden />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{titulo}</h1>
        <p className="text-sm text-muted-foreground">{texto}</p>
      </div>
      {children}
    </div>
  );
}

function AvisoNaPagina({ texto }: { texto: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-base text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{texto}</span>
    </p>
  );
}
