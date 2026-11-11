'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AbaGrupos } from './AbaGrupos';
import { AbaDisponibilidade } from './AbaDisponibilidade';
import { AbaFeriados } from './AbaFeriados';
import { AbaRegras } from './AbaRegras';
import { AbaModelos } from './AbaModelos';
import { AbaMigracao } from './AbaMigracao';

const ABAS = [
  ['grupos', 'Grupos do Impulsão'],
  ['disponibilidade', 'Minha disponibilidade'],
  ['feriados', 'Feriados'],
  ['regras', 'Regras da empresa'],
  ['modelos', 'Modelos'],
  ['migracao', 'Migração'],
] as const;

export function Configuracoes({ me }: { me: { id: string; isAdmin: boolean } }) {
  const [aba, setAba] = React.useState<string>('grupos');
  React.useEffect(() => {
    const h = window.location.hash.slice(1);
    if (ABAS.some(([k]) => k === h)) setAba(h);
  }, []);
  return (
    <div className="space-y-4 pb-16">
      <Link href="/agenda" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar para a agenda
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Configurações da agenda</h1>
      <Tabs
        value={aba}
        onValueChange={(v) => {
          setAba(v);
          history.replaceState(null, '', `#${v}`);
        }}
      >
        <TabsList className="flex h-auto flex-wrap justify-start">
          {ABAS.filter(([k]) => k !== 'migracao' || me.isAdmin).map(([k, nome]) => (
            <TabsTrigger key={k} value={k}>
              {nome}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="grupos" className="pt-4">
          <AbaGrupos isAdmin={me.isAdmin} meId={me.id} />
        </TabsContent>
        <TabsContent value="disponibilidade" className="pt-4">
          <AbaDisponibilidade isAdmin={me.isAdmin} meId={me.id} />
        </TabsContent>
        <TabsContent value="feriados" className="pt-4">
          <AbaFeriados />
        </TabsContent>
        <TabsContent value="regras" className="pt-4">
          <AbaRegras />
        </TabsContent>
        <TabsContent value="modelos" className="pt-4">
          <AbaModelos />
        </TabsContent>
        {me.isAdmin && (
          <TabsContent value="migracao" className="pt-4">
            <AbaMigracao />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
