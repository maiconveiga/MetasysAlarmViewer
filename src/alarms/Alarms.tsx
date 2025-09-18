import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./Alarms.css";
import {
  normalizeValue,
  mapUnit,
  formatDateWithOffset,
  type AlarmDTO,
} from "../lib/api";

import {
  FiRefreshCcw,
  FiSettings,
  FiLayout,
  FiChevronUp,
  FiChevronDown,
  FiX,
  FiAlertTriangle,
  FiXCircle,
} from "react-icons/fi";

/* ===== Tipos ===== */
type Row = {
  id: string;
  server: string;
  dateTimeISO: string;     // original (API)
  dateTime: string;        // exibido com offset
  dateTimeAdjMs: number;   // timestamp ajustado (ms)
  site: string;
  point: string;
  value: string;
  priority: number;
  reconhecido: "Sim" | "Não";
  descartado: "Sim" | "Não";
};

type SortKey =
  | "dateTime"
  | "site"
  | "point"
  | "value"
  | "priority"
  | "reconhecido"
  | "descartado"
  | "server"
  | "idade";
type SortDir = "asc" | "desc";

type BackendCfg = {
  id: string;
  label: string;
  baseUrl: string;
  username: string;
  password: string;
  enabled: boolean;
  offsetSign?: "+" | "-";
  offsetHours?: number;
};

/* ===== Persistência ===== */
const BACKENDS_KEY = "alarms_backends_v1";
const COLS_KEY = "alarms_visible_cols";
const TOOLBAR_PINNED_KEY = "alarms_toolbar_pinned_v1";
const COMMENT_KEY = (id: string) => `alarm_comment_${id}`;
const COMMENT_LIST_KEY = (id: string) => `alarm_comment_list_${id}`;
type CommentEntry = { ts: number; text: string };
const loadCommentList = (id: string): CommentEntry[] => { try { const raw = localStorage.getItem(COMMENT_LIST_KEY(id)); return raw ? JSON.parse(raw) : []; } catch { return []; } };
const saveCommentList = (id: string, list: CommentEntry[]) => { try { localStorage.setItem(COMMENT_LIST_KEY(id), JSON.stringify(list)); } catch {} };

const loadBackends = (): BackendCfg[] => {
  try {
    const raw = localStorage.getItem(BACKENDS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [
    { id: "b100", label: "ROC",   baseUrl: "https://10.2.1.100/api/v3", username: "api", password: "GMX3-Rel.10", enabled: true },
    { id: "b69",  label: "BRPRA", baseUrl: "https://10.2.1.69/api/v3",  username: "api", password: "GMX3-Rel.10", enabled: true },
    { id: "b15",  label: "FLFC",  baseUrl: "https://192.168.7.15/api/v2", username: "api", password: "GMX3-Rel.10", enabled: true },
  ];
};
const saveBackends = (list: BackendCfg[]) => { try { localStorage.setItem(BACKENDS_KEY, JSON.stringify(list)); } catch {} };
const loadComment = (id: string) => { try { return localStorage.getItem(COMMENT_KEY(id)) ?? ""; } catch { return ""; } };
const saveComment = (id: string, text: string) => { try { localStorage.setItem(COMMENT_KEY(id), text); } catch {} };

type VisibleCols = {
  server: boolean; dateTime: boolean; site: boolean; point: boolean; value: boolean;
  priority: boolean; reconhecido: boolean; descartado: boolean; idade: boolean; comentario: boolean;
};
const loadVisibleCols = (): VisibleCols => {
  try { const raw = localStorage.getItem(COLS_KEY); if (raw) return JSON.parse(raw); } catch {}
  return { server: true, dateTime: true, site: true, point: true, value: true, priority: true, reconhecido: true, descartado: true, idade: true, comentario: true };
};
const saveVisibleCols = (cols: VisibleCols) => { try { localStorage.setItem(COLS_KEY, JSON.stringify(cols)); } catch {} };

/* ===== HTTP ===== */
const normalizeBaseApi = (raw: string) => {
  let base = (raw || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (base.startsWith("/")) return base;
  try {
    const u = new URL(base);
    if (!u.pathname || u.pathname === "/") base = `${base}/api`;
  } catch {}
  return base.replace(/\/+$/, "");
};
function toDevProxyUrl(baseUrl: string, path: string, extraQS?: Record<string, string | undefined>) {
  const base = normalizeBaseApi(baseUrl);
  const p = path.startsWith("/") ? path : `/${path}`;
  if (import.meta.env.DEV && !base.startsWith("/")) {
    const qs = new URLSearchParams({ target: base, path: p });
    if (extraQS) for (const [k, v] of Object.entries(extraQS)) if (v !== undefined) qs.append(k, v);
    return `/proxy?${qs.toString()}`;
  }
  const qs = new URLSearchParams();
  if (extraQS) for (const [k, v] of Object.entries(extraQS)) if (v !== undefined) qs.append(k, v);
  return `${base}${p}${qs.toString() ? `?${qs.toString()}` : ""}`;
}
type LoginResponse = { accessToken?: string };
type AlarmsResponse = { total: number; items: AlarmDTO[] };

async function loginBase(baseUrl: string, username: string, password: string): Promise<string> {
  const res = await fetch(toDevProxyUrl(baseUrl, "/login"), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password })
  });
  if (!res.ok) { const text = await res.text().catch(() => ""); throw new Error(`Falha no login (${res.status}) ${text || ""}`.trim()); }
  const token = ((await res.json()) as LoginResponse)?.accessToken;
  if (!token) throw new Error("Login sem accessToken"); return token;
}
async function getAlarmsBase(baseUrl: string, token: string, opts?: { isAcknowledged?: boolean; isDiscarded?: boolean }) {
  const qs: Record<string, string> = { pageSize: "100" };
  if (opts?.isAcknowledged !== undefined) qs.isAcknowledged = String(opts.isAcknowledged);
  if (opts?.isDiscarded !== undefined)   qs.isDiscarded   = String(opts.isDiscarded);
  const res = await fetch(toDevProxyUrl(baseUrl, "/alarms/", qs), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const text = await res.text().catch(() => ""); throw new Error(`Falha ao buscar (${res.status}) ${text || ""}`.trim()); }
  return (await res.json()) as AlarmsResponse;
}

