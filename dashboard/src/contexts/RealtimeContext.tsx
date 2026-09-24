import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from './ToastContext';
import { ALERT_TYPE_LABEL } from '@/lib/constants';
import type { Alert, AlertType, Message } from '@/types/db';

/**
 * Realtime is used purely as an invalidation signal: every change on a published table
 * bumps a version counter, and data hooks that depend on that table refetch.
 * RLS is the security boundary; the organization filter only reduces traffic.
 */
export const REALTIME_TABLES = [
  'care_events', 'messages', 'patient_responses', 'alerts', 'devices', 'interaction_logs',
] as const;
export type RealtimeTable = (typeof REALTIME_TABLES)[number];
type Versions = Record<RealtimeTable, number>;

interface RealtimeValue { versions: Versions; connected: boolean }
const initial = Object.fromEntries(REALTIME_TABLES.map((t) => [t, 0])) as Versions;
const RealtimeContext = createContext<RealtimeValue>({ versions: initial, connected: false });

export function RealtimeProvider({ orgId, children }: { orgId: string; children: ReactNode }) {
  const [versions, setVersions] = useState<Versions>(initial);
  const [connected, setConnected] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const toastRef = useRef(toast);
  const navRef = useRef(navigate);
  toastRef.current = toast;
  navRef.current = navigate;

  useEffect(() => {
    let channel = supabase.channel(`org-${orgId}`);
    for (const table of REALTIME_TABLES) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `organization_id=eq.${orgId}` },
        (payload) => {
          setVersions((v) => ({ ...v, [table]: v[table] + 1 }));
          if (payload.eventType !== 'INSERT') return;
          if (table === 'alerts') {
            const a = payload.new as Alert;
            toastRef.current({
              kind: a.priority === 'HIGH' ? 'urgent' : 'info',
              title: `${a.priority === 'HIGH' ? '🚨 ' : ''}${ALERT_TYPE_LABEL[a.alert_type as AlertType] ?? a.alert_type}`,
              body: a.message,
              onClick: () => navRef.current('/alerts'),
            });
          } else if (table === 'messages') {
            const m = payload.new as Message;
            if (m.sender_type === 'PATIENT') {
              toastRef.current({
                kind: m.message_type === 'PATIENT_REQUEST' && m.request_code !== 'HUNGRY' ? 'urgent' : 'info',
                title: m.message_type === 'PATIENT_REQUEST' ? 'Patient request' : 'Patient response', body: m.message,
                onClick: () => navRef.current(`/check-ins?patient=${m.patient_id}`),
              });
            }
          }
        },
      );
    }
    channel.subscribe((status) => setConnected(status === 'SUBSCRIBED'));
    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  return <RealtimeContext.Provider value={{ versions, connected }}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

/** Combined version number for a set of tables; include it in a data hook's dependencies. */
export function useTableVersion(tables: readonly RealtimeTable[]): string {
  const { versions } = useRealtime();
  return tables.map((t) => versions[t]).join('.');
}
