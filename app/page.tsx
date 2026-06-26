'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import styles from '../styles/Home.module.css';

type Client = { id: string; name: string };

export default function Page() {
  const router = useRouter();
  const [sector, setSector] = useState<'comercial' | 'executoria'>('executoria');
  const [prospectName, setProspectName] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [record, setRecord] = useState(true);
  const [transcribe, setTranscribe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Transcrição depende da gravação (transcrevemos o arquivo gravado).
  const onRecordChange = (checked: boolean) => {
    setRecord(checked);
    if (!checked) setTranscribe(false);
  };
  const onTranscribeChange = (checked: boolean) => {
    setTranscribe(checked);
    if (checked) setRecord(true);
  };

  // Carrega clientes quando o setor é executoria
  useEffect(() => {
    if (sector !== 'executoria') return;
    fetch('/api/clients')
      .then((r) => r.json())
      .then((json) => {
        const list: Client[] = json.clients ?? [];
        setClients(list);
        setTenantId(list[0]?.id ?? '');
      })
      .catch(() => setClients([]));
  }, [sector]);

  const createMeeting = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);

    const body: Record<string, unknown> = {
      sector,
      record,
      transcribe,
    };
    if (sector === 'comercial') {
      if (prospectName.trim()) body.title = prospectName.trim();
    } else {
      if (!tenantId) {
        setError('Selecione um cliente para a reunião de Executoria.');
        setBusy(false);
        return;
      }
      body.tenantId = tenantId;
    }

    try {
      const res = await fetch('/api/meetings/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        setError(text || 'Erro ao criar reunião.');
        setBusy(false);
        return;
      }
      const { roomName } = await res.json();
      const params = new URLSearchParams();
      params.set('rec', record ? '1' : '0');
      params.set('tx', transcribe ? '1' : '0');
      router.push(`/rooms/${roomName}?${params.toString()}`);
    } catch {
      setError('Erro de rede ao criar reunião.');
      setBusy(false);
    }
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
              <label className={styles.fieldLabel} htmlFor="sector">
                Setor
              </label>
              <select
                id="sector"
                className={styles.input}
                value={sector}
                onChange={(e) => setSector(e.target.value as 'comercial' | 'executoria')}
              >
                <option value="executoria">Executoria</option>
                <option value="comercial">Comercial</option>
              </select>
            </div>

            {sector === 'executoria' && (
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="tenant">
                  Cliente
                </label>
                <select
                  id="tenant"
                  className={styles.input}
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  required
                >
                  {clients.length === 0 && <option value="">Carregando...</option>}
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {sector === 'comercial' && (
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="prospect-name">
                  Nome do prospect
                </label>
                <input
                  id="prospect-name"
                  className={styles.input}
                  value={prospectName}
                  onChange={(e) => setProspectName(e.target.value)}
                  placeholder="Ex: João Silva"
                />
              </div>
            )}

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

            {error && <p style={{ color: '#ff8a8a', marginTop: '0.5rem' }}>{error}</p>}

            <button className={styles.primaryButton} type="submit" disabled={busy}>
              {busy ? 'Criando...' : 'Criar reunião'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: '1.5rem' }}>
            <Link href="/gravacoes" style={{ color: '#275286', fontSize: '0.9rem' }}>
              Ver gravações e transcrições →
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
