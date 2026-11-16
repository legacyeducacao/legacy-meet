'use client';

import * as React from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DIAS_CURTOS, dataPorExtenso, diaDaSemanaDe, diaMes, vagas, type SessaoPublica } from '@/lib/kickoff/publico';
import {
  VISOES,
  apelidoDoDia,
  descricaoDoDia,
  diaAnteriorComHorario,
  diaAoNavegar,
  diaDaSemanaPorExtenso,
  diaEMes,
  domingoDaSemana,
  gradeDoMes,
  horarios,
  horariosPorData,
  intervaloDaSemana,
  limitesDoCalendario,
  mostrarNaTela,
  numeroDoDia,
  podeNavegar,
  proximoDiaComHorario,
  rotuloDoMes,
  seteDias,
  type LimitesDoCalendario,
  type VisaoDoCalendario,
} from '@/lib/kickoff/publicoCalendario';

/**
 * Calendário da página pública do kickoff (adaptado do Legacy CS): Mês, Semana e
 * Dia mostram as MESMAS sessões, só organizadas de outro jeito. O dia em foco e o
 * horário escolhido moram em quem usa o calendário: trocar de visão não perde nada.
 */
export function CalendarioPublico({
  sessoes,
  hoje,
  visao,
  onVisao,
  dia,
  onDia,
  escolhida,
  onEscolher,
}: {
  sessoes: SessaoPublica[];
  /** Hoje em Brasília (YYYY-MM-DD). */
  hoje: string;
  visao: VisaoDoCalendario;
  onVisao: (v: VisaoDoCalendario) => void;
  dia: string;
  onDia: (data: string) => void;
  escolhida: string | null;
  onEscolher: (s: SessaoPublica) => void;
}) {
  const porData = React.useMemo(() => horariosPorData(sessoes), [sessoes]);
  const datas = React.useMemo(() => [...porData.keys()], [porData]);
  const limites = limitesDoCalendario(datas, hoje);
  const comum: Comum = { porData, datas, limites, hoje, dia, onDia, escolhida, onEscolher };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div role="group" aria-label="Ver os horários por" className="grid h-12 w-full grid-cols-3 rounded-xl bg-muted p-1 sm:w-80">
          {VISOES.map((v) => (
            <button
              key={v.valor}
              type="button"
              aria-pressed={visao === v.valor}
              onClick={() => onVisao(v.valor)}
              className={cn(
                'h-10 rounded-lg text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                visao === v.valor ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v.rotulo}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">Horários de Brasília</p>
      </div>
      {visao === 'mes' && <VisaoMes {...comum} />}
      {visao === 'semana' && <VisaoSemana {...comum} />}
      {visao === 'dia' && <VisaoDia {...comum} />}
    </div>
  );
}

interface Comum {
  porData: Map<string, SessaoPublica[]>;
  datas: string[];
  limites: LimitesDoCalendario;
  hoje: string;
  dia: string;
  onDia: (data: string) => void;
  escolhida: string | null;
  onEscolher: (s: SessaoPublica) => void;
}

function VisaoMes({ porData, datas, limites, hoje, dia, onDia, escolhida, onEscolher }: Comum) {
  const idDaLista = React.useId();
  const lista = React.useRef<HTMLElement>(null);
  const clicouNoDia = React.useRef(false);
  const horariosDoDia = porData.get(dia) ?? [];

  // No celular a lista fica embaixo do calendário: mostra ao tocar num dia.
  React.useEffect(() => {
    if (!clicouNoDia.current) return;
    clicouNoDia.current = false;
    mostrarNaTela(lista.current);
  }, [dia]);

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(15rem,17rem)] md:gap-0">
      <div className="md:pr-8">
        <Navegacao
          titulo={rotuloDoMes(dia)}
          rotuloAnterior="Mês anterior"
          rotuloProximo="Próximo mês"
          podeVoltar={podeNavegar('mes', dia, -1, limites)}
          podeAvancar={podeNavegar('mes', dia, 1, limites)}
          onNavegar={(passo) => onDia(diaAoNavegar('mes', dia, passo, datas, limites))}
        />
        <div aria-hidden className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-medium uppercase text-muted-foreground">
          {DIAS_CURTOS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div role="group" aria-label={`Dias de ${rotuloDoMes(dia).toLowerCase()}`} className="mt-1 grid grid-cols-7">
          {gradeDoMes(dia)
            .flat()
            .map((d, i) => {
              if (!d) return <span key={`vazio-${i}`} aria-hidden />;
              const quantos = porData.get(d)?.length ?? 0;
              const tem = quantos > 0;
              const selecionado = tem && d === dia;
              return (
                <div key={d} className="flex h-12 items-center justify-center sm:h-14">
                  <button
                    type="button"
                    disabled={!tem}
                    aria-pressed={tem ? selecionado : undefined}
                    aria-current={d === hoje ? 'date' : undefined}
                    aria-label={descricaoDoDia(d, quantos, hoje)}
                    onClick={() => {
                      clicouNoDia.current = true;
                      onDia(d);
                    }}
                    className={cn(
                      'relative flex size-11 items-center justify-center rounded-full text-base tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 xl:size-12',
                      !tem && 'text-muted-foreground/70',
                      tem && !selecionado && 'bg-primary/10 font-semibold text-primary ring-1 ring-inset ring-primary/40 hover:bg-primary/20',
                      selecionado && 'bg-primary font-semibold text-primary-foreground shadow-md ring-2 ring-primary/25 ring-offset-2 ring-offset-card',
                    )}
                  >
                    {numeroDoDia(d)}
                    {d === hoje && <span aria-hidden className="absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-current" />}
                  </button>
                </div>
              );
            })}
        </div>
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span aria-hidden className="size-4 shrink-0 rounded-full bg-primary/10 ring-1 ring-inset ring-primary/40" />
          Dias destacados têm horário disponível
        </p>
      </div>

      <section ref={lista} aria-labelledby={idDaLista} className="scroll-mt-4 space-y-4 md:border-l md:border-border md:pl-8">
        <div>
          <h3 id={idDaLista} className="text-lg font-semibold leading-snug">
            <span className="block text-sm font-medium text-muted-foreground">{diaDaSemanaPorExtenso(dia, hoje)}</span>
            {diaEMes(dia)}
          </h3>
          {horariosDoDia.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {horarios(horariosDoDia.length)} {horariosDoDia.length === 1 ? 'disponível' : 'disponíveis'}
            </p>
          )}
        </div>
        {horariosDoDia.length > 0 ? (
          <ListaDeHorarios sessoes={horariosDoDia} escolhida={escolhida} onEscolher={onEscolher} />
        ) : (
          <SemHorarios texto="Escolha um dos dias destacados no calendário." datas={datas} depoisDe={dia} onDia={onDia} />
        )}
      </section>
    </div>
  );
}

function VisaoSemana({ porData, datas, limites, hoje, dia, onDia, escolhida, onEscolher }: Comum) {
  const domingo = domingoDaSemana(dia);
  const dias = seteDias(domingo);
  const semanaVazia = dias.every((d) => !porData.has(d));

  return (
    <div>
      <Navegacao
        titulo={intervaloDaSemana(domingo)}
        rotuloAnterior="Semana anterior"
        rotuloProximo="Próxima semana"
        podeVoltar={podeNavegar('semana', dia, -1, limites)}
        podeAvancar={podeNavegar('semana', dia, 1, limites)}
        onNavegar={(passo) => onDia(diaAoNavegar('semana', dia, passo, datas, limites))}
      />
      <ul className="mt-4 divide-y divide-border md:grid md:grid-cols-7 md:gap-2 md:divide-y-0">
        {dias.map((d) => {
          const doDia = porData.get(d) ?? [];
          const tem = doDia.length > 0;
          const apelido = apelidoDoDia(d, hoje);
          return (
            <li
              key={d}
              className={cn(
                'flex items-center gap-3 py-3 md:flex-col md:items-stretch md:gap-2 md:rounded-xl md:border md:p-2',
                tem ? 'md:border-primary/40 md:bg-primary/5' : 'md:border-dashed md:border-border',
              )}
            >
              <div className={cn('w-14 shrink-0 md:w-auto md:text-center', !tem && 'text-muted-foreground')}>
                <p className="text-xs font-medium uppercase">{DIAS_CURTOS[diaDaSemanaDe(d)]}</p>
                <p className={cn('text-lg leading-tight tabular-nums', tem && 'font-semibold')}>{diaMes(d)}</p>
                {apelido && <p className="text-xs font-medium text-primary">{apelido}</p>}
              </div>
              {tem ? (
                <ul className="flex flex-1 flex-wrap gap-2 md:flex-col">
                  {doDia.map((s) => (
                    <li key={s.id}>
                      <BotaoDeHorario sessao={s} ativo={s.id === escolhida} onEscolher={onEscolher} compacto />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex-1 text-sm text-muted-foreground md:text-center md:text-xs">Sem horários</p>
              )}
            </li>
          );
        })}
      </ul>
      {semanaVazia && (
        <div className="mt-3">
          <SemHorarios texto="Não há horários nesta semana." datas={datas} depoisDe={dias[6]} onDia={onDia} />
        </div>
      )}
    </div>
  );
}

function VisaoDia({ porData, datas, limites, hoje, dia, onDia, escolhida, onEscolher }: Comum) {
  const doDia = porData.get(dia) ?? [];
  return (
    <div className="space-y-4">
      <Navegacao
        antes={diaDaSemanaPorExtenso(dia, hoje)}
        titulo={diaEMes(dia)}
        rotuloAnterior="Dia anterior"
        rotuloProximo="Próximo dia"
        podeVoltar={podeNavegar('dia', dia, -1, limites)}
        podeAvancar={podeNavegar('dia', dia, 1, limites)}
        onNavegar={(passo) => onDia(diaAoNavegar('dia', dia, passo, datas, limites))}
      />
      {doDia.length > 0 ? (
        <ListaDeHorarios sessoes={doDia} escolhida={escolhida} onEscolher={onEscolher} className="sm:grid-cols-2 xl:grid-cols-3" />
      ) : (
        <SemHorarios texto="Não há horários neste dia." datas={datas} depoisDe={dia} onDia={onDia} />
      )}
    </div>
  );
}

function Navegacao({
  antes,
  titulo,
  rotuloAnterior,
  rotuloProximo,
  podeVoltar,
  podeAvancar,
  onNavegar,
}: {
  antes?: string;
  titulo: string;
  rotuloAnterior: string;
  rotuloProximo: string;
  podeVoltar: boolean;
  podeAvancar: boolean;
  onNavegar: (passo: -1 | 1) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <BotaoDeNavegacao rotulo={rotuloAnterior} ativo={podeVoltar} onClick={() => onNavegar(-1)}>
        <ChevronLeft />
      </BotaoDeNavegacao>
      <div className="min-w-0 flex-1 text-center" aria-live="polite">
        <h3 className="text-lg font-semibold leading-snug">
          {antes && <span className="block text-sm font-medium text-muted-foreground">{antes}</span>}
          {titulo}
        </h3>
      </div>
      <BotaoDeNavegacao rotulo={rotuloProximo} ativo={podeAvancar} onClick={() => onNavegar(1)}>
        <ChevronRight />
      </BotaoDeNavegacao>
    </div>
  );
}

/** Seta de navegação. No limite fica apagada mas continua focável (aria-disabled). */
function BotaoDeNavegacao({ rotulo, ativo, onClick, children }: { rotulo: string; ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      aria-disabled={!ativo}
      onClick={() => {
        if (ativo) onClick();
      }}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:size-5',
        ativo ? 'hover:bg-muted' : 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  );
}

function ListaDeHorarios({
  sessoes,
  escolhida,
  onEscolher,
  className,
}: {
  sessoes: SessaoPublica[];
  escolhida: string | null;
  onEscolher: (s: SessaoPublica) => void;
  className?: string;
}) {
  return (
    <ul className={cn('grid gap-2', className)}>
      {sessoes.map((s) => (
        <li key={s.id}>
          <BotaoDeHorario sessao={s} ativo={s.id === escolhida} onEscolher={onEscolher} />
        </li>
      ))}
    </ul>
  );
}

/** Horário clicável. O nome lido pelo leitor de tela já traz a data. */
function BotaoDeHorario({
  sessao: s,
  ativo,
  onEscolher,
  compacto = false,
}: {
  sessao: SessaoPublica;
  ativo: boolean;
  onEscolher: (s: SessaoPublica) => void;
  compacto?: boolean;
}) {
  const base = 'border-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
  const cor = ativo ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-primary/30 bg-background hover:border-primary hover:bg-primary/5';
  const detalhe = ativo ? 'text-primary-foreground/85' : 'text-muted-foreground';

  if (compacto) {
    return (
      <button
        type="button"
        aria-pressed={ativo}
        onClick={() => onEscolher(s)}
        className={cn(base, cor, 'flex min-h-12 min-w-[5.5rem] flex-col items-center justify-center rounded-lg px-2 py-1 text-center md:w-full md:min-w-0')}
      >
        <span className="sr-only">{dataPorExtenso(s.data)}, das </span>
        <span className="text-base font-semibold tabular-nums">{s.inicio}</span>
        <span className="sr-only"> às {s.fim}, </span>
        <span className={cn('text-xs', detalhe)}>{vagas(s.vagas)}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={() => onEscolher(s)}
      className={cn(base, cor, 'flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-4 py-2.5')}
    >
      <span>
        <span className="sr-only">{dataPorExtenso(s.data)}, das </span>
        <span className="block whitespace-nowrap text-lg font-semibold tabular-nums">
          {s.inicio} às {s.fim}
        </span>
        <span className={cn('block text-sm', detalhe)}>{vagas(s.vagas)}</span>
      </span>
      {ativo ? (
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium">
          <Check className="size-5" aria-hidden />
          Escolhido
        </span>
      ) : (
        <span className="shrink-0 text-sm font-medium text-primary">Escolher</span>
      )}
    </button>
  );
}

/** Dia (ou semana) sem horário: diz isso e leva ao dia com horário mais perto. */
function SemHorarios({ texto, datas, depoisDe, onDia }: { texto: string; datas: string[]; depoisDe: string; onDia: (data: string) => void }) {
  const proximo = proximoDiaComHorario(datas, depoisDe);
  const alvo = proximo ?? diaAnteriorComHorario(datas, depoisDe);
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-border p-4 text-center">
      <p className="font-medium">{texto}</p>
      {alvo && (
        <Button type="button" variant="outline" className="h-auto min-h-11 w-full flex-col gap-0 whitespace-normal py-2 text-base" onClick={() => onDia(alvo)}>
          <span>{proximo ? 'Ver o próximo dia com horário' : 'Ver o último dia com horário'}</span>
          <span className="text-sm font-normal text-muted-foreground">{dataPorExtenso(alvo)}</span>
        </Button>
      )}
    </div>
  );
}
