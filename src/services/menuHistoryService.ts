import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { logger } from '../utils/logger';

export interface MenuHistoryItem {
  id: string;
  name: string;           // 用户自定义名称
  createdAt: string;       // ISO 日期
  menuProposal: any;       // MenuProposal 完整数据
  reasoningContent: string; // AI 思维链
  requirement: any;        // RequirementInput
  sessionId?: string;      // 关联的做菜 session id，用于加载聊天记录
}

class MenuHistoryService {
  private log = logger('SVC:MENU_HIST');

  private async getAll(): Promise<MenuHistoryItem[]> {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.COOKING_SESSION_HISTORY);
    if (!raw) return [];
    try {
      const items: MenuHistoryItem[] = JSON.parse(raw);
      this.log.debug('Loaded menu history', { count: items.length });
      return items;
    } catch (e) {
      this.log.error('Failed to parse menu history', e);
      return [];
    }
  }

  private async saveAll(items: MenuHistoryItem[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.COOKING_SESSION_HISTORY, JSON.stringify(items));
  }

  async add(item: Omit<MenuHistoryItem, 'id' | 'createdAt'>): Promise<MenuHistoryItem> {
    const all = await this.getAll();
    const newItem: MenuHistoryItem = {
      ...item,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      createdAt: new Date().toISOString(),
    };
    all.unshift(newItem); // 最新在前
    // 最多保存 50 条
    if (all.length > 50) all.length = 50;
    await this.saveAll(all);
    const dishCount = item.menuProposal?.dishes?.length ?? 0;
    const prepCount = item.menuProposal?.prepSteps?.length ?? 0;
    const cookCount = item.menuProposal?.cookingSteps?.length ?? 0;
    this.log.info('Added menu history item', { name: newItem.name, dishCount, prepCount, cookCount });
    console.log('[HIST_SAVE] id:', newItem.id, 'prepSteps:', prepCount, 'cookingSteps:', cookCount);
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
    if (item) {
      const prepCount = item.menuProposal?.prepSteps?.length ?? 0;
      const cookCount = item.menuProposal?.cookingSteps?.length ?? 0;
      console.log('[HIST_READ] id:', id, 'prepSteps:', prepCount, 'cookingSteps:', cookCount);
    }
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
