// src/lib/api.ts

// Tipos
export type LoginResponse = { accessToken: string };

export type AlarmDTO = {
  id: string;
  itemReference: string; // -> Site
  name: string;          // -> Ponto
  creationTime: string;  // -> Data - Hora (ISO)
  isAcknowledged: boolean;
  isDiscarded: boolean;
  priority: number;      // <- Prioridade
  triggerValue?: { value?: string; units?: string };
};

export type AlarmsResponse = { total: number; items: AlarmDTO[] };

// Helpers de valor/unidade (mínimos necessários para a UI)
export function normalizeValue(value?: string | number, units?: string): string {
  if (value === undefined || value === null) return '';
  const v = typeof value === 'number' ? value : String(value).trim();
  const u = (units ?? '').trim();
  return u ? `${v} ${u}` : String(v);
}

export function mapUnit(units?: string): string {
  if (!units) return '';
  const m: Record<string, string> = {
    'degC': '°C',
    'degF': '°F',
    'percent': '%'
  };
  return m[units] ?? units;
}

// Datas
export function formatDateUTCToLocal(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function formatDateWithOffset(iso: string, sign?: '+'|'-', hours?: number): string {
  const d = new Date(iso);
  let ms = d.getTime();
  if (hours && hours >= 1 && hours <= 24 && (sign === '+' || sign === '-')) {
    const delta = hours * 60 * 60 * 1000;
    ms = sign === '+' ? ms + delta : ms - delta;
  }
  const adj = new Date(ms);
  return adj.toLocaleString('pt-BR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
