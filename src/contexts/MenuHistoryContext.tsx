import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { menuHistoryService, MenuHistoryItem } from '../services/menuHistoryService';

interface MenuHistoryContextValue {
  items: MenuHistoryItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  add: (item: Omit<MenuHistoryItem, 'id' | 'createdAt'>) => Promise<MenuHistoryItem>;
  remove: (id: string) => Promise<boolean>;
  rename: (id: string, newName: string) => Promise<boolean>;
}

const MenuHistoryContext = createContext<MenuHistoryContextValue | null>(null);

/** Menu proposal history: read uniformly from context; pages no longer call the service directly */
export function MenuHistoryProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<MenuHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await menuHistoryService.getAllItems();
      setItems(list);
    } finally {
      setLoading(false);
    }
  }, []);

  const add = useCallback(async (item: Omit<MenuHistoryItem, 'id' | 'createdAt'>) => {
    const created = await menuHistoryService.add(item);
    setItems((prev) => [created, ...prev].slice(0, 50));
    return created;
  }, []);

  const remove = useCallback(async (id: string) => {
    const ok = await menuHistoryService.remove(id);
    if (ok) setItems((prev) => prev.filter((i) => i.id !== id));
    return ok;
  }, []);

  const rename = useCallback(async (id: string, newName: string) => {
    const ok = await menuHistoryService.rename(id, newName);
    if (ok) setItems((prev) => prev.map((i) => (i.id === id ? { ...i, name: newName } : i)));
    return ok;
  }, []);

  const value = useMemo(
    () => ({ items, loading, refresh, add, remove, rename }),
    [items, loading, refresh, add, remove, rename],
  );

  return (
    <MenuHistoryContext.Provider value={value}>
      {children}
    </MenuHistoryContext.Provider>
  );
}

export function useMenuHistory() {
  const ctx = useContext(MenuHistoryContext);
  if (!ctx) throw new Error('useMenuHistory must be used within MenuHistoryProvider');
  return ctx;
}
