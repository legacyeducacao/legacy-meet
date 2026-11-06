'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import type { MeetingSummary } from '@/lib/meetingSummaryCore';

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

function Lista({ itens }: { itens: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/85">
      {itens.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

/** Conteúdo do resumo da reunião (página da gravação e "Última reunião" da agenda). */
export function ResumoReuniao({ resumo }: { resumo: MeetingSummary }) {
  return (
    <div className="space-y-5">
      {resumo.resumo && <p className="text-sm leading-relaxed text-foreground/90">{resumo.resumo}</p>}

      {resumo.acompanhamento_anterior && (
        <Secao titulo="Sobre a reunião anterior">
          <p className="text-sm text-foreground/85">{resumo.acompanhamento_anterior}</p>
        </Secao>
      )}

      {resumo.assuntos.length > 0 && (
        <Secao titulo="Assuntos tratados">
          <ul className="space-y-2">
            {resumo.assuntos.map((a, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{a.titulo}</span>
                {a.detalhes && <span className="text-foreground/80">: {a.detalhes}</span>}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {resumo.decisoes.length > 0 && (
        <Secao titulo="Decisões e combinados">
          <Lista itens={resumo.decisoes} />
        </Secao>
      )}

      {resumo.proximos_passos.length > 0 && (
        <Secao titulo="Próximos passos">
          <ul className="space-y-2">
            {resumo.proximos_passos.map((p, i) => (
              <li key={i} className="rounded-md border px-3 py-2 text-sm">
                <p>{p.acao}</p>
                {(p.responsavel || p.prazo) && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[p.responsavel && `Responsável: ${p.responsavel}`, p.prazo && `Prazo: ${p.prazo}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {resumo.retomar.length > 0 && (
        <Secao titulo="Para retomar na próxima reunião">
          <Lista itens={resumo.retomar} />
        </Secao>
      )}

      {resumo.sugestoes.length > 0 && (
        <Secao titulo="Sugestões de melhoria (metodologia ExecScore)">
          <ul className="space-y-2">
            {resumo.sugestoes.map((s, i) => (
              <li key={i} className="space-y-1 text-sm">
                {s.pilar && <Badge variant="secondary">{s.pilar}</Badge>}
                <p className="text-foreground/85">{s.sugestao}</p>
              </li>
            ))}
          </ul>
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
