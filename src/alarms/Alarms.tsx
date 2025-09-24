import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./Alarms.css";
import { normalizeValue, mapUnit, formatDateWithOffset, type AlarmDTO } from "../lib/api";
import { FiRefreshCcw, FiSettings, FiLayout, FiChevronUp, FiChevronDown, FiXCircle, FiAlertTriangle } from "react-icons/fi";

const API_HOST = "http://127.0.0.1:8000";

type ApiItem = {
  id: number;
  Servidor: string;
  IP: string;
  Usuario: string;
  Senha: string;
  offset: number;
  Versao: "V1"|"V2"|"V3"|"V4"|"V5"|"V6";
  QuantidadeAlarmes: number;
  Link?: string;
  BaseUrl?: string;
};

const versaoDown = (v?: string) => (v ? (v.toLowerCase() as BackendCfg["versao"]) : undefined);
const versaoUp = (v?: BackendCfg["versao"]) => (v ? (v.toUpperCase() as ApiItem["Versao"]) : "V1");

const apiToCfg = (a: ApiItem): BackendCfg => ({
  id: String(a.id),
  label: a.Servidor,
  ip: a.IP,
  versao: versaoDown(a.Versao),
  offset: a.offset,
  baseUrl: a.BaseUrl || buildBaseUrl(a.IP, versaoDown(a.Versao)),
  link: a.Link || (a.IP ? `https://${a.IP}/UI/alarms/` : undefined),
  backend: computeBackendFromVersao(versaoDown(a.Versao)),
  pageSize: a.QuantidadeAlarmes || 1,
  username: a.Usuario,
  password: a.Senha,
  enabled: true,
});

const cfgToApi = (b: Partial<BackendCfg>) => ({
  Servidor: b.label ?? "",
  IP: b.ip ?? "",
  Usuario: b.username ?? "",
  Senha: b.password ?? "",
  offset: b.offset ?? 0,
  Versao: versaoUp(b.versao),
  QuantidadeAlarmes: b.pageSize ?? 1,
});


type Row = {
  id: string;
  server: string;
  dateTimeISO: string;
  dateTime: string;
  dateTimeAdjMs: number;
  site: string;
  point: string;
  value: string;
  priority: number;
  reconhecido: "Sim" | "Não";
  descartado: "Sim" | "Não";
  message?: string;
};

type SortKey = "dateTime" | "site" | "point" | "value" | "priority" | "reconhecido" | "descartado" | "server" | "idade" | "mensagem";
type SortDir = "asc" | "desc";

type BackendCfg = {
  id: string;
  label: string;
  ip?: string;
  versao?: "v1" | "v2" | "v3" | "v4" | "v5" | "v6";
  offset?: number;
  baseUrl: string;
  link?: string;
  backend?: string;
  pageSize?: number;
  username: string;
  password: string;
  enabled: boolean;
  offsetSign?: "+" | "-";
  offsetHours?: number;
};

type AlarmStatus = "nao_tratado" | "tratado" | "concluido" | "oportunidade";

const groupKey = (o: { server: string; site: string; point: string }) => `${o.server}::${o.site}::${o.point}`;

const shouldPersist = (status: AlarmStatus, comment: string) => {
  const relevantes = new Set<AlarmStatus>(["tratado", "concluido", "oportunidade"]);
  return (comment && comment.trim().length > 0) || relevantes.has(status);
};

async function fetchBackendsFromApi(): Promise<BackendCfg[]> {
  const res = await fetch(`${API_HOST}/apis`);
  if (!res.ok) throw new Error(`Falha ao listar APIs (${res.status})`);
  const data = await res.json();
  const list: ApiItem[] = Array.isArray(data) ? data : [data];
  return list.map(apiToCfg);
}

async function createBackendApi(payload: Partial<BackendCfg>) {
  const res = await fetch(`${API_HOST}/apis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfgToApi(payload)),
  });
  if (!res.ok) throw new Error(`Falha ao criar API (${res.status})`);
}

async function updateBackendApi(id: string, payload: Partial<BackendCfg>) {
  const res = await fetch(`${API_HOST}/apis/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfgToApi(payload)),
  });
  if (!res.ok) throw new Error(`Falha ao atualizar API (${res.status})`);
}

async function deleteBackendApi(id: string) {
  const res = await fetch(`${API_HOST}/apis/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Falha ao remover API (${res.status})`);
}

async function persistIfRelevant(row: Row | undefined, status: AlarmStatus, comment: string, backends: BackendCfg[]) {
  try {
    if (!row || !shouldPersist(status, comment)) return;
    for (const b of backends.filter((x) => x.enabled)) {
      try {
        const url = toDevProxyUrl(b.baseUrl, "/notes");
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.id, server: row.server, site: row.site, point: row.point, status, comment, dateTime: row.dateTimeISO }),
        }).catch(() => {});
      } catch {}
    }
  } catch {}
}

// const BACKENDS_KEY = "alarms_backends_v2";
const COLS_KEY = "alarms_visible_cols";
const TOOLBAR_PINNED_KEY = "alarms_toolbar_pinned_v1";
const COMMENT_LIST_KEY = (gk: string) => `alarm_comment_list_${gk}`;
const STATUS_KEY = (gk: string) => `alarm_status_${gk}`;
const STATUS_LOG_KEY = (gk: string) => `alarm_status_log_${gk}`;

type CommentEntry = { ts: number; text: string };
type StatusEntry = { ts: number; status: AlarmStatus; reason?: "user" | "auto_new_alarm" };

