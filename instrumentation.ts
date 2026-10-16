// Roda uma vez quando o servidor Next sobe. Só no runtime Node: o watchdog usa
// o SDK do LiveKit e o S3, indisponíveis no edge (middleware). O import fica
// DENTRO do if — é assim que o build do edge descarta o módulo.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startRecordingWatchdog } = await import('./lib/recordingWatchdog');
    startRecordingWatchdog();
  }
}
