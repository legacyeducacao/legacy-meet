import { afterEach, describe, expect, it, vi } from 'vitest';
import { driveFindFileInFolder, driveFindOrCreateFolder } from './drive';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('driveFindOrCreateFolder', () => {
  it('reusa a pasta existente sem criar', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ files: [{ id: 'F1' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await driveFindOrCreateFolder('tok', 'Pasta X', 'PARENT', 5000);
    expect(id).toBe('F1');
    expect(fetchMock).toHaveBeenCalledTimes(1); // só o list, sem POST de criação
  });

  it('cria quando não existe', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ files: [] })) // list vazio
      .mockResolvedValueOnce(jsonResponse({ id: 'F2' })); // create
    vi.stubGlobal('fetch', fetchMock);
    const id = await driveFindOrCreateFolder('tok', 'Nova', 'PARENT', 5000);
    expect(id).toBe('F2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('escapa aspas simples no nome da query', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ files: [{ id: 'F3' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await driveFindOrCreateFolder('tok', "O'Brien", 'PARENT', 5000);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(calledUrl)).toContain("name='O\\'Brien'");
  });

  it('lança erro em resposta não-OK da busca, sem criar pasta duplicada', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(driveFindOrCreateFolder('tok', 'Pasta X', 'PARENT', 5000)).rejects.toThrow(
      /drive_find_folder_failed 429/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1); // não chamou create
  });
});

describe('driveFindFileInFolder', () => {
  it('retorna o id quando o arquivo existe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ files: [{ id: 'V1' }] })));
    expect(await driveFindFileInFolder('tok', 'a.mp4', 'F1', 5000)).toBe('V1');
  });

  it('retorna null quando não existe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ files: [] })));
    expect(await driveFindFileInFolder('tok', 'a.mp4', 'F1', 5000)).toBeNull();
  });

  it('lança erro em resposta não-OK da busca (401), em vez de re-upload silencioso', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('unauthorized', { status: 401 })));
    await expect(driveFindFileInFolder('tok', 'a.mp4', 'F1', 5000)).rejects.toThrow(/drive_find_file_failed 401/);
  });

  it('lança erro em resposta não-OK da busca (429)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('rate limited', { status: 429 })));
    await expect(driveFindFileInFolder('tok', 'a.mp4', 'F1', 5000)).rejects.toThrow(/drive_find_file_failed 429/);
  });
});
