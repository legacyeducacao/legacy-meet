import { requireStaff } from '@/lib/requireStaff';
import { canSeeNps } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { NpsClient } from './NpsClient';

export const dynamic = 'force-dynamic';

export default async function NpsPage() {
  const user = await requireStaff();
  if (!canSeeNps(user)) redirect('/');
  return <NpsClient isAdmin={user.isAdmin} />;
}
