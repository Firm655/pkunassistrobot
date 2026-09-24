import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastKind = 'info' | 'success' | 'error' | 'urgent';
interface Toast { id: number; kind: ToastKind; title: string; body?: string; onClick?: () => void }

const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((ts) => ts.filter((t) => t.id !== id));
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId++;
    setToasts((ts) => [...ts.slice(-4), { ...t, id }]);
    setTimeout(() => dismiss(id), t.kind === 'urgent' ? 15000 : 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => { t.onClick?.(); dismiss(t.id); }}>
            <strong>{t.title}</strong>
            {t.body && <div>{t.body}</div>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
