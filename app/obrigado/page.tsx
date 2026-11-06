import { NpsForm } from './NpsForm';
import { PilaresExecScore } from './PilaresExecScore';
import { ThanksCard } from './ThanksCard';

export const dynamic = 'force-dynamic';

export default async function ObrigadoPage(ctx: {
  searchParams: Promise<{ room?: string; host?: string }>;
}) {
  const { room, host } = await ctx.searchParams;
  // NPS é UNICAMENTE para o cliente. Anfitrião (executor/comercial) sai com
  // host=1 e nunca vê o formulário de avaliação; o executor da Executoria
  // escolhe os pilares do ExecScore (os demais veem só o agradecimento).
  const isHost = host === '1';
  return (
    // O cartão é centralizado com margin auto (m-auto) dentro de um bloco com
    // min-h-full — e não com items-center: centralizar por flex cortava o topo
    // do cartão quando o teclado do celular abria (sem como rolar até lá).
    <main className="h-full overflow-y-auto bg-gradient-to-b from-background to-muted/40 text-foreground [color-scheme:light]">
      <div className="flex min-h-full p-3 sm:p-6">
        {!room ? (
          <ThanksCard />
        ) : isHost ? (
          <PilaresExecScore room={room} />
        ) : (
          <NpsForm room={room} />
        )}
      </div>
    </main>
  );
}
