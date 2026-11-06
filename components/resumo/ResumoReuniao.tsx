'use client';

import * as React from 'react';
import {
  Brain,
  CalendarClock,
  CircleCheck,
  History,
  Lightbulb,
  ListTodo,
  Megaphone,
  MessagesSquare,
  Rocket,
  RotateCcw,
  Target,
  User,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { MeetingSummary } from '@/lib/meetingSummaryCore';

const PILAR_ICON: Record<string, LucideIcon> = {
  'Estratégia & BSC': Target,
  'Gestão Financeira': Wallet,
  'Execução & Postura': Rocket,
  'Processos & Escala': Workflow,
  'Comercial & Marketing': Megaphone,
  'Liderança & Mindset': Brain,
};

/** Cor de destaque de cada seção (ícone do título). */
const TOM = {
  azul: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  verde: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  ambar: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  violeta: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  amarelo: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  primaria: 'bg-primary/10 text-primary',
} as const;

function Secao({
  icon: Icon,
  titulo,
  qtd,
  tom = 'primaria',
  children,
  className = '',
}: {
  icon: LucideIcon;
  titulo: string;
  qtd?: number;
  tom?: keyof typeof TOM;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border bg-card/60 p-4 ${className}`}>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TOM[tom]}`}>
          <Icon className="h-4 w-4" />
        </span>
        {titulo}
        {qtd !== undefined && qtd > 0 && (
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {qtd}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

/** Lista com marcador em ícone (decisões, pontos para retomar). */
function ListaIcone({ itens, icon: Icon, cor }: { itens: string[]; icon: LucideIcon; cor: string }) {
  return (
    <ul className="space-y-2">
      {itens.map((t, i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/85">
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cor}`} />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** Conteúdo do resumo da reunião (página da gravação e "Última reunião" da agenda). */
export function ResumoReuniao({ resumo }: { resumo: MeetingSummary }) {
  const temColunaEsq = resumo.assuntos.length > 0 || resumo.decisoes.length > 0;
  const temColunaDir = resumo.proximos_passos.length > 0 || resumo.retomar.length > 0;

  return (
    // @container: duas colunas quando o espaço permite (página), uma no Dialog.
    <div className="@container space-y-4">
      {resumo.resumo && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-sm leading-relaxed text-foreground/90">{resumo.resumo}</p>
        </div>
      )}

      {resumo.acompanhamento_anterior && (
        <Secao icon={History} titulo="Sobre a reunião anterior">
          <p className="text-sm leading-relaxed text-foreground/85">{resumo.acompanhamento_anterior}</p>
        </Secao>
      )}

      {(temColunaEsq || temColunaDir) && (
        <div className="grid gap-4 @3xl:grid-cols-2">
          {temColunaEsq && (
            <div className="space-y-4">
              {resumo.assuntos.length > 0 && (
                <Secao icon={MessagesSquare} titulo="Assuntos tratados" qtd={resumo.assuntos.length} tom="azul">
                  <ol className="space-y-3">
                    {resumo.assuntos.map((a, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-xs font-semibold text-sky-700 dark:text-sky-300">
                          {i + 1}
                        </span>
                        <div className="min-w-0 text-sm">
                          <p className="font-medium">{a.titulo}</p>
                          {a.detalhes && (
                            <p className="mt-0.5 leading-relaxed text-foreground/75">{a.detalhes}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </Secao>
              )}
              {resumo.decisoes.length > 0 && (
                <Secao icon={CircleCheck} titulo="Decisões e combinados" qtd={resumo.decisoes.length} tom="verde">
                  <ListaIcone itens={resumo.decisoes} icon={CircleCheck} cor="text-emerald-600 dark:text-emerald-400" />
                </Secao>
              )}
            </div>
          )}

          {temColunaDir && (
            <div className="space-y-4">
              {resumo.proximos_passos.length > 0 && (
                <Secao icon={ListTodo} titulo="Próximos passos" qtd={resumo.proximos_passos.length} tom="ambar">
                  <ul className="space-y-2">
                    {resumo.proximos_passos.map((p, i) => (
                      <li key={i} className="rounded-lg border bg-background/60 px-3 py-2.5 text-sm">
                        <p className="leading-relaxed">{p.acao}</p>
                        {(p.responsavel || p.prazo) && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {p.responsavel && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                <User className="h-3 w-3" />
                                {p.responsavel}
                              </span>
                            )}
                            {p.prazo && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                                <CalendarClock className="h-3 w-3" />
                                {p.prazo}
                              </span>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </Secao>
              )}
              {resumo.retomar.length > 0 && (
                <Secao icon={RotateCcw} titulo="Para retomar na próxima reunião" qtd={resumo.retomar.length} tom="violeta">
                  <ListaIcone itens={resumo.retomar} icon={RotateCcw} cor="text-violet-600 dark:text-violet-400" />
                </Secao>
              )}
            </div>
          )}
        </div>
      )}

      {resumo.sugestoes.length > 0 && (
        <Secao icon={Lightbulb} titulo="Sugestões de melhoria (metodologia ExecScore)" tom="amarelo">
          <div className="grid gap-3 @2xl:grid-cols-2">
            {resumo.sugestoes.map((s, i) => {
              const Icon = PILAR_ICON[s.pilar] ?? Lightbulb;
              return (
                <div key={i} className="rounded-lg border bg-background/60 p-3">
                  {s.pilar && (
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <Icon className="h-3.5 w-3.5" />
                      {s.pilar}
                    </p>
                  )}
                  <p className="text-sm leading-relaxed text-foreground/85">{s.sugestao}</p>
                </div>
              );
            })}
          </div>
        </Secao>
      )}

      <p className="text-xs text-muted-foreground">
        Gerado pela IA a partir da transcrição em{' '}
        {new Date(resumo.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
        Confira os pontos importantes na gravação.
      </p>
    </div>
  );
}