/* ===== Helpers ===== */
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const numFromStr = (v: string) => { const m = v.match(/-?\d+([.,]\d+)?/); return m ? parseFloat(m[0].replace(",", ".")) : NaN; };
const calcAdjMs = (iso: string, sign: "+" | "-" = "+", hours = 0) =>
  new Date(iso).getTime() + (sign === "+" ? 1 : -1) * (hours || 0) * 3600_000;
const formatAge = (fromMs: number) => {
  const s = Math.max(0, Math.floor((Date.now() - fromMs) / 1000));
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (s < 60) return "agora"; if (m < 60) return `${m}m ${s % 60}s`; if (h < 24) return `${h}h ${m % 60}m`; return `${d}d ${h % 24}h`;
};


/* ===== Pie Chart (SVG) simples ===== */
type PieDatum = { label: string; value: number };
const PIE_COLORS = ["#4CAF50","#F44336","#2196F3","#FFC107","#9C27B0","#00BCD4","#FF9800"];
const polar = (cx:number,cy:number,r:number,a:number)=>({x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)});
const arcPath = (cx:number,cy:number,r:number,a0:number,a1:number)=>`M ${cx} ${cy} L ${polar(cx,cy,r,a0).x} ${polar(cx,cy,r,a0).y} A ${r} ${r} 0 ${a1-a0>Math.PI?1:0} 1 ${polar(cx,cy,r,a1).x} ${polar(cx,cy,r,a1).y} Z`;
function PieChart({ data, title, size=220, thickness=0 }: { data: PieDatum[]; title?: string; size?: number; thickness?: number; }) {
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0), cx=size/2, cy=size/2, r=size/2-2;
  let ang = -Math.PI/2;
  const segs = data.map((d,i)=>{ const f = total ? (Number(d.value) || 0) / total : 0, a0=ang, a1=a0+f*Math.PI*2; ang=a1; return {...d,a0,a1,color:PIE_COLORS[i%PIE_COLORS.length]}; });
  return (
    <div style={{width:"100%"}}>
      {title && <div style={{fontWeight:600,marginBottom:8,textAlign:"center"}}>{title}</div>}
      <div style={{display:"flex",justifyContent:"center"}}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {segs.map((s,i)=><path key={i} d={arcPath(cx,cy,r,s.a0,s.a1)} fill={s.color} stroke="#fff" strokeWidth={1}/>)}
          {thickness>0 && <circle cx={cx} cy={cy} r={r-thickness} fill="#fff" />}
        </svg>
      </div>
      <div style={{display:"grid",gap:6,marginTop:8}}>
        {segs.map((s,i)=>{ const pct = total? Math.round((s.value/total)*100):0; return (
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:14,justifyContent:"center"}}>
            <span style={{width:12,height:12,background:s.color,borderRadius:2,display:"inline-block"}}/>
            <span style={{minWidth:150,textAlign:"left"}}>{s.label}</span>
            <span style={{opacity:.85}}>{s.value}</span>
            <span style={{opacity:.6}}>({pct}%)</span>
          </div>
        );})}
        {total===0 && <div style={{opacity:.6,textAlign:"center"}}>Sem dados</div>}
      </div>
    </div>
  );
}

/* ===== Componente ===== */
// function PrioritySlider({ min, max, onMin, onMax }: Props) {
//   return (
//     <div className="toolbar-item priority-range">
//       <label className="priority-title">Prioridade</label>
//       <div className="range-row">
//         <input
//           type="range"
//           min={1}
//           max={4}
//           step={1}
//           value={min}
//           onChange={(e) => onMin(Math.min(Number(e.target.value), max))}
//         />
//         <input
//           type="range"
//           min={1}
//           max={4}
//           step={1}
//           value={max}
//           onChange={(e) => onMax(Math.max(Number(e.target.value), min))}
//         />
//       </div>
//       <div className="range-labels">
//         <span>{labelsByRank[min]}</span>
//         <span>–</span>
//         <span>{labelsByRank[max]}</span>
//       </div>
//     </div>
//   )
// }


