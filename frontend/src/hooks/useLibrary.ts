import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedClip } from '../types.ts';

const DB_NAME = 'cosmic-engine';
const STORE_NAME = 'clips';
const DB_VERSION = 1;

interface LibraryState {
  clips: SavedClip[];
  isOpen: boolean;
}

interface LibraryActions {
  openLibrary: () => void;
  closeLibrary: () => void;
  toggleLibrary: () => void;
  addClip: (clip: SavedClip) => Promise<void>;
  deleteClip: (id: string) => void;
  downloadClip: (id: string) => void;
  renameClip: (id: string, name: string) => void;
}

export type UseLibraryReturn = LibraryState & LibraryActions;

// ---- IndexedDB helpers ----

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllClips(): Promise<SavedClip[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const clips = req.result as SavedClip[];
      // Sort newest first.
      clips.sort((a, b) => b.createdAt - a.createdAt);
      resolve(clips);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function putClip(clip: SavedClip): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(clip);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function removeClip(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// ---- Hook ----

export function useLibrary(): UseLibraryReturn {
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const loadedRef = useRef(false);

  // Load clips from IndexedDB on mount.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    getAllClips()
      .then((stored) => setClips(stored))
      .catch((err) => console.error('Failed to load clips from IndexedDB:', err));
  }, []);

  const openLibrary = useCallback(() => setIsOpen(true), []);
  const closeLibrary = useCallback(() => setIsOpen(false), []);
  const toggleLibrary = useCallback(() => setIsOpen((prev) => !prev), []);

  const addClip = useCallback(async (clip: SavedClip) => {
    await putClip(clip);
    setClips((prev) => [clip, ...prev]);
  }, []);

  const deleteClip = useCallback((id: string) => {
    removeClip(id).catch((err) =>
      console.error('Failed to delete clip:', err),
    );
    setClips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const downloadClip = useCallback(
    (id: string) => {
      const clip = clips.find((c) => c.id === id);
      if (!clip) return;

      const ext = clip.blob.type.includes('wav') ? 'wav' : 'webm';
      const fileName =
        clip.name ??
        `cosmic-${clip.mood}-${new Date(clip.createdAt).toISOString().slice(0, 10)}.${ext}`;

      const url = URL.createObjectURL(clip.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [clips],
  );

  const renameClip = useCallback(
    (id: string, name: string) => {
      setClips((prev) => {
        const updated = prev.map((c) =>
          c.id === id ? { ...c, name } : c,
        );
        // Persist the rename.
        const clip = updated.find((c) => c.id === id);
        if (clip) {
          putClip(clip).catch((err) =>
            console.error('Failed to rename clip:', err),
          );
        }
        return updated;
      });
    },
    [],
  );

  return {
    clips,
    isOpen,
    openLibrary,
    closeLibrary,
    toggleLibrary,
    addClip,
    deleteClip,
    downloadClip,
    renameClip,
  };
}
