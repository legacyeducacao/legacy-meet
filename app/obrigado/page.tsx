import Image from 'next/image';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { NpsForm } from './NpsForm';

export const dynamic = 'force-dynamic';

export default async function ObrigadoPage(ctx: { searchParams: Promise<{ room?: string }> }) {
  const { room } = await ctx.searchParams;
  return (
    <main className="flex h-full items-center justify-center overflow-y-auto bg-gradient-to-b from-background to-muted/40 p-4 text-foreground [color-scheme:light]">
      {room ? (
        <NpsForm room={room} />
      ) : (
        <Card className="w-full max-w-md text-center">
          <CardContent className="flex flex-col items-center gap-4 py-10">
            <Image src="/favicon.svg" alt="Legacy Meet" width={64} height={64} />
            <CheckCircle2 className="h-10 w-10 text-primary" />
            <h1 className="text-2xl font-bold">Obrigado pela sua participação!</h1>
            <p className="text-muted-foreground">A reunião foi encerrada. Você já pode fechar esta janela.</p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
