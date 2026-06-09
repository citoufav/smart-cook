import { useState, useEffect, useRef, useCallback } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

interface NetworkStatus {
  isConnected: boolean;
  isChecking: boolean;
  connectionType: string | null;
}

export function useNetworkStatus(onNetworkRestored?: () => void) {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isChecking: true,
    connectionType: null,
  });

  const onNetworkRestoredRef = useRef(onNetworkRestored);
  onNetworkRestoredRef.current = onNetworkRestored;

  const refresh = useCallback(async () => {
    try {
      const state = await NetInfo.fetch();
      setStatus({
        isConnected: !!state.isConnected,
        isChecking: false,
        connectionType: state.type,
      });
    } catch {
      setStatus((prev) => ({ ...prev, isChecking: false }));
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const isNowConnected = !!state.isConnected;

      setStatus((prevStatus) => {
        const wasConnected = prevStatus.isConnected;

        if (!wasConnected && isNowConnected) {
          onNetworkRestoredRef.current?.();
        }

        return {
          isConnected: isNowConnected,
          isChecking: false,
          connectionType: state.type,
        };
      });
    });

    return () => unsubscribe();
  }, []);

  return { ...status, refresh };
}
