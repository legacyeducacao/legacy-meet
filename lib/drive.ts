/** Obtém um access token do Google Drive a partir do refresh token (OAuth). */
export async function getDriveAccessToken(): Promise<string> {
  const {
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REFRESH_TOKEN,
  } = process.env;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REFRESH_TOKEN) {
    throw new Error('Google OAuth não configurado (GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN)');
  }
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = (await resp.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Falha ao obter access token do Google Drive');
  }
  return data.access_token;
}
