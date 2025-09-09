export type Backend = {
  ip: string;                 // só p/ compor ID e logs
  prefix?: string;            // usado em DEV (via Vite proxy), ex: '/api100'
  baseUrl?: string;           // usado em PROD (URL absoluta do seu proxy público)
  username: string;
  password: string;
  enabled?: boolean;
  label?: string;
};

const isProd = import.meta.env.PROD;

export const backends: Backend[] = [
  {
    ip: '10.2.1.100',
    label: 'API 10.2.1.100',
    // Em dev usamos o proxy do Vite:
    prefix: '/api100',
    // Em prod use uma URL pública (exposta via proxy/tunnel) ou deixe vazio até ter:
    baseUrl: isProd ? (import.meta.env.VITE_BACKEND_100_BASE ?? '') : undefined,
    username: import.meta.env.VITE_BACKEND_100_USER ?? 'api',
    password: import.meta.env.VITE_BACKEND_100_PASS ?? 'GMX3-Rel.10',
    enabled: true,
  },
  {
    ip: '10.2.1.69',
    label: 'API 10.2.1.69',
    prefix: '/api69',
    baseUrl: isProd ? (import.meta.env.VITE_BACKEND_69_BASE ?? '') : undefined,
    username: import.meta.env.VITE_BACKEND_69_USER ?? 'api',
    password: import.meta.env.VITE_BACKEND_69_PASS ?? 'GMX3-Rel.10',
    enabled: true,
  },
];
