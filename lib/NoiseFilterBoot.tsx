'use client';

import React from 'react';
import { useKrispNoiseFilter } from '@livekit/components-react/krisp';
import { isLowPowerDevice } from './client-utils';

/**
 * Liga o cancelamento de ruído Krisp por padrão, sem depender do menu de
 * configurações (que fica atrás da flag NEXT_PUBLIC_SHOW_SETTINGS_MENU — com a
 * flag desligada, ninguém tinha noise cancelling). Em máquinas fracas fica
 * desligado: o filtro custa CPU e atrapalharia mais do que ajudaria.
 */
export function NoiseFilterBoot() {
  const { setNoiseFilterEnabled } = useKrispNoiseFilter({
    filterOptions: {
      bufferOverflowMs: 100,
      bufferDropMs: 200,
      quality: 'medium',
      onBufferDrop: () => {
        console.warn('krisp buffer drop — o filtro se desativa sozinho nas versões >= 0.3.2');
      },
    },
  });

  React.useEffect(() => {
    if (!isLowPowerDevice()) setNoiseFilterEnabled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
