export interface MeterData {
  code: string;
  description: string;
  printedValue: number;
  handwrittenValue: number;
  usage: number;
}

export interface ReadingData {
  id?: number;
  customer_name: string;
  customer_id: string;
  pea_meter_no: string;
  reading_month: number;
  reading_year: number;
  image_base64?: string;
  data: {
    codes: Record<string, MeterData>;
    analysis: {
      totalEnergyMatch: boolean;
      sum010_020_030: number;
      val111: number;
      diff015_050: boolean;
      diff016_060: boolean;
      diff017_070: boolean;
      diff118_280: boolean;
    };
  };
  created_at?: string;
}

export const MONTHS_TH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];
