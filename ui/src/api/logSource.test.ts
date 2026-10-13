import { describe, expect, it, vi } from 'vitest';
import { fileSource } from './logSource';

/** A File the browser no longer reads because its file grew on disk. */
function stale(text: string): File {
  const file = new File([text], 'WoWCombatLog-100726_185823.txt');
  vi.spyOn(file, 'slice').mockReturnValue({
    arrayBuffer: () => Promise.reject(new DOMException('changed', 'NotReadableError')),
  } as unknown as Blob);
  return file;
}

describe('fileSource', () => {
  it('reads a log that grew on disk through a fresh file from its handle', async () => {
    const grown = new File(['line one\nline two\n'], 'WoWCombatLog-100726_185823.txt');
    const handle = { getFile: vi.fn().mockResolvedValue(grown) } as unknown as FileSystemFileHandle;
    const source = fileSource(stale('line one\n'), handle);
    expect(new TextDecoder().decode(await source.read(0, 8))).toBe('line one');
    expect(handle.getFile).toHaveBeenCalledTimes(1);
    expect(source.size).toBe(9);
  });

  it('asks to open the log again when there is no handle to read it through', async () => {
    await expect(fileSource(stale('line one\n')).read(0, 8)).rejects.toBe('The log changed on disk since it was opened. Open it again to read it.');
  });
});
