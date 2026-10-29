export interface PlanItem {
  date: string;
  tooth: string;
  treatment: string;
  cost: number | string;
  paid: number | string;
  remaining: number | string;
  doctor: string;
}

export interface DentalRecord {
  id: number;
  name: string;
  phone: string;
  address: string;
  dob: string; // Age (Tuổi)
  visitDate: string;
  appointment: string;
  plan: PlanItem[];
}

export type DentalRecordInput = Omit<DentalRecord, 'id'>;

export interface PaymentRequest {
  id: number;
  code: string;
  patientId: number | null;
  patientName: string | null;
  amount: number;
  status: 'pending' | 'paid';
  createdAt: number;
  paidAt: number | null;
  paidAmount: number | null; // what the bank actually received (can exceed amount)
  bankReference: string | null;
}

export interface BankConfig {
  bankCode: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  sepayEnabled: boolean;
}