export default function Alarms() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [backends, setBackends] = useState<BackendCfg[]>(loadBackends);
  const [backendErrors, setBackendErrors] = useState<Record<string, string>>({});

  const [fSite, setFSite] = useState(""), [fPoint, setFPoint] = useState(""), [fValue, setFValue] = useState("");
  const [fDateFrom, setFDateFrom] = useState(""), [fDateTo, setFDateTo] = useState("");
  const [fPriMin, setFPriMin] = useState(0), [fPriMax, setFPriMax] = useState(255);

  const [sortKey, setSortKey] = useState<SortKey>("dateTime");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [secondsLeft, setSecondsLeft] = useState(60);
  const timerRef = useRef<number | null>(null);

  const [comments, setComments] = useState<Record<string, string>>({});
  type AlarmStatus = "nao_tratado" | "tratado" | "concluido" | "oportunidade";
  const STATUS_KEY = (id: string) => `alarm_status_${id}`;
  const loadStatus = (id: string): AlarmStatus => { try { return (localStorage.getItem(STATUS_KEY(id)) as AlarmStatus) || "nao_tratado"; } catch { return "nao_tratado"; } };
  const saveStatus = (id: string, s: AlarmStatus) => { try { localStorage.setItem(STATUS_KEY(id), s); } catch {} };
  const [statuses, setStatuses] = useState<Record<string, AlarmStatus>>({});
  // Deriva status "ao vivo": reconhecido/descartado => concluido; senão, estado salvo
  const computedStatus = (r: Row): AlarmStatus => {
    if (r.reconhecido === "Sim" || r.descartado === "Sim") return "concluido";
    return (statuses[r.id] ?? "nao_tratado") as AlarmStatus;
  };

  const [statusFilter, setStatusFilter] = useState<"all" | AlarmStatus>("all");

  const [visibleCols, setVisibleCols] = useState<VisibleCols>(loadVisibleCols);
  const toggleCol = useCallback((k: keyof VisibleCols) => {
    setVisibleCols(prev => { const next = { ...prev, [k]: !prev[k] }; saveVisibleCols(next); return next; });
  }, []);

  const [viewMode, setViewMode] = useState<"table" | "cards">("cards");
  // Modal de Comentário/Status
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftComment, setDraftComment] = useState(""); 
  const [draftStatus, setDraftStatus] = useState<AlarmStatus>("nao_tratado");
  const [commentList, setCommentList] = useState<CommentEntry[]>([]);

  const openNoteModal = useCallback((id: string) => {
    setActiveId(id);
    setDraftComment("");
    setDraftStatus(statuses[id] ?? "nao_tratado");
    setCommentList(loadCommentList(id));
    setShowNoteModal(true);
  }, [comments, statuses]);

  const sendComment = useCallback(() => {
    if (!activeId) return;
    const id = activeId;
    const text = draftComment.trim();
    if (!text) return;
    const prev = loadCommentList(id);
    const entry: CommentEntry = { ts: Date.now(), text };
    const updated = [...prev, entry];
    saveCommentList(id, updated);
    setCommentList(updated);
    // Atualiza 'último comentário' e status (se não concluído)
    setComments(p => ({ ...p, [id]: text }));
    setStatuses(p => {
      const curr = p[id] ?? (statuses[id] ?? "nao_tratado");
      const next: AlarmStatus = curr === "concluido" ? "concluido" : "tratado";
      try { localStorage.setItem(STATUS_KEY(id), next); } catch {}
      return { ...p, [id]: next };
    });
    setDraftComment(""); // limpa e mantém modal aberto
  }, [activeId, draftComment, statuses]);
