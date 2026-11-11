import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Endereço antigo da agenda nova (antes de virar a única agenda). */
export default function Page() {
  redirect('/agenda/configuracoes');
}
