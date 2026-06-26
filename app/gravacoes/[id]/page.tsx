import Link from 'next/link';
import { getManifest, canAccessRecording } from '@/lib/recordings';
import { getCurrentUser } from '@/lib/auth';
import { RecordingDetail } from './RecordingDetail';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function Page(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Isolamento por usuário: EXECUTOR só vê as suas; MASTER vê todas. Sem dono
  // ou de outro executor → trata como "não encontrada" (não revela conteúdo).
  const user = await getCurrentUser();
  const manifest = (await canAccessRecording(id, user)) ? await getManifest(id) : null;

  if (!manifest) {
    return (
      <AppShell>
        <div className="space-y-4">
          <Link
            href="/gravacoes"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para Gravações
          </Link>
          <Card className="rounded-xl">
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Gravação não encontrada ou sem permissão de acesso.
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  return <RecordingDetail manifest={manifest} />;
}
