// src/alarms/Alarms.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import './Alarms.css';
import {
  normalizeValue,
  mapUnit,
  formatDateUTCToLocal,
  type AlarmDTO,
} from '../lib/api';

type Row = {
  id: string;              // backendId + "_" + alarmId
  server: string;          // label do backend (coluna Servidor)
  dateTimeISO: string;
  dateTime: string;
  site: string;
  point: string;
  value: string;           // valor + unidade (ex.: "10 °C")
  priority: number;
  reconhecido: 'Sim' | 'Não';
  descartado: 'Sim' | 'Não';
};

type SortKey =
  | 'dateTime'
  | 'site'
  | 'point'
  | 'value'
  | 'priority'
  | 'reconhecido'
  | 'descartado'
  | 'server'
  | 'idade';
type SortDir = 'asc' | 'desc';

/* =========================
   Backends dinâmicos (UI)
   ========================= */
type BackendCfg = {
  id: string;       // uid local
  label: string;    // nome amigável (vai na coluna Servidor)
  baseUrl: string;  // ex.: "/api69" ou "https://10.2.1.69/api" ou "https://10.2.1.69"
  username: string;
  password: string;
  enabled: boolean;
};
const BACKENDS_KEY = 'alarms_backends_v1';

function loadBackends(): BackendCfg[] {
  try {
    const raw = localStorage.getItem(BACKENDS_KEY);
    if (raw) return JSON.parse(raw) as BackendCfg[];
  } catch {}
  // Seed opcional
  return [
    {
      id: 'b100',
      label: 'API 10.2.1.100',
      baseUrl: '/api100',
      username: 'api',
      password: 'GMX3-Rel.10',
      enabled: true,
    },
    {
      id: 'b69',
      label: 'API 10.2.1.69',
      baseUrl: '/api69',
      username: 'api',
      password: 'GMX3-Rel.10',
      enabled: true,
    },
  ];
}
function saveBackends(list: BackendCfg[]) {
  try { localStorage.setItem(BACKENDS_KEY, JSON.stringify(list)); } catch {}
}

/* =========================
   Comentários (localStorage)
   ========================= */
const COMMENT_KEY = (id: string) => `alarm_comment_${id}`;
function loadComment(id: string): string {
  try { return localStorage.getItem(COMMENT_KEY(id)) ?? ''; } catch { return ''; }
}
function saveComment(id: string, text: string) {
  try { localStorage.setItem(COMMENT_KEY(id), text); } catch {}
}

/* =========================
   Colunas visíveis (localStorage)
   ========================= */
type VisibleCols = {
  server: boolean;
  dateTime: boolean;
  site: boolean;
  point: boolean;
  value: boolean;        // coluna unificada (valor + unidade)
  priority: boolean;
  reconhecido: boolean;
  descartado: boolean;
  idade: boolean;        // nova coluna
  comentario: boolean;
};
const COLS_KEY = 'alarms_visible_cols';
function loadVisibleCols(): VisibleCols {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    if (raw) return JSON.parse(raw) as VisibleCols;
  } catch {}
  return {
    server: true,
    dateTime: true,
    site: true,
    point: true,
    value: true,
    priority: true,
    reconhecido: true,
    descartado: true,
    idade: true,
    comentario: true,
  };
}
function saveVisibleCols(cols: VisibleCols) {
  try { localStorage.setItem(COLS_KEY, JSON.stringify(cols)); } catch {}
}

/* =========================
   HTTP helpers + proxy universal em dev
   ========================= */

