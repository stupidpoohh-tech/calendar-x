import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeBackup, readBackupFromHash, stripBackupFromUrl } from './lib/backup';
import {
  type PersistenceStatus,
  hasBackupHistory,
  lastBackupAt,
  loadState,
  markBackupTaken,
  requestPersistence,
  saveState,
  storageAvailable,
  clearState as wipeState,
} from './lib/storage';
import type { State } from './lib/types';

export type PendingRestore = { state: State; exportedAt: string };

export type Store = {
  ready: boolean;
  state: State | null;
  /** 저장소를 읽다가 생긴 문제. 데이터를 덮어쓰기 전에 사용자에게 보여준다. */
  loadIssue: string | null;
  persistence: PersistenceStatus;
  canStore: boolean;
  /** 백업 이력이 있는데 저장된 데이터가 없다 = 데이터가 지워졌다. */
  wasWiped: boolean;
  backupTakenAt: string | null;
  pendingRestore: PendingRestore | null;
  toast: string | null;

  setState: (next: State) => void;
  confirmRestore: () => void;
  cancelRestore: () => void;
  offerRestore: (payload: string) => void;
  noteBackupTaken: () => void;
  reset: () => void;
  showToast: (message: string) => void;
  dismissToast: () => void;
};

export function useStore(): Store {
  const [ready, setReady] = useState(false);
  const [state, setStateRaw] = useState<State | null>(null);
  const [loadIssue, setLoadIssue] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<PersistenceStatus>('unknown');
  const [canStore, setCanStore] = useState(true);
  const [backupTakenAt, setBackupTakenAt] = useState<string | null>(null);
  const [hadBackup, setHadBackup] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const toastTimer = useRef<number | null>(null);
  /**
   * 덮어쓰기 확인은 "지금 이 기기에 데이터가 있는가"로 갈린다.
   * 해시 이벤트 핸들러는 렌더 사이에 살아남아야 해서 ref로 들고 있는다.
   * 읽기에 실패한 데이터(corrupt/future)도 있는 것으로 친다 — 말없이 덮어쓰면 안 된다.
   */
  const hasDataRef = useRef(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const applyRestore = useCallback((next: State) => {
    setStateRaw(next);
    setLoadIssue(null);
    hasDataRef.current = true;
    saveState(next);
    // 복원했다는 건 이 사람에게 백업 링크가 있다는 증거이기도 하다.
    // 이력을 다시 남겨두면 다음에 또 지워졌을 때 안내를 띄울 수 있다.
    markBackupTaken();
    setBackupTakenAt(lastBackupAt());
    setHadBackup(true);
  }, []);

  const takeBackup = useCallback(
    (payload: string) => {
      const decoded = decodeBackup(payload);
      if (!decoded.ok) {
        showToast(decoded.reason);
        return;
      }
      if (hasDataRef.current) {
        // 덮어쓰기 전에 반드시 물어본다.
        setPendingRestore({ state: decoded.state, exportedAt: decoded.exportedAt });
      } else {
        applyRestore(decoded.state);
        showToast('백업 링크에서 복원했습니다.');
      }
    },
    [applyRestore, showToast],
  );

  // 부팅: 저장소 읽기 -> 해시의 백업 링크 처리 -> 영속성 요청.
  useEffect(() => {
    setCanStore(storageAvailable());
    setHadBackup(hasBackupHistory());
    setBackupTakenAt(lastBackupAt());

    const loaded = loadState();
    if (loaded.status === 'ok') {
      setStateRaw(loaded.state);
    } else if (loaded.status === 'corrupt') {
      setLoadIssue(loaded.reason);
    } else if (loaded.status === 'future') {
      setLoadIssue(
        `이 기기에 더 최신 버전(v${loaded.version})의 데이터가 있습니다. 덮어쓰지 않으려면 앱을 새로고침해 주세요.`,
      );
    }
    hasDataRef.current = loaded.status !== 'empty';

    /**
     * 앱이 이미 열려 있는 상태에서 주소창에 백업 링크를 붙여넣으면
     * 해시만 바뀌는 같은-문서 이동이라 페이지가 새로 뜨지 않는다.
     * hashchange까지 받아야 "링크 접속 시 복원"이 실제로 성립한다.
     */
    const onHash = () => {
      const payload = readBackupFromHash();
      if (!payload) return;
      stripBackupFromUrl();
      takeBackup(payload);
    };

    onHash();
    setReady(true);
    window.addEventListener('hashchange', onHash);

    void requestPersistence().then(setPersistence);

    return () => {
      window.removeEventListener('hashchange', onHash);
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, [takeBackup]);

  const persist = useCallback(
    (next: State) => {
      setStateRaw(next);
      setLoadIssue(null);
      hasDataRef.current = true;
      if (!saveState(next)) {
        showToast('저장하지 못했습니다. 백업 링크를 복사해 두세요.');
      }
    },
    [showToast],
  );

  const confirmRestore = useCallback(() => {
    if (!pendingRestore) return;
    applyRestore(pendingRestore.state);
    setPendingRestore(null);
    showToast('백업 링크에서 복원했습니다.');
  }, [applyRestore, pendingRestore, showToast]);

  const cancelRestore = useCallback(() => setPendingRestore(null), []);

  const noteBackupTaken = useCallback(() => {
    markBackupTaken();
    setBackupTakenAt(lastBackupAt());
    setHadBackup(true);
  }, []);

  const reset = useCallback(() => {
    wipeState();
    setStateRaw(null);
    setLoadIssue(null);
    hasDataRef.current = false;
  }, []);

  return {
    ready,
    state,
    loadIssue,
    persistence,
    canStore,
    wasWiped: state === null && hadBackup,
    backupTakenAt,
    pendingRestore,
    toast,
    setState: persist,
    confirmRestore,
    cancelRestore,
    offerRestore: takeBackup,
    noteBackupTaken,
    reset,
    showToast,
    dismissToast,
  };
}
