export type DoctorCheckName = 'node' | 'git' | 'config';

export type DoctorCheckStatus = 'pass' | 'fail' | 'unavailable';

export interface DoctorCheck {
  name: DoctorCheckName;
  status: DoctorCheckStatus;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}
