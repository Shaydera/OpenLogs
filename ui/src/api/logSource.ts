import { t } from '../i18n/i18n';

/** A combat log the engine reads in parts. */
export interface LogSource {
  /** Identifies the log across sessions: its file name. */
  id: string;
  name: string;
  /** Grows while the game appends and `refresh` follows it. */
  size: number;
  lastModified: number;
  /** Up to `length` bytes from `offset`, in a buffer of their own. */
  read(offset: number, length: number): Promise<Uint8Array>;
  /** The file's handle where the browser has them (Chromium), so the recent list can open it again. */
  handle?: FileSystemFileHandle;
  /** Takes the file's current state from its handle; whether it grew. */
  refresh?(): Promise<boolean>;
}

/** A log the user chose. Its file is only reached by `open`, which can still fail. */
export interface ChosenLog {
  name: string;
  open(): Promise<LogSource>;
}

const changedOnDisk = (err: unknown) => err instanceof DOMException && err.name === 'NotReadableError';

/**
 * WoW appends to the log while it records. Chromium refuses to read a `File` once its file
 * changed, so a read takes a fresh `File` from the handle; the log only grows, so the offsets
 * read so far stay valid.
 */
export function fileSource(file: File, handle?: FileSystemFileHandle): LogSource {
  let current = file;
  const slice = async (offset: number, length: number) =>
    new Uint8Array(await current.slice(offset, offset + length).arrayBuffer());
  const source: LogSource = {
    id: file.name,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    handle,
    read: async (offset, length) => {
      try {
        return await slice(offset, length);
      } catch (err) {
        if (!changedOnDisk(err)) throw err;
        if (!handle) throw t('error.changedOnDisk');
        current = await handle.getFile();
        return slice(offset, length);
      }
    },
  };
  if (handle) {
    source.refresh = async () => {
      const grownFrom = source.size;
      current = await handle.getFile();
      source.size = current.size;
      source.lastModified = current.lastModified;
      return source.size > grownFrom;
    };
  }
  return source;
}

export function chosenFile(file: File): ChosenLog {
  return { name: file.name, open: async () => fileSource(file) };
}

export function chosenHandle(handle: FileSystemFileHandle): ChosenLog {
  return { name: handle.name, open: async () => fileSource(await handle.getFile(), handle) };
}

/** Chromium's File System Access API; other browsers lack it and use a file input. */
interface FilePickerWindow {
  showOpenFilePicker?(options: {
    types: { description: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle[]>;
}

interface PermissionHandle {
  queryPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>;
}

export const fileMissing = (err: unknown) => err instanceof DOMException && err.name === 'NotFoundError';

/** Only a file the browser may read without asking can be checked; any other is not known to be gone. */
export async function fileGone(handle: FileSystemFileHandle): Promise<boolean> {
  try {
    const permission = await (handle as PermissionHandle).queryPermission?.({ mode: 'read' });
    if (permission !== undefined && permission !== 'granted') return false;
    await handle.getFile();
    return false;
  } catch (err) {
    return fileMissing(err);
  }
}

let fileInput: HTMLInputElement | null = null;
let onFileChosen: (file: File) => void = () => {};

/** A cancelled choice never settles, so nothing happens. Firefox reports a choice only for an input that is part of the page. */
function chooseWithInput(): Promise<File> {
  if (!fileInput) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt';
    input.hidden = true;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) onFileChosen(file);
    });
    document.body.append(input);
    fileInput = input;
  }
  const input = fileInput;
  return new Promise((resolve) => {
    onFileChosen = resolve;
    input.click();
  });
}

/** Asks for a log; `null` when the user cancels the picker. */
export async function chooseLog(): Promise<ChosenLog | null> {
  const picker = (window as FilePickerWindow).showOpenFilePicker;
  if (!picker) return chosenFile(await chooseWithInput());
  try {
    const [handle] = await picker({ types: [{ description: t('start.dialogFilter'), accept: { 'text/plain': ['.txt'] } }] });
    return handle ? chosenHandle(handle) : null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

/** Opens a remembered file again; the browser may ask the user to allow reading it. */
export async function reopenHandle(handle: FileSystemFileHandle | undefined): Promise<LogSource> {
  if (!handle) throw t('error.chooseAgain');
  const permission = await (handle as PermissionHandle).requestPermission?.({ mode: 'read' });
  if (permission !== undefined && permission !== 'granted') throw t('error.permissionDenied');
  return fileSource(await handle.getFile(), handle);
}