// Normaliza base para terminar (implicitamente) em /api quando necessário
function normalizeBaseApi(raw: string): string {
  let base = (raw || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (base.startsWith('/')) return base; // prefixo do Vite (ex.: /api69)

  try {
    const u = new URL(base);
    if (u.pathname === '' || u.pathname === '/') base = `${base}/api`;
  } catch {}
  return base.replace(/\/+$/, '');
}

// Monta URL final. Em dev, se a base for absoluta, passa pelo /proxy do Vite.
// Em prod ou se base começar com "/", chama direto.
function toDevProxyUrl(baseUrl: string, path: string, extraQS?: Record<string, string | undefined>) {
  const base = normalizeBaseApi(baseUrl);
  const p = path.startsWith('/') ? path : `/${path}`;

  if (import.meta.env.DEV && !base.startsWith('/')) {
    const qs = new URLSearchParams({ target: base, path: p });
    if (extraQS) for (const [k, v] of Object.entries(extraQS)) if (v !== undefined) qs.append(k, v);
    return `/proxy?${qs.toString()}`;
  }

  const qs = new URLSearchParams();
  if (extraQS) for (const [k, v] of Object.entries(extraQS)) if (v !== undefined) qs.append(k, v);
  return `${base}${p}${qs.toString() ? `?${qs.toString()}` : ''}`;
}

type LoginResponse = { accessToken?: string };
type AlarmsResponse = { total: number; items: AlarmDTO[] };

async function loginBase(baseUrl: string, username: string, password: string): Promise<string> {
  const url = toDevProxyUrl(baseUrl, '/v3/login');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Falha no login (${res.status}) ${text || ''}`.trim());
  }
  const data = (await res.json()) as LoginResponse;
  const token = data?.accessToken;
  if (!token) throw new Error('Login sem accessToken');
  return token;
}

async function getAlarmsBase(
  baseUrl: string,
  token: string,
  opts?: { isAcknowledged?: boolean; isDiscarded?: boolean }
): Promise<AlarmsResponse> {
  const qs: Record<string, string> = { pageSize: '500' };
  if (opts?.isAcknowledged !== undefined) qs['isAcknowledged'] = String(opts.isAcknowledged);
  if (opts?.isDiscarded !== undefined)   qs['isDiscarded']   = String(opts.isDiscarded);

  const url = toDevProxyUrl(baseUrl, '/v3/alarms/', qs);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Falha ao buscar (${res.status}) ${text || ''}`.trim());
  }
  return (await res.json()) as AlarmsResponse;
}

/* =========================
   Helpers de apresentação
   ========================= */

// Idade em milissegundos (quanto tempo está ativo)
function ageMs(iso: string) {
  return Date.now() - new Date(iso).getTime();
}

