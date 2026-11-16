'use client';

import * as React from 'react';
import { Loader2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';

const AVISOS: Record<string, string> = {
  fora_do_horario: 'A entrada ainda não está aberta para o horário da sua reunião. Atualize a página e confira o horário.',
  sem_reserva: 'Sua empresa não tem um kickoff marcado agora. Atualize a página.',
  concluida: 'O kickoff da sua empresa já foi concluído.',
  convite_invalido: 'Este link não é mais válido. Peça o link atualizado ao time da Legacy.',
  convite_revogado: 'Este link foi substituído. Peça o link atualizado ao time da Legacy.',
  convite_expirado: 'Este link expirou. Peça um link novo ao time da Legacy.',
  muitas_tentativas: 'Muitas tentativas seguidas. Aguarde 15 minutos e tente de novo.',
};
const FALHA = 'Não foi possível entrar agora. Verifique a conexão e tente de novo.';

/**
 * Botão "Entrar na reunião". Nada acontece até o clique. No clique:
 *   1. pede ao servidor um passe de 2 minutos (confere convite, reserva e horário);
 *   2. envia o formulário (POST, navegação do navegador) para a operação de entrada,
 *      que confere tudo de novo e encaminha ao Zoom.
 * O link do Zoom nunca passa por esta página: só existe no encaminhamento final.
 */
export function BotaoEntrarNaReuniao({ codigo }: { codigo: string }) {
  const formulario = React.useRef<HTMLFormElement>(null);
  const campo = React.useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [aviso, setAviso] = React.useState<string | null>(null);

  // Voltar do Zoom pelo botão "voltar" do navegador: o botão fica pronto de novo.
  React.useEffect(() => {
    const religar = () => setEnviando(false);
    window.addEventListener('pageshow', religar);
    return () => window.removeEventListener('pageshow', religar);
  }, []);

  async function entrar(e: React.FormEvent) {
    // O envio só acontece depois de o servidor emitir o passe.
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/impulsao/convites/${encodeURIComponent(codigo)}/entrada`, { method: 'POST', cache: 'no-store' });
      const j = (await r.json().catch(() => null)) as { status?: string; passe?: string } | null;
      if (r.ok && j?.status === 'ok' && j.passe && campo.current && formulario.current) {
        campo.current.value = j.passe;
        formulario.current.submit();
        return;
      }
      setAviso((j?.status && AVISOS[j.status]) || FALHA);
    } catch {
      setAviso(FALHA);
    }
    setEnviando(false);
  }

  return (
    <form ref={formulario} method="post" action={`/impulsao/reuniao/${encodeURIComponent(codigo)}/entrar`} onSubmit={entrar} className="space-y-3">
      <input ref={campo} type="hidden" name="passe" defaultValue="" />
      <Button type="submit" size="lg" className="h-14 px-8 text-lg shadow-md" disabled={enviando}>
        {enviando ? <Loader2 className="mr-2 size-5 animate-spin" aria-hidden /> : <Video className="mr-2 size-5" aria-hidden />}
        {enviando ? 'Entrando…' : 'Entrar na reunião'}
      </Button>
      {aviso && (
        <p role="alert" className="text-sm text-destructive">
          {aviso}
        </p>
      )}
    </form>
  );
}
