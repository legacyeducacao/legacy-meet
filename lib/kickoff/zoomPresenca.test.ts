// Presença pelo Zoom (E3): regras puras de associação execução -> sessão e
// participante -> empresa. Sem banco e sem rede.
import { describe, expect, it } from 'vitest';
import { apurarPresenca, duracaoDaUniao, subtrair, type ContextoDaPresenca, type ExecucaoLida } from './zoomPresenca';
import type { ZoomReportParticipant } from '@/lib/zoom/api';

const SALA = '81243037829';
const T = (hm: string, dia = '2026-11-16') => `${dia}T${hm}:00Z`;
const ms = (iso: string) => Date.parse(iso);

// Duas sessões vizinhas no mesmo dia (UTC): A 14:00–15:00 e B 15:00–16:00.
const A = { id: 'A', inicio: T('14:00'), fim: T('15:00') };
const B = { id: 'B', inicio: T('15:00'), fim: T('16:00') };

const PADARIA = 'aaaaaaaa-0000-4000-8000-000000000001';
const OFICINA = 'bbbbbbbb-0000-4000-8000-000000000001';

function contexto(sessao = A, outras = [B]): ContextoDaPresenca {
  return {
    sessao,
    outras,
    salas: [SALA],
    inscricoes: [
      { zoom_meeting_id: SALA, registrant_id: 'reg-padaria', email: 'maria@padaria.com', tenant_id: PADARIA, empresa: 'Padaria' },
      { zoom_meeting_id: SALA, registrant_id: 'reg-oficina', email: 'joao@oficina.com', tenant_id: OFICINA, empresa: 'Oficina' },
    ],
    reservas: [{ reserva_id: 'r1', tenant_id: PADARIA, email: 'maria@padaria.com', empresa: 'Padaria', status: 'ativa', presenca: null }],
  };
}

const entrada = (p: Partial<ZoomReportParticipant> & { join_time: string; leave_time: string }): ZoomReportParticipant => ({ status: 'in_meeting', ...p });
const execucao = (uuid: string, inicio: string, fim: string | null, participantes: ZoomReportParticipant[]): ExecucaoLida => ({
  zoom_meeting_id: SALA,
  uuid,
  inicio,
  fim,
  relatorio: fim ? 'ok' : 'indisponivel',
  emailDoAnfitriao: 'equipe@legacy.com',
  participantes,
});
const DEPOIS = ms(T('20:00'));

describe('associação execução do Zoom -> sessão', () => {
  it('reunião aberta antes e que termina depois do horário entra na sessão; execução de outro dia não', () => {
    const a = apurarPresenca(
      contexto(A, []),
      [
        execucao('cedo-e-longa', T('13:35'), T('15:20'), []),
        execucao('outro-dia', T('14:00', '2026-11-09'), T('15:00', '2026-11-09'), []),
        execucao('terminou-antes-da-janela', T('12:00'), T('13:20'), []),
      ],
      DEPOIS,
    );
    expect(a.execucoes.map((e) => e.zoom_uuid)).toEqual(['cedo-e-longa']);
    expect(a.incompleta).toBe(false);
  });

  it('a execução que cruza as janelas de duas sessões vizinhas é marcada como compartilhada', () => {
    const a = apurarPresenca(contexto(), [execucao('x', T('13:50'), T('16:10'), [])], DEPOIS);
    expect(a.execucoes[0].compartilhada).toBe(true);
  });

  it('sem fim de sessão ainda, ou relatório indisponível: a apuração é incompleta', () => {
    expect(apurarPresenca(contexto(A, []), [], ms(T('14:40'))).incompleta).toBe(true);
    expect(apurarPresenca(contexto(A, []), [execucao('sem-relatorio', T('13:58'), null, [])], DEPOIS).incompleta).toBe(true);
  });
});

