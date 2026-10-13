import { useEffect, useState } from 'react';
import { type ChosenLog, chosenFile, chosenHandle } from '../api/logSource';

/** Chromium hands out a file handle for a dropped file, which lets the recent list reopen it. */
interface HandleItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}

/** Takes the dropped file while the drop event lasts; its items are gone afterwards. */
function droppedLog(transfer: DataTransfer): () => Promise<ChosenLog | null> {
  const item = transfer.items[0];
  const file = item?.getAsFile() ?? null;
  const handle = (item as HandleItem | undefined)?.getAsFileSystemHandle?.();
  return async () => {
    const fileHandle = await handle?.catch(() => null);
    if (fileHandle?.kind === 'file') return chosenHandle(fileHandle as FileSystemFileHandle);
    return file ? chosenFile(file) : null;
  };
}

const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

/** Opens a log dropped on the window; returns whether a drag is currently over it. */
export function useLogDrop(onDrop: (log: ChosenLog) => void): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    // dragenter and dragleave fire for every child element the pointer crosses.
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setOver(true);
    };
    const overWindow = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      depth = 0;
      setOver(false);
      if (!event.dataTransfer) return;
      void droppedLog(event.dataTransfer)().then((log) => log && onDrop(log));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overWindow);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overWindow);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [onDrop]);
  return over;
}
