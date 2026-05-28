import { db } from './db';
import type { BackupRow } from './types';

export async function createBackup(plannedUnsubIds: string[]): Promise<number> {
  const channels = await db().channels.toArray();
  const row: BackupRow = {
    createdAt: Date.now(),
    channelCount: channels.length,
    plannedUnsubIds: [...plannedUnsubIds],
    payload: channels,
  };
  const id = await db().backups.add(row);
  return typeof id === 'number' ? id : Number(id);
}

export async function listBackups(): Promise<BackupRow[]> {
  return db().backups.orderBy('createdAt').reverse().toArray();
}

export async function getBackup(id: number): Promise<BackupRow | undefined> {
  return db().backups.get(id);
}
