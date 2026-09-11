import React from 'react';
import { decodePassphrase } from './client-utils';

interface E2EESetup {
  worker: Worker | undefined;
  e2eePassphrase: string | undefined;
}

/**
 * Passphrase E2EE do hash da URL + worker de criptografia, criados UMA vez por
 * montagem. Antes rodava no corpo do componente: cada re-render criava outro
 * Worker (nunca encerrado) e um hash malformado (`#100%`) lançava URIError
 * durante o render, deixando a sala em branco.
 */
export function useSetupE2EE(): E2EESetup {
  const [setup] = React.useState<E2EESetup>(() => {
    if (typeof window === 'undefined') return { worker: undefined, e2eePassphrase: undefined };
    let passphrase: string | undefined;
    try {
      passphrase = decodePassphrase(location.hash.substring(1)) || undefined;
    } catch {
      passphrase = undefined;
    }
    const worker = passphrase
      ? new Worker(new URL('livekit-client/e2ee-worker', import.meta.url))
      : undefined;
    return { worker, e2eePassphrase: passphrase };
  });
  React.useEffect(() => () => setup.worker?.terminate(), [setup]);
  return setup;
}
