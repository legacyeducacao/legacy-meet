'use client';

import * as React from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/custom-toast';
import { Button } from '@/components/ui/button';
import type { MeetingSummary } from '@/lib/meetingSummaryCore';

/** Baixa o resumo da reunião em PDF. */
export function BaixarPdfButton({ resumo, variant = 'ghost' }: { resumo: MeetingSummary; variant?: 'ghost' | 'outline' }) {
  const [gerando, setGerando] = React.useState(false);
  const baixar = async () => {
    setGerando(true);
    try {
      const { baixarResumoPdf } = await import('@/lib/resumoPdf');
      await baixarResumoPdf(resumo);
    } catch (e) {
      console.error('resumo: PDF', e);
      toast.error('Não foi possível gerar o PDF.');
    } finally {
      setGerando(false);
    }
  };
  return (
    <Button variant={variant} size="sm" type="button" onClick={() => void baixar()} disabled={gerando}>
      {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
      Baixar PDF
    </Button>
  );
}
