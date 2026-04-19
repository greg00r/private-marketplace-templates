import { useEffect, useState } from 'react';
import { getMarketplaceAccess } from '../api/templates';
import type { MarketplaceAccess } from '../types';
import { getInitialMarketplaceAccess, mergeMarketplaceAccess } from '../utils/access';

export function useMarketplaceAccess() {
  const [access, setAccess] = useState<MarketplaceAccess>(() => getInitialMarketplaceAccess());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadAccess() {
      try {
        const serverAccess = await getMarketplaceAccess();
        if (!cancelled) {
          setAccess((current) => mergeMarketplaceAccess(current, serverAccess));
        }
      } catch {
        if (!cancelled) {
          setAccess(getInitialMarketplaceAccess());
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadAccess();

    return () => {
      cancelled = true;
    };
  }, []);

  return { access, loading };
}
