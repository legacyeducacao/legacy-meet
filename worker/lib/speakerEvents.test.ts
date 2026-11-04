import { describe, expect, it } from 'vitest';
import {
  mapFromVoiceActivity,
  mergeSpeakerMaps,
  parseSpeakerEvents,
  type SpeakerEvent,
} from './speakerEvents';
import { genericSpeakerName } from './utterances';
import type { Utterance } from './text';

const T0 = 1_700_000_000_000; // início da gravação (ms de época)

const utt = (speaker: string, start: number, end: number): Utterance => ({
  speaker,
  start,
  end,
  text: 'x',
});

const ev = (name: string, start: number, end: number): SpeakerEvent => ({
  name,
  start: T0 + start * 1000,
  end: T0 + end * 1000,
});

describe('parseSpeakerEvents', () => {
  it('aceita {events: [...]} e lista direta, descartando lixo', () => {
    const good = { name: 'Ana', start: 1, end: 2 };
    expect(parseSpeakerEvents({ events: [good] })).toEqual([good]);
    expect(parseSpeakerEvents([good])).toEqual([good]);
    expect(
      parseSpeakerEvents({
        events: [good, { name: '', start: 1, end: 2 }, { name: 'B', start: 5, end: 5 }, null, 'x'],
      }),
    ).toEqual([good]);
    expect(parseSpeakerEvents(null)).toEqual([]);
    expect(parseSpeakerEvents('nada')).toEqual([]);
  });
});

