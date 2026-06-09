import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/storageKeys';

export interface MenuHistoryItem {
  id: string;
  name: string;           // 用户自定义名称
  createdAt: string;       // ISO 日期
  menuProposal: any;       // MenuProposal 完整数据
  reasoningContent: string; // AI 思维链
  requirement: any;        // RequirementInput
}

class MenuHistoryService {
  private async getAll(): Promise<MenuHistoryItem[]> {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.COOKING_SESSION_HISTORY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
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
    return newItem;
  }

  async getAllItems(): Promise<MenuHistoryItem[]> {
    return this.getAll();
  }

  async getById(id: string): Promise<MenuHistoryItem | null> {
    const all = await this.getAll();
    return all.find((i) => i.id === id) || null;
  }

  async rename(id: string, newName: string): Promise<boolean> {
    const all = await this.getAll();
    const item = all.find((i) => i.id === id);
    if (!item) return false;
    item.name = newName.trim();
    await this.saveAll(all);
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const all = await this.getAll();
    const filtered = all.filter((i) => i.id !== id);
    if (filtered.length === all.length) return false;
    await this.saveAll(filtered);
    return true;
  }
}

export const menuHistoryService = new MenuHistoryService();
