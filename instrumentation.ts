// Roda uma vez quando o servidor Next sobe. Só no runtime Node: o watchdog usa
// o SDK do LiveKit e o S3, indisponíveis no edge (middleware). O import fica
// DENTRO do if — é assim que o build do edge descarta o módulo.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startRecordingWatchdog } = await import('./lib/recordingWatchdog');
    startRecordingWatchdog();
    // Agenda nova: estende os encontros dos grupos do Impulsão até o horizonte
    // (a cada 6 h; a primeira 2 min depois de subir). AGENDA_EXTENSAO=0 desliga.
    if (process.env.AGENDA_EXTENSAO !== '0') {
      const { estenderGrupos } = await import('./lib/agenda/grupos');
      setTimeout(() => void estenderGrupos(), 2 * 60_000);
      setInterval(() => void estenderGrupos(), 6 * 60 * 60_000);
    }
  }
}
