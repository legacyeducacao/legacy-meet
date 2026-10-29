'use client';
import * as React from 'react';
import Image from 'next/image';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { NPS_NAME_STORAGE_KEY } from '@/lib/npsStorage';


export function NpsForm({ room }: { room: string }) {
  const [state, setState] = React.useState<'loading' | 'thanks' | 'form' | 'done'>('loading');
  const [hostName, setHostName] = React.useState<string | null>(null);
  const [score, setScore] = React.useState<number | null>(null);
  const [comment, setComment] = React.useState('');
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    try {
      const saved = sessionStorage.getItem(NPS_NAME_STORAGE_KEY);
      if (saved) setName(saved);
    } catch {
      /* sem sessionStorage (aba anônima/bloqueada) */
    }
    fetch(`/api/nps/context?room=${encodeURIComponent(room)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.needsNps) {
          setHostName(j.hostName ?? null);
          setState('form');
        } else setState('thanks');
      })
      .catch(() => setState('thanks'));
  }, [room]);

  const enviar = async () => {
    if (score == null) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/nps/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, score, comment, respondentName: name }),
      });
      if (!res.ok) {
        setError('Não foi possível enviar sua avaliação. Tente novamente.');
        return;
      }
      setState('done');
    } catch {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading')
    return (
      <div className="m-auto flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando…
      </div>
    );
  if (state === 'thanks' || state === 'done')
    return (
      <Card className="m-auto w-full max-w-md text-center">
        <CardContent className="flex flex-col items-center gap-4 py-10">
          <Image src="/favicon.svg" alt="Legacy Meet" width={64} height={64} />
          <CheckCircle2 className="h-10 w-10 text-primary" />
          <h1 className="text-2xl font-bold">
            {state === 'done' ? 'Obrigado pela avaliação!' : 'Obrigado pela sua participação!'}
          </h1>
          <p className="text-muted-foreground">A reunião foi encerrada. Você já pode fechar esta janela.</p>
        </CardContent>
      </Card>
    );

  return (
    <Card className="m-auto w-full max-w-2xl">
      <CardContent className="space-y-5 px-5 py-6 sm:px-6 sm:py-8">
        <div className="text-center">
          <h1 className="text-xl font-bold">Como foi a entrega{hostName ? ` de ${hostName}` : ''}?</h1>
          <p className="text-sm text-muted-foreground">Toque em uma nota de 0 a 10.</p>
        </div>
        <div>
          {/* Celular: 0–5 e 6–10 em duas linhas, botões de 48px (onze numa linha
              ficavam com ~22px, difíceis de acertar com o dedo). */}
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-11 sm:gap-1.5" role="radiogroup" aria-label="Nota">
            {Array.from({ length: 11 }).map((_, n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={score === n}
                onClick={() => setScore(n)}
                className={cn(
                  'h-12 w-full rounded-lg border text-base font-semibold transition-colors sm:h-11',
                  score === n
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-muted active:bg-muted',
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
            <span>0 = Muito ruim</span>
            <span>10 = Excelente</span>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="obs">Observações (opcional)</Label>
          <Textarea
            id="obs"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Conte como foi…"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nome">Seu nome (opcional)</Label>
          <Input
            id="nome"
            autoComplete="name"
            enterKeyHint="send"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        <Button className="h-12 w-full text-base" disabled={score == null || busy} onClick={enviar}>
          {busy ? 'Enviando…' : score == null ? 'Escolha uma nota para enviar' : 'Enviar avaliação'}
        </Button>
      </CardContent>
    </Card>
  );
}
