import { readFile } from 'node:fs/promises';
import { fetchWithTimeout } from './http';

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export async function getDriveAccessToken(cfg: DriveConfig, timeoutMs: number): Promise<string> {
  const resp = await fetchWithTimeout(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: 'refresh_token',
      }),
    },
    timeoutMs,
  );
  const data: any = await resp.json();
  if (!data.access_token) {
    throw new Error(`drive_auth_failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.access_token;
}

export async function driveCreateFolder(
  token: string,
  name: string,
  parentId: string | undefined,
  timeoutMs: number,
): Promise<string> {
  const metadata: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) metadata.parents = [parentId];
  const resp = await fetchWithTimeout(
    `${DRIVE_FILES_URL}?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    },
    timeoutMs,
  );
  if (!resp.ok) {
    throw new Error(`drive_folder_failed ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data: any = await resp.json();
  if (!data.id) throw new Error('drive_folder_no_id');
  return data.id;
}

// Busca por nome+pai; reusa se achar, senão cria. Sem parentId, cria direto
// (não dá pra desambiguar por pai). Elimina pastas duplicadas em reprocessos.
export async function driveFindOrCreateFolder(
  token: string,
  name: string,
  parentId: string | undefined,
  timeoutMs: number,
): Promise<string> {
  if (parentId) {
    const esc = name.replace(/'/g, "\\'");
    const q = `name='${esc}' and '${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
    const url =
      `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const resp = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, timeoutMs);
    if (!resp.ok) {
      throw new Error(`drive_find_folder_failed ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    }
    const data: any = await resp.json();
    if (data.files?.length) return data.files[0].id;
  }
  return driveCreateFolder(token, name, parentId, timeoutMs);
}

// Retorna o id do arquivo com esse nome na pasta, ou null. Evita re-upload.
export async function driveFindFileInFolder(
  token: string,
  name: string,
  folderId: string,
  timeoutMs: number,
): Promise<string | null> {
  const esc = name.replace(/'/g, "\\'");
  const q = `name='${esc}' and '${folderId}' in parents and trashed=false`;
  const url =
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const resp = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, timeoutMs);
  if (!resp.ok) {
    throw new Error(`drive_find_file_failed ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data: any = await resp.json();
  if (data.files?.length) return data.files[0].id;
  return null;
}

export async function driveUploadFile(
  token: string,
  filePath: string,
  name: string,
  mimeType: string,
  parentId: string | undefined,
  timeoutMs: number,
): Promise<string> {
  const metadata: Record<string, unknown> = { name };
  if (parentId) metadata.parents = [parentId];

  const initResp = await fetchWithTimeout(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify(metadata),
    },
    timeoutMs,
  );
  if (!initResp.ok) {
    throw new Error(`drive_init_failed ${initResp.status}: ${(await initResp.text()).slice(0, 300)}`);
  }
  const sessionUri = initResp.headers.get('location');
  if (!sessionUri) throw new Error('drive_init_no_session_uri');

  const fileBuffer = await readFile(filePath);
  const putResp = await fetchWithTimeout(
    sessionUri,
    {
      method: 'PUT',
      headers: { 'Content-Type': mimeType, 'Content-Length': String(fileBuffer.length) },
      body: fileBuffer,
    },
    timeoutMs,
  );
  if (!putResp.ok) {
    throw new Error(`drive_upload_failed ${putResp.status}: ${(await putResp.text()).slice(0, 300)}`);
  }
  const result: any = await putResp.json();
  if (!result.id) throw new Error(`drive_upload_no_id: ${JSON.stringify(result).slice(0, 300)}`);
  return result.id;
}
