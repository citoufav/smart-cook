import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { logger } from '../utils/logger';

export interface MenuHistoryItem {
  id: string;
  name: string;           // user-defined name
  createdAt: string;       // ISO date
  menuProposal: any;       // full MenuProposal data
  reasoningContent: string; // AI reasoning chain
  requirement: any;        // RequirementInput
  sessionId?: string;      // linked cooking session id, used to load chat history
}

class MenuHistoryService {
  private log = logger('SVC:MENU_HIST');

  private async getAll(): Promise<MenuHistoryItem[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.COOKING_SESSION_HISTORY);
      if (!raw) return [];
      const items: MenuHistoryItem[] = JSON.parse(raw);
      this.log.debug('Loaded menu history', { count: items.length });
      return Array.isArray(items) ? items : [];
    } catch (e) {
      this.log.error('Failed to parse menu history', e);
      // 数据损坏：备份原始内容，避免下次写入静默清空历史后无备份可查
      try {
        const corrupted = await AsyncStorage.getItem(STORAGE_KEYS.COOKING_SESSION_HISTORY);
        if (corrupted) {
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          await AsyncStorage.setItem(`${STORAGE_KEYS.COOKING_SESSION_HISTORY}_corrupted_${ts}`, corrupted);
        }
      } catch {}
      return [];
    }
  }

  private async saveAll(items: MenuHistoryItem[]): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.COOKING_SESSION_HISTORY, JSON.stringify(items));
    } catch (e) {
      this.log.error('saveAll failed', e);
    }
  }

  async add(item: Omit<MenuHistoryItem, 'id' | 'createdAt'>): Promise<MenuHistoryItem> {
    const all = await this.getAll();
    // 思考链体积大（几十 KB/条），落盘时截断，避免单 key 膨胀触发 Android AsyncStorage 写入限制
    const MAX_SAVED_REASONING = 2000;
    const reasoning = item.reasoningContent || '';
    const truncatedReasoning = reasoning.length > MAX_SAVED_REASONING
      ? `${reasoning.slice(0, MAX_SAVED_REASONING)}\n…（思考链已截断，完整内容仅保存在当次会话中）`
      : reasoning;
    const newItem: MenuHistoryItem = {
      ...item,
      reasoningContent: truncatedReasoning,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      createdAt: new Date().toISOString(),
    };
    all.unshift(newItem); // newest first
    // keep at most 50 entries
    if (all.length > 50) all.length = 50;
    await this.saveAll(all);
    const dishCount = item.menuProposal?.dishes?.length ?? 0;
    const prepCount = item.menuProposal?.prepSteps?.length ?? 0;
    const cookCount = item.menuProposal?.cookingSteps?.length ?? 0;
    this.log.info('Added menu history item', { name: newItem.name, dishCount, prepCount, cookCount });
    return newItem;
  }

  async getAllItems(): Promise<MenuHistoryItem[]> {
    const items = await this.getAll();
    this.log.debug('getAllItems', { count: items.length });
    return items;
  }

  async getById(id: string): Promise<MenuHistoryItem | null> {
    const all = await this.getAll();
    const item = all.find((i) => i.id === id) || null;
    this.log.debug('getById', { id, found: !!item });
    return item;
  }

  async rename(id: string, newName: string): Promise<boolean> {
    const all = await this.getAll();
    const item = all.find((i) => i.id === id);
    if (!item) return false;
    item.name = newName.trim();
    await this.saveAll(all);
    this.log.info('Renamed menu history item', { id, newName });
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const all = await this.getAll();
    const filtered = all.filter((i) => i.id !== id);
    if (filtered.length === all.length) return false;
    await this.saveAll(filtered);
    this.log.info('Removed menu history item', { id });
    return true;
  }
}

export const menuHistoryService = new MenuHistoryService();
