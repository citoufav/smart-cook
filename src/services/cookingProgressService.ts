import AsyncStorage from '@react-native-async-storage/async-storage';
import { CookingSession, CookingStage } from '../types';
import { logger } from '../utils/logger';

const STORAGE_KEY = '@v1:cooking:progress_records';

export interface CookingProgressRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentStage: CookingStage;
  session: CookingSession;
  isCompleted?: boolean; // true = completed, shows "View"; false/undefined = in progress, shows "Continue"
}

/** Stage → readable Chinese label */
export const STAGE_LABELS: Record<CookingStage, string> = {
  requirement: '需求确认',
  menu: '查看菜谱',
  prep: '备菜',
  cooking: '炒制',
  inventoryUpdate: '更新库存',
  completed: '已完成',
  cancelled: '已取消',
};

class CookingProgressService {
  private log = logger('SVC:PROGRESS');

  private async getAll(): Promise<CookingProgressRecord[]> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const records: CookingProgressRecord[] = JSON.parse(raw);
      this.log.debug('Loaded progress records', { count: records.length });
      return records;
    } catch (e) {
      this.log.error('Failed to parse progress records', e);
      return [];
    }
  }

  private async saveAll(items: CookingProgressRecord[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  /** Save or update cooking progress */
  async save(session: CookingSession, name?: string): Promise<CookingProgressRecord> {
    const all = await this.getAll();
    const existing = all.find((r) => r.session.id === session.id);
    const now = new Date().toISOString();

    if (existing) {
      existing.session = session;
      existing.currentStage = session.status;
      existing.updatedAt = now;
      if (name) existing.name = name;
      await this.saveAll(all);
      this.log.info('Updated progress record', { status: session.status, recordCount: all.length });
      return existing;
    }

    const record: CookingProgressRecord = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name: name || `菜单 ${new Date().toLocaleDateString('zh-CN')}`,
      createdAt: now,
      updatedAt: now,
      currentStage: session.status,
      session,
    };
    all.unshift(record);
    if (all.length > 50) all.length = 50;
    await this.saveAll(all);
    this.log.info('Created progress record', { status: session.status, recordCount: all.length });
    return record;
  }

  /** Mark as completed */
  async markCompleted(sessionId: string): Promise<boolean> {
    const all = await this.getAll();
    const record = all.find((r) => r.session.id === sessionId);
    if (!record) return false;
    record.isCompleted = true;
    record.currentStage = 'completed';
    record.updatedAt = new Date().toISOString();
    await this.saveAll(all);
    this.log.info('Marked progress record as completed', { sessionId });
    return true;
  }

  /** Get in-progress records (not completed) */
  async getActiveRecords(): Promise<CookingProgressRecord[]> {
    const all = await this.getAll();
    return all.filter((r) => !r.isCompleted);
  }

  /** Get all progress records (including completed) */
  async getAllRecords(): Promise<CookingProgressRecord[]> {
    const records = await this.getAll();
    this.log.debug('getAllRecords', { count: records.length });
    return records;
  }

  /** Remove a record */
  async remove(recordId: string): Promise<boolean> {
    const all = await this.getAll();
    const filtered = all.filter((r) => r.id !== recordId);
    if (filtered.length === all.length) return false;
    await this.saveAll(filtered);
    this.log.info('Removed progress record', { recordId });
    return true;
  }

  /** Rename */
  async rename(recordId: string, newName: string): Promise<boolean> {
    const all = await this.getAll();
    const item = all.find((r) => r.id === recordId);
    if (!item) return false;
    item.name = newName.trim();
    await this.saveAll(all);
    this.log.info('Renamed progress record', { recordId, newName });
    return true;
  }
}

export const cookingProgressService = new CookingProgressService();
