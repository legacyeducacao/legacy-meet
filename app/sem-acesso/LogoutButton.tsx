'use client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { sairDoHub } from '@/lib/legacyHub';

export function LogoutButton() {
  const router = useRouter();
  const sair = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      await sairDoHub();
    } catch {}
    router.push('/login');
    router.refresh();
  };
  return (
    <Button variant="outline" onClick={sair}>
      Sair
    </Button>
  );
}
