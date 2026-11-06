'use client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * "Reunião de onboarding" (Executoria), logo abaixo de Gravar/Transcrever na
 * criação e na edição da reunião. Onboarding não vai para o ExecScore.
 */
export function OnboardingSwitch({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="cursor-pointer font-normal">
        Reunião de onboarding
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
