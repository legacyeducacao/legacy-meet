'use client';
import * as React from 'react';
import Image from 'next/image';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function NpsForm({ room }: { room: string }) {
  const [state, setState] = React.useState<'loading' | 'thanks' | 'form' | 'done'>('loading');
  const [hostName, setHostName] = React.useState<string | null>(null);
  const [score, setScore] = React.useState<number | null>(null);
  const [comment, setComment] = React.useState('');
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    fetch(`/api/nps/context?room=${encodeURIComponent(room)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.needsNps) { setHostName(j.hostName ?? null); setState('form'); }
        else setState('thanks');
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

  if (state === 'loading') return null;
  if (state === 'thanks' || state === 'done')
    return (
      <Card className="w-full max-w-md text-center">
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
    <Card className="w-full max-w-lg">
      <CardContent className="space-y-5 py-8">
        <div className="text-center">
          <h1 className="text-xl font-bold">Como foi a entrega{hostName ? ` de ${hostName}` : ''}?</h1>
          <p className="text-sm text-muted-foreground">Dê uma nota de 0 a 10.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {Array.from({ length: 11 }).map((_, n) => (
            <button
              key={n}
              type="button"
              onClick={() => setScore(n)}
              className={cn(
                'h-10 w-10 rounded-md border text-sm font-semibold transition-colors',
                score === n ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-muted',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="obs">Observações</Label>
          <Textarea id="obs" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Conte como foi…" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nome">Seu nome (opcional)</Label>
          <Input id="nome" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        <Button className="w-full" disabled={score == null || busy} onClick={enviar}>
          {busy ? 'Enviando…' : 'Enviar avaliação'}
        </Button>
      </CardContent>
    </Card>
  );
}
