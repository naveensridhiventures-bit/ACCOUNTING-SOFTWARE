import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, post, setToken } from './api';

export interface SessionUser { id: string; name: string; email: string; roleName: string; permissions: string[] }
export interface SessionCompany { id: string; name: string; legalName?: string | null; gstin?: string | null; baseCurrency: string; state?: string | null; stateCode?: string | null; gstEnabled: boolean; allowNegativeStock: boolean; roundOffInvoices: boolean }
interface Ctx {
  user: SessionUser | null;
  company: SessionCompany | null;
  loading: boolean;
  can: (perm: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [company, setCompany] = useState<SessionCompany | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  const refresh = useCallback(async () => {
    const r = await api<{ user: SessionUser; company: SessionCompany }>('/auth/me');
    setUser(r.user);
    setCompany(r.company);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    refresh().catch(() => setToken(null)).finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    const out = () => { setUser(null); setCompany(null); };
    window.addEventListener('ledgerly:logout', out);
    return () => window.removeEventListener('ledgerly:logout', out);
  }, []);

  const value = useMemo<Ctx>(() => ({
    user, company, loading, refresh,
    can: (p) => !!user && (user.permissions.includes('*') || user.permissions.includes(p)),
    login: async (email, password) => {
      const r = await post<{ token: string }>('/auth/login', { email, password });
      setToken(r.token);
      await refresh();
    },
    logout: () => { setToken(null); setUser(null); setCompany(null); },
  }), [user, company, loading, refresh]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
