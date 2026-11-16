'use client';

import * as React from 'react';
import { CalendarClock, CheckCircle2, Clock, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AVISO_DA_RECUSA,
  KICKOFF_CONCLUIDO,
  RECUSAS,
  dataPorExtenso,
  duracaoPorExtenso,
  minutosEntre,
  type PaginaDoConvite,
  type RecusaDoConvite,
  type RespostaDoConvite,
} from '@/lib/kickoff/publico';
import { ACESSO_ABRE_ANTES_MIN, janelaDoAcesso } from '@/lib/kickoff/zoomAcessoRegras';
import { Aviso, Moldura } from './AgendamentoPublico';
import { BotaoEntrarNaReuniao } from './BotaoEntrarNaReuniao';

const ERRO_GENERICO = 'Não foi possível abrir a página da reunião agora. Verifique a conexão e tente de novo.';

/** O que aconteceu quando a tentativa de entrar voltou para esta página. */
const AVISO_DO_RETORNO: Record<string, string> = {
  expirou: 'A página ficou aberta por um tempo. Clique em "Entrar na reunião" de novo.',
  pendente: 'Ainda não foi possível entrar. Tente de novo em instantes; se continuar, fale com o time da Legacy.',
  recusa: 'Não foi possível entrar com este link.',
  falha: 'Não foi possível entrar agora. Tente de novo em instantes.',
};

const horaDeBrasilia = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Página de entrada da reunião do kickoff: /impulsao/reuniao/<código do convite>.
 * Abrir a página só LÊ (a mesma consulta pública do agendamento): não inscreve no
 * Zoom, não encaminha e não recebe o link da reunião. Entrar é sempre um clique no
 * botão, que aciona a operação de entrada no servidor.
 */
export function EntradaNaReuniao({ codigo, retorno }: { codigo: string; retorno: string | null }) {
  const [resposta, setResposta] = React.useState<RespostaDoConvite | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [agora, setAgora] = React.useState(() => Date.now());

  const carregar = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/impulsao/convites/${encodeURIComponent(codigo)}`, { cache: 'no-store' });
      const j = (await r.json().catch(() => null)) as RespostaDoConvite | { status: 'erro' } | null;
      if (!r.ok || !j || j.status === 'erro') throw new Error(ERRO_GENERICO);
      setResposta(j as RespostaDoConvite);
      setErro(null);
    } catch {
      setErro(ERRO_GENERICO);
    }
  }, [codigo]);
  React.useEffect(() => {
    void carregar();
  }, [carregar]);

  // O botão aparece sozinho quando a entrada abre (e some quando fecha).
  React.useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  if (!resposta) {
    return (
      <Moldura>
        {erro ? (
          <Aviso titulo="Não foi possível abrir" texto={erro}>
            <Button variant="outline" onClick={() => void carregar()}>
              <RefreshCw className="mr-2 size-4" />
              Tentar de novo
            </Button>
          </Aviso>
        ) : (
          <div role="status" className="flex items-center justify-center gap-2 py-16 text-base text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            Carregando a sua reunião…
          </div>
        )}
      </Moldura>
    );
  }
  if (resposta.status !== 'ok') {
    const motivo = RECUSAS.includes(resposta.status as RecusaDoConvite) ? (resposta.status as RecusaDoConvite) : 'convite_invalido';
    return (
      <Moldura>
        <Aviso {...AVISO_DA_RECUSA[motivo]} />
      </Moldura>
    );
  }
  return (
    <Moldura>
      <Reuniao codigo={codigo} pagina={resposta} agora={agora} aviso={retorno ? (AVISO_DO_RETORNO[retorno] ?? null) : null} />
    </Moldura>
  );
}

function Cartao({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6 rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-8">{children}</div>;
}

function Reuniao({ codigo, pagina, agora, aviso }: { codigo: string; pagina: PaginaDoConvite; agora: number; aviso: string | null }) {
  const agendar = `/impulsao/agendar/${encodeURIComponent(codigo)}`;

  if (pagina.situacao === 'concluida') {
    return (
      <Cartao>
        <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">Kickoff concluído</h1>
        <p className="text-base text-muted-foreground">{KICKOFF_CONCLUIDO}</p>
      </Cartao>
    );
  }

  const reserva = pagina.reserva;
  if (!reserva) {
    return (
      <Cartao>
        <CalendarClock className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">Nenhum kickoff marcado</h1>
        <p className="text-base text-muted-foreground">
          {pagina.empresa.nome} ainda não tem um kickoff marcado. Escolha um horário para liberar a entrada na reunião.
        </p>
        <Button asChild size="lg">
          <a href={agendar}>Agendar o kickoff</a>
        </Button>
      </Cartao>
    );
  }

  const acesso = pagina.acesso;
  const janela = acesso ? janelaDoAcesso(acesso, agora) : null;
  return (
    <Cartao>
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Kickoff do Impulsão</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{pagina.empresa.nome}</h1>
      </div>

      <div className="space-y-1">
        <p className="text-xl font-semibold">{dataPorExtenso(reserva.data)}</p>
        <p className="text-lg">
          <span className="tabular-nums">
            {reserva.inicio} às {reserva.fim}
          </span>{' '}
          <span className="text-base text-muted-foreground">(horário de Brasília)</span>
        </p>
      </div>

      <dl className="grid gap-4 border-t border-border pt-5 text-left sm:grid-cols-3">
        <Item rotulo="Conduzido por">{reserva.anfitriao?.nome ?? 'Equipe Legacy'}</Item>
        <Item rotulo="Participante">{reserva.participante}</Item>
        <Item rotulo="Duração">{duracaoPorExtenso(minutosEntre(reserva.inicio, reserva.fim))}</Item>
      </dl>

      <div className="space-y-3 border-t border-border pt-6">
        {aviso && (
          <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {aviso}
          </p>
        )}
        {!acesso || acesso.estado === 'indisponivel' ? (
          <Situacao titulo="Acesso em preparação">O acesso a esta reunião será enviado pelo time da Legacy antes do horário marcado.</Situacao>
        ) : janela === 'antes' ? (
          <Situacao titulo="Ainda é cedo">
            A entrada abre {ACESSO_ABRE_ANTES_MIN} minutos antes do horário marcado: a partir de {horaDeBrasilia(acesso.abreEm)} (horário de Brasília). Volte a
            esta página nesse horário.
          </Situacao>
        ) : janela === 'encerrada' ? (
          <Situacao titulo="Esta sessão já terminou">O horário desta reunião já passou. Se precisar de ajuda, fale com o time da Legacy.</Situacao>
        ) : (
          <>
            <BotaoEntrarNaReuniao codigo={codigo} />
            <p className="text-sm text-muted-foreground">
              {acesso.estado === 'preparando'
                ? 'Seu acesso é preparado na hora, ao clicar. Você vai para a sala da reunião no Zoom.'
                : 'Você vai para a sala da reunião no Zoom, já identificado pela sua empresa.'}
            </p>
          </>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Precisa trocar o horário ou quem vai participar? Fale com o time da Legacy.{' '}
        <a href={agendar} className="underline underline-offset-2">
          Ver o agendamento
        </a>
      </p>
    </Cartao>
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

function Situacao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div role="status" className="space-y-1 rounded-xl bg-muted/60 p-4">
      <p className="flex items-center justify-center gap-2 text-base font-semibold">
        <Clock className="size-4" aria-hidden />
        {titulo}
      </p>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
