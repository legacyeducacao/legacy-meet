'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { generateRoomId } from '@/lib/client-utils';
import styles from '../styles/Home.module.css';

export default function Page() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [record, setRecord] = useState(true);
  const [transcribe, setTranscribe] = useState(true);

  // Transcrição depende da gravação (transcrevemos o arquivo gravado).
  const onRecordChange = (checked: boolean) => {
    setRecord(checked);
    if (!checked) setTranscribe(false);
  };
  const onTranscribeChange = (checked: boolean) => {
    setTranscribe(checked);
    if (checked) setRecord(true);
  };

  const createMeeting = (event: React.FormEvent) => {
    event.preventDefault();
    const roomId = generateRoomId();
    const params = new URLSearchParams();
    if (name.trim()) params.set('name', name.trim());
    params.set('rec', record ? '1' : '0');
    params.set('tx', transcribe ? '1' : '0');
    router.push(`/rooms/${roomId}?${params.toString()}`);
  };

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
          <p className={styles.formSubtitle}>Crie uma reunião da Legacy.</p>

          <form className={styles.tabContent} onSubmit={createMeeting}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="host-name">
                Seu nome
              </label>
              <input
                id="host-name"
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Digite seu nome"
                autoComplete="name"
                required
              />
            </div>

            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={record}
                onChange={(e) => onRecordChange(e.target.checked)}
              />
              <span>Gravar reunião</span>
            </label>

            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={transcribe}
                onChange={(e) => onTranscribeChange(e.target.checked)}
              />
              <span>Transcrever reunião</span>
            </label>

            <button className={styles.primaryButton} type="submit">
              Criar reunião
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