describe('mapFromVoiceActivity', () => {
  it('atribui cada rótulo ao nome com maior sobreposição de fala', () => {
    // Executor (Matheus) fala nos trechos de B; cliente (Tony) nos de A —
    // o caso real em que o LLM invertia os dois.
    const utts = [utt('A', 0, 10), utt('B', 10, 25), utt('A', 25, 40), utt('B', 40, 60)];
    const events = [ev('Tony', 0, 10), ev('Matheus Parolini', 10, 25), ev('Tony', 25, 40), ev('Matheus Parolini', 40, 60)];
    const { map } = mapFromVoiceActivity(utts, events, T0, ['Matheus Parolini', 'Tony']);
    expect(map).toEqual({ A: 'Tony', B: 'Matheus Parolini' });
  });

  it('tolera defasagem de relógio/detecção dentro do pad', () => {
    const utts = [utt('A', 10, 30)];
    // Evento deslocado 1s (detecção do ActiveSpeakers atrasa alguns ms~s).
    const events = [ev('Ana', 11, 31)];
    const { map } = mapFromVoiceActivity(utts, events, T0, ['Ana']);
    expect(map).toEqual({ A: 'Ana' });
  });

  it('não decide com pouca evidência (abaixo de minSeconds)', () => {
    const utts = [utt('A', 0, 3)];
    const events = [ev('Ana', 0, 3)];
    const { map } = mapFromVoiceActivity(utts, events, T0, ['Ana'], { minSeconds: 5 });
    expect(map).toEqual({});
  });

  it('não decide quando dois nomes disputam o mesmo rótulo (fala sobreposta)', () => {
    // Ana e Beto falando juntos durante quase todo o trecho de A.
    const utts = [utt('A', 0, 20)];
    const events = [ev('Ana', 0, 20), ev('Beto', 1, 19)];
    const { map } = mapFromVoiceActivity(utts, events, T0, ['Ana', 'Beto'], { padMs: 0 });
    expect(map).toEqual({});
  });

  it('decide quando o vencedor domina apesar de ruído do outro', () => {
    const utts = [utt('A', 0, 60)];
    const events = [ev('Ana', 0, 55), ev('Beto', 55, 60)];
    const { map } = mapFromVoiceActivity(utts, events, T0, ['Ana', 'Beto'], { padMs: 0 });
    expect(map).toEqual({ A: 'Ana' });
  });

  it('canonicaliza o nome do evento para a grafia da lista de participantes', () => {
    const utts = [utt('A', 0, 30)];
    const events = [ev('mariza', 0, 30)];
    const { map } = mapFromVoiceActivity(utts, events, T0, ['MARIZA']);
    expect(map).toEqual({ A: 'MARIZA' });
  });

  it('mantém o nome do evento quando não está na lista (fonte é o PreJoin)', () => {
    const utts = [utt('A', 0, 30)];
    const events = [ev('Visitante X', 0, 30)];
    const { map } = mapFromVoiceActivity(utts, events, T0, ['Ana']);
    expect(map).toEqual({ A: 'Visitante X' });
  });

  it('permite o mesmo nome em dois rótulos (diarização dividiu uma voz)', () => {
    const utts = [utt('A', 0, 30), utt('B', 30, 60)];
    const events = [ev('Ana', 0, 60)];
    const { map } = mapFromVoiceActivity(utts, events, T0, ['Ana'], { padMs: 0 });
    expect(map).toEqual({ A: 'Ana', B: 'Ana' });
  });

  it('caso Atual Center (04/11): o microfone do anfitrião capta a cliente — cada nome fica com uma voz só', () => {
    // A = Celso (fala muito); B = Rosimere, mas o LiveKit marcou o Celso como
    // ativo durante a maior parte das falas dela (eco / microfone baixo).
    const utts = [utt('A', 0, 100), utt('B', 100, 140), utt('A', 140, 240), utt('B', 240, 290)];
    const events = [
      ev('Celso Bento', 0, 100),
      ev('Celso Bento', 100, 130), // "eco" durante a fala da Rosimere
      ev('Rosimere', 130, 140),
      ev('Celso Bento', 140, 240),
      ev('Celso Bento', 240, 275),
      ev('Rosimere', 275, 290),
      ev('Flavio Guerrico', 289, 290),
    ];
    const { map } = mapFromVoiceActivity(utts, events, T0, ['Celso Bento', 'Flavio Guerrico', 'Rosimere'], {
      padMs: 0,
    });
    expect(map).toEqual({ A: 'Celso Bento', B: 'Rosimere' });
  });

  it('sem nome que sobre com evidência clara, a voz fica sem nome (vai para a reserva)', () => {
    const utts = [utt('A', 0, 100), utt('B', 100, 140)];
    const events = [ev('Ana', 0, 140), ev('Beto', 120, 122)];
    const { map } = mapFromVoiceActivity(utts, events, T0, ['Ana', 'Beto', 'Caio'], { padMs: 0 });
    // Beto tem só 2s em B: abaixo do mínimo, não decide.
    expect(map).toEqual({ A: 'Ana' });
  });

  it('ignora eventos fora da janela da gravação (sessão antiga na mesma sala)', () => {
    const utts = [utt('A', 0, 30)];
    const events = [
      { name: 'Velho', start: T0 - 3_600_000, end: T0 - 3_590_000 },
      ev('Ana', 0, 30),
    ];
    const { map } = mapFromVoiceActivity(utts, events, T0, ['Ana', 'Velho']);
    expect(map).toEqual({ A: 'Ana' });
  });
});

describe('mergeSpeakerMaps', () => {
  it('a atividade de voz vence o LLM no mesmo rótulo', () => {
    const merged = mergeSpeakerMaps({ A: 'Tony' }, { A: 'Matheus', B: 'Tony' }, genericSpeakerName);
    // B dizia "Tony" no LLM, mas a medição provou que Tony é A → B cai para genérico.
    expect(merged).toEqual({ A: 'Tony', B: genericSpeakerName('B') });
  });

  it('rótulos sem medição ficam com o LLM', () => {
    const merged = mergeSpeakerMaps({ A: 'Ana' }, { A: 'Beto', B: 'Caio' }, genericSpeakerName);
    expect(merged).toEqual({ A: 'Ana', B: 'Caio' });
  });

  it('sem medição nenhuma, devolve o mapa do LLM intacto', () => {
    const llm = { A: 'Ana', B: 'Beto' };
    expect(mergeSpeakerMaps({}, llm, genericSpeakerName)).toEqual(llm);
  });
});
