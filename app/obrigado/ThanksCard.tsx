import Image from 'next/image';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/** Agradecimento padrão do fim da reunião (quem não tem nada a preencher). */
export function ThanksCard({
  title = 'Obrigado pela sua participação!',
  loginHref,
}: {
  title?: string;
  /** Executor que saiu sem login: link para entrar e escolher os pilares do ExecScore. */
  loginHref?: string;
}) {
  return (
    <Card className="m-auto w-full max-w-md text-center">
      <CardContent className="flex flex-col items-center gap-4 py-10">
        <Image src="/favicon.svg" alt="Legacy Meet" width={64} height={64} />
        <CheckCircle2 className="h-10 w-10 text-primary" />
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">A reunião foi encerrada. Você já pode fechar esta janela.</p>
        {loginHref && (
          <Link
            href={loginHref}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Entrar para escolher os pilares do ExecScore
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
