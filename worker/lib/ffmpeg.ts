import { spawn } from 'node:child_process';

// --------------------------- ffmpeg helpers ---------------------------
export function runProcess(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${cmd} saiu com código ${code}: ${stderr.slice(0, 500)}`)),
    );
  });
}

// Como runProcess, mas resolve stdout+stderr (o ffmpeg loga o silencedetect no stderr).
export function runProcessAll(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(`${stdout}\n${stderr}`)
        : reject(new Error(`${cmd} saiu com código ${code}: ${stderr.slice(0, 500)}`)),
    );
  });
}

// Áudio mono 16 kHz, mp3 64 kbps: suficiente para ASR e pequeno para enviar.
export async function extractAudio(videoPath: string, audioPath: string) {
  await runProcess('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', videoPath,
    '-vn', '-ac', '1', '-ar', '16000',
    '-c:a', 'libmp3lame', '-b:a', '64k',
    audioPath,
  ]);
}

// Duração em segundos (ffprobe aceita tanto o mp3 extraído quanto o mp4).
export async function getAudioDuration(mediaPath: string): Promise<number> {
  const out = await runProcess('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    mediaPath,
  ]);
  return parseFloat(out.trim());
}
