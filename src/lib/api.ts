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
export function normalizeValue(v: unknown): string {
  if (v == null) return "-";
  const s = String(v).trim();

  // mapeamentos diretos
  const direct: Record<string, string> = {
    "controllerStatusEnumSet.csOffline": "Offline",
    "controllerStatusEnumSet.csOnline": "Online",
    "batteryConditionEnumSet.bcBatteryService": "BatteryService",
    "normalAlarmEnumSet.naAlarm": "Alarm",
    "localremoteEnumSet.1" : "LR - 1",
    "localremoteEnumSet.0" : "LR - 0",
    "offAutoEnumSet.0" : "Estado - 0",
    "offAutoEnumSet.1" : "Estado - 1",
    "unitEnumSet.noUnits" : "",
    "normalAlarm2EnumSet.na2Alarm" : "Alarm",
    "normalAlarm2EnumSet.na2Normal" : "Normal",
    "unitEnumSet.kilopascals" : "kPa",
    "unitEnumSet.kilowatts" : "kW",
    "unitEnumSet.jaKilogramsPerSqCm" : "kg/m²",
    "unitEnumSet.millimetersPerSecond" : "mm/s.",
    
    
  };
  if (direct[s]) return direct[s];

  // off/on com sufixo numérico
  // ex.: "offonEnumSet.0" => "Estado 0", "offonEnumSet.1" => "Estado 1"
  if (s.startsWith("offonEnumSet.")) {
    const code = s.split(".")[1];
    if (code === "0") return "Estado 0";
    if (code === "1") return "Estado 1";
  }

  return s; // fallback
}


export function mapUnit(u?: string): string | undefined {
  if (!u) return undefined;
  const map: Record<string, string> = {
    // seus pedidos
    "unitEnumSet.noUnits" : "",
    "unitEnumSet.degC": "°C",
    "unitEnumSet.percent": "%",
    "unitEnumSet.milligrams": "mg",
    "unitEnumSet.perMinute": "perMinute",
    // tolerância a variações (se vier sem prefixo)
    "unitEnumSet.degF": "°F",
    "percent": "%",
    "milligrams": "milligrams",
    "perMinute": "perMinute",
    "localremoteEnumSet.0" : "LR - 0",
    "localremoteEnumSet.1" : "LR - 1",
    "normalAlarm2EnumSet.na2Alarm" : "Alarm",
    "normalAlarm2EnumSet.na2Normal" : "Normal",
    "unitEnumSet.kilopascals" : "kPa",
    "unitEnumSet.kilowatts" : "kW",
    "unitEnumSet.jaKilogramsPerSqCm" : "kg/m²",
    "unitEnumSet.millimetersPerSecond" : "mm/s.",
    
    
  };
  return map[u] ?? u; // fallback para não quebrar nada
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
