import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useData } from '@/hooks/useData';
import { listPatients, listProfiles } from '@/features/patients/api';
import { listDevices } from '@/features/devices/api';
import type { Device, Patient, Profile } from '@/types/db';

/** Small, frequently-needed lookup tables shared by every page. */
interface ReferenceData {
  patients: Patient[];
  devices: Device[];
  profiles: Profile[];
  patientMap: Map<string, Patient>;
  deviceByPatient: Map<string, Device>;
  profileMap: Map<string, Profile>;
  loading: boolean;
  error: string | null;
  reloadPatients: () => void;
  reloadProfiles: () => void;
}

const Ctx = createContext<ReferenceData | null>(null);

export function ReferenceDataProvider({ children }: { children: ReactNode }) {
  const patients = useData(listPatients, []);
  const devices = useData(() => listDevices(), [], ['devices']);
  const profiles = useData(listProfiles, []);

  const value = useMemo<ReferenceData>(() => {
    const p = patients.data ?? [];
    const d = devices.data ?? [];
    const pr = profiles.data ?? [];
    return {
      patients: p, devices: d, profiles: pr,
      patientMap: new Map(p.map((x) => [x.id, x])),
      deviceByPatient: new Map(d.filter((x) => x.assigned_patient_id).map((x) => [x.assigned_patient_id!, x])),
      profileMap: new Map(pr.map((x) => [x.id, x])),
      loading: patients.loading || devices.loading,
      error: patients.error || devices.error,
      reloadPatients: patients.reload,
      reloadProfiles: profiles.reload,
    };
  }, [patients.data, devices.data, profiles.data, patients.loading, devices.loading, patients.error, devices.error, patients.reload, profiles.reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReferenceData() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useReferenceData outside provider');
  return v;
}