// Formata idade de forma amigável
// <1 min: "agora"; <1h: "Xm Ys"; <24h: "Hh Mm"; >=24h: "Dd Hh"
function formatAge(iso: string) {
  const ms = ageMs(iso);
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);

  if (s < 60) return 'agora';
  if (m < 60) return `${m}m ${s % 60}s`;
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${d}d ${h % 24}h`;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/* =========================
   Componente
   ========================= */
export default function Alarms() {
  // dados
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // backends
  const [backends, setBackends] = useState<BackendCfg[]>(() => loadBackends());
  const [backendErrors, setBackendErrors] = useState<Record<string, string>>({});

  // filtros
  const [fSite, setFSite] = useState('');
  const [fPoint, setFPoint] = useState('');
  const [fValue, setFValue] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [fPriority, setFPriority] = useState('');
  const [fAck, setFAck] = useState<'all' | 'sim' | 'nao'>('all');
  const [fDisc, setFDisc] = useState<'all' | 'sim' | 'nao'>('all');

  // ordenação
  const [sortKey, setSortKey] = useState<SortKey>('dateTime');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const intervalRef = useRef<number | null>(null);

  // comentários
  const [comments, setComments] = useState<Record<string, string>>({});

  // colunas
  const [visibleCols, setVisibleCols] = useState<VisibleCols>(() => loadVisibleCols());
  function toggleCol(col: keyof VisibleCols) {
    setVisibleCols((prev) => {
      const next = { ...prev, [col]: !prev[col] };
      saveVisibleCols(next);
      return next;
    });
  }

  // modal APIs
  const [showApiMgr, setShowApiMgr] = useState(false);
  const [newApi, setNewApi] = useState<Partial<BackendCfg>>({});

  // Autocomplete de https:// ao digitar só IP (e opcionalmente porta)
  function normalizeNewBaseUrl(input: string): string {
    const raw = (input || '').trim();
    if (!raw) return '';
    if (raw.startsWith('/') || raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    // se digitou apenas IP (e opcional porta/caminho), prefixa https://
    return `https://${raw}`;
  }

  function addBackend() {
    const baseRaw = normalizeNewBaseUrl(newApi.baseUrl || '');
    if (!baseRaw || !newApi.username || !newApi.password) {
      alert('Informe Base URL, Usuário e Senha.');
      return;
    }
    const b: BackendCfg = {
      id: (crypto as any)?.randomUUID?.() ?? String(Date.now()),
      label: (newApi.label || baseRaw) as string,
      baseUrl: baseRaw,
      username: newApi.username as string,
      password: newApi.password as string,
      enabled: true,
    };
    const next = [...backends, b];
    setBackends(next); saveBackends(next);
    setNewApi({});
  }

  function toggleBackend(id: string) {
    const next = backends.map((b) => (b.id === id ? { ...b, enabled: !b.enabled } : b));
    setBackends(next); saveBackends(next);
  }

  function removeBackend(id: string) {
    if (!confirm('Remover esta API?')) return;
    const next = backends.filter((b) => b.id !== id);
    setBackends(next); saveBackends(next);
  }

  async function testBackend(b: BackendCfg) {
    try {
      const token = await loginBase(b.baseUrl, b.username, b.password);
      await getAlarmsBase(b.baseUrl, token);
      alert(`OK — ${b.label} respondeu.`);
      setBackendErrors((prev) => {
        const n = { ...prev }; delete n[b.id]; return n;
      });
    } catch (e: any) {
      const msg = e?.message || 'Erro desconhecido';
      alert(`Falha — ${b.label}\n${msg}`);
      setBackendErrors((prev) => ({ ...prev, [b.id]: msg }));
    }
  }

  async function fetchData() {
    setLoading(true); setErr('');
    try {
      const enabled = backends.filter((b) => b.enabled);
      const opts = {
        isAcknowledged: fAck === 'all' ? undefined : fAck === 'sim',
        isDiscarded:   fDisc === 'all' ? undefined : fDisc === 'sim',
      };

      const all: Row[] = [];
      const errors: Record<string, string> = {};

      for (const b of enabled) {
        try {
          const token = await loginBase(b.baseUrl, b.username, b.password);
          const data = await getAlarmsBase(b.baseUrl, token, opts);
          const rowsB: Row[] = (data.items || []).map((a) => {
            const v = normalizeValue(a.triggerValue?.value);
            const u = mapUnit(a.triggerValue?.units);
            const valueUnified = u ? `${v} ${u}` : v;

            return {
              id: `${b.id}_${a.id}`,
              server: b.label,
              dateTimeISO: a.creationTime,
              dateTime: formatDateUTCToLocal(a.creationTime),
              site: a.itemReference,
              point: a.name || a.itemReference,
              value: valueUnified,
              priority: Number.isFinite(a.priority as unknown as number) ? (a.priority as unknown as number) : 0,
              reconhecido: a.isAcknowledged ? 'Sim' : 'Não',
              descartado: a.isDiscarded ? 'Sim' : 'Não',
            };
          });
          all.push(...rowsB);
        } catch (e: any) {
          errors[b.id] = e?.message || 'Erro desconhecido';
        }
      }

      setBackendErrors(errors);
      setRows(all);

      // hidrata comentários
      const nextComments: Record<string, string> = {};
      for (const r of all) nextComments[r.id] = loadComment(r.id);
      setComments(nextComments);
      setSecondsLeft(60);
    } catch (e: any) {
      setErr(e?.message || 'Erro geral');
    } finally {
      setLoading(false);
    }
  }

  // primeira carga e quando mudar backends
  useEffect(() => { fetchData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [backends]);

  // auto-refresh 60s
  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    if (!intervalRef.current) {
      intervalRef.current = window.setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) { fetchData(); return 60; }
          return s - 1;
        });
      }, 1000);
    }
    return () => {
      if (intervalRef.current) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, backends]);

  function clearFilters() {
    setFSite(''); setFPoint(''); setFValue('');
    setFDateFrom(''); setFDateTo('');
    setFPriority('');
    setFAck('all'); setFDisc('all');
    setSortKey('dateTime'); setSortDir('desc');
  }

  const filtered = useMemo(() => {
    const from = fDateFrom ? new Date(`${fDateFrom}T00:00:00`).getTime() : undefined;
    const to   = fDateTo   ? new Date(`${fDateTo}T23:59:59.999`).getTime() : undefined;
    const inc = (h: string, n: string) => h.toLowerCase().includes(n.trim().toLowerCase());

    const priNum = fPriority.trim() !== '' ? Number(fPriority) : undefined;
    const priIsNum = priNum !== undefined && !Number.isNaN(priNum);

    return rows.filter((r) => {
      const passSite  = !fSite || inc(r.site, fSite);
      const passPoint = !fPoint || inc(r.point, fPoint);
      const passValue = !fValue || inc(String(r.value), fValue);

      const ts = new Date(r.dateTimeISO).getTime();
      const passFrom = from === undefined ? true : ts >= from;
      const passTo   = to   === undefined ? true : ts <= to;

      const passAck  = fAck  === 'all' || (fAck  === 'sim' ? r.reconhecido === 'Sim' : r.reconhecido === 'Não');
      const passDisc = fDisc === 'all' || (fDisc === 'sim' ? r.descartado  === 'Sim' : r.descartado  === 'Não');

      const passPriority =
        fPriority.trim() === ''
          ? true
          : priIsNum
            ? r.priority === priNum
            : String(r.priority).includes(fPriority.trim());

      return passSite && passPoint && passValue && passFrom && passTo && passAck && passDisc && passPriority;
    });
  }, [rows, fSite, fPoint, fValue, fDateFrom, fDateTo, fAck, fDisc, fPriority]);

  const sorted = useMemo(() => {
    const data = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    data.sort((a, b) => {
      switch (sortKey) {
        case 'dateTime': {
          const ta = new Date(a.dateTimeISO).getTime();
          const tb = new Date(b.dateTimeISO).getTime();
          return (ta - tb) * dir;
        }
        case 'server':       return a.server.localeCompare(b.server) * dir;
        case 'site':         return a.site.localeCompare(b.site) * dir;
        case 'point':        return a.point.localeCompare(b.point) * dir;
        case 'priority':     return (a.priority - b.priority) * dir;
        case 'reconhecido':  return a.reconhecido.localeCompare(b.reconhecido) * dir;
        case 'descartado':   return a.descartado.localeCompare(b.descartado) * dir;
        case 'idade':        return (ageMs(a.dateTimeISO) - ageMs(b.dateTimeISO)) * dir; // mais novo/velho
        case 'value': {
          // tenta ordenar numericamente se possível (ex.: "10 °C" -> 10)
          const num = (v: string) => {
            const m = v.match(/-?\d+([.,]\d+)?/);
            if (!m) return NaN;
            return parseFloat(m[0].replace(',', '.'));
          };
          const na = num(a.value);
          const nb = num(b.value);
          if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * dir;
          return a.value.localeCompare(b.value) * dir;
        }
        default: return 0;
      }
    });
    return data;
  }, [filtered, sortKey, sortDir]);

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '↕';

  function onSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const btnLabel = loading
    ? 'Atualizando…'
    : autoRefresh
      ? `Atualizar alarmes (${secondsLeft}s)`
      : 'Atualizar alarmes';

  return (
    <div className="alarms-container">
      <div className="alarms-toolbar">
        <button onClick={fetchData} disabled={loading} className="btn-refresh mono">
          {btnLabel}
        </button>

        <label className="auto-toggle">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto (1 min)
        </label>

        <button className="btn-clear" onClick={() => setShowApiMgr(true)}>Gerenciar APIs</button>

        <input
          className="filter-input"
          placeholder="Filtro por Site"
          value={fSite}
          onChange={(e) => setFSite(e.target.value)}
        />
        <input
          className="filter-input"
          placeholder="Filtro por Ponto"
          value={fPoint}
          onChange={(e) => setFPoint(e.target.value)}
        />
        <input
          className="filter-input"
          placeholder="Filtro por Valor"
          value={fValue}
          onChange={(e) => setFValue(e.target.value)}
        />

        <input
          className="filter-input small"
          type="date"
          value={fDateFrom}
          onChange={(e) => setFDateFrom(e.target.value)}
          title="Data: De"
        />
        <span className="range-dash">—</span>
        <input
          className="filter-input small"
          type="date"
          value={fDateTo}
          onChange={(e) => setFDateTo(e.target.value)}
          title="Data: Até"
        />

        <input
          className="filter-input small"
          placeholder="Prioridade"
          value={fPriority}
          onChange={(e) => setFPriority(e.target.value)}
          title="Prioridade (ex: 0, 1, 2...)"
        />

        <select
          className="filter-select"
          value={fAck}
          onChange={(e) => setFAck(e.target.value as 'all' | 'sim' | 'nao')}
          title="Reconhecido"
        >
          <option value="all">Reconhecido: Todos</option>
          <option value="sim">Reconhecido: Sim</option>
          <option value="nao">Reconhecido: Não</option>
        </select>

        <select
          className="filter-select"
          value={fDisc}
          onChange={(e) => setFDisc(e.target.value as 'all' | 'sim' | 'nao')}
          title="Descartado"
        >
          <option value="all">Descartado: Todos</option>
          <option value="sim">Descartado: Sim</option>
          <option value="nao">Descartado: Não</option>
        </select>

        <button onClick={clearFilters} className="btn-clear">Limpar filtros</button>

        <span className="status">
          {Object.keys(backendErrors).length
            ? `Falhas: ${Object.values(backendErrors).length}`
            : 'Conectado'}
        </span>
        <span className="count">Total: {sorted.length}</span>

        {/* Mostrar/Ocultar colunas */}
        <div className="col-controls">
          {(
            [
              ['server', 'Servidor'],
              ['dateTime', 'Data - Hora'],
              ['site', 'Site'],
              ['point', 'Ponto'],
              ['value', 'Valor'],
              ['priority', 'Prioridade'],
              ['reconhecido', 'Reconhecido'],
              ['descartado', 'Descartado'],
              ['idade', 'Idade'],
              ['comentario', 'Comentário'],
            ] as [keyof VisibleCols, string][]
          ).map(([key, label]) => (
            <label key={key} className="col-toggle">
              <input
                type="checkbox"
                checked={visibleCols[key]}
                onChange={() => toggleCol(key)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <table className="alarms-table">
        <thead>
          <tr>
            {visibleCols.server && (
              <th onClick={() => onSort('server')} className="sortable">
                Servidor <span className="arrow">{arrow('server')}</span>
              </th>
            )}
            {visibleCols.dateTime && (
              <th
                onClick={() => onSort('dateTime')}
                className="sortable"
                aria-sort={sortKey === 'dateTime' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Data - Hora <span className="arrow">{arrow('dateTime')}</span>
              </th>
            )}
            {visibleCols.site && (
              <th onClick={() => onSort('site')} className="sortable">
                Site <span className="arrow">{arrow('site')}</span>
              </th>
            )}
            {visibleCols.point && (
              <th onClick={() => onSort('point')} className="sortable">
                Ponto <span className="arrow">{arrow('point')}</span>
              </th>
            )}
            {visibleCols.value && (
              <th onClick={() => onSort('value')} className="sortable">
                Valor <span className="arrow">{arrow('value')}</span>
              </th>
            )}
            {visibleCols.priority && (
              <th onClick={() => onSort('priority')} className="sortable col-priority">
                Prioridade <span className="arrow">{arrow('priority')}</span>
              </th>
            )}
            {visibleCols.reconhecido && (
              <th onClick={() => onSort('reconhecido')} className="sortable">
                Reconhecido <span className="arrow">{arrow('reconhecido')}</span>
              </th>
            )}
            {visibleCols.descartado && (
              <th onClick={() => onSort('descartado')} className="sortable">
                Descartado <span className="arrow">{arrow('descartado')}</span>
              </th>
            )}
            {visibleCols.idade && (
              <th onClick={() => onSort('idade')} className="sortable">
                Idade <span className="arrow">{arrow('idade')}</span>
              </th>
            )}
            {visibleCols.comentario && <th>Comentário</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const hasComment = (comments[r.id] ?? '').trim().length > 0;
            const isOld = ageMs(r.dateTimeISO) > TWO_HOURS_MS;

            // prioridade: vermelho (>2h) tem precedência sobre amarelo (comentário)
            const rowStyle: React.CSSProperties = isOld
              ? { backgroundColor: '#ffd6d6' } // vermelho claro
              : hasComment
                ? { backgroundColor: '#fff9c4' } // amarelo suave
                : {};

            return (
              <tr key={r.id} className={hasComment ? 'has-comment' : ''} style={rowStyle}>
                {visibleCols.server && <td>{r.server}</td>}
                {visibleCols.dateTime && (
                  <td title={r.dateTimeISO}>
                    {r.dateTime}
                  </td>
                )}
                {visibleCols.site && <td>{r.site}</td>}
                {visibleCols.point && <td>{r.point}</td>}
                {visibleCols.value && <td>{r.value}</td>}
                {visibleCols.priority && <td className="col-priority">{r.priority}</td>}
                {visibleCols.reconhecido && <td>{r.reconhecido}</td>}
                {visibleCols.descartado && <td>{r.descartado}</td>}
                {visibleCols.idade && (
                  <td title={new Date(r.dateTimeISO).toLocaleString('pt-BR')}>
                    {formatAge(r.dateTimeISO)}
                  </td>
                )}
                {visibleCols.comentario && (
                  <td className="comment-cell">
                    <textarea
                      className="comment-input"
                      rows={1}
                      value={comments[r.id] ?? ''}
                      placeholder="Escreva um comentário…"
                      onChange={(e) => setComments((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      onBlur={() => saveComment(r.id, comments[r.id] ?? '')}
                      onInput={(e) => {
                        const el = e.currentTarget;
                        el.style.height = 'auto';
                        el.style.height = el.scrollHeight + 'px';
                      }}
                    />
                  </td>
                )}
              </tr>
            );
          })}
          {!loading && !err && sorted.length === 0 && (
            <tr>
              <td
                colSpan={Object.values(visibleCols).filter(Boolean).length || 1}
                style={{ textAlign: 'center' }}
              >
                Nenhum alarme encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Modal Gerenciar APIs */}
      {showApiMgr && (
        <div className="modal">
          <div className="modal-content">
            <div className="modal-head">
              <h3>Gerenciar APIs</h3>
              <button className="api-close" onClick={() => setShowApiMgr(false)}>×</button>
            </div>

            <div className="api-list">
              {backends.map((b) => (
                <div key={b.id} className="api-item">
                  <label className="api-toggle">
                    <input type="checkbox" checked={b.enabled} onChange={() => toggleBackend(b.id)} />
                    Ativo
                  </label>
                  <div className="api-desc">
                    <div><strong>{b.label}</strong></div>
                    <div className="api-meta">{b.baseUrl}</div>
                  </div>
                  {backendErrors[b.id] && <span className="api-error-tip" title={backendErrors[b.id]}>⚠ {backendErrors[b.id]}</span>}
                  <div className="api-actions">
                    <button className="btn-clear" onClick={() => testBackend(b)}>Testar</button>
                    <button className="btn-danger" onClick={() => removeBackend(b.id)}>Remover</button>
                  </div>
                </div>
              ))}
            </div>

            <hr className="api-div" />

            <div className="api-form">
              <h4>Adicionar nova API</h4>
              <div className="api-grid">
                <input
                  className="filter-input"
                  placeholder="Nome do servidor"
                  value={newApi.label || ''}
                  onChange={(e) => setNewApi({ ...newApi, label: e.target.value })}
                />
                <input
                  className="filter-input"
                  placeholder="Base URL (ex.: 10.2.1.120, 10.2.1.120/api ou /api120)"
                  value={newApi.baseUrl || ''}
                  onChange={(e) => setNewApi({ ...newApi, baseUrl: e.target.value })}
                  onBlur={(e) => setNewApi((prev) => ({ ...prev, baseUrl: normalizeNewBaseUrl(e.target.value) }))}
                />
                <input
                  className="filter-input"
                  placeholder="Usuário"
                  value={newApi.username || ''}
                  onChange={(e) => setNewApi({ ...newApi, username: e.target.value })}
                />
                <input
                  className="filter-input"
                  placeholder="Senha - GMX3-Rel.10"
                  type="password"
                  value={newApi.password || ''}
                  onChange={(e) => setNewApi({ ...newApi, password: e.target.value })}
                />
              </div>
              <div className="api-actions">
                <button className="btn-clear" onClick={addBackend}>Adicionar</button>
                <button className="btn-clear" onClick={() => setShowApiMgr(false)}>Fechar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
