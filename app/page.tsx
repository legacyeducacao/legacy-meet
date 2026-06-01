'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense } from 'react';
import { generateRoomId } from '@/lib/client-utils';
import { MeetingType, MEETING_TYPES, roomNameWithType } from '@/lib/meeting-types';
import styles from '../styles/Home.module.css';

const TAB_CONTENT: Record<MeetingType, { label: string; description: string }> = {
  comercial: {
    label: 'Comercial',
    description: 'Inicie uma reunião comercial da Legacy. A gravação começa automaticamente.',
  },
  executoria: {
    label: 'Executoria',
    description: 'Inicie uma reunião de executoria da Legacy. A gravação começa automaticamente.',
  },
};

function Tabs(props: React.PropsWithChildren<{}>) {
  const searchParams = useSearchParams();
  const activeTab = searchParams?.get('tab') as MeetingType | null;
  const tabIndex = activeTab ? MEETING_TYPES.indexOf(activeTab) : 0;
  const safeIndex = tabIndex >= 0 ? tabIndex : 0;

  const router = useRouter();
  function onTabSelected(index: number) {
    router.push(`/?tab=${MEETING_TYPES[index]}`);
  }

  const tabs = React.Children.map(props.children, (child, index) => {
    return (
      <button
        onClick={() => onTabSelected(index)}
        aria-pressed={safeIndex === index}
      >
        {/* @ts-ignore */}
        {child?.props.label}
      </button>
    );
  });

  return (
    <div className={styles.tabContainer}>
      <div className={styles.tabSelect}>{tabs}</div>
      {/* @ts-ignore */}
      {props.children[safeIndex]}
    </div>
  );
}

function MeetingTab(props: { label: string; type: MeetingType; description: string }) {
  const router = useRouter();
  const startMeeting = () => {
    const roomName = roomNameWithType(props.type, generateRoomId());
    router.push(`/rooms/${roomName}`);
  };
  return (
    <div className={styles.tabContent}>
      <p className={styles.lead}>{props.description}</p>
      <button className={styles.primaryButton} onClick={startMeeting}>
        Iniciar reunião
      </button>
    </div>
  );
}

export default function Page() {
  return (
    <main className={styles.container}>
      <section className={styles.brandPanel} aria-label="Legacy Meet">
        <p className={styles.brandCopyright}>
          Copyright 2026 Legacy Educação | Todos os direitos reservados
        </p>
      </section>
      <section className={styles.formPanel}>
        <div className={styles.formInner}>
          <h1 className={styles.formTitle}>Seja bem-vindo!</h1>
          <p className={styles.formSubtitle}>Escolha o tipo de reunião da Legacy.</p>
          <Suspense fallback="Carregando">
            <Tabs>
              <MeetingTab
                label={TAB_CONTENT.comercial.label}
                type="comercial"
                description={TAB_CONTENT.comercial.description}
              />
              <MeetingTab
                label={TAB_CONTENT.executoria.label}
                type="executoria"
                description={TAB_CONTENT.executoria.description}
              />
            </Tabs>
          </Suspense>
        </div>
      </section>
    </main>
  );
}
