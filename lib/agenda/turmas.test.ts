import { describe, expect, it } from 'vitest';
import { linkDaAula, rotuloModalidade, sessaoParaEvento, type LinhaSessaoTurma } from './turmas';
import { CALENDARIOS } from './tipos';

const linha = (extra: Partial<LinhaSessaoTurma> = {}): LinhaSessaoTurma => ({
  id: '79d54b8d-f1fb-45c1-adbc-250142639e0e',
  scheduled_start_at: '2026-11-12T12:00:00+00:00',
  scheduled_end_at: '2026-11-12T15:00:00+00:00',
  title: 'Encontro 4: Checagem do Combustível Parte II',
  modality: 'online',
  location: null,
  meeting_url: 'https://us06web.zoom.us/j/83851327460',
  zoom_meeting_id: null,
  cohort_schedules: { cohort_name: 'Turma 20' },
  ...extra,
});

describe('turmas do Legado', () => {
  it('converte a sessão em evento só leitura do calendário turmas', () => {
    expect(sessaoParaEvento(linha())).toEqual({
      id: 'turma:79d54b8d-f1fb-45c1-adbc-250142639e0e',
      tipo: 'turma',
      titulo: 'Encontro 4: Checagem do Combustível Parte II',
      inicio: '2026-11-12T12:00:00.000Z',
      fim: '2026-11-12T15:00:00.000Z',
      calendario: 'turmas',
      executorId: '',
      turma: 'Turma 20',
      modalidade: 'online',
      local: null,
      link: 'https://us06web.zoom.us/j/83851327460',
      podeEditar: false,
    });
  });

  it('título vazio vira "Encontro da turma"; turma embutida como lista também serve', () => {
    const ev = sessaoParaEvento(linha({ title: '  ', cohort_schedules: [{ cohort_name: 'Turma 19' }] }));
    expect(ev.titulo).toBe('Encontro da turma');
    expect(ev.turma).toBe('Turma 19');
    expect(sessaoParaEvento(linha({ title: null, cohort_schedules: null })).turma).toBeNull();
  });

  it('fim ausente ou não posterior ao início vira início + 60 min', () => {
    expect(sessaoParaEvento(linha({ scheduled_end_at: null })).fim).toBe('2026-11-12T13:00:00.000Z');
    expect(sessaoParaEvento(linha({ scheduled_end_at: '2026-11-12T12:00:00+00:00' })).fim).toBe('2026-11-12T13:00:00.000Z');
    expect(sessaoParaEvento(linha({ scheduled_end_at: '2026-11-12T11:00:00+00:00' })).fim).toBe('2026-11-12T13:00:00.000Z');
  });

  it('presencial leva o local; sem link quando não há URL nem ID do Zoom', () => {
    const ev = sessaoParaEvento(linha({ modality: 'in_person', location: ' Auditório Legacy ', meeting_url: null }));
    expect(ev.local).toBe('Auditório Legacy');
    expect(ev.link).toBeNull();
    expect(rotuloModalidade(ev.modalidade)).toBe('Presencial');
  });

  it('link da aula: URL quando existe, senão o link do Zoom pelo ID', () => {
    expect(linkDaAula('https://zoom.us/j/1', '999')).toBe('https://zoom.us/j/1');
    expect(linkDaAula(null, '895 6184 9516')).toBe('https://zoom.us/j/89561849516');
    expect(linkDaAula('javascript:alert(1)', null)).toBeNull();
    expect(linkDaAula('', '')).toBeNull();
  });

  it('modalidade conhecida ganha nome; desconhecida passa legível', () => {
    expect(rotuloModalidade('online')).toBe('Online');
    expect(rotuloModalidade('hybrid')).toBe('Híbrida');
    expect(rotuloModalidade('ao_vivo')).toBe('Ao vivo');
    expect(rotuloModalidade(null)).toBeNull();
  });

  it('calendário "Turmas do Legado" fica antes de bloqueios', () => {
    const ids = CALENDARIOS.map((c) => c.id);
    expect(CALENDARIOS.find((c) => c.id === 'turmas')).toEqual({ id: 'turmas', nome: 'Turmas do Legado', cor: '#d97706' });
    expect(ids.indexOf('turmas')).toBe(ids.indexOf('bloqueios') - 1);
  });
});
