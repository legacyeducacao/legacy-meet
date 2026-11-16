'use client';

import * as React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { BotaoEntrarNaReuniao } from './BotaoEntrarNaReuniao';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { ACESSO_ABRE_ANTES_MIN, janelaDoAcesso, type AcessoPublico } from '@/lib/kickoff/zoomAcessoRegras';

/** Novas tentativas automáticas enquanto o acesso está sendo preparado. */
const TENTATIVAS_AUTOMATICAS = 3;
const ESPERA_MS = 6000;

async function pedirAcesso(codigo: string): Promise<AcessoPublico | null> {
  const r = await fetch(`/api/impulsao/convites/${encodeURIComponent(codigo)}/acesso`, { method: 'POST', cache: 'no-store' });
  const j = (await r.json().catch(() => null)) as { status?: string; acesso?: AcessoPublico } | null;
  return r.ok && j?.status === 'ok' && j.acesso ? j.acesso : null;
}

const horaDeBrasilia = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Como entrar na reunião do kickoff (Zoom E2), na página da empresa. Mostra só o
 * endereço da Legacy (/impulsao/reuniao/<código>, a página de entrada): o link
 * individual do Zoom fica no servidor e só é entregue no encaminhamento, depois do
 * clique em "Entrar na reunião", no horário da sessão.
 * Sem `inicial` (estrutura ainda não instalada), cai no texto da M3.
 */
export function AcessoDaReuniao({ codigo, inicial }: { codigo: string; inicial: AcessoPublico | undefined }) {
  const [acesso, setAcesso] = React.useState(inicial);
  const [tentativas, setTentativas] = React.useState(0);
  const [tentando, setTentando] = React.useState(false);
  const [agora, setAgora] = React.useState(() => Date.now());

  React.useEffect(() => setAcesso(inicial), [inicial]);

  // O botão de entrar aparece sozinho quando a janela abre.
  React.useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const tentar = React.useCallback(async () => {
    setTentando(true);
    try {
      const novo = await pedirAcesso(codigo);
      if (novo) setAcesso(novo);
    } catch {
      // Falha de rede: fica "preparando"; o botão permite tentar de novo.
    } finally {
      setTentando(false);
      setTentativas((n) => n + 1);
    }
  }, [codigo]);

  const preparando = acesso?.estado === 'preparando';
  React.useEffect(() => {
    if (!preparando || tentando || tentativas >= TENTATIVAS_AUTOMATICAS) return;
    const t = setTimeout(() => void tentar(), ESPERA_MS);
    return () => clearTimeout(t);
  }, [preparando, tentando, tentativas, tentar]);

  if (!acesso) {
    return <p className="text-center text-base text-muted-foreground">O acesso à reunião será informado pelo time da Legacy.</p>;
  }

  if (acesso.estado === 'indisponivel') {
    return (
      <Quadro titulo="Acesso à reunião">
        <p className="text-base text-muted-foreground">
          O seu agendamento está confirmado. O acesso à reunião será enviado pelo time da Legacy antes do horário marcado.
        </p>
      </Quadro>
    );
  }

  if (acesso.estado === 'preparando') {
    const automatico = tentando || tentativas < TENTATIVAS_AUTOMATICAS;
    return (
      <Quadro titulo="Acesso à reunião">
        <p role="status" className="flex items-center justify-center gap-2 text-base text-muted-foreground">
          {automatico && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {automatico
            ? 'Seu agendamento está confirmado. Estamos preparando o seu acesso à reunião…'
            : 'Seu agendamento está confirmado, mas o acesso à reunião ainda não ficou pronto.'}
        </p>
        {!automatico && (
          <>
            <Button variant="outline" onClick={() => void tentar()}>
              <RefreshCw className="mr-2 size-4" />
              Tentar de novo
            </Button>
            <p className="text-sm text-muted-foreground">Se continuar assim, não se preocupe: o time da Legacy envia o acesso antes da reunião.</p>
          </>
        )}
      </Quadro>
    );
  }

  const endereco = acesso.endereco ?? (typeof window !== 'undefined' ? `${window.location.origin}/impulsao/reuniao/${codigo}` : '');
  const janela = janelaDoAcesso(acesso, agora);
  return (
    <Quadro titulo="Como entrar na reunião">
      <p className="text-base text-muted-foreground">
        No dia, abra este endereço e clique em “Entrar na reunião”. Ele leva você à sala da reunião no Zoom e é só da sua empresa: compartilhe
        apenas com quem vai participar.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <code className="max-w-full break-all rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm">{endereco}</code>
        <CopyButton value={endereco} label="Copiar" size="sm" variant="outline" aria-label="Copiar o endereço da reunião" />
      </div>
      {janela === 'aberta' ? (
        <div className="flex justify-center">
          <BotaoEntrarNaReuniao codigo={codigo} />
        </div>
      ) : janela === 'antes' ? (
        <p className="text-sm text-muted-foreground">
          A entrada abre {ACESSO_ABRE_ANTES_MIN} minutos antes do horário marcado: a partir de {horaDeBrasilia(acesso.abreEm)} (horário de Brasília).
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">O horário desta reunião já passou. Se precisar de ajuda, fale com o time da Legacy.</p>
      )}
    </Quadro>
  );
}

function Quadro({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section aria-label={titulo} className="space-y-4 rounded-2xl border border-border bg-card p-5 text-center sm:p-6">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}
