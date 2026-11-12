'use client';

import * as React from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { layoutDia, parseYmd, weekdayIso, type Ymd } from '@/lib/agenda-engine';
import {
  DIAS_CURTOS,
  faixaHorario,
  HORA_PX,
  instanteMin,
  minutosNoDia,
  noDia,
  SNAP_MIN,
} from '@/lib/agenda/visao';
import type { EventoDTO, FeriadoDTO } from '@/lib/agenda/tipos';
import type { Ancora } from './Flutuante';

type Modo = 'criar' | 'mover' | 'redimensionar';

interface Arraste {
  modo: Modo;
  evento?: EventoDTO;
  diaIdx0: number;
  min0: number;
  diaIdx: number;
  min: number;
  /** mover: minutos entre o ponteiro e o início do evento. */
  offset: number;
  duracao: number;
  moveu: boolean;
  x0: number;
  y0: number;
  toque: boolean;
  /** mover: reunião embaixo do ponteiro (soltar ali troca os horários). */
  trocaCom?: EventoDTO | null;
}

/** Soltar uma reunião em cima da outra troca os horários das duas. */
export function podeTrocar(origem: EventoDTO | undefined, alvo: EventoDTO | undefined): alvo is EventoDTO {
  return (
    !!origem &&
    !!alvo &&
    origem.id !== alvo.id &&
    origem.tipo === 'reuniao' &&
    alvo.tipo === 'reuniao' &&
    origem.podeEditar &&
    alvo.podeEditar &&
    !origem.diaInteiro &&
    !alvo.diaInteiro
  );
}

const MIN_DIA = 1440;
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const piso = (m: number) => Math.floor(m / SNAP_MIN) * SNAP_MIN;
const arred = (m: number) => Math.round(m / SNAP_MIN) * SNAP_MIN;