// const saveNoteModal = useCallback(() => {
//     if (!activeId) return;
//     const id = activeId;
//     setComments(prev => { const n={...prev,[id]:draftComment}; return n; });
//     saveComment(id, draftComment);
//     setStatuses(prev => { const n={...prev,[id]:draftStatus}; return n; });
//     saveStatus(id, draftStatus);
//     setShowNoteModal(false);
//   }, [activeId, draftComment, draftStatus]);


  // Toolbar retrátil — agora com switch On/Off
  const [toolbarPinned, setToolbarPinned] = useState<boolean>(() => {
    try { return localStorage.getItem(TOOLBAR_PINNED_KEY) === "1"; } catch { return false; }
  });
  const [toolbarOpen, setToolbarOpen] = useState<boolean>(true);
  useEffect(() => { try { localStorage.setItem(TOOLBAR_PINNED_KEY, toolbarPinned ? "1" : "0"); } catch {} }, [toolbarPinned]);

  const [showApiMgr, setShowApiMgr] = useState(false);
  const [newApi, setNewApi] = useState<Partial<BackendCfg>>({});
  const normalizeNewBaseUrl = (s: string) => !s ? "" : (s.startsWith("/") || s.startsWith("http") ? s.trim() : `https://${s.trim()}`);

  const addBackend = useCallback(() => {
    const baseRaw = normalizeNewBaseUrl(newApi.baseUrl || "");
    if (!baseRaw || !newApi.username || !newApi.password) { alert("Informe Base URL, Usuário e Senha."); return; }
    const b: BackendCfg = {
      id: (crypto as any)?.randomUUID?.() ?? String(Date.now()),
      label: (newApi.label || baseRaw) as string, baseUrl: baseRaw,
      username: newApi.username as string, password: newApi.password as string,
      enabled: true, offsetSign: (newApi.offsetSign as any) || "+", offsetHours: (newApi.offsetHours as any) || 0
    };
    const next = [...backends, b]; setBackends(next); saveBackends(next); setNewApi({});
  }, [backends, newApi]);

  const toggleBackend = useCallback((id: string) => {
    const next = backends.map(b => b.id===id ? { ...b, enabled: !b.enabled } : b); setBackends(next); saveBackends(next);
  }, [backends]);

  const removeBackend = useCallback((id: string) => {
    if (!confirm("Remover esta API?")) return; const next = backends.filter(b => b.id !== id); setBackends(next); saveBackends(next);
  }, [backends]);

  const testBackend = useCallback(async (b: BackendCfg) => {
    try { const token = await loginBase(b.baseUrl, b.username, b.password); await getAlarmsBase(b.baseUrl, token, {}); alert(`OK — ${b.label} respondeu.`);
      setBackendErrors(p => { const n={...p}; delete n[b.id]; return n; });
    } catch (e: any) { const msg = e?.message || "Erro desconhecido"; alert(`Falha — ${b.label}\n${msg}`); setBackendErrors(p => ({ ...p, [b.id]: msg })); }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const enabled = backends.filter(b => b.enabled);
      const all: Row[] = []; const errors: Record<string, string> = {};
      for (const b of enabled) {
        try {
          const token = await loginBase(b.baseUrl, b.username, b.password);
          const { items } = await getAlarmsBase(b.baseUrl, token, {});
          all.push(...(items || []).map(a => {
            const v = normalizeValue(a.triggerValue?.value), u = mapUnit(a.triggerValue?.units);
            const adjMs = calcAdjMs(a.creationTime, b.offsetSign || "+", b.offsetHours || 0);
            return {
              id: `${b.id}_${a.id}`,
              server: b.label,
              dateTimeISO: a.creationTime,
              dateTime: formatDateWithOffset(a.creationTime, b.offsetSign, b.offsetHours),
              dateTimeAdjMs: adjMs,
              site: a.itemReference,
              point: a.name || a.itemReference,
              value: u ? `${v} ${u}` : v,
              priority: Number.isFinite(a.priority as unknown as number) ? (a.priority as unknown as number) : 0,
              reconhecido: a.isAcknowledged ? "Sim" : "Não",
              descartado: a.isDiscarded ? "Sim" : "Não",
            } as Row;
          }));
        } catch (e: any) { errors[b.id] = e?.message || "Erro desconhecido"; }
      }
      setBackendErrors(errors); setRows(all);
      const next: Record<string, string> = {}; const nextStatus: Record<string, AlarmStatus> = {}; for (const r of all){ next[r.id] = loadComment(r.id); nextStatus[r.id] = loadStatus(r.id);} setComments(next); setStatuses(nextStatus);
      setSecondsLeft(60);
    } catch (e: any) { setErr(e?.message || "Erro geral"); }
    finally { setLoading(false); }
  }, [backends]);

  useEffect(() => { fetchData(); }, [fetchData]);
  // Mantém status "concluido" automaticamente quando reconhecido/descartado vierem da API
  useEffect(() => {
    if (rows.length === 0) return;
    setStatuses(prev => {
      const next = { ...prev };
      for (const r of rows) {
        const forceConcluded = (r.reconhecido === "Sim" || r.descartado === "Sim");
        const current = prev[r.id] ?? "nao_tratado";
        const derived = forceConcluded ? "concluido" : current;
        next[r.id] = derived;
        try { localStorage.setItem(STATUS_KEY(r.id), derived); } catch {}
      }
      return next;
    });
  }, [rows]);


  useEffect(() => {
    if (!timerRef.current) {
      timerRef.current = window.setInterval(() => {
        setSecondsLeft(s => { if (s <= 1) { fetchData(); return 60; } return s - 1; });
      }, 1000);
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [fetchData]);

  const clearFilters = useCallback(() => {
    setFSite(""); setFPoint(""); setFValue(""); setFDateFrom(""); setFDateTo("");
    setFPriMin(0); setFPriMax(255); setFAck("all"); setFDisc("all"); setSortKey("dateTime"); setSortDir("desc");
  }, []);

  const [fAck, setFAck] = useState<"all" | "sim" | "nao">("all");
  const [fDisc, setFDisc] = useState<"all" | "sim" | "nao">("all");

  /* ===== Filtro/Ordenação ===== */
  const lowered = useMemo(() => ({
    site: fSite.trim().toLowerCase(),
    point: fPoint.trim().toLowerCase(),
    value: fValue.trim().toLowerCase(),
  }), [fSite, fPoint, fValue]);

  const fromTo = useMemo(() => ({
    from: fDateFrom ? new Date(`${fDateFrom}T00:00:00`).getTime() : undefined,
    to:   fDateTo   ? new Date(`${fDateTo}T23:59:59.999`).getTime() : undefined,
  }), [fDateFrom, fDateTo]);

  const filtered = useMemo(() => {
    const inc = (h: string, n: string) => h.toLowerCase().includes(n);
    return rows.filter(r => {
      const st = computedStatus(r);
      const passStatus = statusFilter === "all" || statusFilter === st;

      const ts = r.dateTimeAdjMs;
      const passSite  = !lowered.site  || inc(r.site,  lowered.site);
      const passPoint = !lowered.point || inc(r.point, lowered.point);
      const passValue = !lowered.value || inc(String(r.value), lowered.value);
      const passFrom  = fromTo.from === undefined ? true : ts >= fromTo.from;
      const passTo    = fromTo.to   === undefined ? true : ts <= fromTo.to;
      const passAck   = fAck  === "all" || (fAck  === "sim" ? r.reconhecido === "Sim" : r.reconhecido === "Não");
      const passDisc  = fDisc === "all" || (fDisc === "sim" ? r.descartado  === "Sim" : r.descartado  === "Não");
      const passPri   = r.priority >= fPriMin && r.priority <= fPriMax;
      return passSite && passPoint && passValue && passFrom && passTo && passAck && passDisc && passPri && passStatus;
    });
  }, [rows, lowered, fromTo, fAck, fDisc, fPriMin, fPriMax, statusFilter, statuses]);

  const sorted = useMemo(() => {
    const data = [...filtered], dir = sortDir === "asc" ? 1 : -1, now = Date.now();
    data.sort((a, b) => {
      switch (sortKey) {
        case "dateTime": return (a.dateTimeAdjMs - b.dateTimeAdjMs) * dir;
        case "server": return a.server.localeCompare(b.server) * dir;
        case "site": return a.site.localeCompare(b.site) * dir;
        case "point": return a.point.localeCompare(b.point) * dir;
        case "priority": return (a.priority - b.priority) * dir;
        case "reconhecido": return a.reconhecido.localeCompare(b.reconhecido) * dir;
        case "descartado": return a.descartado.localeCompare(b.descartado) * dir;
        case "idade": {
          const ageA = now - a.dateTimeAdjMs, ageB = now - b.dateTimeAdjMs; return (ageA - ageB) * dir;
        }
        case "value": {
          const na = numFromStr(a.value), nb = numFromStr(b.value);
          return (!Number.isNaN(na) && !Number.isNaN(nb) ? (na - nb) : a.value.localeCompare(b.value)) * dir;
        }
        default: return 0;
      }
    });
    return data;
  }, [filtered, sortKey, sortDir]);

  /* ===== Stats ===== */
  const statsAll = useMemo(() => {
    const total = filtered.length, disc = filtered.filter(r => r.descartado === "Sim").length, ack = filtered.filter(r => r.reconhecido === "Sim").length;
    return { pie: [
      { label: "Reconhecido", value: ack },
      { label: "Não reconhecido", value: total - ack },
      { label: "Descartado", value: disc },
      { label: "Não descartado", value: total - disc },
    ] };
  }, [filtered]);

  const statsAging = useMemo(() => {
    const old = filtered.filter(r => Date.now() - r.dateTimeAdjMs > TWO_HOURS_MS).length;
    return { pie: [{ label: "Até 2h", value: filtered.length - old }, { label: "Maior que 2h", value: old }] };
  }, [filtered]);

  /* ===== UI helpers ===== */
  const arrowIcon = (k: SortKey) =>
    sortKey === k ? (sortDir === "asc" ? <FiChevronUp /> : <FiChevronDown />) : <span className="arrow">↕</span>;
  const onSort = useCallback((k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("asc"); }
  }, [sortKey]);
  const btnLabel = loading ? "Atualizando…" : `Atualizar alarmes (${secondsLeft}s)`;
  const backendErrorCount = useMemo(() => Object.keys(backendErrors).length, [backendErrors]);

  return (
    <div className="alarms-container">
      {/* ===== Toolbar retrátil ===== */}
      <div
        className={`toolbar-shell ${toolbarPinned ? "pinned open" : toolbarOpen ? "open" : "collapsed"}`}
        onMouseEnter={() => !toolbarPinned && setToolbarOpen(true)}
        onMouseLeave={() => !toolbarPinned && setToolbarOpen(false)}
        onClick={() => { if (!toolbarPinned && !toolbarOpen) setToolbarOpen(true); }}
      >
        <div className="alarms-toolbar">
          {/* Switch On/Off: Fixar menu */}
          <label className={`switch ${toolbarPinned ? "on" : ""}`} title="Fixar menu">
            <input
              type="checkbox"
              checked={toolbarPinned}
              onChange={() => { setToolbarPinned(v => !v); if (!toolbarPinned) setToolbarOpen(true); }}
              aria-label="Fixar/soltar barra"
            />
            <span className="track" aria-hidden="true"></span>
            <span className="thumb" aria-hidden="true"></span>
            <span className="switch-text">{toolbarPinned ? "Fixo" : "Solto"}</span>
          </label>

          {/* Ações principais */}
          <button type="button" onClick={fetchData} disabled={loading} className="btn-refresh mono">
            <FiRefreshCcw /> {btnLabel}
          </button>
          <button type="button" className="btn-clear" onClick={() => setShowApiMgr(true)}>
            <FiSettings /> Gerenciar APIs
          </button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn-clear"
              onClick={() => setViewMode(m => m === "cards" ? "table" : "cards")}
              title="Alternar entre Tabela e Cards"
            >
              <FiLayout /> {viewMode === "cards" ? "Tabela" : "Cards"}
            </button>
          </div>

          {/* Filtros */}
          <input className="filter-input" placeholder="Filtro por Site"  value={fSite}  onChange={(e) => setFSite(e.target.value)} />
          <input className="filter-input" placeholder="Filtro por Ponto" value={fPoint} onChange={(e) => setFPoint(e.target.value)} />
          <input className="filter-input" placeholder="Filtro por Valor" value={fValue} onChange={(e) => setFValue(e.target.value)} />
          <input className="filter-input small" type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} title="Data: De" />
          <span className="range-dash">—</span>
          <input className="filter-input small" type="date" value={fDateTo}   onChange={(e) => setFDateTo(e.target.value)}   title="Data: Até" />

          {/* Prioridade */}
          <div className="toolbar-item prio-range">
            <label className="prio-label">Prioridade (0–255)</label>
            <div className="prio-sliders">
              <input type="range" min={0} max={255} step={1} value={fPriMin} onChange={(e) => setFPriMin(Math.min(Number(e.target.value), fPriMax))} />
              <input type="range" min={0} max={255} step={1} value={fPriMax} onChange={(e) => setFPriMax(Math.max(Number(e.target.value), fPriMin))} />
            </div>
            <div className="prio-values">
              <span className="badge">Mín: <strong>{fPriMin}</strong></span>
              <span className="sep">—</span>
              <span className="badge">Máx: <strong>{fPriMax}</strong></span>
            </div>
          </div>
          <select className="filter-select" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as any)} title="Status do tratamento">
            <option value="all">Status: Todos</option>
            <option value="nao_tratado">Não tratado</option>
            <option value="tratado">Tratado</option>
            <option value="concluido">Concluído</option>
            <option value="oportunidade">Oportunidade</option>
          </select>
          {/* Reconhecido / Descartado */}
          <select className="filter-select" value={fAck}  onChange={(e) => setFAck(e.target.value as any)} title="Reconhecido">
            <option value="all">Reconhecido: Todos</option><option value="sim">Reconhecido: Sim</option><option value="nao">Reconhecido: Não</option>
          </select>
          <select className="filter-select" value={fDisc} onChange={(e) => setFDisc(e.target.value as any)} title="Descartado">
            <option value="all">Descartado: Todos</option><option value="sim">Descartado: Sim</option><option value="nao">Descartado: Não</option>
          </select>

          {/* Ordenação + Limpar filtros (alinhados) */}
          <div className="cards-toolbar">
            <label className="sort-control">
              Ordenar por:
              <select className="filter-select" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                {visibleCols.server && <option value="server">Servidor</option>}
                <option value="dateTime">Data - Hora</option>
                {visibleCols.site && <option value="site">Site</option>}
                {visibleCols.point && <option value="point">Ponto</option>}
                <option value="value">Valor</option>
                <option value="priority">Prioridade</option>
                <option value="reconhecido">Reconhecido</option>
                <option value="descartado">Descartado</option>
                <option value="idade">Idade</option>
              </select>
            </label>
            <button type="button" className="btn-clear" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")} title="Alternar direção (asc/desc)">
              {sortDir === "asc" ? <>Asc <FiChevronUp /></> : <>Desc <FiChevronDown /></>}
            </button>

            {/* Limpar filtros aqui, alinhado ao sort */}
            <button type="button" onClick={clearFilters} className="btn-clear clear-inline">
              <FiXCircle /> Limpar filtros
            </button>
          </div>

          <span className="status">{backendErrorCount ? <><FiAlertTriangle /> Falhas: {backendErrorCount}</> : "Conectado!"}</span>
          <span className="count">Total de alarmes: {sorted.length}</span>
        </div>
      </div>

      {/* ===== Conteúdo ===== */}
      <div className="content">
        {viewMode === "table" && (
          <div className="alarms-table-scroll">
            <div className="col-controls">
              {(
                [
                  ["server","Servidor"],["dateTime","Data - Hora"],["site","Site"],["point","Ponto"],["value","Valor"],
                  ["priority","Prioridade"],["reconhecido","Reconhecido"],["descartado","Descartado"],["idade","Idade"],["comentario","Comentário"],
                ] as [keyof VisibleCols, string][]
              ).map(([key, label]) => (
                <label key={key} className="col-toggle">
                  <input type="checkbox" checked={visibleCols[key]} onChange={() => toggleCol(key)} /> {label}
                </label>
              ))}
            </div>

            <table className="alarms-table">
              <thead>
                <tr>
                  {visibleCols.server && <th onClick={() => onSort("server")} className="sortable">Servidor {arrowIcon("server")}</th>}
                  {visibleCols.dateTime && (
                    <th onClick={() => onSort("dateTime")} className="sortable" aria-sort={sortKey === "dateTime" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      Data - Hora {arrowIcon("dateTime")}
                    </th>
                  )}
                  {visibleCols.site && <th onClick={() => onSort("site")} className="sortable">Site {arrowIcon("site")}</th>}
                  {visibleCols.point && <th onClick={() => onSort("point")} className="sortable">Ponto {arrowIcon("point")}</th>}
                  {visibleCols.value && <th onClick={() => onSort("value")} className="sortable">Valor {arrowIcon("value")}</th>}
                  {visibleCols.priority && <th onClick={() => onSort("priority")} className="sortable col-priority">Prioridade {arrowIcon("priority")}</th>}
                  {visibleCols.reconhecido && <th onClick={() => onSort("reconhecido")} className="sortable">Reconhecido {arrowIcon("reconhecido")}</th>}
                  {visibleCols.descartado && <th onClick={() => onSort("descartado")} className="sortable">Descartado {arrowIcon("descartado")}</th>}
                  {visibleCols.idade && <th onClick={() => onSort("idade")} className="sortable">Idade {arrowIcon("idade")}</th>}
                  {visibleCols.comentario && <th>Comentário</th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => {
                  // const hasComment = (comments[r.id] ?? "").trim().length > 0;
                  // const isOld = Date.now() - r.dateTimeAdjMs > TWO_HOURS_MS;
                  const status = computedStatus(r);
                  const rowStyle: React.CSSProperties = status === "concluido" ? { backgroundColor: "#e7fbe7" } : status === "tratado" ? { backgroundColor: "#fff9c4" } : (Date.now() - r.dateTimeAdjMs > TWO_HOURS_MS ? { backgroundColor: "#ffd6d6" } : {});
                  return (
                    <tr key={r.id} className={`${status==="tratado"?"status-tratado":""} ${status==="concluido"?"status-concluido":""} ${status==="oportunidade"?"status-oportunidade":""}`.trim()} style={rowStyle}>
                      {visibleCols.server && <td>{r.server}</td>}
                      {visibleCols.dateTime && <td title={new Date(r.dateTimeAdjMs).toLocaleString("pt-BR")}>{r.dateTime}</td>}
                      {visibleCols.site && <td>{r.site}</td>}
                      {visibleCols.point && <td>{r.point}</td>}
                      {visibleCols.value && <td>{r.value}</td>}
                      {visibleCols.priority && <td className="col-priority">{r.priority}</td>}
                      {visibleCols.reconhecido && <td>{r.reconhecido}</td>}
                      {visibleCols.descartado && <td>{r.descartado}</td>}
                      {visibleCols.idade && <td title={new Date(r.dateTimeAdjMs).toLocaleString("pt-BR")}>{formatAge(r.dateTimeAdjMs)}</td>}
                      {visibleCols.comentario && (
                        <td className="comment-cell">
                          <button type="button" className="btn-clear" onClick={() => openNoteModal(r.id)}>Comentário / Status</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!loading && !err && sorted.length === 0 && (
                  <tr><td colSpan={Object.values(visibleCols).filter(Boolean).length || 1} style={{ textAlign: "center" }}>Nenhum alarme encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {viewMode === "cards" && (
          <div className="cards-layout">
            <div className="cards-scroll">
              <div className="cards-grid">
                {sorted.map(r => {
                  const hasComment = (comments[r.id] ?? "").trim().length > 0;
                  const isOld = Date.now() - r.dateTimeAdjMs > TWO_HOURS_MS;
                  const status = computedStatus(r);
                  const cardClass = ["alarm-card","clickable", isOld ? "old" : "", status === "tratado" ? "status-tratado" : "", status === "concluido" ? "status-concluido" : "", status === "oportunidade" ? "status-oportunidade" : ""].join(" ").trim();
                  return (
                    <div key={r.id} className={cardClass} onClick={() => openNoteModal(r.id)} role="button" tabIndex={0} onKeyDown={(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openNoteModal(r.id); } }}>
                      <div className="card-head">
                        {visibleCols.server && <span className="chip server">{r.server}</span>}
                        {visibleCols.priority && <span className={`chip prio p${r.priority}`} title="Prioridade">P{r.priority}</span>}
                      </div>
                      <div className="card-title">
                        {visibleCols.point && <strong className="point">{r.point}</strong>}
                        {visibleCols.site && <span className="site">• {r.site}</span>}
                      </div>
                      <div className="card-meta">
                        {visibleCols.dateTime && <span className="meta"><span className="meta-label">Data/Hora:</span> {r.dateTime}</span>}
                        {visibleCols.idade && <span className="meta" title={new Date(r.dateTimeAdjMs).toLocaleString("pt-BR")}><span className="meta-label">Idade:</span> {formatAge(r.dateTimeAdjMs)}</span>}
                        {visibleCols.value && <span className="meta value"><span className="meta-label">Valor:</span> {r.value}</span>}
                      </div>
                      <div className="card-flags">
                        {visibleCols.reconhecido && <span className={`flag ${r.reconhecido === "Sim" ? "ok" : "warn"}`}>{r.reconhecido === "Sim" ? "Reconhecido" : "Não reconhecido"}</span>}
                        {visibleCols.descartado && <span className={`flag ${r.descartado === "Sim" ? "neutral" : "active"}`}>{r.descartado === "Sim" ? "Descartado" : "Não descartado"}</span>}
                        <span className={`flag status ${(statuses[r.id]||"nao_tratado")==="concluido"?"done":(statuses[r.id]||"nao_tratado")==="tratado"?"progress":"pending"}`}>
                          {(statuses[r.id]||"nao_tratado")==="concluido"?"Concluído":(statuses[r.id]||"nao_tratado")==="tratado"?"Tratado":(statuses[r.id]||"nao_tratado")==="oportunidade"?"Oportunidade":"Não tratado"}
                        </span>
                      </div>
                      {/* {visibleCols.comentario && (
                        <div className="card-comment">
                          <textarea
                            className="comment-input" rows={1} value={comments[r.id] ?? ""} placeholder="Escreva um comentário…"
                            onChange={(e) => setComments(prev => ({ ...prev, [r.id]: e.target.value }))}
                            onBlur={() => saveComment(r.id, comments[r.id] ?? "")}
                            onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }}
                          />
                        </div>
                      )} */}
                    </div>
                  );
                })}
                {!loading && !err && sorted.length === 0 && <div className="empty-state">Nenhum alarme encontrado.</div>}
              </div>
            </div>

            {filtered.length > 0 && (
              <aside className="insight-panel">
                <PieChart title="Status do alarme" data={statsAll.pie} size={120} />
                <div style={{ height: 16 }} />
                <PieChart title="Alarmes por idade" data={statsAging.pie} size={120} />
              </aside>
            )}
          </div>
        )}
      </div>

      {/* ===== Modal Comentário/Status ===== */}
      {showNoteModal && activeId && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="noteModalTitle">
          <div className="modal-content">
            <div className="modal-head">
              <h3 id="noteModalTitle">Comentário e Status</h3>
              <button type="button" className="api-close" onClick={() => setShowNoteModal(false)} aria-label="Fechar">×</button>
            </div>
            <div style={{display:'grid', gap:10}}>
              {/* Histórico de comentários (mais recentes no topo) */}
              {commentList.length > 0 && (
                <div style={{display:'grid', gap:6}}>
                  <span><strong>Histórico</strong></span>
                  <div style={{display:'grid', gap:6, maxHeight:220, overflow:'auto', padding:'6px', border:'1px dashed #e2e8f0', borderRadius:8, background:'#fafafa'}}>
                    {[...commentList].reverse().map((c,i) => (
                      <div key={i} style={{display:'grid', gap:4, background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, padding:'8px'}}>
                        <div style={{fontSize:12, color:'#475569'}}>{new Date(c.ts).toLocaleString('pt-BR')}</div>
                        <div style={{whiteSpace:'pre-wrap'}}>{c.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            
              <label style={{display:'grid', gap:6}}>
                <span>Comentário</span>
                <textarea className="comment-input" rows={4} value={draftComment} onChange={(e)=>setDraftComment(e.target.value)} />
              </label>
              <label style={{display:'grid', gap:6}}>
                <span>Status</span>
                <select className="filter-select" value={draftStatus} onChange={(e)=>{ const v = e.target.value as any; setDraftStatus(v); if(activeId){ setStatuses(p=>{ const n={...p,[activeId]:v}; return n; }); try{ localStorage.setItem(STATUS_KEY(activeId), v);}catch{} } }}>
                  <option value="nao_tratado">Não tratado</option>
                  <option value="tratado">Tratado</option>
                  <option value="concluido">Concluído</option>
            <option value="oportunidade">Oportunidade</option>
                </select>
              </label>
              <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                <button type="button" className="btn-clear" onClick={()=>setShowNoteModal(false)}>Sair</button>
                <button type="button" className="btn-refresh" onClick={sendComment}>Enviar</button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ===== Modal Gerenciar APIs ===== */}
      {showApiMgr && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="apiMgrTitle">
          <div className="modal-content">
            <div className="modal-head">
              <h3 id="apiMgrTitle">Gerenciar APIs</h3>
              <button type="button" className="api-close" onClick={() => setShowApiMgr(false)} aria-label="Fechar">
                <FiX />
              </button>
            </div>

            <div className="api-list">
              {backends.map(b => (
                <div key={b.id} className="api-item">
                  <label className="api-toggle"><input type="checkbox" checked={b.enabled} onChange={() => toggleBackend(b.id)} />Ativo</label>
                  <div className="api-desc">
                    <div><strong>{b.label}</strong></div>
                    <div className="api-meta">{b.baseUrl}</div>
                    <div className="api-meta">Offset: {(b.offsetSign||"+")}{b.offsetHours||0}h</div>
                  </div>
                  {backendErrors[b.id] && <span className="api-error-tip" title={backendErrors[b.id]}>⚠ {backendErrors[b.id]}</span>}
                  <div className="api-actions">
                    <button type="button" className="btn-clear" onClick={() => testBackend(b)}>Testar</button>
                    <button type="button" className="btn-danger" onClick={() => removeBackend(b.id)}>Remover</button>
                  </div>
                </div>
              ))}
            </div>

            <hr className="api-div" />

            <div className="api-form">
              <h4>Adicionar nova API</h4>
              <div className="api-grid">
                <input className="filter-input" placeholder="Nome do servidor" value={newApi.label || ""} onChange={(e) => setNewApi({ ...newApi, label: e.target.value })} />
                <input className="filter-input" placeholder="https://xxx.xxx.xxx.xxx/api/vx" value={newApi.baseUrl || ""} onChange={(e) => setNewApi({ ...newApi, baseUrl: e.target.value })} onBlur={(e) => setNewApi(p => ({ ...p, baseUrl: normalizeNewBaseUrl(e.target.value) }))} />
                <input className="filter-input" placeholder="Usuário" value={newApi.username || ""} onChange={(e) => setNewApi({ ...newApi, username: e.target.value })} />
                <input className="filter-input" placeholder="Senha - GMX3-Rel.10" type="password" value={newApi.password || ""} onChange={(e) => setNewApi({ ...newApi, password: e.target.value })} />
                <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    Sinal
                    <select className="filter-input" value={newApi.offsetSign || "+"} onChange={(e) => setNewApi({ ...newApi, offsetSign: e.target.value as "+" | "-" })}>
                      <option value="+">+</option><option value="-">-</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    Offset (0–24h)
                    <input className="filter-input" type="number" min={0} max={24} step={1}
                      value={Number.isFinite(newApi.offsetHours as number) ? (newApi.offsetHours as number) : 0}
                      onChange={(e) => setNewApi({ ...newApi, offsetHours: Math.max(0, Math.min(24, Math.abs(parseInt(e.target.value || "0", 10)))) })}
                    />
                  </label>
                </div>
              </div>
              <div className="api-actions">
                <button type="button" className="btn-clear" onClick={addBackend}>Adicionar</button>
                <button type="button" className="btn-clear" onClick={() => setShowApiMgr(false)}>Fechar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
