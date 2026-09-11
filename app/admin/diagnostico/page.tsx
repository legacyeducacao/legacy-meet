import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import DiagnosticoClient from './DiagnosticoClient';

export const dynamic = 'force-dynamic';

export default async function DiagnosticoPage() {
  const me = await getCurrentUser();
  if (!me?.isAdmin) notFound();

  return <DiagnosticoClient />;
}