function horaDe(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Grade de horas (Dia, 4 dias, Semana). Clique e arraste no vazio cria;
 * arraste no evento move (inclusive para outro dia); a borda de baixo
 * redimensiona. Soltar uma reunião em cima de outra troca os horários das
 * duas. Tudo em passos de 15 minutos. No toque, tocar abre (o arraste fica
 * para a rolagem da tela).
 */
export function GradeHoras({
  dias,
  hoje,
  agora,
  tz,
  eventos,
  feriados,
  corDe,
  selecionadoId,
  onCriar,
  onAbrir,
  onMover,
  onTrocar,
  onVerDia,
}: {
  dias: Ymd[];
  hoje: Ymd;
  agora: Date;
  tz: string;
  eventos: EventoDTO[];
  feriados: FeriadoDTO[];
  corDe: (e: EventoDTO) => string;
  selecionadoId: string | null;
  onCriar: (inicio: Date, fim: Date, ancora: Ancora) => void;
  onAbrir: (e: EventoDTO, ancora: Ancora) => void;
  onMover: (e: EventoDTO, inicio: Date, fim: Date) => void;
  onTrocar: (origem: EventoDTO, alvo: EventoDTO) => void;
  onVerDia: (d: Ymd) => void;
}) {
  const rolagem = React.useRef<HTMLDivElement>(null);
  const colunas = React.useRef<Array<HTMLDivElement | null>>([]);
  const arrasteRef = React.useRef<Arraste | null>(null);
  const [arraste, setArraste] = React.useState<Arraste | null>(null);
  const eventosRef = React.useRef(eventos);
  eventosRef.current = eventos;

  const feriadoDe = React.useMemo(() => new Map(feriados.map((f) => [f.data, f])), [feriados]);

  // Rola até perto de agora (ou 7h) ao abrir ou trocar de período.
  React.useEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    const min = dias.includes(hoje) ? minutosNoDia(agora, hoje, tz) - 60 : 7 * 60;
    el.scrollTop = Math.max(0, (min / 60) * HORA_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dias[0], dias.length]);

  const porDia = React.useMemo(
    () =>
      dias.map((dia) => {
        const doDia = noDia(eventos, dia, tz).filter((e) => !e.diaInteiro);
        const ini = instanteMin(dia, 0, tz).getTime();
        const fim = instanteMin(dia, MIN_DIA, tz).getTime();
        const pos = new Map(
          layoutDia(doDia.map((e) => ({ id: e.id, inicio: Math.max(Date.parse(e.inicio), ini), fim: Math.min(Date.parse(e.fim), fim) }))).map(
            (p) => [p.id, p],
          ),
        );
        return { dia, eventos: doDia, pos, diaInteiro: noDia(eventos, dia, tz).filter((e) => e.diaInteiro) };
      }),
    [dias, eventos, tz],
  );

  const posicao = React.useCallback((x: number, y: number) => {
    const cols = colunas.current;
    let idx = cols.findIndex((c) => {
      const r = c?.getBoundingClientRect();
      return r && x >= r.left && x < r.right;
    });
    if (idx < 0) {
      const primeiro = cols[0]?.getBoundingClientRect();
      idx = primeiro && x < primeiro.left ? 0 : cols.length - 1;
    }
    const r = cols[idx]!.getBoundingClientRect();
    return { diaIdx: idx, min: clamp(((y - r.top) / HORA_PX) * 60, 0, MIN_DIA) };
  }, []);

  const iniciar = (e: React.PointerEvent, modo: Modo, diaIdx: number, evento?: EventoDTO) => {
    if (e.button !== 0) return;
    const toque = e.pointerType === 'touch';
    const { min } = posicao(e.clientX, e.clientY);
    let offset = 0;
    let duracao = 60;
    if (evento) {
      const ini = minutosNoDia(new Date(evento.inicio), dias[diaIdx], tz);
      duracao = Math.round((Date.parse(evento.fim) - Date.parse(evento.inicio)) / 60_000);
      offset = min - ini;
    }
    const a: Arraste = { modo, evento, diaIdx0: diaIdx, min0: min, diaIdx, min, offset, duracao, moveu: false, x0: e.clientX, y0: e.clientY, toque };
    arrasteRef.current = a;
    if (!toque) setArraste(a);
  };

  React.useEffect(() => {
    const mover = (e: PointerEvent) => {
      const a = arrasteRef.current;
      if (!a) return;
      const longe = Math.hypot(e.clientX - a.x0, e.clientY - a.y0) > 4;
      if (a.toque) {
        // No toque o arraste é rolagem: cancela.
        if (longe) arrasteRef.current = null;
        return;
      }
      if (a.modo !== 'criar' && !a.evento?.podeEditar) return;
      const p = posicao(e.clientX, e.clientY);
      let trocaCom: EventoDTO | null = null;
      if (a.modo === 'mover') {
        const el = document
          .elementsFromPoint(e.clientX, e.clientY)
          .map((x) => (x as HTMLElement).closest?.('[data-evento-id]') as HTMLElement | null)
          .find((x) => x && x.dataset.eventoId !== a.evento?.id);
        const alvo = el ? eventosRef.current.find((ev) => ev.id === el.dataset.eventoId) : undefined;
        if (podeTrocar(a.evento, alvo)) trocaCom = alvo;
      }
      const novo = { ...a, diaIdx: a.modo === 'mover' ? p.diaIdx : a.diaIdx0, min: p.min, moveu: a.moveu || longe, trocaCom };
      arrasteRef.current = novo;
      setArraste(novo);
    };
    const soltar = (e: PointerEvent) => {
      const a = arrasteRef.current;
      arrasteRef.current = null;
      setArraste(null);
      if (!a) return;
      const ancora = { x: e.clientX, y: e.clientY };
      const dia0 = dias[a.diaIdx0];
      if (a.modo === 'criar') {
        let ini: number;
        let fim: number;
        if (!a.moveu) {
          ini = Math.floor(a.min0 / 30) * 30;
          fim = Math.min(ini + 60, MIN_DIA);
        } else {
          ini = piso(Math.min(a.min0, a.min));
          fim = Math.max(ini + SNAP_MIN, Math.ceil(Math.max(a.min0, a.min) / SNAP_MIN) * SNAP_MIN);
        }
        onCriar(instanteMin(dia0, ini, tz), instanteMin(dia0, fim, tz), ancora);
        return;
      }
      const ev = a.evento!;
      if (!a.moveu || !ev.podeEditar) {
        onAbrir(ev, ancora);
        return;
      }
      if (a.modo === 'mover' && a.trocaCom) {
        onTrocar(ev, a.trocaCom);
        return;
      }
      if (a.modo === 'mover') {
        const ini = clamp(arred(a.min - a.offset), 0, MIN_DIA - SNAP_MIN);
        const inicio = instanteMin(dias[a.diaIdx], ini, tz);
        const fim = new Date(inicio.getTime() + a.duracao * 60_000);
        if (inicio.getTime() !== Date.parse(ev.inicio)) onMover(ev, inicio, fim);
      } else {
        const iniMin = minutosNoDia(new Date(ev.inicio), dia0, tz);
        const fimMin = clamp(arred(a.min), iniMin + SNAP_MIN, MIN_DIA);
        const fim = instanteMin(dia0, fimMin, tz);
        if (fim.getTime() !== Date.parse(ev.fim)) onMover(ev, new Date(ev.inicio), fim);
      }
    };
    const cancelar = () => {
      arrasteRef.current = null;
      setArraste(null);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', cancelar);
    return () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', cancelar);
    };
  }, [dias, tz, posicao, onCriar, onAbrir, onMover, onTrocar]);

  // Prévia do arraste
  let previa: { diaIdx: number; ini: number; fim: number; cor: string; titulo: string } | null = null;
  if (arraste?.moveu) {
    if (arraste.modo === 'criar') {
      const ini = piso(Math.min(arraste.min0, arraste.min));
      const fim = Math.max(ini + SNAP_MIN, Math.ceil(Math.max(arraste.min0, arraste.min) / SNAP_MIN) * SNAP_MIN);
      previa = { diaIdx: arraste.diaIdx0, ini, fim, cor: '#6366f1', titulo: '(sem título)' };
    } else if (arraste.evento?.podeEditar && !arraste.trocaCom) {
      const ev = arraste.evento;
      if (arraste.modo === 'mover') {
        const ini = clamp(arred(arraste.min - arraste.offset), 0, MIN_DIA - SNAP_MIN);
        previa = { diaIdx: arraste.diaIdx, ini, fim: Math.min(ini + arraste.duracao, MIN_DIA), cor: corDe(ev), titulo: ev.titulo };
      } else {
        const ini = minutosNoDia(new Date(ev.inicio), dias[arraste.diaIdx0], tz);
        previa = { diaIdx: arraste.diaIdx0, ini, fim: clamp(arred(arraste.min), ini + SNAP_MIN, MIN_DIA), cor: corDe(ev), titulo: ev.titulo };
      }
    }
  }

  const colunasCss = { gridTemplateColumns: `3.5rem repeat(${dias.length}, minmax(0, 1fr))` };
  const temDiaInteiro = porDia.some((d) => d.diaInteiro.length || feriadoDe.has(d.dia));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabeçalho dos dias */}
      <div className="grid border-b bg-card" style={colunasCss}>
        <div />
        {dias.map((d) => {
          const { day } = parseYmd(d);
          const eHoje = d === hoje;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onVerDia(d)}
              className="flex flex-col items-center gap-0.5 py-2 hover:bg-muted/50"
              aria-label={`Ver o dia ${d}`}
            >
              <span className={cn('text-[11px] uppercase tracking-wide text-muted-foreground', eHoje && 'text-primary')}>
                {DIAS_CURTOS[weekdayIso(d) - 1]}
              </span>
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-lg font-semibold',
                  eHoje && 'bg-primary text-primary-foreground',
                )}
              >
                {day}
              </span>
            </button>
          );
        })}
      </div>

      {/* Linha de dia inteiro: feriados e bloqueios do dia todo */}
      {temDiaInteiro && (
        <div className="grid border-b bg-card" style={colunasCss}>
          <div className="px-1 py-1 text-right text-[10px] text-muted-foreground">dia todo</div>
          {porDia.map(({ dia, diaInteiro }) => (
            <div key={dia} className="space-y-0.5 border-l p-0.5">
              {feriadoDe.has(dia) && (
                <div className="truncate rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300" title={feriadoDe.get(dia)!.nome}>
                  {feriadoDe.get(dia)!.nome}
                </div>
              )}
              {diaInteiro.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={(ev) => onAbrir(e, { x: ev.clientX, y: ev.clientY })}
                  className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium"
                  style={{ backgroundColor: `${corDe(e)}26`, color: 'inherit' }}
                >
                  {e.titulo}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Grade com rolagem */}
      <div ref={rolagem} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid" style={{ ...colunasCss, height: 24 * HORA_PX }}>
          {/* Horas */}
          <div className="relative">
            {Array.from({ length: 23 }, (_, h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: (h + 1) * HORA_PX }}>
                {String(h + 1).padStart(2, '0')}:00
              </span>
            ))}
          </div>

          {porDia.map(({ dia, eventos: evs, pos }, idx) => (
            <div
              key={dia}
              ref={(el) => {
                colunas.current[idx] = el;
              }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) iniciar(e, 'criar', idx);
              }}
              className={cn('relative border-l touch-pan-y', feriadoDe.has(dia) && 'bg-red-500/[0.04]')}
              style={{
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HORA_PX - 1}px, hsl(var(--border, 214 32% 91%) / 0.7) ${HORA_PX - 1}px, hsl(var(--border, 214 32% 91%) / 0.7) ${HORA_PX}px)`,
              }}
            >
              {evs.map((e) => {
                const p = pos.get(e.id);
                if (!p) return null;
                const ini = Math.max(0, minutosNoDia(new Date(e.inicio), dia, tz));
                const fim = Math.min(MIN_DIA, minutosNoDia(new Date(e.fim), dia, tz));
                const alt = Math.max(((fim - ini) / 60) * HORA_PX, 18);
                const cor = corDe(e);
                const movendo = arraste?.moveu && arraste.evento?.id === e.id && arraste.modo === 'mover';
                const curto = alt < 40;
                const alvoTroca = !!arraste?.moveu && arraste.trocaCom?.id === e.id;
                const passado = Date.parse(e.fim) < agora.getTime();
                return (
                  <div
                    key={e.id}
                    data-evento-id={e.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${e.titulo}, ${faixaHorario(new Date(e.inicio), new Date(e.fim), tz)}`}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      iniciar(ev, 'mover', idx, e);
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                        onAbrir(e, { x: r.right, y: r.top });
                      }
                    }}
                    className={cn(
                      'absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm outline-none ring-offset-1 transition-[box-shadow,opacity] focus-visible:ring-2 focus-visible:ring-primary',
                      e.podeEditar ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                      selecionadoId === e.id && 'ring-2 ring-primary',
                      alvoTroca && 'ring-2 ring-primary ring-offset-2',
                      movendo && 'opacity-40',
                      passado && 'opacity-70',
                      e.status === 'no_show' && 'line-through',
                    )}
                    style={{
                      top: (ini / 60) * HORA_PX,
                      height: alt - 1,
                      left: `calc(${p.left * 100}% + 2px)`,
                      width: `calc(${p.width * 100}% - 4px)`,
                      backgroundColor: `color-mix(in srgb, ${cor} 18%, hsl(var(--card)))`,
                      borderLeftColor: cor,
                      zIndex: alvoTroca ? 25 : 1 + p.coluna,
                    }}
                  >
                    {alvoTroca && (
                      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-1 bg-primary/85 px-1 text-[11px] font-semibold text-primary-foreground">
                        <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Trocar horários</span>
                      </div>
                    )}
                    <div className={cn('flex min-w-0 gap-1', curto ? 'items-center' : 'flex-col')}>
                      <span className="truncate font-semibold">
                        {e.rotulo && <span className="mr-1 rounded bg-black/10 px-1 dark:bg-white/15">{e.rotulo}</span>}
                        {e.titulo}
                      </span>
                      <span className="truncate text-muted-foreground">
                        {faixaHorario(new Date(e.inicio), new Date(e.fim), tz)}
                        {!curto && (e.cliente || e.turma) ? ` · ${e.cliente || e.turma}` : ''}
                      </span>
                    </div>
                    {e.podeEditar && (
                      <div
                        aria-hidden
                        onPointerDown={(ev) => {
                          ev.stopPropagation();
                          iniciar(ev, 'redimensionar', idx, e);
                        }}
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                      />
                    )}
                  </div>
                );
              })}

              {previa && previa.diaIdx === idx && (
                <div
                  className="pointer-events-none absolute inset-x-0.5 z-30 rounded-md border-l-[3px] px-1.5 py-0.5 text-[11px] font-semibold shadow-lg"
                  style={{
                    top: (previa.ini / 60) * HORA_PX,
                    height: ((previa.fim - previa.ini) / 60) * HORA_PX - 1,
                    backgroundColor: `color-mix(in srgb, ${previa.cor} 35%, hsl(var(--card)))`,
                    borderLeftColor: previa.cor,
                  }}
                >
                  <div className="truncate">{previa.titulo}</div>
                  <div className="font-normal">
                    {horaDe(previa.ini)} às {horaDe(previa.fim)}
                  </div>
                </div>
              )}

              {dia === hoje && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-40 h-0.5 bg-red-500"
                  style={{ top: (minutosNoDia(agora, dia, tz) / 60) * HORA_PX }}
                  aria-hidden
                >
                  <span className="absolute -left-1.5 -top-[5px] h-3 w-3 rounded-full bg-red-500" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
