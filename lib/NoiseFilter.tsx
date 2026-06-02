'use client';

import * as React from 'react';
import { useKrispNoiseFilter } from '@livekit/components-react/krisp';
import { isLowPowerDevice } from './client-utils';

/**
 * Ativa automaticamente o cancelamento de ruído (Krisp) no microfone local
 * de cada participante ao entrar na chamada. Renderize uma vez dentro do
 * RoomContext. Dispositivos de baixo desempenho ficam de fora (custo de CPU).
 */
export function NoiseFilter() {
  const { setNoiseFilterEnabled } = useKrispNoiseFilter();

  React.useEffect(() => {
    if (!isLowPowerDevice()) {
      void setNoiseFilterEnabled(true);
    }
  }, [setNoiseFilterEnabled]);

  return null;
}