describe('participante -> empresa', () => {
  it('reconhece pelo registrant_id; reconexões somam entradas e o tempo não conta duas vezes', () => {
    const a = apurarPresenca(
      contexto(A, []),
      [
        execucao('e1', T('13:55'), T('15:05'), [
          entrada({ registrant_id: 'reg-padaria', name: 'Maria | Padaria #AAAAAAAA', join_time: T('14:02'), leave_time: T('14:20') }),
          entrada({ registrant_id: 'reg-padaria', name: 'Maria | Padaria #AAAAAAAA', join_time: T('14:18'), leave_time: T('14:50') }),
          // A própria conta da Legacy (anfitrião) não conta.
          entrada({ user_email: 'equipe@legacy.com', name: 'Legacy Executoria', join_time: T('13:55'), leave_time: T('15:05') }),
          // Sala de espera não é participação.
          entrada({ registrant_id: 'reg-oficina', status: 'in_waiting_room', join_time: T('14:10'), leave_time: T('14:12') }),
        ]),
      ],
      DEPOIS,
    );
    expect(a.empresas).toHaveLength(1);
    expect(a.empresas[0]).toMatchObject({ tenant_id: PADARIA, evidencia: 'registrante', exclusiva: true, entradas: 2, duracao_s: 48 * 60, registrantes: ['reg-padaria'] });
    expect(a.naoIdentificados).toEqual([]);
  });

  it('sem registrant_id, o e-mail da inscrição ou da reserva reconhece a empresa', () => {
    const a = apurarPresenca(
      contexto(A, []),
      [execucao('e1', T('13:55'), T('15:05'), [entrada({ user_email: 'MARIA@padaria.com', join_time: T('14:05'), leave_time: T('14:30') })])],
      DEPOIS,
    );
    expect(a.empresas[0]).toMatchObject({ tenant_id: PADARIA, evidencia: 'email' });
  });

  it('nome com o #CÓDIGO, sem inscrição nem e-mail que confirme, NÃO vira presença: só pista em "não identificados"', () => {
    const a = apurarPresenca(
      contexto(A, []),
      [execucao('e1', T('13:55'), T('15:05'), [entrada({ name: 'Maria | Padaria #AAAAAAAA', user_email: 'outra@gmail.com', join_time: T('14:05'), leave_time: T('14:30') })])],
      DEPOIS,
    );
    expect(a.empresas).toEqual([]);
    expect(a.naoIdentificados).toEqual([{ nome: 'Maria | Padaria #AAAAAAAA', sugestao: 'Padaria' }]);
  });

  it('o mesmo registrant_id em OUTRA sala não reconhece a empresa', () => {
    const a = apurarPresenca(
      contexto(A, []),
      [{ ...execucao('e1', T('13:55'), T('15:05'), [entrada({ registrant_id: 'reg-padaria', join_time: T('14:05'), leave_time: T('14:30') })]), zoom_meeting_id: '89999999999' }],
      DEPOIS,
    );
    expect(a.empresas).toEqual([]);
  });
});

describe('sem falso positivo entre sessões', () => {
  it('entrada no horário da sessão B não conta para a sessão A', () => {
    const exec = [execucao('tarde', T('14:55'), T('16:05'), [entrada({ registrant_id: 'reg-padaria', join_time: T('15:40'), leave_time: T('16:00') })])];
    expect(apurarPresenca(contexto(A, [B]), exec, DEPOIS).empresas).toEqual([]);
  });

  it('entrada só no trecho em que as janelas de A e B se sobrepõem é ambígua (vai para conferência)', () => {
    // Janela de A até 15:30; janela de B desde 14:30. Entrada 14:40–15:20: só no trecho comum.
    const exec = [execucao('x', T('13:55'), T('16:05'), [entrada({ registrant_id: 'reg-padaria', join_time: T('14:40'), leave_time: T('15:20') })])];
    const a = apurarPresenca(contexto(A, [B]), exec, DEPOIS);
    expect(a.empresas[0]).toMatchObject({ tenant_id: PADARIA, exclusiva: false });
  });

  it('entrada que passa por um trecho só de A é evidência de A', () => {
    const exec = [execucao('x', T('13:55'), T('16:05'), [entrada({ registrant_id: 'reg-padaria', join_time: T('14:10'), leave_time: T('15:20') })])];
    expect(apurarPresenca(contexto(A, [B]), exec, DEPOIS).empresas[0].exclusiva).toBe(true);
  });
});

describe('intervalos', () => {
  it('subtrair e união', () => {
    expect(subtrair({ inicio: 0, fim: 10 }, [{ inicio: 3, fim: 5 }, { inicio: 8, fim: 20 }])).toEqual([
      { inicio: 0, fim: 3 },
      { inicio: 5, fim: 8 },
    ]);
    expect(duracaoDaUniao([{ inicio: 0, fim: 5 }, { inicio: 3, fim: 8 }, { inicio: 10, fim: 12 }])).toBe(10);
  });
});
