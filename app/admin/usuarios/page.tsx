import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import UsuariosClient from './UsuariosClient';

export default async function AdminUsuariosPage() {
  const me = await getCurrentUser();
  if (me?.role !== 'MASTER') notFound();

  return <UsuariosClient />;
}
