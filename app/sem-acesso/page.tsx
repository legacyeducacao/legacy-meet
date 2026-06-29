import Image from 'next/image';
import { LogoutButton } from './LogoutButton';

export default function SemAcessoPage() {
  return (
    <main className="flex h-full items-center justify-center overflow-y-auto bg-gradient-to-b from-background to-muted/40 p-4 text-foreground [color-scheme:light]">
      <div className="max-w-md text-center">
        <Image src="/favicon.svg" alt="Legacy Meet" width={56} height={56} className="mx-auto" />
        <h1 className="mt-4 text-2xl font-bold">Sem acesso ao Legacy Meet</h1>
        <p className="mt-2 text-muted-foreground">
          Sua conta não tem acesso a esta área. Fale com um administrador do Meet.
        </p>
        <div className="mt-6">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
