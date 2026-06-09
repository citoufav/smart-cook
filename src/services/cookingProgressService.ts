import AsyncStorage from '@react-native-async-storage/async-storage';
import { CookingSession, CookingStage } from '../types';

const STORAGE_KEY = '@v1:cooking:progress_records';

export interface CookingProgressRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentStage: CookingStage;
  session: CookingSession;
}

/** Stage → 可读中文 */
export const STAGE_LABELS: Record<CookingStage, string> = {
  requirement: '需求确认',
  menu: '查看菜单',
  weighing: '称量确认',
  prep: '备菜',
  bowl: '分装碗',
  cooking: '炒制',
  inventoryUpdate: '更新库存',
  completed: '已完成',
  cancelled: '已取消',
};

class CookingProgressService {
  private async getAll(): Promise<CookingProgressRecord[]> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  private async saveAll(items: CookingProgressRecord[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  /** 保存或更新做菜进度 */
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
    return record;
  }

  /** 获取所有进度记录 */
  async getAllRecords(): Promise<CookingProgressRecord[]> {
    return this.getAll();
  }

  /** 删除一条记录 */
  async remove(recordId: string): Promise<boolean> {
    const all = await this.getAll();
    const filtered = all.filter((r) => r.id !== recordId);
    if (filtered.length === all.length) return false;
    await this.saveAll(filtered);
    return true;
  }

  /** 重命名 */
  async rename(recordId: string, newName: string): Promise<boolean> {
    const all = await this.getAll();
    const item = all.find((r) => r.id === recordId);
    if (!item) return false;
    item.name = newName.trim();
    await this.saveAll(all);
    return true;
  }
}

export const cookingProgressService = new CookingProgressService();
