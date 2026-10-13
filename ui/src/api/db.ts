/** The browser database: stored log indexes and the recent list. */
export type StoreName = 'indexes' | 'indexes-used' | 'recent';

export interface Database {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, value: object): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  all<T>(store: StoreName): Promise<T[]>;
}

const NAME = 'openlogs';
const VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;

function connect(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('indexes', { keyPath: 'key' });
      database.createObjectStore('indexes-used', { keyPath: 'key' });
      database.createObjectStore('recent', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      // Another tab upgrades the schema: give way; the next call reconnects.
      request.result.onversionchange = () => {
        request.result.close();
        opening = null;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  }).catch((err: unknown) => {
    opening = null;
    throw err;
  });
  return opening;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, action: (objects: IDBObjectStore) => IDBRequest): Promise<T> {
  const database = await connect();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(store, mode);
    const request = action(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request.result as T);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const browserDatabase: Database = {
  get: (store, key) => run(store, 'readonly', (objects) => objects.get(key)),
  put: (store, value) => run(store, 'readwrite', (objects) => objects.put(value)),
  delete: (store, key) => run(store, 'readwrite', (objects) => objects.delete(key)),
  all: (store) => run(store, 'readonly', (objects) => objects.getAll()),
};