const loadCommentList = (gk: string): CommentEntry[] => {
  try {
    const raw = localStorage.getItem(COMMENT_LIST_KEY(gk));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};
const saveCommentList = (gk: string, list: CommentEntry[]) => {
  try {
    localStorage.setItem(COMMENT_LIST_KEY(gk), JSON.stringify(list));
  } catch {}
};

// const migrateOldBackends = (list: any[]): BackendCfg[] =>
//   (list || []).map((b) => {
//     const off = typeof b.offset === "number" ? b.offset : (b.offsetHours ? (b.offsetSign === "-" ? -Math.abs(b.offsetHours) : Math.abs(b.offsetHours)) : 0) as number;
//     let ip = b.ip as string | undefined;
//     let versao = b.versao as BackendCfg["versao"] | undefined;
//     let link = b.link as string | undefined;
//     try {
//       const u = new URL(b.baseUrl);
//       ip = ip || u.hostname;
//       const m = u.pathname.match(/\/api\/(v\d+)/i);
//       if (m) versao = (m[1].toLowerCase() as any) || versao;
//       const l = new URL(u.toString());
//       l.pathname = "/UI/alarms/";
//       l.search = "";
//       l.hash = "";
//       link = link || l.toString();
//     } catch {}
//     return { ...b, offset: off, ip, versao, link, backend: computeBackendFromVersao(versao), pageSize: Number.isFinite(b.pageSize) ? Number(b.pageSize) : 1 } as BackendCfg;
//   });

// const loadBackends = (): BackendCfg[] => {
//   try {
//     const raw = localStorage.getItem(BACKENDS_KEY);
//     if (raw) return migrateOldBackends(JSON.parse(raw));
//     const rawV1 = localStorage.getItem("alarms_backends_v1");
//     if (rawV1) return migrateOldBackends(JSON.parse(rawV1));
//   } catch {}
//  // defaults sem pré-cadastrados
//   return migrateOldBackends([]);

// };
// const saveBackends = (list: BackendCfg[]) => {
//   try {
//     localStorage.setItem(BACKENDS_KEY, JSON.stringify(list));
//   } catch {}
// };

const loadStatus = (gk: string): AlarmStatus => {
  try {
    return (localStorage.getItem(STATUS_KEY(gk)) as AlarmStatus) || "nao_tratado";
  } catch {
    return "nao_tratado";
  }
};
const saveStatus = (gk: string, s: AlarmStatus) => {
  try {
    localStorage.setItem(STATUS_KEY(gk), s);
  } catch {}
};
const loadStatusLog = (gk: string): StatusEntry[] => {
  try {
    const raw = localStorage.getItem(STATUS_LOG_KEY(gk));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};
const saveStatusLog = (gk: string, list: StatusEntry[]) => {
  try {
    localStorage.setItem(STATUS_LOG_KEY(gk), JSON.stringify(list));
  } catch {}
};

type VisibleCols = {
  server: boolean;
  dateTime: boolean;
  site: boolean;
  point: boolean;
  value: boolean;
  priority: boolean;
  reconhecido: boolean;
  descartado: boolean;
  idade: boolean;
  mensagem: boolean;
  comentario: boolean;
};

const loadVisibleCols = (): VisibleCols => {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.mensagem !== "boolean") parsed.mensagem = true;
      return parsed;
    }
  } catch {}
  return { server: true, dateTime: true, site: true, point: true, value: true, priority: true, reconhecido: true, descartado: true, idade: true, mensagem: true, comentario: true };
};
const saveVisibleCols = (cols: VisibleCols) => {
  try {
    localStorage.setItem(COLS_KEY, JSON.stringify(cols));
  } catch {}
};

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
  const res = await fetch(toDevProxyUrl(baseUrl, "/login"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha no login (${res.status}) ${text || ""}`.trim());
  }
  const token = ((await res.json()) as LoginResponse)?.accessToken;
  if (!token) throw new Error("Login sem accessToken");
  return token;
}
async function getAlarmsBase(baseUrl: string, token: string, opts: { isAcknowledged?: boolean; isDiscarded?: boolean; pageSize?: number } = {}) {
  const qs: Record<string, string> = { pageSize: String(opts.pageSize ?? 1) };
  if (opts?.isAcknowledged !== undefined) qs.isAcknowledged = String(opts?.isAcknowledged);
  if (opts?.isDiscarded !== undefined) qs.isDiscarded = String(opts?.isDiscarded);
  const res = await fetch(toDevProxyUrl(baseUrl, "/alarms/", qs), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao buscar (${res.status}) ${text || ""}`.trim());
  }
  return (await res.json()) as AlarmsResponse;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const numFromStr = (v: string) => {
  const m = v.match(/-?\d+([.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : NaN;
};
const calcAdjMsUnified = (iso: string, offsetHours = 0) => new Date(iso).getTime() + (offsetHours || 0) * 3600_000;
const formatAge = (fromMs: number) => {
  const s = Math.max(0, Math.floor((Date.now() - fromMs) / 1000));
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (s < 60) return "agora";
  if (m < 60) return `${m}m ${s % 60}s`;
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${d}d ${h % 24}h`;
};

type PieDatum = { label: string; value: number };
const PIE_COLORS = ["#4CAF50", "#F44336", "#2196F3", "#FFC107", "#9C27B0", "#00BCD4", "#FF9800"];
const polar = (cx: number, cy: number, r: number, a: number) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
const arcPath = (cx: number, cy: number, r: number, a0: number, a1: number) =>
  `M ${cx} ${cy} L ${polar(cx, cy, r, a0).x} ${polar(cx, cy, r, a0).y} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${polar(cx, cy, r, a1).x} ${polar(cx, cy, r, a1).y} Z`;
function PieChart({ data, title, size = 220, thickness = 0 }: { data: PieDatum[]; title?: string; size?: number; thickness?: number }) {
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0), cx = size / 2, cy = size / 2, r = size / 2 - 2;
  let ang = -Math.PI / 2;
  const segs = data.map((d, i) => {
    const f = total ? (Number(d.value) || 0) / total : 0;
    const a0 = ang, a1 = a0 + f * Math.PI * 2;
    ang = a1;
    return { ...d, a0, a1, color: PIE_COLORS[i % PIE_COLORS.length] };
  });
  return (
    <div style={{ width: "100%" }}>
      {title && <div style={{ fontWeight: 600, marginBottom: 8, textAlign: "center" }}>{title}</div>}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {segs.map((s, i) => <path key={i} d={arcPath(cx, cy, r, s.a0, s.a1)} fill={s.color} stroke="#fff" strokeWidth={1} />)}
          {thickness > 0 && <circle cx={cx} cy={cy} r={r - thickness} fill="#fff" />}
        </svg>
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        {segs.map((s, i) => {
          const pct = total ? Math.round((s.value / total) * 100) : 0;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, justifyContent: "center" }}>
              <span style={{ width: 12, height: 12, background: s.color, borderRadius: 2, display: "inline-block" }} />
              <span style={{ minWidth: 150, textAlign: "left" }}>{s.label}</span>
              <span style={{ opacity: 0.85 }}>{s.value}</span>
              <span style={{ opacity: 0.6 }}>({pct}%)</span>
            </div>
          );
        })}
        {total === 0 && <div style={{ opacity: 0.6, textAlign: "center" }}>Sem dados</div>}
      </div>
    </div>
  );
}

function computeBackendFromVersao(versao?: BackendCfg["versao"]) {
  if (!versao) return undefined;
  const n = Number(versao.replace("v", ""));
  if (!Number.isFinite(n)) return undefined;
  return `https://10.2.1.133:${5000 + n}`;
}
function buildBaseUrl(ip?: string, versao?: BackendCfg["versao"]) {
  if (!ip || !versao) return "";
  return `https://${ip}/api/${versao}`;
}

type UnifiedHistEntry = { ts: number; kind: "comment" | "status"; text: string };
const prettyStatus = (s: AlarmStatus) => (s === "nao_tratado" ? "Não tratado" : s.charAt(0).toUpperCase() + s.slice(1));
const statusToText = (s: StatusEntry): string => `Status alterado para "${prettyStatus(s.status)}"${s.reason ? ` (${s.reason === "auto_new_alarm" ? "novo alarme" : "usuário"})` : ""}.`;

export default function Alarms() {
  useEffect(() => {
  (async () => {
    try {
      const list = await fetchBackendsFromApi();
      setBackends(list);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Falha ao carregar APIs");
    }
  })();
}, []);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  // const [backends, setBackends] = useState<BackendCfg[]>(loadBackends);
  const [backends, setBackends] = useState<BackendCfg[]>([]);
  const [backendErrors, setBackendErrors] = useState<Record<string, string>>({});
  const [fSite, setFSite] = useState(""), [fPoint, setFPoint] = useState(""), [fValue, setFValue] = useState("");
  const [fDateFrom, setFDateFrom] = useState(""), [fDateTo, setFDateTo] = useState("");
  const [fPriMin, setFPriMin] = useState(0), [fPriMax, setFPriMax] = useState(255);
  const [sortKey, setSortKey] = useState<SortKey>("dateTime");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [secondsLeft, setSecondsLeft] = useState(60);
  const timerRef = useRef<number | null>(null);
  const [statuses, setStatuses] = useState<Record<string, AlarmStatus>>({});
  const [statusFilter, setStatusFilter] = useState<"all" | AlarmStatus>("all");
  const [visibleCols, setVisibleCols] = useState<VisibleCols>(loadVisibleCols);
  const toggleCol = useCallback((k: keyof VisibleCols) => {
    setVisibleCols((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      saveVisibleCols(next);
      return next;
    });
  }, []);
  const [viewMode, setViewMode] = useState<"table" | "cards">("cards");

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [activeGk, setActiveGk] = useState<string | null>(null);
  const [draftComment, setDraftComment] = useState("");
  const [draftStatus, setDraftStatus] = useState<AlarmStatus>("nao_tratado");
  const [, setCommentList] = useState<CommentEntry[]>([]);
  const [, setStatusLog] = useState<StatusEntry[]>([]);
  const [unifiedHistory, setUnifiedHistory] = useState<UnifiedHistEntry[]>([]);

  type GroupedRow = Row & { __groupCount: number; __items: Row[]; __gk: string };
  const computedStatus = (g: GroupedRow): AlarmStatus => (g.reconhecido === "Sim" || g.descartado === "Sim" ? "concluido" : (statuses[g.__gk] ?? loadStatus(g.__gk) ?? "nao_tratado"));

  const rebuildUnified = useCallback((gk: string) => {
    const comments = loadCommentList(gk).map<UnifiedHistEntry>((c) => ({ ts: c.ts, kind: "comment", text: c.text }));
    const statuses = loadStatusLog(gk).map<UnifiedHistEntry>((s) => ({ ts: s.ts, kind: "status", text: statusToText(s) }));
    setUnifiedHistory([...comments, ...statuses].sort((a, b) => a.ts - b.ts));
  }, []);

  const openNoteModal = useCallback((g: GroupedRow) => {
    const gk = g.__gk;
    setActiveGk(gk);
    setDraftComment("");
    setDraftStatus(loadStatus(gk));
    const cl = loadCommentList(gk);
    const sl = loadStatusLog(gk);
    setCommentList(cl);
    setStatusLog(sl);
    const comments = cl.map<UnifiedHistEntry>((c) => ({ ts: c.ts, kind: "comment", text: c.text }));
    const statuses = sl.map<UnifiedHistEntry>((s) => ({ ts: s.ts, kind: "status", text: statusToText(s) }));
    setUnifiedHistory([...comments, ...statuses].sort((a, b) => a.ts - b.ts));
    setShowNoteModal(true);
  }, []);

  const sendComment = useCallback(() => {
    if (!activeGk) return;
    const text = draftComment.trim();
    if (!text) return;
    const prev = loadCommentList(activeGk);
    const updated = [...prev, { ts: Date.now(), text }];
    saveCommentList(activeGk, updated);
    setCommentList(updated);
    setUnifiedHistory((h) => [...h, { ts: Date.now(), kind: "comment" as const, text }].sort((a, b) => a.ts - b.ts));
    try {
      const [server, site, point] = activeGk.split("::");
      const row = rows.find((r) => r.server === server && r.site === site && r.point === point);
      persistIfRelevant(row, loadStatus(activeGk), text, backends);
    } catch {}
    setDraftComment("");
  }, [activeGk, draftComment, rows, backends]);

  const [toolbarPinned, setToolbarPinned] = useState<boolean>(() => {
    try { return localStorage.getItem(TOOLBAR_PINNED_KEY) === "1"; } catch { return false; }
  });
  const [toolbarOpen, setToolbarOpen] = useState<boolean>(true);
  useEffect(() => {
    try { localStorage.setItem(TOOLBAR_PINNED_KEY, toolbarPinned ? "1" : "0"); } catch {}
  }, [toolbarPinned]);

  const [showApiMgr, setShowApiMgr] = useState(false);
  const [newApi, setNewApi] = useState<Partial<BackendCfg>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    setNewApi((prev) => {
      const ip = prev.ip?.trim();
      const versao = prev.versao;
      return { ...prev, baseUrl: buildBaseUrl(ip, versao), link: ip ? `https://${ip}/UI/alarms/` : undefined, backend: computeBackendFromVersao(versao) };
    });
  }, [newApi.ip, newApi.versao]);

  const normalizeNewBaseUrl = (s: string) => (!s ? "" : s.startsWith("/") || s.startsWith("http") ? s.trim() : `https://${s.trim()}`);
  const resetForm = () => { setNewApi({}); setEditingId(null); };

  // const addOrUpdateBackend = useCallback(() => {
  //   const baseRaw = normalizeNewBaseUrl(newApi.baseUrl || "");
  //   const label = (newApi.label || "").trim();
  //   const username = (newApi.username || "").trim();
  //   const password = (newApi.password || "").trim();
  //   const offset = Number(newApi.offset || 0);
  //   const pageSize = Number(newApi.pageSize || 0);
  //   if (!label) return alert("Informe o campo Servidor.");
  //   if (!newApi.ip) return alert("Informe o campo IP.");
  //   if (!newApi.versao) return alert("Selecione a Versão (v1 a v6).");
  //   if (!baseRaw) return alert("Base URL inválida.");
  //   if (!username || !password) return alert("Informe Usuário e Senha.");

  //   const b: BackendCfg = {
  //     id: editingId ?? ((crypto as any)?.randomUUID?.() ?? String(Date.now())),
  //     label,
  //     ip: newApi.ip,
  //     versao: newApi.versao as BackendCfg["versao"],
  //     offset,
  //     baseUrl: baseRaw,
  //     link: newApi.link,
  //     backend: newApi.backend,
  //     pageSize,
  //     username,
  //     password,
  //     enabled: newApi.enabled ?? true,
  //   };

  //   if (editingId) {
  //     const next = backends.map((x) => (x.id === editingId ? b : x));
  //     setBackends(next); saveBackends(next); resetForm();
  //   } else {
  //     const next = [...backends, b];
  //     setBackends(next); saveBackends(next); resetForm();
  //   }
  // }, [backends, newApi, editingId]);

  const addOrUpdateBackend = useCallback(async () => {
  const baseRaw = normalizeNewBaseUrl(newApi.baseUrl || "");
  const label = (newApi.label || "").trim();
  const username = (newApi.username || "").trim();
  const password = (newApi.password || "").trim();
  const offset = Number(newApi.offset || 0);
  const pageSize = Number(newApi.pageSize || 1);

  if (!label) return alert("Informe o campo Servidor.");
  if (!newApi.ip) return alert("Informe o campo IP.");
  if (!newApi.versao) return alert("Selecione a Versão (v1 a v6).");
  if (!username || !password) return alert("Informe Usuário e Senha.");

  const payload: Partial<BackendCfg> = {
    label, ip: newApi.ip, versao: newApi.versao,
    offset, pageSize, username, password,
    // BaseUrl/Link são opcionais no seu backend; enviaremos sempre os campos principais
  };

  try {
    if (editingId) await updateBackendApi(editingId, payload);
    else await createBackendApi(payload);

    const list = await fetchBackendsFromApi();
    setBackends(list);
    resetForm();
    setShowApiMgr(false);
  } catch (e: any) {
    alert(e?.message || "Erro ao salvar");
  }
}, [newApi, editingId]);

  const startEditBackend = useCallback((id: string) => {
    const b = backends.find((x) => x.id === id);
    if (!b) return;
    setEditingId(id);
    setNewApi({ ...b, enabled: b.enabled ?? true, pageSize: b.pageSize ?? 1, offset: typeof b.offset === "number" ? b.offset : (b.offsetHours ? (b.offsetSign === "-" ? -Math.abs(b.offsetHours) : Math.abs(b.offsetHours)) : 0) });
    setShowApiMgr(true);
  }, [backends]);

  // const toggleBackend = useCallback((id: string) => {
  //   const next = backends.map((b) => (b.id === id ? { ...b, enabled: !b.enabled } : b));
  //   setBackends(next); saveBackends(next);
  // }, [backends]);

  const toggleBackend = useCallback((id: string) => {
  setBackends(prev => prev.map(b => b.id === id ? { ...b, enabled: !b.enabled } : b));
}, []);


  // const removeBackend = useCallback((id: string) => {
  //   if (!confirm("Remover esta API?")) return;
  //   const next = backends.filter((b) => b.id !== id);
  //   setBackends(next); saveBackends(next);
  //   if (editingId === id) resetForm();
  // }, [backends, editingId]);

  const removeBackend = useCallback(async (id: string) => {
  if (!confirm("Remover esta API?")) return;
  try {
    await deleteBackendApi(id);
    const list = await fetchBackendsFromApi();
    setBackends(list);
    if (editingId === id) resetForm();
  } catch (e: any) {
    alert(e?.message || "Erro ao remover");
  }
}, [editingId]);

// const startEditBackend = useCallback((id: string) => {
//   const b = backends.find((x) => x.id === id);
//   if (!b) return;
//   setEditingId(id);
//   setNewApi({
//     ...b,
//     enabled: b.enabled ?? true,
//     pageSize: b.pageSize ?? 0,
//     offset: typeof b.offset === "number" ? b.offset : 0,
//   });
//   setShowApiMgr(true);
// }, [backends]);


  const testBackend = useCallback(async (b: BackendCfg) => {
    try {
      const token = await loginBase(b.baseUrl, b.username, b.password);
      await getAlarmsBase(b.baseUrl, token, { pageSize: b.pageSize ?? 0 });
      alert(`OK — ${b.label} respondeu.`);
      setBackendErrors((p) => { const n = { ...p }; delete n[b.id]; return n; });
    } catch (e: any) {
      const msg = e?.message || "Erro desconhecido";
      alert(`Falha — ${b.label}\n${msg}`);
      setBackendErrors((p) => ({ ...p, [b.id]: msg }));
    }
  }, []);

  // const prevCountRef = useRef(0);
  const prevGroupCountsRef = useRef<Record<string, number>>({});

  const makeGroupsRaw = (list: Row[]) => {
    const map = new Map<string, { gk: string; rep: Row; items: Row[] }>();
    for (const r of list) {
      const gk = groupKey(r);
      const got = map.get(gk);
      if (!got) map.set(gk, { gk, rep: r, items: [r] });
      else { got.items.push(r); if (r.dateTimeAdjMs > got.rep.dateTimeAdjMs) got.rep = r; }
    }
    return Array.from(map.values());
  };

  // const fetchData = useCallback(async () => {
  //   setLoading(true); setErr("");
  //   try {
  //     const enabled = backends.filter((b) => b.enabled);
  //     const all: Row[] = []; const errors: Record<string, string> = {};
  //     for (const b of enabled) {
  //       try {
  //         const token = await loginBase(b.baseUrl, b.username, b.password);
  //         const { items } = await getAlarmsBase(b.baseUrl, token, { pageSize: b.pageSize ?? 1 });
  //         const off = typeof b.offset === "number" ? b.offset : (b.offsetHours ? (b.offsetSign === "-" ? -Math.abs(b.offsetHours) : Math.abs(b.offsetHours)) : 0);
  //         all.push(
  //           ...(items || []).map((a) => {
  //             const v = normalizeValue(a.triggerValue?.value), u = mapUnit(a.triggerValue?.units);
  //             const adjMs = calcAdjMsUnified(a.creationTime, off);
  //             return {
  //               id: `${b.id}_${a.id}`,
  //               server: b.label,
  //               dateTimeISO: a.creationTime,
  //               dateTime: formatDateWithOffset(a.creationTime, off >= 0 ? "+" : "-", Math.abs(off)),
  //               dateTimeAdjMs: adjMs,
  //               site: a.itemReference,
  //               point: a.name || a.itemReference,
  //               value: u ? `${v} ${u}` : v,
  //               priority: Number.isFinite((a.priority as unknown) as number) ? ((a.priority as unknown) as number) : 0,
  //               reconhecido: a.isAcknowledged ? "Sim" : "Não",
  //               descartado: a.isDiscarded ? "Sim" : "Não",
  //               message: (a as any).message ?? "",
  //             } as Row;
  //           })
  //         );
  //       } catch (e: any) { errors[b.id] = e?.message || "Erro desconhecido"; }
  //     }

  //     setBackendErrors(errors);
  //     setRows(all);

  //     const total = all.length;
  //     const groups = makeGroupsRaw(all);
  //     const prevCounts = prevGroupCountsRef.current || {};
  //     const changedGks: string[] = [];

  //     for (const g of groups) {
  //       const prevC = prevCounts[g.gk] ?? 0;
  //       const currC = g.items.length;
  //       if (currC > prevC && prevC > 0) {
  //         saveStatus(g.gk, "nao_tratado");
  //         const se: StatusEntry = { ts: Date.now(), status: "nao_tratado", reason: "auto_new_alarm" };
  //         const newLog = [...loadStatusLog(g.gk), se];
  //         saveStatusLog(g.gk, newLog);

  //         const list = loadCommentList(g.gk);
  //         const autoComment = `Status alterado para "Não tratado" (novo alarme).`;
  //         saveCommentList(g.gk, [...list, { ts: Date.now(), text: autoComment }]);

  //         changedGks.push(g.gk);
  //       }
  //     }

  //     setStatuses((prev) => {
  //       const next = { ...prev };
  //       for (const gk of changedGks) next[gk] = "nao_tratado";
  //       for (const g of groups) if (next[g.gk] === undefined) next[g.gk] = loadStatus(g.gk);
  //       return next;
  //     });

  //     prevGroupCountsRef.current = Object.fromEntries(groups.map((g) => [g.gk, g.items.length]));
  //     setSecondsLeft(60);
  //     prevCountRef.current = total;
  //   } catch (e: any) {
  //     setErr(e?.message || "Erro geral");
  //   } finally { setLoading(false); }
  // }, [backends]);

  const fetchData = useCallback(async () => {
  setLoading(true); setErr("");
  try {
    const enabled = backends.filter(b => b.enabled);
    if (!enabled.length) { setRows([]); setBackendErrors({}); setSecondsLeft(60); return; }

    const results = await Promise.all(enabled.map(async (b) => {
      try {
        const token = await loginBase(b.baseUrl, b.username, b.password);
        const { items } = await getAlarmsBase(b.baseUrl, token, { pageSize: b.pageSize ?? 1 });
        const off = typeof b.offset === "number" ? b.offset : (b.offsetHours ? (b.offsetSign === "-" ? -Math.abs(b.offsetHours) : Math.abs(b.offsetHours)) : 0);
        const rowsForB: Row[] = (items || []).map((a) => {
          const v = normalizeValue(a.triggerValue?.value);
          const u = mapUnit(a.triggerValue?.units);
          const adjMs = calcAdjMsUnified(a.creationTime, off);
          return {
            id: `${b.id}_${a.id}`,
            server: b.label,
            dateTimeISO: a.creationTime,
            dateTime: formatDateWithOffset(a.creationTime, off >= 0 ? "+" : "-", Math.abs(off)),
            dateTimeAdjMs: adjMs,
            site: a.itemReference,
            point: a.name || a.itemReference,
            value: u ? `${v} ${u}` : v,
            priority: Number.isFinite((a.priority as unknown as number)) ? (a.priority as unknown as number) : 0,
            reconhecido: a.isAcknowledged ? "Sim" : "Não",
            descartado: a.isDiscarded ? "Sim" : "Não",
            message: (a as any).message ?? "",
          };
        });
        return { ok: true as const, id: b.id, rows: rowsForB };
      } catch (e: any) {
        return { ok: false as const, id: b.id, error: e?.message || "Erro desconhecido" };
      }
    }));

    const errors: Record<string,string> = {};
    const all = results.flatMap(r => r.ok ? r.rows : (errors[r.id] = (r as any).error, []));
    setBackendErrors(errors);
    setRows(all);

    const groups = makeGroupsRaw(all);
    const prevCounts = prevGroupCountsRef.current || {};
    const changedGks: string[] = [];

    for (const g of groups) {
      const prevC = prevCounts[g.gk] ?? 0;
      const currC = g.items.length;
      if (currC > prevC && prevC > 0) {
        saveStatus(g.gk, "nao_tratado");
        const se: StatusEntry = { ts: Date.now(), status: "nao_tratado", reason: "auto_new_alarm" };
        saveStatusLog(g.gk, [...loadStatusLog(g.gk), se]);
        saveCommentList(g.gk, [...loadCommentList(g.gk), { ts: Date.now(), text: 'Status alterado para "Não tratado" (novo alarme).' }]);
        changedGks.push(g.gk);
      }
    }

    setStatuses((prev) => {
      const next = { ...prev };
      for (const gk of changedGks) next[gk] = "nao_tratado";
      for (const g of groups) if (next[g.gk] === undefined) next[g.gk] = loadStatus(g.gk);
      return next;
    });

    prevGroupCountsRef.current = Object.fromEntries(groups.map((g) => [g.gk, g.items.length]));
    setSecondsLeft(60);
  } catch (e: any) {
    setErr(e?.message || "Erro geral");
  } finally {
    setLoading(false);
  }
}, [backends]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (rows.length === 0) return;
    const groups = new Map<string, Row>();
    for (const r of rows) {
      const gk = groupKey(r);
      const rep = groups.get(gk);
      if (!rep || r.dateTimeAdjMs > rep.dateTimeAdjMs) groups.set(gk, r);
    }
    setStatuses((prev) => {
      const next = { ...prev };
      for (const [gk, rep] of groups) {
        const derived: AlarmStatus = rep.reconhecido === "Sim" || rep.descartado === "Sim" ? "concluido" : (next[gk] ?? loadStatus(gk));
        next[gk] = derived; saveStatus(gk, derived);
      }
      return next;
    });
  }, [rows]);

  useEffect(() => {
  if (timerRef.current) return;
  const id = window.setInterval(() => {
    setSecondsLeft((s) => {
      if (s <= 1) { fetchData(); return 60; }
      return s - 1;
    });
  }, 1000);
  timerRef.current = id as unknown as number;
  return () => { window.clearInterval(id); timerRef.current = null; };
}, [fetchData]);

  // useEffect(() => {
  //   if (!timerRef.current) {
  //     timerRef.current = window.setInterval(() => {
  //       setSecondsLeft((s) => {
  //         if (s <= 1) { fetchData(); return 60; }
  //         return s - 1;
  //       });
  //     }, 1000);
  //   }
  // }, [fetchData]);

  const clearFilters = useCallback(() => {
    setFSite(""); setFPoint(""); setFValue("");
    setFDateFrom(""); setFDateTo("");
    setFPriMin(0); setFPriMax(255);
    setFAck("all"); setFDisc("all");
    setSortKey("dateTime"); setSortDir("desc");
  }, []);

  const [fAck, setFAck] = useState<"all" | "sim" | "nao">("all");
  const [fDisc, setFDisc] = useState<"all" | "sim" | "nao">("all");

  const lowered = useMemo(() => ({ site: fSite.trim().toLowerCase(), point: fPoint.trim().toLowerCase(), value: fValue.trim().toLowerCase() }), [fSite, fPoint, fValue]);
  const fromTo = useMemo(() => ({ from: fDateFrom ? new Date(`${fDateFrom}T00:00:00`).getTime() : undefined, to: fDateTo ? new Date(`${fDateTo}T23:59:59.999`).getTime() : undefined }), [fDateFrom, fDateTo]);

  const filtered = useMemo(() => {
    const inc = (h: string, n: string) => h.toLowerCase().includes(n);
    return rows.filter((r) => {
      const ts = r.dateTimeAdjMs;
      const passSite = !lowered.site || inc(r.site, lowered.site);
      const passPoint = !lowered.point || inc(r.point, lowered.point);
      const passValue = !lowered.value || inc(String(r.value), lowered.value);
      const passFrom = fromTo.from === undefined ? true : ts >= fromTo.from;
      const passTo = fromTo.to === undefined ? true : ts <= fromTo.to;
      const passAck = fAck === "all" || (fAck === "sim" ? r.reconhecido === "Sim" : r.reconhecido === "Não");
      const passDisc = fDisc === "all" || (fDisc === "sim" ? r.descartado === "Sim" : r.descartado === "Não");
      const passPri = r.priority >= fPriMin && r.priority <= fPriMax;
      return passSite && passPoint && passValue && passFrom && passTo && passAck && passDisc && passPri;
    });
  }, [rows, lowered, fromTo, fAck, fDisc, fPriMin, fPriMax]);

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
        case "idade": { const ageA = now - a.dateTimeAdjMs, ageB = now - b.dateTimeAdjMs; return (ageA - ageB) * dir; }
        case "value": { const na = numFromStr(a.value), nb = numFromStr(b.value); return (!Number.isNaN(na) && !Number.isNaN(nb) ? na - nb : a.value.localeCompare(b.value)) * dir; }
        // case "mensagem": { const am = (a as any).message ?? "", bm = (b as any).message ?? ""; return am.localeCompare(bm) * dir; }
       case "mensagem": {
  const am = a.message ?? "";
  const bm = b.message ?? "";
  return am.localeCompare(bm) * dir;
}

        default: return 0;
      }
    });
    return data;
  }, [filtered, sortKey, sortDir]);

  const grouped = useMemo<GroupedRow[]>(() => {
    const map = new Map<string, { row: Row; count: number; items: Row[] }>();
    for (const r of sorted) {
      const gk = groupKey(r);
      const got = map.get(gk);
      if (!got) map.set(gk, { row: r, count: 1, items: [r] });
      else { got.count += 1; got.items.push(r); if (r.dateTimeAdjMs > got.row.dateTimeAdjMs) got.row = r; }
    }
    for (const g of map.values()) g.items.sort((a, b) => b.dateTimeAdjMs - a.dateTimeAdjMs);
    return Array.from(map.entries()).map(([gk, { row, count, items }]) => ({ ...row, __groupCount: count, __items: items, __gk: gk }));
  }, [sorted]);

  const groupedFiltered = useMemo(() => (statusFilter === "all" ? grouped : grouped.filter((g) => computedStatus(g) === statusFilter)), [grouped, statusFilter, statuses]);

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyGroup, setHistoryGroup] = useState<{ site: string; point: string; items: Row[] } | null>(null);
  const openHistoryModal = useCallback((g: GroupedRow) => { setHistoryGroup({ site: g.site, point: g.point, items: g.__items }); setShowHistoryModal(true); }, []);

  const statsAll = useMemo(() => {
    const total = filtered.length;
    const disc = filtered.filter((r) => r.descartado === "Sim").length;
    const ack = filtered.filter((r) => r.reconhecido === "Sim").length;
    return { pie: [{ label: "Reconhecido", value: ack }, { label: "Não reconhecido", value: total - ack }, { label: "Descartado", value: disc }, { label: "Não descartado", value: total - disc }] };
  }, [filtered]);

  const statsAging = useMemo(() => {
    const old = filtered.filter((r) => Date.now() - r.dateTimeAdjMs > TWO_HOURS_MS).length;
    return { pie: [{ label: "Até 2h", value: filtered.length - old }, { label: "Maior que 2h", value: old }] };
  }, [filtered]);

  const arrowIcon = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? <FiChevronUp /> : <FiChevronDown />) : <span className="arrow">↕</span>);
  const onSort = useCallback((k: SortKey) => { if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir("asc"); } }, [sortKey]);
  const btnLabel = loading ? "Atualizando…" : `Atualizar em ${secondsLeft}s`;
  const backendErrorCount = useMemo(() => Object.keys(backendErrors).length, [backendErrors]);

  const serverUiMap = useMemo(() => {
    const m: Record<string, string | undefined> = {};
    for (const b of backends) m[b.label] = b.link;
    return m;
  }, [backends]);

  // const renderServerLink = (label: string, className?: string) => {
  //   const href = serverUiMap[label];
  //   if (!href) return <span className={className}>{label}</span>;
  //   return (
  //     <a href={href} target="_blank" rel="noopener noreferrer" className={className} title={`Abrir ${href}`} style={{ textDecoration: "none" }}>
  //       {label}
  //     </a>
  //   );
  // };

  const renderServerLink = useCallback((label: string, className?: string) => {
  const href = serverUiMap[label];
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" className={className} title={`Abrir ${href}`} style={{ textDecoration: "none" }}>{label}</a>
    : <span className={className}>{label}</span>;
}, [serverUiMap]);


  return (
    <div className="alarms-container">
      <div
        className={`toolbar-shell ${toolbarPinned ? "pinned open" : toolbarOpen ? "open" : "collapsed"}`}
        onMouseEnter={() => !toolbarPinned && setToolbarOpen(true)}
        onMouseLeave={() => !toolbarPinned && setToolbarOpen(false)}
        onClick={() => { if (!toolbarPinned && !toolbarOpen) setToolbarOpen(true); }}
      >
        <div className="alarms-toolbar">
          <label className={`switch ${toolbarPinned ? "on" : ""}`} title="Fixar menu">
            <input
              type="checkbox"
              checked={toolbarPinned}
              onChange={() => { setToolbarPinned((v) => !v); if (!toolbarPinned) setToolbarOpen(true); }}
              aria-label="Fixar/soltar barra"
            />
            <span className="track" aria-hidden="true"></span>
            <span className="thumb" aria-hidden="true"></span>
            <span className="switch-text">{toolbarPinned ? "Fixo" : "Solto"}</span>
          </label>

          <button type="button" onClick={fetchData} disabled={loading} className="btn-refresh mono">
            <FiRefreshCcw /> {btnLabel}
          </button>
          <button type="button" className="btn-clear" onClick={() => setShowApiMgr(true)}>
            <FiSettings /> Gerenciar APIs
          </button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button type="button" className="btn-clear" onClick={() => setViewMode((m) => (m === "cards" ? "table" : "cards"))} title="Alternar entre Tabela e Cards">
              <FiLayout /> {viewMode === "cards" ? "Tabela" : "Cards"}
            </button>
          </div>

          <input className="filter-input" placeholder="Filtro por Site" value={fSite} onChange={(e) => setFSite(e.target.value)} />
          <input className="filter-input" placeholder="Filtro por Ponto" value={fPoint} onChange={(e) => setFPoint(e.target.value)} />
          <input className="filter-input" placeholder="Filtro por Valor" value={fValue} onChange={(e) => setFValue(e.target.value)} />
          <input className="filter-input small" type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} title="Data: De" />
          <span className="range-dash">—</span>
          <input className="filter-input small" type="date" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} title="Data: Até" />

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

          <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} title="Status do tratamento">
            <option value="all">Status: Todos</option>
            <option value="nao_tratado">Não tratado</option>
            <option value="tratado">Tratado</option>
            <option value="concluido">Concluído</option>
            <option value="oportunidade">Oportunidade</option>
          </select>
          <select className="filter-select" value={fAck} onChange={(e) => setFAck(e.target.value as any)} title="Reconhecido">
            <option value="all">Reconhecido: Todos</option>
            <option value="sim">Reconhecido: Sim</option>
            <option value="nao">Reconhecido: Não</option>
          </select>
          <select className="filter-select" value={fDisc} onChange={(e) => setFDisc(e.target.value as any)} title="Descartado">
            <option value="all">Descartado: Todos</option>
            <option value="sim">Descartado: Sim</option>
            <option value="nao">Descartado: Não</option>
          </select>

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
                <option value="mensagem">Mensagem</option>
              </select>
            </label>
            <button type="button" className="btn-clear" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))} title="Alternar direção (asc/desc)">
              {sortDir === "asc" ? <>Asc <FiChevronUp /></> : <>Desc <FiChevronDown /></>}
            </button>
            <button type="button" onClick={clearFilters} className="btn-clear clear-inline">
              <FiXCircle /> Limpar filtros
            </button>
          </div>

          <span className="status">{backendErrorCount ? <><FiAlertTriangle /> Falhas: {backendErrorCount}</> : "Conectado!"}</span>
          <span className="count">Total de alarmes: {groupedFiltered.length}</span>
        </div>
      </div>

      <div className="content">
        {viewMode === "table" && (
          <div className="alarms-table-scroll">
            <div className="col-controls">
              {(
                [
                  ["server", "Servidor"],
                  ["dateTime", "Data - Hora"],
                  ["site", "Site"],
                  ["point", "Ponto"],
                  ["value", "Valor"],
                  ["priority", "Prioridade"],
                  ["reconhecido", "Reconhecido"],
                  ["descartado", "Descartado"],
                  ["idade", "Idade"],
                  ["mensagem", "Mensagem"],
                  ["comentario", "Comentário"],
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
                  {visibleCols.dateTime && <th onClick={() => onSort("dateTime")} className="sortable" aria-sort={sortKey === "dateTime" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>Data - Hora {arrowIcon("dateTime")}</th>}
                  {visibleCols.site && <th onClick={() => onSort("site")} className="sortable">Site {arrowIcon("site")}</th>}
                  {visibleCols.point && <th onClick={() => onSort("point")} className="sortable">Ponto {arrowIcon("point")}</th>}
                  {visibleCols.value && <th onClick={() => onSort("value")} className="sortable">Valor {arrowIcon("value")}</th>}
                  {visibleCols.priority && <th onClick={() => onSort("priority")} className="sortable col-priority">Prioridade {arrowIcon("priority")}</th>}
                  {visibleCols.reconhecido && <th onClick={() => onSort("reconhecido")} className="sortable">Reconhecido {arrowIcon("reconhecido")}</th>}
                  {visibleCols.descartado && <th onClick={() => onSort("descartado")} className="sortable">Descartado {arrowIcon("descartado")}</th>}
                  {visibleCols.idade && <th onClick={() => onSort("idade")} className="sortable">Idade {arrowIcon("idade")}</th>}
                  {visibleCols.mensagem && <th onClick={() => onSort("mensagem")} className="sortable">Mensagem {arrowIcon("mensagem")}</th>}
                  {visibleCols.comentario && <th>Comentário</th>}
                </tr>
              </thead>
              <tbody>
                {groupedFiltered.map((g) => {
                  const status = computedStatus(g);
                  const rowStyle: React.CSSProperties =
                    status === "concluido" ? { backgroundColor: "#e7fbe7" } :
                    status === "tratado" ? { backgroundColor: "#fff9c4" } :
                    Date.now() - g.dateTimeAdjMs > TWO_HOURS_MS ? { backgroundColor: "#ffd6d6" } : {};
                  return (
                    <tr
                      key={g.__gk}
                      className={`${status === "tratado" ? "status-tratado" : ""} ${status === "concluido" ? "status-concluido" : ""} ${status === "oportunidade" ? "status-oportunidade" : ""}`.trim()}
                      style={rowStyle}
                    >
                      {visibleCols.server && <td>{renderServerLink(g.server)}</td>}
                      {visibleCols.dateTime && <td title={new Date(g.dateTimeAdjMs).toLocaleString("pt-BR")}>{g.dateTime}</td>}
                      {visibleCols.site && <td>{g.site}</td>}
                      {visibleCols.point && (
                        <td className="td-point">
                          <strong>{g.point}</strong>
                          {g.__groupCount > 1 && (
                            <button type="button" className="count-badge count-click" title="Ver histórico" onClick={() => openHistoryModal(g)}>
                              x{g.__groupCount}
                            </button>
                          )}
                        </td>
                      )}
                      {visibleCols.value && <td>{g.value}</td>}
                      {visibleCols.priority && <td className="col-priority">{g.priority}</td>}
                      {visibleCols.reconhecido && <td>{g.reconhecido}</td>}
                      {visibleCols.descartado && <td>{g.descartado}</td>}
                      {visibleCols.idade && <td title={new Date(g.dateTimeAdjMs).toLocaleString("pt-BR")}>{formatAge(g.dateTimeAdjMs)}</td>}
                      {visibleCols.mensagem && <td>{g.message || "-"}</td>}
                      {visibleCols.comentario && (
                        <td className="comment-cell">
                          <button type="button" className="btn-clear" onClick={() => openNoteModal(g)}>Comentário / Status</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!loading && !err && groupedFiltered.length === 0 && (
                  <tr>
                    <td colSpan={Object.values(visibleCols).filter(Boolean).length || 1} style={{ textAlign: "center" }}>
                      Nenhum alarme encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

{/* Cards */}
        {viewMode === "cards" && (
          <div className="cards-layout">
            <div className="cards-scroll">
              <div className="cards-grid">
                {groupedFiltered.map((g) => {
                  const isOld = Date.now() - g.dateTimeAdjMs > TWO_HOURS_MS;
                  const status = computedStatus(g);
                  const cardClass = ["alarm-card", isOld ? "old" : "", status === "tratado" ? "status-tratado" : "", status === "concluido" ? "status-concluido" : "", status === "oportunidade" ? "status-oportunidade" : ""].join(" ").trim();

                  return (
                    <div key={g.__gk} className={cardClass}>
                      <div className="card-row top">
                        <div className="top-left">{visibleCols.server && renderServerLink(g.server, "chip server")}</div>
                        <div className="top-right">
                          <button
                            type="button"
                            className="count-badge count-click"
                            title="Ver histórico"
                            onClick={(e) => { e.stopPropagation(); openHistoryModal(g); }}
                          >
                            x{g.__groupCount}
                          </button>
                        </div>
                      </div>

                      {visibleCols.point && (
                        <div className="card-row line">
                          <button type="button" className="point-btn" title="Abrir comentário/status" onClick={() => openNoteModal(g)}>
                            <strong className="point">{g.point}</strong>
                          </button>
                        </div>
                      )}

                      {visibleCols.site && <div className="card-row line"><span className="site">{g.site}</span></div>}
                      <div className="card-row line"><span className="value">{g.value || "-"}</span></div>
                      <div className="card-row line"><span className="message">{g.message || "-"}</span></div>
                     
                      {visibleCols.dateTime && <div className="card-row line dt" title={new Date(g.dateTimeAdjMs).toLocaleString("pt-BR")}>{g.dateTime}</div>}

                      <div className="card-row flags">
                        {visibleCols.reconhecido && <span className={`flag ${g.reconhecido === "Sim" ? "ok" : "warn"}`}>{g.reconhecido === "Sim" ? "Reconhecido" : "Não reconhecido"}</span>}
                        {visibleCols.descartado && <span className={`flag ${g.descartado === "Sim" ? "neutral" : "active"}`}>{g.descartado === "Sim" ? "Descartado" : "Não descartado"}</span>}
                        <span
                          className={`flag status ${
                            (statuses[g.__gk] || "nao_tratado") === "concluido"
                              ? "done"
                              : (statuses[g.__gk] || "nao_tratado") === "tratado"
                              ? "progress"
                              : (statuses[g.__gk] || "nao_tratado") === "oportunidade"
                              ? "opportunity"
                              : "pending"
                          }`}
                        >
                          {(statuses[g.__gk] || "nao_tratado") === "concluido"
                            ? "Concluído"
                            : (statuses[g.__gk] || "nao_tratado") === "tratado"
                            ? "Tratado"
                            : (statuses[g.__gk] || "nao_tratado") === "oportunidade"
                            ? "Oportunidade"
                            : "Não tratado"}
                        </span>
                        {visibleCols.priority && <span className={`chip prio p${g.priority}`} title="Prioridade" style={{ marginLeft: "auto" }}>P{g.priority}</span>}
                      </div>
                    </div>
                  );
                })}
                {!loading && !err && groupedFiltered.length === 0 && <div className="empty-state">Nenhum alarme encontrado.</div>}
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

      {showHistoryModal && historyGroup && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="histModalTitle">
          <div className="modal-content">
            <div className="modal-head">
              <h3 id="histModalTitle">
                Histórico – {historyGroup.point} @ {historyGroup.site} <span className="api-meta">({historyGroup.items.length} ocorrências)</span>
              </h3>
              <button type="button" className="api-close" onClick={() => setShowHistoryModal(false)} aria-label="Fechar">×</button>
            </div>
            <div className="api-list">
              {historyGroup.items.map((it) => (
                <div key={it.id} className="api-item" style={{ gridTemplateColumns: "180px 1fr auto" }}>
                  <div className="api-label" style={{ fontWeight: 600 }}>
                    <time title={new Date(it.dateTimeAdjMs).toLocaleString("pt-BR")}>{it.dateTime}</time>
                  </div>
                  <div className="api-desc">
                    <div className="api-meta">
                      Valor: <strong>{it.value}</strong> • Prioridade: <strong>P{it.priority}</strong>
                      {it.reconhecido === "Sim" && <> • Reconhecido</>}
                      {it.descartado === "Sim" && <> • Descartado</>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn-clear" onClick={() => setShowHistoryModal(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {showApiMgr && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="apiMgrTitle">
          <div className="modal-content">
            <div className="modal-head">
              <h3 id="apiMgrTitle">Gerenciar API</h3>
              <button type="button" className="api-close" onClick={() => { setShowApiMgr(false); resetForm(); }} aria-label="Fechar">×</button>
            </div>

            <div className="api-list">
              {backends.map((b) => (
                <div key={b.id} className="api-item api-item--nice">
                  <div className="api-label">
                    <div className="api-title">{b.label}</div>
                    <div className="api-grid-kv">
                      <div className="kv"><span className="k">IP</span><span className="v">{b.ip || "-"}</span></div>
                      <div className="kv"><span className="k">Versão</span><span className="v">{b.versao || "-"}</span></div>
                      <div className="kv"><span className="k">Offset</span><span className="v">{(b.offset ?? 0) >= 0 ? `+${b.offset ?? 0}` : b.offset}h</span></div>
                      <div className="kv"><span className="k">QTD</span><span className="v">{b.pageSize ?? 1}</span></div>
                      <div className="kv kv-span2"><span className="k">Base</span><span className="v mono" title={b.baseUrl}>{b.baseUrl}</span></div>
                      {b.link && <div className="kv kv-span2"><span className="k">Link</span><span className="v mono" title={b.link}>{b.link}</span></div>}
                      {b.backend && <div className="kv kv-span2"><span className="k">Backend</span><span className="v mono" title={b.backend}>{b.backend}</span></div>}
                      <div className="kv kv-span2"><span className="k">Usuário</span><span className="v">{b.username}</span></div>
                    </div>
                  </div>
                  <div className="api-actions">
                    <label className="api-toggle">
                      <input type="checkbox" checked={!!b.enabled} onChange={() => toggleBackend(b.id)} />
                      Ativo
                    </label>
                    <button type="button" className="btn-clear" onClick={() => testBackend(b)} title="Testar">Testar</button>
                    <button type="button" className="btn-clear" onClick={() => startEditBackend(b.id)} title="Editar">Editar</button>
                    <button type="button" className="btn-danger" onClick={() => removeBackend(b.id)} title="Remover">Remover</button>
                  </div>
                </div>
              ))}
            </div>

            <hr className="api-div" />

            <form className="api-form" onSubmit={(e) => { e.preventDefault(); addOrUpdateBackend(); }}>
              <h4>{editingId ? "Editar API" : "Adicionar API"}</h4>
              <div className="api-grid">
                <div>
                  <label className="api-label">Servidor</label>
                  <input className="filter-input" placeholder="Ex.: ROC" value={newApi.label ?? ""} onChange={(e) => setNewApi((p) => ({ ...p, label: e.target.value }))} />
                </div>
                <div>
                  <label className="api-label">IP</label>
                  <input className="filter-input" placeholder="Ex.: 10.2.1.100" value={newApi.ip ?? ""} onChange={(e) => setNewApi((p) => ({ ...p, ip: e.target.value }))} />
                </div>
                <div>
                  <label className="api-label">Versão</label>
                  <select className="filter-select" value={newApi.versao ?? ""} onChange={(e) => setNewApi((p) => ({ ...p, versao: e.target.value as BackendCfg["versao"] }))}>
                    <option value="" disabled>Selecione</option>
                    {["v1","v2","v3","v4","v5","v6"].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="api-label">Offset (horas)</label>
                  <select className="filter-select" value={String(newApi.offset ?? 0)} onChange={(e) => setNewApi((p) => ({ ...p, offset: Number(e.target.value) }))}>
                    {Array.from({ length: 25 }, (_, i) => i - 12).map(n => (<option key={n} value={n}>{n >= 0 ? `+${n}` : n}</option>))}
                  </select>
                </div>
                <div>
                  <label className="api-label">Base URL (auto)</label>
                  <input className="filter-input" value={newApi.baseUrl ?? ""} onChange={(e) => setNewApi((p) => ({ ...p, baseUrl: e.target.value }))} placeholder="https://IP/api/Versao" />
                </div>
                <div>
                  <label className="api-label">Link (auto)</label>
                  <input className="filter-input" value={newApi.link ?? ""} onChange={(e) => setNewApi((p) => ({ ...p, link: e.target.value }))} placeholder="https://IP/UI/alarms/" />
                </div>
                <div>
                  <label className="api-label">Backend (auto)</label>
                  <input className="filter-input" value={newApi.backend ?? ""} onChange={(e) => setNewApi((p) => ({ ...p, backend: e.target.value }))} placeholder="https://10.2.1.133:500X" />
                </div>
                <div>
                  <label className="api-label">QTD alarmes (pageSize)</label>
                  <input className="filter-input" type="number" min={1} max={1000} value={newApi.pageSize ?? 1} onChange={(e) => setNewApi((p) => ({ ...p, pageSize: Math.min(Number(e.target.value), 1000) }))} />
                </div>
                <div>
                  <label className="api-label">Usuário</label>
                  <input className="filter-input" value={newApi.username ?? ""} onChange={(e) => setNewApi((p) => ({ ...p, username: e.target.value }))} />
                </div>
                <div>
                  <label className="api-label">Senha</label>
                  <input className="filter-input" type="password" value={newApi.password ?? ""} onChange={(e) => setNewApi((p) => ({ ...p, password: e.target.value }))} />
                </div>
                <div>
                  <label className="api-label">Ativo</label>
                  <label className="api-toggle" style={{ display: "inline-flex", gap: 6 }}>
                    <input type="checkbox" checked={newApi.enabled ?? true} onChange={(e) => setNewApi((p) => ({ ...p, enabled: e.target.checked }))} />
                    Ativo
                  </label>
                </div>
              </div>

              <div className="api-actions">
                <button type="submit" className="btn-refresh">{editingId ? "Salvar" : "Adicionar"}</button>
                {editingId && <button type="button" className="btn-clear" onClick={resetForm}>Cancelar edição</button>}
              </div>
            </form>
          </div>
        </div>
      )}

      {showNoteModal && activeGk && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="noteModalTitle">
          <div className="modal-content">
            <div className="modal-head">
              <h3 id="noteModalTitle">Comentário e Status</h3>
              <button type="button" className="api-close" onClick={() => setShowNoteModal(false)} aria-label="Fechar">×</button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {unifiedHistory.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  <span><strong>Histórico</strong></span>
                  <div style={{ display: "grid", gap: 6, maxHeight: 300, overflow: "auto", padding: "6px", border: "1px dashed #e2e8f0", borderRadius: 8, background: "#fafafa" }}>
                    {[...unifiedHistory].reverse().map((h, i) => (
                      <div key={i} style={{ display: "grid", gap: 4, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px" }}>
                        <div style={{ fontSize: 12, color: "#475569", display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span>{h.kind === "status" ? "Status" : "Comentário"}</span>
                          <span>{new Date(h.ts).toLocaleString("pt-BR")}</span>
                        </div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{h.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <label style={{ display: "grid", gap: 6 }}>
                <span>Comentário</span>
                <textarea className="comment-input" rows={4} value={draftComment} onChange={(e) => setDraftComment(e.target.value)} />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span>Status</span>
                <select
                  className="filter-select"
                  value={draftStatus}
                  onChange={(e) => {
                    const v = e.target.value as AlarmStatus;
                    setDraftStatus(v);
                    if (activeGk) {
                      saveStatus(activeGk, v);
                      const se: StatusEntry = { ts: Date.now(), status: v, reason: "user" as const };
                      const newLog = [...loadStatusLog(activeGk), se];
                      saveStatusLog(activeGk, newLog);
                      setStatusLog(newLog);
                      setStatuses((p) => ({ ...p, [activeGk]: v }));
                      setUnifiedHistory((h) => [...h, { ts: se.ts, kind: "status" as const, text: statusToText(se) }].sort((a, b) => a.ts - b.ts));
                      try {
                        const [server, site, point] = activeGk.split("::");
                        const row = rows.find((r) => r.server === server && r.site === site && r.point === point);
                        persistIfRelevant(row, v, "", backends);
                      } catch {}
                    }
                  }}
                >
                  <option value="nao_tratado">Não tratado</option>
                  <option value="tratado">Tratado</option>
                  <option value="concluido">Concluído</option>
                  <option value="oportunidade">Oportunidade</option>
                </select>
              </label>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn-clear" onClick={() => setShowNoteModal(false)}>Sair</button>
                <button
                  type="button"
                  className="btn-refresh"
                  onClick={() => { sendComment(); if (activeGk) rebuildUnified(activeGk); }}
                >
                  Enviar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
