import type { Firestore } from 'firebase/firestore';
import { changeDevice, deviceCollections, emptyDevice, readDevice, type DeviceData } from './deviceStore';
import { createManyIfAbsent, fetchAll, saveLayout, saveLedgerSettings, saveRecoveryRule } from './repo';

export const deviceCount = (data: DeviceData) => deviceCollections.filter(k => k !== 'categories')
  .reduce((n, k) => n + data[k].length, 0);

/** Bind an interrupted transfer to one account; retain the source until every cloud write acknowledges. */
export async function backupDevice(db: Firestore, uid: string) {
  const source = await readDevice();
  if (source.transferTo && source.transferTo !== uid)
    throw new Error('다른 계정으로 시작한 백업이 남아 있습니다. 처음 백업한 계정으로 로그인해 완료해 주세요.');
  if (!source.transferTo) {
    const existing = await fetchAll(db, uid);
    if (deviceCollections.some(k => k !== 'categories' && existing[k].length > 0))
      throw new Error('이 계정에는 이미 기록이 있습니다. 기기 기록은 그대로 보관했습니다. 새 계정으로 백업하거나 설정의 파일 백업·가져오기로 기록을 확인하며 합쳐 주세요.');
    await changeDevice(data => {
      if (data.revision !== source.revision || data.transferTo) throw new Error('기기 기록이 바뀌었습니다. 다시 백업해 주세요.');
      return { ...data, transferTo: uid };
    });
  }
  const locked = await readDevice();
  const result = await createManyIfAbsent(db, uid, locked);
  if (result.failed.length) throw new Error('일부 기록을 계정에 백업하지 못했습니다. 기기 원본은 보관되어 있으며 다시 시도할 수 있습니다.');
  await saveLedgerSettings(db, uid, locked.ledger);
  await saveRecoveryRule(db, uid, locked.recovery);
  await saveLayout(db, uid, locked.layout);
  // Archive and clear in one local transaction. Logout starts a separate, empty device workspace.
  await changeDevice(data => {
    if (data.transferTo !== uid || data.revision !== locked.revision)
      throw new Error('기기 기록의 상태가 바뀌어 원본을 남겼습니다. 다시 확인해 주세요.');
    return emptyDevice();
  }, 'backup:' + uid + ':' + locked.revision);
}
