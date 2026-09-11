'use client';

import React from 'react';
import { RoomEvent, ConnectionState } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { useKrispNoiseFilter } from '@livekit/components-react/krisp';
import { isLowPowerDevice, KRISP_FILTER_OPTIONS } from './client-utils';

// ServerInfo_Edition.Cloud no protocolo do LiveKit (Standard = 0, Cloud = 1).
const EDITION_CLOUD = 1;
// Espera a chamada estabilizar (ICE, câmera e microfone publicados) antes de
// baixar ~6 MB de JS/WASM e trocar o processor do microfone.
const KRISP_DELAY_MS = 8000;

/**
 * Liga o cancelamento de ruído Krisp por padrão, sem depender do menu de
 * configurações. Três guardas que faltavam:
 * - o SDK Krisp é licenciado para o LiveKit Cloud; em servidor próprio não
 *   ativa (e antes tentava mesmo assim, em todo ingresso);
 * - só depois de conectado e com um atraso — carregar 6 MB no mesmo instante
 *   em que o WebRTC negocia e a câmera sobe disputava CPU/banda em máquinas
 *   fracas e redes ruins;
 * - máquina fraca fica sem (o filtro custa CPU e atrapalharia mais que ajudaria).
 * NEXT_PUBLIC_NOISE_FILTER=off desliga; =force ignora a checagem de edição.
 */
export function NoiseFilterBoot() {
  const room = useRoomContext();
  const { setNoiseFilterEnabled } = useKrispNoiseFilter({ filterOptions: KRISP_FILTER_OPTIONS });

  React.useEffect(() => {
    const mode = process.env.NEXT_PUBLIC_NOISE_FILTER ?? 'auto';
    if (mode === 'off' || isLowPowerDevice()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const edition = room.serverInfo?.edition;
      if (mode !== 'force' && edition !== EDITION_CLOUD) {
        console.info('Krisp desligado: servidor LiveKit não é Cloud (edition=%s)', edition);
        return;
      }
      timer = setTimeout(() => setNoiseFilterEnabled(true), KRISP_DELAY_MS);
    };
    if (room.state === ConnectionState.Connected) arm();
    room.on(RoomEvent.Connected, arm);
    return () => {
      room.off(RoomEvent.Connected, arm);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  return null;
}
