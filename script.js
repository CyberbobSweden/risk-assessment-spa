/* ==========================================================================
   Cyber Asset Inventory & Risk Assessment
   Client-side application — no backend, no database, no login.
   All data persisted in LocalStorage. Built modularly for future extension
   (backend API, AI integration, additional frameworks).
   ========================================================================== */

'use strict';

/* ============================================================
   1. CONFIG / TAXONOMIES
   ============================================================ */

const API_BASE = '/api';
const LAST_WORKSPACE_KEY = 'caira_last_workspace_id'; // only remembers which workspace to open, not the data itself

const SYSTEM_TYPES = ['Affärssystem','OT','ICS','SCADA','Server','Databas','Webbapplikation','Mobilapp','SaaS','Azure','AWS','Google Cloud','Microsoft 365','Nätverksutrustning','Brandvägg','Annat'];
const CLOUD_TYPES = ['SaaS','Azure','AWS','Google Cloud','Microsoft 365'];

const SECURITY_CONTROLS = [
  { key:'mfa', label:'MFA', icon:'fa-key' },
  { key:'logging', label:'Loggning', icon:'fa-file-lines' },
  { key:'siem', label:'SIEM', icon:'fa-chart-line' },
  { key:'backup', label:'Backup', icon:'fa-box-archive' },
  { key:'immutableBackup', label:'Immutable Backup', icon:'fa-lock' },
  { key:'encryption', label:'Kryptering', icon:'fa-lock' },
  { key:'antivirus', label:'Antivirus', icon:'fa-virus-slash' },
  { key:'edr', label:'EDR', icon:'fa-shield-virus' },
  { key:'xdr', label:'XDR', icon:'fa-shield-halved' },
  { key:'ids', label:'IDS', icon:'fa-radar' },
  { key:'ips', label:'IPS', icon:'fa-ban' },
  { key:'waf', label:'WAF', icon:'fa-fire-flame-curved' },
  { key:'segmentedNetwork', label:'Segmenterat nät', icon:'fa-diagram-project' },
  { key:'zeroTrust', label:'Zero Trust', icon:'fa-user-shield' },
  { key:'pam', label:'PAM', icon:'fa-user-lock' },
  { key:'vulnScanning', label:'Sårbarhetsskanning', icon:'fa-magnifying-glass' },
  { key:'pentestLastYear', label:'Penetrationstest senaste året', icon:'fa-bug' },
];

const EXPOSURE_ITEMS = [
  { key:'internetExposed', label:'Internetexponerad' },
  { key:'vpn', label:'VPN' },
  { key:'externalUsers', label:'Externa användare' },
  { key:'api', label:'API' },
  { key:'remoteAdmin', label:'Fjärradministration' },
  { key:'vendorAccess', label:'Leverantörsåtkomst' },
];

const DATA_ITEMS = [
  { key:'personalData', label:'Personuppgifter' },
  { key:'sensitivePersonalData', label:'Känsliga personuppgifter' },
  { key:'paymentInfo', label:'Betalningsinformation' },
  { key:'tradeSecrets', label:'Affärshemligheter' },
  { key:'productionData', label:'Produktionsdata' },
  { key:'researchData', label:'Forskningsdata' },
  { key:'classifiedInfo', label:'Säkerhetsskyddsklassad information' },
  { key:'logs', label:'Loggar' },
];

const REGULATIONS = [
  { key:'nis2', label:'NIS2' },
  { key:'dora', label:'DORA' },
  { key:'iso27001', label:'ISO 27001' },
  { key:'nistCsf', label:'NIST CSF' },
  { key:'cisControls', label:'CIS Controls' },
  { key:'iec62443', label:'IEC 62443' },
  { key:'cer', label:'CER' },
  { key:'gdpr', label:'GDPR' },
];

const RISK_COLORS = { 'Låg':'#16A34A', 'Medel':'#F59E0B', 'Hög':'#EA580C', 'Kritisk':'#DC2626' };
const RISK_BADGE_CLASS = { 'Låg':'badge-low', 'Medel':'badge-medium', 'Hög':'badge-high', 'Kritisk':'badge-critical' };

/* ============================================================
   2. STATE
   ============================================================ */

let systems = [];          // array of system objects (cache of the current workspace's data)
let settings = {};         // project/customer settings (mirrors the current workspace row)
let completedActions = {}; // { actionId: true }
let charts = {};           // Chart.js instances keyed by canvas id
let currentWizardStep = 1;
let editingSystemId = null;
let workspaces = [];        // all workspaces the caller can see
let currentWorkspaceId = null;
let currentFilters = { risk:'', vendor:'', regulation:'', owner:'', cloud:'', criticality:'' };
let currentSort = { key:'riskScore', dir:'desc' };
let searchTerm = '';
let currentReport = null;

/* ============================================================
   3. PERSISTENCE — Cloudflare Pages Functions + D1 backend
   All systems/settings/actions live server-side, scoped to a workspace
   (= one customer engagement) so consultants and customers see shared data.
   ============================================================ */

async function apiRequest(path, options){
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok){
    let msg = `Fel (${res.status})`;
    try{ const body = await res.json(); if (body.error) msg = body.error; } catch(e){}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}
const apiGet = path => apiRequest(path);
const apiPost = (path, body) => apiRequest(path, { method:'POST', body: JSON.stringify(body) });
const apiPut = (path, body) => apiRequest(path, { method:'PUT', body: JSON.stringify(body) });
const apiDelete = path => apiRequest(path, { method:'DELETE' });

/** Loads the workspace list. Called on startup and whenever the switcher opens. */
async function loadWorkspaces(){
  workspaces = await apiGet('/workspaces');
  return workspaces;
}

/** Loads everything for one workspace: metadata (-> settings), systems, action status. */
async function loadWorkspaceData(workspaceId){
  const [ws, sysList, actions] = await Promise.all([
    apiGet(`/workspaces/${workspaceId}`),
    apiGet(`/workspaces/${workspaceId}/systems`),
    apiGet(`/workspaces/${workspaceId}/actions`),
  ]);
  currentWorkspaceId = workspaceId;
  settings = { customer: ws.customer, project: ws.project, consultancy: ws.consultancy, consultant: ws.consultant, name: ws.name };
  systems = sysList;
  completedActions = actions;
  localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
}

/* ============================================================
   4. RISK ENGINE
   ============================================================ */

const CRITICALITY_WEIGHT = { 'Låg':4, 'Medel':10, 'Hög':20, 'Mycket hög':30 };
const CLASS_WEIGHT = { 'Låg':0, 'Medel':3, 'Hög':6 };
const OLD_STATUSES = ['Ska avvecklas','Föråldrat / Legacy','Ej längre supporterat'];

/**
 * Computes a 0-100 risk score plus a list of identified findings for a system.
 * Findings feed both the per-system risk view and the global recommendations engine.
 */
function computeRisk(sys){
  let score = 0;
  const findings = []; // { id, text, severity: 'low'|'medium'|'high', category }

  score += CRITICALITY_WEIGHT[sys.criticality] || 0;
  score += CLASS_WEIGHT[sys.confidentiality] || 0;
  score += CLASS_WEIGHT[sys.integrity] || 0;
  score += CLASS_WEIGHT[sys.availability] || 0;

  const sec = sys.security || {};
  const exp = sys.exposure || {};
  const data = sys.data || {};

  if (exp.internetExposed){ score += 15; findings.push({ id:'exposure_internet', text:'Systemet är internetexponerat', severity:'high' }); }
  if (exp.vendorAccess){ score += 5; findings.push({ id:'exposure_vendor', text:'Extern leverantörsåtkomst finns', severity:'medium' }); }
  if (exp.remoteAdmin && !sec.pam){ score += 6; findings.push({ id:'exposure_remoteadmin', text:'Fjärradministration utan PAM', severity:'medium' }); }

  if (!sec.mfa){ score += 10; findings.push({ id:'missing_mfa', text:'Saknad MFA', severity:'high', category:'mfa' }); }
  if (!sec.backup){ score += 10; findings.push({ id:'missing_backup', text:'Ingen backup', severity:'high', category:'backup' }); }
  if (sec.backup && !sec.immutableBackup){ score += 4; findings.push({ id:'missing_immutable', text:'Backup saknar immutability', severity:'medium', category:'immutableBackup' }); }
  if (!sec.logging){ score += 8; findings.push({ id:'missing_logging', text:'Avsaknad av loggning', severity:'high', category:'logging' }); }
  if (!sec.siem){ score += 5; findings.push({ id:'missing_siem', text:'Ingen central SIEM-övervakning', severity:'medium', category:'siem' }); }
  if (!sec.edr && !sec.xdr){ score += 8; findings.push({ id:'missing_edr', text:'Avsaknad av EDR/XDR', severity:'high', category:'edr' }); }
  if (!sec.segmentedNetwork){ score += 8; findings.push({ id:'missing_segmentation', text:'Bristande nätverkssegmentering', severity:'medium', category:'segmentedNetwork' }); }
  if (!sec.zeroTrust){ score += 3; findings.push({ id:'missing_zerotrust', text:'Zero Trust ej infört', severity:'low', category:'zeroTrust' }); }
  if (!sec.vulnScanning){ score += 5; findings.push({ id:'missing_vulnscan', text:'Ingen sårbarhetsskanning', severity:'medium', category:'vulnScanning' }); }
  if (!sec.pentestLastYear){ score += 4; findings.push({ id:'missing_pentest', text:'Inget penetrationstest senaste året', severity:'medium', category:'pentestLastYear' }); }
  if (exp.internetExposed && !sec.waf){ score += 4; findings.push({ id:'missing_waf', text:'Internetexponerat system utan WAF', severity:'medium', category:'waf' }); }

  const sensitiveData = data.sensitivePersonalData || data.paymentInfo || data.classifiedInfo || data.tradeSecrets;
  if (sensitiveData && !sec.encryption){ score += 12; findings.push({ id:'sensitive_unencrypted', text:'Känslig data utan kryptering', severity:'high', category:'encryption' }); }

  if (OLD_STATUSES.includes(sys.lifecycleStatus)){ score += 10; findings.push({ id:'old_system', text:'Föråldrat system / bristande livscykelhantering', severity:'high' }); }

  const depCount = (sys.dependencies || []).length;
  if (depCount > 3){ score += 7; findings.push({ id:'too_many_deps', text:'Många systemberoenden ökar komplexitet och risk', severity:'medium' }); }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level = 'Låg';
  if (score >= 75) level = 'Kritisk';
  else if (score >= 50) level = 'Hög';
  else if (score >= 25) level = 'Medel';

  return { score, level, findings };
}

/* Recommendation catalogue: maps a finding category to a recommended action with effect/cost ratings (1-5) */
const ACTION_CATALOGUE = {
  mfa:            { title:'Inför MFA', effect:5, cost:2, desc:'Kräv multifaktorautentisering för samtliga användare och administratörer.' },
  backup:         { title:'Implementera backup-rutin', effect:5, cost:2, desc:'Etablera regelbunden backup med definierad RPO/RTO.' },
  immutableBackup:{ title:'Inför immutable backup', effect:4, cost:3, desc:'Skydda backuper mot manipulation och ransomware genom immutability.' },
  logging:        { title:'Implementera central loggning', effect:4, cost:2, desc:'Aktivera och centralisera loggning för spårbarhet och incidentutredning.' },
  siem:           { title:'Anslut till SIEM', effect:4, cost:3, desc:'Koppla systemets loggar till SIEM för korrelation och detektion.' },
  edr:            { title:'Aktivera EDR/XDR', effect:5, cost:3, desc:'Installera EDR/XDR för detektion och respons på endpoint-nivå.' },
  segmentedNetwork:{ title:'Segmentera nätverket', effect:4, cost:4, desc:'Dela upp nätverket för att begränsa lateral rörelse vid intrång.' },
  zeroTrust:      { title:'Inför Zero Trust-principer', effect:3, cost:4, desc:'Verifiera varje åtkomst oavsett nätverksplacering.' },
  vulnScanning:   { title:'Inför sårbarhetsskanning', effect:4, cost:2, desc:'Schemalägg regelbunden skanning av sårbarheter.' },
  pentestLastYear:{ title:'Genomför penetrationstest', effect:3, cost:3, desc:'Testa systemets motståndskraft genom ett auktoriserat penetrationstest.' },
  waf:            { title:'Inför WAF', effect:3, cost:2, desc:'Skydda webbapplikationen mot vanliga attacker med en brandvägg för applikationer.' },
  encryption:     { title:'Kryptera känslig data', effect:5, cost:2, desc:'Kryptera data i vila och under överföring för känsliga informationsklasser.' },
};

const STAR_MAX = 5;
function starRating(n){
  let out = '';
  for(let i=1;i<=STAR_MAX;i++){ out += i<=n ? '★' : '<span class="off">★</span>'; }
  return out;
}

/* ============================================================
   5. RECALCULATE ALL RISK (called after any data mutation)
   ============================================================ */

function recalcAll(){
  systems.forEach(sys => {
    const r = computeRisk(sys);
    sys.riskScore = r.score;
    sys.riskLevel = r.level;
    sys.findings = r.findings;
  });
}

/* ============================================================
   6. RENDER: NAVIGATION
   ============================================================ */

function initNav(){
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });
  document.getElementById('menuToggle').addEventListener('click', () => {
    const sb = document.getElementById('sidebar');
    if (window.innerWidth <= 900) sb.classList.toggle('mobile-open');
    else sb.classList.toggle('collapsed');
  });
}

function switchView(view){
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  renderAll();
  if (view === 'settings') renderMembers();
  if (window.innerWidth <= 900) document.getElementById('sidebar').classList.remove('mobile-open');
}

/* ============================================================
   7. RENDER: DASHBOARD KPIs
   ============================================================ */

function renderKPIs(){
  const total = systems.length;
  const vendors = new Set(systems.map(s => (s.vendor||'').trim()).filter(Boolean)).size;
  const cloud = systems.filter(s => CLOUD_TYPES.includes(s.type)).length;
  const exposed = systems.filter(s => s.exposure && s.exposure.internetExposed).length;
  const highCrit = systems.filter(s => s.criticality === 'Hög' || s.criticality === 'Mycket hög').length;
  const avgRisk = total ? Math.round(systems.reduce((a,s) => a + (s.riskScore||0), 0) / total) : 0;

  const kpis = [
    { label:'Totalt antal system', value:total, icon:'fa-server', color:'var(--c-secondary)' },
    { label:'Totalt antal leverantörer', value:vendors, icon:'fa-truck-field', color:'var(--c-accent)' },
    { label:'Molntjänster', value:cloud, icon:'fa-cloud', color:'var(--c-secondary)' },
    { label:'Internetexponerade system', value:exposed, icon:'fa-globe', color:'var(--c-orange)' },
    { label:'Högkritiska system', value:highCrit, icon:'fa-fire', color:'var(--c-danger)' },
    { label:'Genomsnittlig riskpoäng', value:avgRisk, icon:'fa-gauge-high', color:RISK_COLORS[scoreToLevel(avgRisk)] },
  ];

  document.getElementById('kpiGrid').innerHTML = kpis.map(k => `
    <div class="kpi-card" style="--kpi-accent:${k.color}">
      <div class="kpi-icon" style="background:${k.color}"><i class="fa-solid ${k.icon}"></i></div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-label">${k.label}</div>
    </div>
  `).join('');
}

function scoreToLevel(score){
  if (score >= 75) return 'Kritisk';
  if (score >= 50) return 'Hög';
  if (score >= 25) return 'Medel';
  return 'Låg';
}

/* ============================================================
   8. RENDER: CHARTS
   ============================================================ */

function destroyChart(id){ if (charts[id]){ charts[id].destroy(); delete charts[id]; } }

function renderCharts(){
  renderRiskDistChart();
  renderSystemTypesChart();
  renderCloudOnpremChart();
  renderSecurityControlsChart();
  renderRegulationsChart();
  renderVendorsChart();
}

const CHART_FONT = { family:"'Inter', sans-serif", size:11 };

function renderRiskDistChart(){
  const ctx = document.getElementById('chartRiskDist');
  destroyChart('riskDist');
  const levels = ['Låg','Medel','Hög','Kritisk'];
  const counts = levels.map(l => systems.filter(s => s.riskLevel === l).length);
  charts.riskDist = new Chart(ctx, {
    type:'doughnut',
    data:{ labels:levels, datasets:[{ data:counts, backgroundColor:levels.map(l=>RISK_COLORS[l]), borderWidth:2, borderColor:'#fff' }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ font:CHART_FONT, boxWidth:10, padding:12 } } }, cutout:'62%' }
  });
}

function renderSystemTypesChart(){
  const ctx = document.getElementById('chartSystemTypes');
  destroyChart('sysTypes');
  const counts = {};
  systems.forEach(s => { counts[s.type] = (counts[s.type]||0) + 1; });
  const labels = Object.keys(counts);
  charts.sysTypes = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data:labels.map(l=>counts[l]), backgroundColor:'#005EB8', borderRadius:5, maxBarThickness:26 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } },
      scales:{ x:{ ticks:{ font:CHART_FONT }, grid:{ display:false } }, y:{ beginAtZero:true, ticks:{ font:CHART_FONT, precision:0 }, grid:{ color:'#EEF1F6' } } } }
  });
}

function renderCloudOnpremChart(){
  const ctx = document.getElementById('chartCloudOnprem');
  destroyChart('cloudOnprem');
  const cloud = systems.filter(s => CLOUD_TYPES.includes(s.type)).length;
  const onprem = systems.length - cloud;
  charts.cloudOnprem = new Chart(ctx, {
    type:'pie',
    data:{ labels:['Moln','On-prem'], datasets:[{ data:[cloud,onprem], backgroundColor:['#00A3A3','#0B2D4D'], borderWidth:2, borderColor:'#fff' }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ font:CHART_FONT, boxWidth:10, padding:12 } } } }
  });
}

function renderSecurityControlsChart(){
  const ctx = document.getElementById('chartSecurityControls');
  destroyChart('secControls');
  const total = systems.length || 1;
  const labels = SECURITY_CONTROLS.map(c => c.label);
  const pct = SECURITY_CONTROLS.map(c => Math.round(100 * systems.filter(s => s.security && s.security[c.key]).length / total));
  charts.secControls = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data:pct, backgroundColor:'#00A3A3', borderRadius:5, maxBarThickness:16 }] },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false },
      tooltip:{ callbacks:{ label: c => c.raw + '% av system' } } },
      scales:{ x:{ beginAtZero:true, max:100, ticks:{ font:CHART_FONT, callback:v=>v+'%' }, grid:{ color:'#EEF1F6' } }, y:{ ticks:{ font:{ size:10 } }, grid:{ display:false } } } }
  });
}

function renderRegulationsChart(){
  const ctx = document.getElementById('chartRegulations');
  destroyChart('regs');
  const labels = REGULATIONS.map(r => r.label);
  const counts = REGULATIONS.map(r => systems.filter(s => s.regulations && s.regulations[r.key]).length);
  charts.regs = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data:counts, backgroundColor:'#0B2D4D', borderRadius:5, maxBarThickness:22 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } },
      scales:{ x:{ ticks:{ font:{ size:10 } }, grid:{ display:false } }, y:{ beginAtZero:true, ticks:{ font:CHART_FONT, precision:0 }, grid:{ color:'#EEF1F6' } } } }
  });
}

function renderVendorsChart(){
  const ctx = document.getElementById('chartVendors');
  destroyChart('vendors');
  const counts = {};
  systems.forEach(s => { const v = (s.vendor||'').trim(); if (v) counts[v] = (counts[v]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  charts.vendors = new Chart(ctx, {
    type:'bar',
    data:{ labels:sorted.map(x=>x[0]), datasets:[{ data:sorted.map(x=>x[1]), backgroundColor:'#005EB8', borderRadius:5, maxBarThickness:20 }] },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } },
      scales:{ x:{ beginAtZero:true, ticks:{ font:CHART_FONT, precision:0 }, grid:{ color:'#EEF1F6' } }, y:{ ticks:{ font:{ size:10 } }, grid:{ display:false } } } }
  });
}

/* ============================================================
   9. RENDER: DASHBOARD LISTS (top10 / quick wins / most critical / actions)
   ============================================================ */

function renderDashboardLists(){
  renderTop10Risks();
  renderQuickWins();
  renderMostCritical();
  renderPriorityActions('priorityActions', 6);
}

function renderTop10Risks(){
  const el = document.getElementById('top10Risks');
  const sorted = [...systems].sort((a,b) => b.riskScore - a.riskScore).slice(0,10);
  if (!sorted.length){ el.innerHTML = emptyInline('Inga system registrerade ännu.'); return; }
  el.innerHTML = sorted.map((s,i) => `
    <div class="list-row" data-open-system="${s.id}">
      <div class="list-rank">${i+1}</div>
      <div class="list-main">
        <div class="list-title">${esc(s.name)}</div>
        <div class="list-sub">${esc(s.type||'')} · ${esc(s.vendor||'Okänd leverantör')}</div>
      </div>
      ${riskBadge(s.riskLevel)}
      <div class="cell-sub" style="width:34px;text-align:right;font-weight:700;">${s.riskScore}</div>
    </div>
  `).join('');
}

function renderQuickWins(){
  const el = document.getElementById('quickWins');
  // Quick wins = low cost / high effect actions aggregated across systems, not yet completed
  const agg = aggregateActions();
  const wins = agg.filter(a => a.cost <= 2 && a.effect >= 4 && !completedActions[a.id]).sort((a,b) => (b.effect-b.cost) - (a.effect-a.cost)).slice(0,6);
  if (!wins.length){ el.innerHTML = emptyInline('Inga quick wins just nu — bra jobbat!'); return; }
  el.innerHTML = wins.map(a => `
    <div class="list-row">
      <div class="list-main">
        <div class="list-title">${esc(a.title)}</div>
        <div class="list-sub">${a.affectedCount} system berörs</div>
      </div>
      <span class="stars" title="Effekt">${starRating(a.effect)}</span>
    </div>
  `).join('');
}

function renderMostCritical(){
  const el = document.getElementById('mostCritical');
  const crit = systems.filter(s => s.riskLevel === 'Kritisk' || s.riskLevel === 'Hög').sort((a,b)=>b.riskScore-a.riskScore).slice(0,6);
  if (!crit.length){ el.innerHTML = emptyInline('Inga kritiska system identifierade.'); return; }
  el.innerHTML = crit.map(s => `
    <div class="list-row" data-open-system="${s.id}">
      <div class="list-main">
        <div class="list-title">${esc(s.name)}</div>
        <div class="list-sub">${(s.findings||[]).length} identifierade brister</div>
      </div>
      ${riskBadge(s.riskLevel)}
    </div>
  `).join('');
}

/**
 * Aggregates recommended actions across all systems: one entry per action category,
 * with the number of affected systems and combined priority.
 */
function aggregateActions(){
  const map = {};
  systems.forEach(sys => {
    (sys.findings||[]).forEach(f => {
      if (!f.category || !ACTION_CATALOGUE[f.category]) return;
      const cat = f.category;
      if (!map[cat]){
        const base = ACTION_CATALOGUE[cat];
        map[cat] = { id:cat, title:base.title, desc:base.desc, effect:base.effect, cost:base.cost, affectedCount:0, systemIds:[] };
      }
      map[cat].affectedCount++;
      map[cat].systemIds.push(sys.id);
    });
  });
  return Object.values(map).sort((a,b) => (b.effect*b.affectedCount) - (a.effect*a.affectedCount));
}

function renderPriorityActions(targetId, limit){
  const el = document.getElementById(targetId);
  const agg = aggregateActions().slice(0, limit || 999);
  if (!agg.length){ el.innerHTML = emptyInline('Inga åtgärder att prioritera — miljön ser bra ut!'); return; }
  el.innerHTML = agg.map((a,i) => `
    <div class="list-row action-row ${completedActions[a.id] ? 'done' : ''}">
      <div class="action-check ${completedActions[a.id] ? 'done' : ''}" data-toggle-action="${a.id}">${completedActions[a.id] ? '<i class="fa-solid fa-check"></i>' : ''}</div>
      <div class="list-rank">${i+1}</div>
      <div class="list-main">
        <div class="list-title">${esc(a.title)}</div>
        <div class="list-sub">${esc(a.desc)} · ${a.affectedCount} system berörs</div>
      </div>
      <div style="text-align:right;">
        <div class="stars" title="Effekt">${starRating(a.effect)}</div>
        <div class="cell-sub">Kostnad: <span class="stars">${starRating(a.cost)}</span></div>
      </div>
    </div>
  `).join('');
  updateActionProgress(agg);
}

function updateActionProgress(agg){
  const all = aggregateActions();
  const total = all.length;
  const done = all.filter(a => completedActions[a.id]).length;
  const pct = total ? Math.round(100*done/total) : 0;
  document.getElementById('sidebarActionProgress').style.width = pct + '%';
  document.getElementById('sidebarActionPct').textContent = pct + '%';
}

function riskBadge(level){
  return `<span class="badge ${RISK_BADGE_CLASS[level]||'badge-neutral'}"><span class="badge-dot"></span>${level||'—'}</span>`;
}
function emptyInline(msg){ return `<div class="empty-inline">${esc(msg)}</div>`; }
function esc(str){ return String(str==null?'':str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ============================================================
   10. RENDER: INVENTORY TABLE
   ============================================================ */

function populateFilterOptions(){
  const vendorSel = document.getElementById('filterVendor');
  const ownerSel = document.getElementById('filterOwner');
  const regSel = document.getElementById('filterRegulation');
  const vendors = [...new Set(systems.map(s => s.vendor).filter(Boolean))].sort();
  const owners = [...new Set(systems.map(s => s.systemOwner).filter(Boolean))].sort();
  vendorSel.innerHTML = '<option value="">Alla</option>' + vendors.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  ownerSel.innerHTML = '<option value="">Alla</option>' + owners.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  regSel.innerHTML = '<option value="">Alla</option>' + REGULATIONS.map(r => `<option value="${r.key}">${r.label}</option>`).join('');
}

function getFilteredSystems(){
  let list = [...systems];
  const f = currentFilters;
  if (f.risk) list = list.filter(s => s.riskLevel === f.risk);
  if (f.vendor) list = list.filter(s => s.vendor === f.vendor);
  if (f.regulation) list = list.filter(s => s.regulations && s.regulations[f.regulation]);
  if (f.owner) list = list.filter(s => s.systemOwner === f.owner);
  if (f.cloud === 'yes') list = list.filter(s => CLOUD_TYPES.includes(s.type));
  if (f.cloud === 'no') list = list.filter(s => !CLOUD_TYPES.includes(s.type));
  if (f.criticality) list = list.filter(s => s.criticality === f.criticality);
  if (searchTerm){
    const t = searchTerm.toLowerCase();
    list = list.filter(s => [s.name,s.vendor,s.systemOwner,s.businessOwner,s.description,s.type]
      .some(v => (v||'').toLowerCase().includes(t)) ||
      REGULATIONS.some(r => s.regulations && s.regulations[r.key] && r.label.toLowerCase().includes(t)));
  }
  list.sort((a,b) => {
    let av = a[currentSort.key], bv = b[currentSort.key];
    if (currentSort.key === 'exposed'){ av = a.exposure && a.exposure.internetExposed ? 1:0; bv = b.exposure && b.exposure.internetExposed ? 1:0; }
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av == null) av = '';
    if (bv == null) bv = '';
    if (av < bv) return currentSort.dir === 'asc' ? -1 : 1;
    if (av > bv) return currentSort.dir === 'asc' ? 1 : -1;
    return 0;
  });
  return list;
}

function renderInventoryTable(){
  populateFilterOptions();
  const list = getFilteredSystems();
  const tbody = document.getElementById('systemsTableBody');
  document.getElementById('inventoryEmptyState').style.display = systems.length ? 'none' : 'block';
  document.getElementById('systemsTable').style.display = systems.length ? 'table' : 'none';

  if (!list.length){
    tbody.innerHTML = `<tr><td colspan="8" class="empty-inline">Inga system matchar filtren.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(s => `
    <tr data-open-system="${s.id}">
      <td>
        <div class="cell-name">${esc(s.name)}</div>
        <div class="cell-sub">${esc(s.systemOwner||'Ingen ägare angiven')}</div>
      </td>
      <td>${esc(s.type||'—')}</td>
      <td>${esc(s.vendor||'—')}</td>
      <td>${criticalityBadge(s.criticality)}</td>
      <td>
        <div class="risk-score-bar">
          <div class="risk-score-track"><div class="risk-score-fill" style="width:${s.riskScore}%;background:${RISK_COLORS[s.riskLevel]}"></div></div>
          <span>${s.riskScore}</span>
        </div>
      </td>
      <td>${riskBadge(s.riskLevel)}</td>
      <td>${s.exposure && s.exposure.internetExposed ? '<i class="fa-solid fa-globe" style="color:var(--c-orange)" title="Internetexponerad"></i>' : '<i class="fa-solid fa-lock" style="color:var(--c-text-muted)" title="Ej exponerad"></i>'}</td>
      <td>
        <div class="row-actions">
          <button data-edit-system="${s.id}" title="Redigera"><i class="fa-solid fa-pen"></i></button>
          <button data-delete-system="${s.id}" title="Ta bort"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
}

function criticalityBadge(c){
  const cls = { 'Låg':'badge-low','Medel':'badge-medium','Hög':'badge-high','Mycket hög':'badge-critical' }[c] || 'badge-neutral';
  return `<span class="badge ${cls}"><span class="badge-dot"></span>${esc(c||'—')}</span>`;
}

function initInventoryControls(){
  ['filterRisk','filterVendor','filterRegulation','filterOwner','filterCloud','filterCriticality'].forEach(id => {
    document.getElementById(id).addEventListener('change', e => {
      const map = { filterRisk:'risk', filterVendor:'vendor', filterRegulation:'regulation', filterOwner:'owner', filterCloud:'cloud', filterCriticality:'criticality' };
      currentFilters[map[id]] = e.target.value;
      renderInventoryTable();
    });
  });
  document.getElementById('clearFilters').addEventListener('click', () => {
    currentFilters = { risk:'', vendor:'', regulation:'', owner:'', cloud:'', criticality:'' };
    document.querySelectorAll('.filter-group select').forEach(s => s.value = '');
    renderInventoryTable();
  });
  document.querySelectorAll('#systemsTable thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (currentSort.key === key) currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
      else { currentSort.key = key; currentSort.dir = 'asc'; }
      renderInventoryTable();
    });
  });
  document.getElementById('systemsTableBody').addEventListener('click', e => {
    const editBtn = e.target.closest('[data-edit-system]');
    const delBtn = e.target.closest('[data-delete-system]');
    if (delBtn){ e.stopPropagation(); deleteSystem(delBtn.dataset.deleteSystem); return; }
    if (editBtn){ e.stopPropagation(); openSystemModal(editBtn.dataset.editSystem); return; }
    const row = e.target.closest('[data-open-system]');
    if (row) openDetailDrawer(row.dataset.openSystem);
  });
}

/* ============================================================
   11. GLOBAL SEARCH
   ============================================================ */

function initGlobalSearch(){
  const input = document.getElementById('globalSearch');
  input.addEventListener('input', e => {
    searchTerm = e.target.value.trim();
    switchViewSilently('inventory');
    renderInventoryTable();
  });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== input){ e.preventDefault(); input.focus(); }
  });
}
function switchViewSilently(view){
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
}

/* ============================================================
   12. SYSTEM FORM MODAL (5-step wizard)
   ============================================================ */

function buildChecklist(containerId, items, prefix){
  const el = document.getElementById(containerId);
  el.innerHTML = items.map(it => `
    <label class="check-item" data-key="${it.key}">
      <input type="checkbox" data-checklist="${prefix}" data-key="${it.key}">
      ${it.icon ? `<i class="fa-solid ${it.icon}"></i>` : ''}
      <span>${esc(it.label)}</span>
    </label>
  `).join('');
  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => cb.closest('.check-item').classList.toggle('checked', cb.checked));
  });
}

function initSystemForm(){
  buildChecklist('securityChecklist', SECURITY_CONTROLS, 'security');
  buildChecklist('exposureChecklist', EXPOSURE_ITEMS, 'exposure');
  buildChecklist('dataChecklist', DATA_ITEMS, 'data');
  buildChecklist('regulationChecklist', REGULATIONS, 'regulations');

  document.getElementById('newSystemBtnTop').addEventListener('click', () => openSystemModal());
  document.querySelectorAll('[data-action="open-new-system"]').forEach(b => b.addEventListener('click', () => openSystemModal()));
  document.getElementById('closeSystemModal').addEventListener('click', closeSystemModal);
  document.getElementById('cancelSystemBtn').addEventListener('click', closeSystemModal);
  document.getElementById('systemModalOverlay').addEventListener('click', e => { if (e.target.id === 'systemModalOverlay') closeSystemModal(); });

  document.getElementById('nextStepBtn').addEventListener('click', () => goToStep(currentWizardStep + 1));
  document.getElementById('prevStepBtn').addEventListener('click', () => goToStep(currentWizardStep - 1));
  document.querySelectorAll('.modal-progress .step').forEach(st => {
    st.addEventListener('click', () => goToStep(parseInt(st.dataset.step,10)));
  });

  document.getElementById('systemForm').addEventListener('submit', e => e.preventDefault());
  document.getElementById('saveSystemBtn').addEventListener('click', saveSystemFromForm);
}

function goToStep(step){
  if (step < 1 || step > 5) return;
  if (step === 1 && !document.getElementById('f_name').value.trim()){
    // allow navigating back freely
  }
  currentWizardStep = step;
  document.querySelectorAll('.form-step').forEach(s => s.classList.toggle('active', parseInt(s.dataset.step,10) === step));
  document.querySelectorAll('.modal-progress .step').forEach(s => {
    const n = parseInt(s.dataset.step,10);
    s.classList.toggle('active', n === step);
    s.classList.toggle('done', n < step);
  });
  document.getElementById('prevStepBtn').style.visibility = step === 1 ? 'hidden' : 'visible';
  document.getElementById('nextStepBtn').style.display = step === 5 ? 'none' : 'inline-flex';
  document.getElementById('saveSystemBtn').style.display = step === 5 ? 'inline-flex' : 'none';
}

function populateDependencyOptions(excludeId){
  const sel = document.getElementById('f_dependencies');
  sel.innerHTML = systems.filter(s => s.id !== excludeId).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
}

function openSystemModal(id){
  editingSystemId = id || null;
  document.getElementById('systemModalTitle').innerHTML = id
    ? '<i class="fa-solid fa-server"></i> Redigera system'
    : '<i class="fa-solid fa-server"></i> Lägg till system';
  const form = document.getElementById('systemForm');
  form.reset();
  document.querySelectorAll('.check-item').forEach(c => c.classList.remove('checked'));
  populateDependencyOptions(id);

  if (id){
    const sys = systems.find(s => s.id === id);
    if (sys){
      document.getElementById('systemId').value = sys.id;
      document.getElementById('f_name').value = sys.name || '';
      document.getElementById('f_description').value = sys.description || '';
      document.getElementById('f_systemOwner').value = sys.systemOwner || '';
      document.getElementById('f_businessOwner').value = sys.businessOwner || '';
      document.getElementById('f_vendor').value = sys.vendor || '';
      document.getElementById('f_contactPerson').value = sys.contactPerson || '';
      document.getElementById('f_version').value = sys.version || '';
      document.getElementById('f_lifecycleStatus').value = sys.lifecycleStatus || 'Aktiv';
      document.getElementById('f_type').value = sys.type || '';
      document.getElementById('f_criticality').value = sys.criticality || 'Låg';
      document.getElementById('f_confidentiality').value = sys.confidentiality || 'Låg';
      document.getElementById('f_integrity').value = sys.integrity || 'Låg';
      document.getElementById('f_availability').value = sys.availability || 'Låg';

      setChecklistValues('securityChecklist', sys.security);
      setChecklistValues('exposureChecklist', sys.exposure);
      setChecklistValues('dataChecklist', sys.data);
      setChecklistValues('regulationChecklist', sys.regulations);

      const depSel = document.getElementById('f_dependencies');
      Array.from(depSel.options).forEach(opt => { opt.selected = (sys.dependencies||[]).includes(opt.value); });
    }
  } else {
    document.getElementById('systemId').value = '';
  }
  goToStep(1);
  document.getElementById('systemModalOverlay').classList.add('active');
}

function setChecklistValues(containerId, valuesObj){
  const el = document.getElementById(containerId);
  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    const checked = !!(valuesObj && valuesObj[cb.dataset.key]);
    cb.checked = checked;
    cb.closest('.check-item').classList.toggle('checked', checked);
  });
}
function readChecklistValues(containerId){
  const el = document.getElementById(containerId);
  const out = {};
  el.querySelectorAll('input[type=checkbox]').forEach(cb => { out[cb.dataset.key] = cb.checked; });
  return out;
}

function closeSystemModal(){
  document.getElementById('systemModalOverlay').classList.remove('active');
  editingSystemId = null;
}

async function saveSystemFromForm(){
  const name = document.getElementById('f_name').value.trim();
  const type = document.getElementById('f_type').value;
  if (!name || !type){
    goToStep(1);
    showToast('Systemnamn och typ krävs.', 'error');
    return;
  }
  const depSel = document.getElementById('f_dependencies');
  const dependencies = Array.from(depSel.selectedOptions).map(o => o.value);

  const id = document.getElementById('systemId').value || null;
  const now = new Date().toISOString();
  const existing = id ? systems.find(s => s.id === id) : null;

  const sys = {
    id: id || undefined,
    name,
    description: document.getElementById('f_description').value.trim(),
    systemOwner: document.getElementById('f_systemOwner').value.trim(),
    businessOwner: document.getElementById('f_businessOwner').value.trim(),
    vendor: document.getElementById('f_vendor').value.trim(),
    contactPerson: document.getElementById('f_contactPerson').value.trim(),
    version: document.getElementById('f_version').value.trim(),
    lifecycleStatus: document.getElementById('f_lifecycleStatus').value,
    type,
    criticality: document.getElementById('f_criticality').value,
    confidentiality: document.getElementById('f_confidentiality').value,
    integrity: document.getElementById('f_integrity').value,
    availability: document.getElementById('f_availability').value,
    security: readChecklistValues('securityChecklist'),
    exposure: readChecklistValues('exposureChecklist'),
    data: readChecklistValues('dataChecklist'),
    regulations: readChecklistValues('regulationChecklist'),
    dependencies,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  const risk = computeRisk(sys);
  sys.riskScore = risk.score; sys.riskLevel = risk.level; sys.findings = risk.findings;

  const saveBtn = document.getElementById('saveSystemBtn');
  saveBtn.disabled = true;
  try{
    const saved = existing
      ? await apiPut(`/workspaces/${currentWorkspaceId}/systems/${id}`, sys)
      : await apiPost(`/workspaces/${currentWorkspaceId}/systems`, sys);

    if (existing) systems = systems.map(s => s.id === id ? saved : s);
    else systems.push(saved);

    closeSystemModal();
    showToast(existing ? 'System uppdaterat och analyserat.' : 'System tillagt och analyserat.', 'success');
    renderAll();
  } catch(err){
    showToast('Kunde inte spara: ' + err.message, 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteSystem(id){
  const sys = systems.find(s => s.id === id);
  if (!sys) return;
  if (!confirm(`Ta bort "${sys.name}"? Detta kan inte ångras.`)) return;
  try{
    await apiDelete(`/workspaces/${currentWorkspaceId}/systems/${id}`);
    systems = systems.filter(s => s.id !== id);
    systems.forEach(s => { s.dependencies = (s.dependencies||[]).filter(d => d !== id); });
    showToast('System borttaget.', 'success');
    renderAll();
  } catch(err){
    showToast('Kunde inte ta bort: ' + err.message, 'error');
  }
}

/* ============================================================
   13. DETAIL DRAWER
   ============================================================ */

function openDetailDrawer(id){
  const sys = systems.find(s => s.id === id);
  if (!sys) return;
  document.getElementById('detailDrawerTitle').textContent = sys.name;

  const secOn = SECURITY_CONTROLS.filter(c => sys.security && sys.security[c.key]);
  const secOff = SECURITY_CONTROLS.filter(c => !(sys.security && sys.security[c.key]));
  const expOn = EXPOSURE_ITEMS.filter(c => sys.exposure && sys.exposure[c.key]);
  const dataOn = DATA_ITEMS.filter(c => sys.data && sys.data[c.key]);
  const regOn = REGULATIONS.filter(c => sys.regulations && sys.regulations[c.key]);
  const deps = (sys.dependencies||[]).map(id2 => systems.find(s=>s.id===id2)).filter(Boolean);

  document.getElementById('detailDrawerBody').innerHTML = `
    <div class="risk-hero">
      <div class="risk-hero-score" style="color:${RISK_COLORS[sys.riskLevel]}">${sys.riskScore}</div>
      <div>
        ${riskBadge(sys.riskLevel)}
        <div class="cell-sub" style="margin-top:6px;">${esc(sys.type)} · ${esc(sys.vendor||'Okänd leverantör')}</div>
      </div>
    </div>

    <div class="drawer-section">
      <h4>Grundinformation</h4>
      <div class="kv-grid">
        <div><span class="kv-label">Systemägare</span><span class="kv-value">${esc(sys.systemOwner||'—')}</span></div>
        <div><span class="kv-label">Verksamhetsägare</span><span class="kv-value">${esc(sys.businessOwner||'—')}</span></div>
        <div><span class="kv-label">Kontaktperson</span><span class="kv-value">${esc(sys.contactPerson||'—')}</span></div>
        <div><span class="kv-label">Version</span><span class="kv-value">${esc(sys.version||'—')}</span></div>
        <div><span class="kv-label">Livscykelstatus</span><span class="kv-value">${esc(sys.lifecycleStatus||'—')}</span></div>
        <div><span class="kv-label">Affärskritikalitet</span><span class="kv-value">${esc(sys.criticality||'—')}</span></div>
      </div>
      ${sys.description ? `<p class="cell-sub" style="margin-top:10px;">${esc(sys.description)}</p>` : ''}
    </div>

    <div class="drawer-section">
      <h4>Identifierade brister</h4>
      ${(sys.findings||[]).length ? sys.findings.map(f => `<div class="finding-row"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(f.text)}</span></div>`).join('') : emptyInline('Inga brister identifierade.')}
    </div>

    <div class="drawer-section">
      <h4>Säkerhetskontroller</h4>
      <div class="tag-row">
        ${secOn.map(c => `<span class="tag on"><i class="fa-solid fa-check"></i> ${esc(c.label)}</span>`).join('')}
        ${secOff.map(c => `<span class="tag off">${esc(c.label)}</span>`).join('')}
      </div>
    </div>

    <div class="drawer-section">
      <h4>Exponering</h4>
      <div class="tag-row">${expOn.length ? expOn.map(c => `<span class="tag on">${esc(c.label)}</span>`).join('') : emptyInline('Ingen exponering registrerad.')}</div>
    </div>

    <div class="drawer-section">
      <h4>Data som behandlas</h4>
      <div class="tag-row">${dataOn.length ? dataOn.map(c => `<span class="tag on">${esc(c.label)}</span>`).join('') : emptyInline('Ingen data registrerad.')}</div>
    </div>

    <div class="drawer-section">
      <h4>Regelverk</h4>
      <div class="tag-row">${regOn.length ? regOn.map(c => `<span class="tag on">${esc(c.label)}</span>`).join('') : emptyInline('Inga regelverk kopplade.')}</div>
    </div>

    <div class="drawer-section">
      <h4>Beroenden</h4>
      ${deps.length ? deps.map(d => `<div class="list-row" data-open-system="${d.id}"><div class="list-main"><div class="list-title">${esc(d.name)}</div></div>${riskBadge(d.riskLevel)}</div>`).join('') : emptyInline('Inga beroenden registrerade.')}
    </div>

    <div class="drawer-actions">
      <button class="btn btn-primary" data-edit-system="${sys.id}"><i class="fa-solid fa-pen"></i> Redigera</button>
      <button class="btn btn-danger" data-delete-system="${sys.id}"><i class="fa-solid fa-trash"></i> Ta bort</button>
    </div>
  `;
  document.getElementById('detailDrawerBody').querySelector('[data-edit-system]').addEventListener('click', () => { closeDrawer(); openSystemModal(sys.id); });
  document.getElementById('detailDrawerBody').querySelector('[data-delete-system]').addEventListener('click', () => { closeDrawer(); deleteSystem(sys.id); });
  document.getElementById('detailDrawerBody').querySelectorAll('[data-open-system]').forEach(row => {
    row.addEventListener('click', () => openDetailDrawer(row.dataset.openSystem));
  });

  document.getElementById('detailDrawerOverlay').classList.add('active');
}
function closeDrawer(){ document.getElementById('detailDrawerOverlay').classList.remove('active'); }

function initDrawer(){
  document.getElementById('closeDrawerBtn').addEventListener('click', closeDrawer);
  document.getElementById('detailDrawerOverlay').addEventListener('click', e => { if (e.target.id === 'detailDrawerOverlay') closeDrawer(); });
}

/* ============================================================
   14. RISK ANALYSIS VIEW
   ============================================================ */

function renderRiskView(){
  renderPriorityActions('riskActionsFull', 999);
  const el = document.getElementById('riskPerSystem');
  const sorted = [...systems].sort((a,b) => b.riskScore - a.riskScore);
  if (!sorted.length){ el.innerHTML = emptyInline('Inga system registrerade ännu.'); return; }
  el.innerHTML = sorted.map(s => `
    <div class="list-row" data-open-system="${s.id}" style="align-items:flex-start;">
      <div class="list-main">
        <div class="list-title">${esc(s.name)} <span class="cell-sub">(${s.riskScore} p.)</span></div>
        <div class="list-sub">${(s.findings||[]).length ? (s.findings||[]).slice(0,3).map(f=>f.text).join(' · ') : 'Inga identifierade brister'}${(s.findings||[]).length>3 ? ' …' : ''}</div>
      </div>
      ${riskBadge(s.riskLevel)}
    </div>
  `).join('');
  el.querySelectorAll('[data-open-system]').forEach(row => row.addEventListener('click', () => openDetailDrawer(row.dataset.openSystem)));
}

/* ============================================================
   15. DEPENDENCIES VIEW
   ============================================================ */

function renderDependenciesView(){
  const depEl = document.getElementById('dependencyList');
  const withDeps = systems.filter(s => (s.dependencies||[]).length);
  depEl.innerHTML = withDeps.length ? withDeps.map(s => {
    const deps = s.dependencies.map(id => systems.find(x=>x.id===id)).filter(Boolean);
    return `<div class="list-row" style="align-items:flex-start;">
      <div class="list-main">
        <div class="list-title">${esc(s.name)}</div>
        <div class="list-sub">Beror på: ${deps.map(d=>esc(d.name)).join(', ') || '—'}</div>
      </div>
    </div>`;
  }).join('') : emptyInline('Inga systemberoenden registrerade ännu.');

  const chainEl = document.getElementById('vendorChains');
  const vendorMap = {};
  systems.forEach(s => { const v=(s.vendor||'').trim(); if(!v) return; (vendorMap[v] = vendorMap[v]||[]).push(s); });
  const chains = Object.entries(vendorMap).sort((a,b) => b[1].length - a[1].length);
  chainEl.innerHTML = chains.length ? chains.map(([vendor, list]) => `
    <div class="list-row" style="align-items:flex-start;">
      <div class="list-main">
        <div class="list-title"><i class="fa-solid fa-truck-field" style="color:var(--c-accent);margin-right:6px;"></i>${esc(vendor)}</div>
        <div class="list-sub">Levererar: ${list.map(s=>esc(s.name)).join(', ')}</div>
      </div>
      <span class="badge badge-neutral">${list.length} system</span>
    </div>
  `).join('') : emptyInline('Inga leverantörer registrerade ännu.');
}

/* ============================================================
   16. REPORTS
   ============================================================ */

function initReports(){
  document.querySelectorAll('[data-action="generate-report"]').forEach(btn => {
    btn.addEventListener('click', () => generateReport(btn.dataset.report));
  });
  document.querySelectorAll('[data-export]').forEach(btn => {
    btn.addEventListener('click', () => exportReport(btn.dataset.export));
  });
}

function reportMeta(){
  const s = settings;
  return `${esc(s.customer || 'Ej angiven kund')} · ${esc(s.project || 'Cyber Asset Inventory & Risk Assessment')} · Genererad ${new Date().toLocaleDateString('sv-SE')} av ${esc(s.consultancy || 'Konsult ej angiven')}`;
}

function generateReport(type){
  currentReport = type;
  const titles = { executive:'Executive Summary', technical:'Teknisk rapport', risk:'Riskrapport', management:'Ledningsrapport', audit:'Revisionsrapport' };
  document.getElementById('reportPreviewTitle').textContent = titles[type];
  document.getElementById('reportPreviewCard').style.display = 'block';
  document.getElementById('reportPreviewCard').scrollIntoView({ behavior:'smooth', block:'start' });

  let html = `<div class="rp-meta">${reportMeta()}</div>`;
  const avgRisk = systems.length ? Math.round(systems.reduce((a,s)=>a+s.riskScore,0)/systems.length) : 0;
  const critSystems = systems.filter(s => s.riskLevel === 'Kritisk');
  const highSystems = systems.filter(s => s.riskLevel === 'Hög');

  if (type === 'executive'){
    html += `<h2>Executive Summary</h2>
      <p>Organisationen har totalt <b>${systems.length}</b> registrerade system med en genomsnittlig riskpoäng på <b>${avgRisk}/100</b>. 
      ${critSystems.length} system bedöms ha kritisk risknivå och kräver omedelbar åtgärd.</p>
      <h3>Nyckeltal</h3>
      <table><tr><td>Totalt antal system</td><td>${systems.length}</td></tr>
      <tr><td>Kritiska system</td><td>${critSystems.length}</td></tr>
      <tr><td>Höga risker</td><td>${highSystems.length}</td></tr>
      <tr><td>Internetexponerade system</td><td>${systems.filter(s=>s.exposure&&s.exposure.internetExposed).length}</td></tr></table>
      <h3>Rekommendation</h3>
      <p>Prioritera de topp 3 rekommenderade åtgärderna nedan för att snabbast minska organisationens riskexponering.</p>
      ${aggregateActions().slice(0,3).map((a,i)=>`<p><b>${i+1}. ${esc(a.title)}</b> — ${esc(a.desc)} (${a.affectedCount} system)</p>`).join('')}`;
  } else if (type === 'technical'){
    html += `<h2>Teknisk rapport</h2>
      <table><thead><tr><th>System</th><th>Typ</th><th>Version</th><th>Livscykel</th><th>Riskpoäng</th></tr></thead><tbody>
      ${systems.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.type)}</td><td>${esc(s.version||'—')}</td><td>${esc(s.lifecycleStatus||'—')}</td><td>${s.riskScore}</td></tr>`).join('')}
      </tbody></table>
      <h3>Säkerhetskontroller per system</h3>
      ${systems.map(s => `<p><b>${esc(s.name)}</b>: ${SECURITY_CONTROLS.filter(c=>s.security&&s.security[c.key]).map(c=>c.label).join(', ') || 'Inga kontroller registrerade'}</p>`).join('')}`;
  } else if (type === 'risk'){
    html += `<h2>Riskrapport</h2>
      <p>Rangordnade risker, högst risk först.</p>
      <table><thead><tr><th>#</th><th>System</th><th>Risknivå</th><th>Poäng</th><th>Antal brister</th></tr></thead><tbody>
      ${[...systems].sort((a,b)=>b.riskScore-a.riskScore).map((s,i)=>`<tr><td>${i+1}</td><td>${esc(s.name)}</td><td>${esc(s.riskLevel)}</td><td>${s.riskScore}</td><td>${(s.findings||[]).length}</td></tr>`).join('')}
      </tbody></table>
      <h3>Detaljerade brister</h3>
      ${systems.map(s => (s.findings||[]).length ? `<p><b>${esc(s.name)}</b>: ${s.findings.map(f=>f.text).join('; ')}</p>` : '').join('')}`;
  } else if (type === 'management'){
    html += `<h2>Ledningsrapport</h2>
      <h3>Statusöversikt</h3>
      <table><tr><td>Genomsnittlig riskpoäng</td><td>${avgRisk}/100</td></tr>
      <tr><td>Åtgärder identifierade</td><td>${aggregateActions().length}</td></tr>
      <tr><td>Åtgärder genomförda</td><td>${aggregateActions().filter(a=>completedActions[a.id]).length}</td></tr></table>
      <h3>Prioriterade beslut</h3>
      ${aggregateActions().slice(0,5).map((a,i)=>`<p>${i+1}. ${esc(a.title)} — effekt ${a.effect}/5, kostnad ${a.cost}/5, berör ${a.affectedCount} system</p>`).join('')}`;
  } else if (type === 'audit'){
    html += `<h2>Revisionsrapport</h2>
      <h3>Regelefterlevnad</h3>
      <table><thead><tr><th>Regelverk</th><th>Antal system kopplade</th></tr></thead><tbody>
      ${REGULATIONS.map(r => `<tr><td>${r.label}</td><td>${systems.filter(s=>s.regulations&&s.regulations[r.key]).length}</td></tr>`).join('')}
      </tbody></table>
      <h3>Spårbarhet</h3>
      ${systems.map(s => `<p><b>${esc(s.name)}</b>: ${REGULATIONS.filter(r=>s.regulations&&s.regulations[r.key]).map(r=>r.label).join(', ') || 'Inga regelverk kopplade'}</p>`).join('')}`;
  }

  document.getElementById('reportPreviewBody').innerHTML = html;
}

function exportReport(format){
  if (!currentReport){ showToast('Generera en rapport först.', 'error'); return; }
  const titles = { executive:'Executive_Summary', technical:'Teknisk_rapport', risk:'Riskrapport', management:'Ledningsrapport', audit:'Revisionsrapport' };
  const filename = titles[currentReport] || 'Rapport';

  if (format === 'json') return exportJSON(filename);
  if (format === 'csv') return exportCSV(filename);
  if (format === 'excel') return exportExcel(filename);
  if (format === 'pdf') return exportPDF(filename);
}

function exportJSON(filename){
  const blob = new Blob([JSON.stringify({ meta: { customer: settings.customer, project: settings.project, generated: new Date().toISOString() }, systems }, null, 2)], { type:'application/json' });
  downloadBlob(blob, `${filename}.json`);
  showToast('JSON exporterad.', 'success');
}

function exportCSV(filename){
  const headers = ['Namn','Typ','Leverantör','Ägare','Kritikalitet','Riskpoäng','Risknivå','Internetexponerad'];
  const rows = systems.map(s => [s.name, s.type, s.vendor, s.systemOwner, s.criticality, s.riskScore, s.riskLevel, s.exposure&&s.exposure.internetExposed ? 'Ja':'Nej']);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v==null?'':v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type:'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${filename}.csv`);
  showToast('CSV exporterad.', 'success');
}

function exportExcel(filename){
  const rows = systems.map(s => ({
    Namn:s.name, Typ:s.type, Leverantör:s.vendor, Ägare:s.systemOwner, Kritikalitet:s.criticality,
    Riskpoäng:s.riskScore, Risknivå:s.riskLevel, Internetexponerad: s.exposure&&s.exposure.internetExposed ? 'Ja':'Nej',
    Regelverk: REGULATIONS.filter(r=>s.regulations&&s.regulations[r.key]).map(r=>r.label).join(', ')
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'System');
  XLSX.writeFile(wb, `${filename}.xlsx`);
  showToast('Excel exporterad.', 'success');
}

function exportPDF(filename){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const bodyText = document.getElementById('reportPreviewBody').innerText;
  const title = document.getElementById('reportPreviewTitle').textContent;
  doc.setFontSize(16); doc.setTextColor(11,45,77);
  doc.text(title, 14, 18);
  doc.setFontSize(9); doc.setTextColor(107,114,128);
  doc.text(reportMetaPlain(), 14, 25);
  doc.setFontSize(10); doc.setTextColor(31,41,55);
  const lines = doc.splitTextToSize(bodyText, 180);
  doc.text(lines, 14, 35);
  doc.save(`${filename}.pdf`);
  showToast('PDF exporterad.', 'success');
}
function reportMetaPlain(){
  const s = settings;
  return `${s.customer || 'Ej angiven kund'} — ${s.project || 'Cyber Asset Inventory & Risk Assessment'} — Genererad ${new Date().toLocaleDateString('sv-SE')}`;
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
   17. SETTINGS
   ============================================================ */

function initSettings(){
  document.getElementById('settingsConsultancy').value = settings.consultancy || '';
  document.getElementById('settingsCustomer').value = settings.customer || '';
  document.getElementById('settingsProject').value = settings.project || '';
  document.getElementById('settingsConsultant').value = settings.consultant || '';

  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const body = {
      name: settings.name || document.getElementById('settingsCustomer').value.trim() || 'Namnlöst arbetsrum',
      consultancy: document.getElementById('settingsConsultancy').value.trim(),
      customer: document.getElementById('settingsCustomer').value.trim(),
      project: document.getElementById('settingsProject').value.trim(),
      consultant: document.getElementById('settingsConsultant').value.trim(),
    };
    try{
      const ws = await apiPut(`/workspaces/${currentWorkspaceId}`, body);
      settings = { customer: ws.customer, project: ws.project, consultancy: ws.consultancy, consultant: ws.consultant, name: ws.name };
      updateCustomerChip();
      showToast('Inställningar sparade.', 'success');
    } catch(err){
      showToast('Kunde inte spara: ' + err.message, 'error');
    }
  });

  document.getElementById('addMemberBtn').addEventListener('click', addMember);
  document.getElementById('newMemberEmail').addEventListener('keydown', e => { if (e.key === 'Enter') addMember(); });

  document.getElementById('exportAllJsonBtn').addEventListener('click', () => exportJSON('CAIRA_full_export'));

  document.getElementById('importJsonBtn').addEventListener('click', () => document.getElementById('importJsonInput').click());
  document.getElementById('importJsonInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try{
        const parsed = JSON.parse(ev.target.result);
        const imported = Array.isArray(parsed) ? parsed : parsed.systems;
        if (!Array.isArray(imported)) throw new Error('Ogiltigt format');
        showToast(`Importerar ${imported.length} system …`);
        for (const s of imported){
          const { id, ...rest } = s; // let the API assign fresh ids
          const risk = computeRisk(rest);
          rest.riskScore = risk.score; rest.riskLevel = risk.level; rest.findings = risk.findings;
          const saved = await apiPost(`/workspaces/${currentWorkspaceId}/systems`, rest);
          systems.push(saved);
        }
        renderAll();
        showToast(`${imported.length} system importerade.`, 'success');
      } catch(err){
        showToast('Kunde inte importera: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('loadDemoBtn').addEventListener('click', loadDemoData);
  document.getElementById('clearAllDataBtn').addEventListener('click', async () => {
    if (!confirm('Radera all data i det här arbetsrummet permanent? Detta kan inte ångras.')) return;
    try{
      await apiDelete(`/workspaces/${currentWorkspaceId}/systems`);
      systems = []; completedActions = {};
      renderAll();
      showToast('All data raderad.', 'success');
    } catch(err){
      showToast('Kunde inte radera: ' + err.message, 'error');
    }
  });
}

async function renderMembers(){
  const el = document.getElementById('membersList');
  if (!currentWorkspaceId) return;
  el.innerHTML = emptyInline('Läser in …');
  try{
    const members = await apiGet(`/workspaces/${currentWorkspaceId}/members`);
    if (!members.length){ el.innerHTML = emptyInline('Inga medlemmar listade ännu.'); return; }
    el.innerHTML = members.map(m => `
      <div class="list-row">
        <div class="list-main">
          <div class="list-title"><i class="fa-solid fa-user" style="color:var(--c-text-muted); margin-right:8px;"></i>${esc(m.email)}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-remove-member="${esc(m.email)}"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `).join('');
    el.querySelectorAll('[data-remove-member]').forEach(btn => {
      btn.addEventListener('click', () => removeMember(btn.dataset.removeMember));
    });
  } catch(err){
    el.innerHTML = emptyInline('Kunde inte läsa in medlemmar: ' + err.message);
  }
}

async function addMember(){
  const input = document.getElementById('newMemberEmail');
  const email = input.value.trim();
  if (!email || !email.includes('@')){ showToast('Ange en giltig e-postadress.', 'error'); return; }
  try{
    await apiPost(`/workspaces/${currentWorkspaceId}/members`, { email });
    input.value = '';
    renderMembers();
    showToast('Medlem tillagd. Kom ihåg att också ge åtkomst i Cloudflare Access.', 'success');
  } catch(err){
    showToast('Kunde inte lägga till: ' + err.message, 'error');
  }
}

async function removeMember(email){
  if (!confirm(`Ta bort ${email} från arbetsrummet?`)) return;
  try{
    await apiRequest(`/workspaces/${currentWorkspaceId}/members`, { method:'DELETE', body: JSON.stringify({ email }) });
    renderMembers();
    showToast('Medlem borttagen.', 'success');
  } catch(err){
    showToast('Kunde inte ta bort: ' + err.message, 'error');
  }
}

function updateCustomerChip(){
  document.getElementById('customerNameDisplay').textContent = settings.customer || 'Ej angiven kund';
}

async function loadDemoData(){
  if (systems.length && !confirm('Detta lägger till exempeldata utöver befintliga system. Fortsätta?')) return;
  const demo = [
    { name:'Ekonomisystem Agresso', type:'Affärssystem', vendor:'Unit4', systemOwner:'Ekonomichef', businessOwner:'CFO', criticality:'Hög', lifecycleStatus:'Aktiv', confidentiality:'Hög', integrity:'Hög', availability:'Medel',
      security:{ mfa:false, logging:true, backup:true, encryption:false }, exposure:{ internetExposed:true, vendorAccess:true }, data:{ paymentInfo:true, personalData:true }, regulations:{ gdpr:true, nis2:true } },
    { name:'SCADA Vattenverk', type:'SCADA', vendor:'Siemens', systemOwner:'Drifttekniker', businessOwner:'Produktionschef', criticality:'Mycket hög', lifecycleStatus:'Föråldrat / Legacy', confidentiality:'Medel', integrity:'Hög', availability:'Hög',
      security:{ mfa:false, logging:false, backup:false, segmentedNetwork:false }, exposure:{ remoteAdmin:true, vendorAccess:true }, data:{ productionData:true }, regulations:{ nis2:true, iec62443:true, cer:true } },
    { name:'Microsoft 365', type:'Microsoft 365', vendor:'Microsoft', systemOwner:'IT-chef', businessOwner:'CIO', criticality:'Hög', lifecycleStatus:'Aktiv', confidentiality:'Hög', integrity:'Medel', availability:'Hög',
      security:{ mfa:true, logging:true, siem:true, backup:true, encryption:true, edr:true }, exposure:{ internetExposed:true, externalUsers:true }, data:{ personalData:true, tradeSecrets:true }, regulations:{ gdpr:true, iso27001:true } },
    { name:'HR-portal (SaaS)', type:'SaaS', vendor:'Workday', systemOwner:'HR-chef', businessOwner:'HR-direktör', criticality:'Medel', lifecycleStatus:'Aktiv', confidentiality:'Hög', integrity:'Medel', availability:'Medel',
      security:{ mfa:true, logging:false, backup:true }, exposure:{ internetExposed:true, externalUsers:true, api:true }, data:{ personalData:true, sensitivePersonalData:true }, regulations:{ gdpr:true } },
    { name:'Filserver HQ', type:'Server', vendor:'Dell', systemOwner:'IT-drift', businessOwner:'IT-chef', criticality:'Medel', lifecycleStatus:'Aktiv', confidentiality:'Medel', integrity:'Medel', availability:'Medel',
      security:{ backup:true, antivirus:true, logging:false }, exposure:{}, data:{ tradeSecrets:true, logs:true }, regulations:{ iso27001:true } },
    { name:'Kundportal (webb)', type:'Webbapplikation', vendor:'Egen utveckling', systemOwner:'Produktägare', businessOwner:'Affärsområdeschef', criticality:'Hög', lifecycleStatus:'Aktiv', confidentiality:'Hög', integrity:'Hög', availability:'Hög',
      security:{ mfa:true, waf:false, encryption:true, logging:true, edr:false }, exposure:{ internetExposed:true, api:true, externalUsers:true }, data:{ personalData:true, paymentInfo:true }, regulations:{ gdpr:true, dora:true } },
    { name:'AWS Produktionsmiljö', type:'AWS', vendor:'Amazon', systemOwner:'Cloud Engineer', businessOwner:'CTO', criticality:'Mycket hög', lifecycleStatus:'Aktiv', confidentiality:'Hög', integrity:'Hög', availability:'Hög',
      security:{ mfa:true, logging:true, siem:true, backup:true, encryption:true, edr:true, vulnScanning:true, pentestLastYear:true }, exposure:{ internetExposed:true, api:true }, data:{ productionData:true, personalData:true }, regulations:{ iso27001:true, nistCsf:true } },
    { name:'Brandvägg Perimeter', type:'Brandvägg', vendor:'Fortinet', systemOwner:'Nätverksansvarig', businessOwner:'IT-chef', criticality:'Mycket hög', lifecycleStatus:'Aktiv', confidentiality:'Medel', integrity:'Hög', availability:'Hög',
      security:{ logging:true, ips:true, ids:true, segmentedNetwork:true }, exposure:{ internetExposed:true, remoteAdmin:true }, data:{ logs:true }, regulations:{ nis2:true, cisControls:true } },
  ];
  showToast('Läser in demodata …');
  try{
    for (const d of demo){
      const sys = Object.assign({
        description:'', contactPerson:'', version:'1.0', dependencies:[],
        security:{}, exposure:{}, data:{}, regulations:{},
      }, d);
      const risk = computeRisk(sys);
      sys.riskScore = risk.score; sys.riskLevel = risk.level; sys.findings = risk.findings;
      const saved = await apiPost(`/workspaces/${currentWorkspaceId}/systems`, sys);
      systems.push(saved);
    }
    renderAll();
    showToast('Demodata inläst.', 'success');
  } catch(err){
    showToast('Kunde inte läsa in demodata: ' + err.message, 'error');
  }
}

/* ============================================================
   18. TOASTS
   ============================================================ */

function showToast(msg, type){
  const el = document.createElement('div');
  el.className = `toast ${type||''}`;
  const icon = type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
  el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${esc(msg)}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(), 300); }, 3200);
}

/* ============================================================
   19. GLOBAL CLICK DELEGATION (dashboard rows, action toggles)
   ============================================================ */

function initGlobalDelegation(){
  document.addEventListener('click', async e => {
    const toggle = e.target.closest('[data-toggle-action]');
    if (toggle){
      const id = toggle.dataset.toggleAction;
      const newValue = !completedActions[id];
      completedActions[id] = newValue; // optimistic update
      renderAll();
      try{
        await apiPost(`/workspaces/${currentWorkspaceId}/actions`, { actionId:id, completed:newValue });
      } catch(err){
        completedActions[id] = !newValue; // revert on failure
        renderAll();
        showToast('Kunde inte spara åtgärdsstatus: ' + err.message, 'error');
      }
      return;
    }
    const openRow = e.target.closest('[data-open-system]');
    if (openRow && !e.target.closest('.modal') ) {
      openDetailDrawer(openRow.dataset.openSystem);
    }
  });
}

/* ============================================================
   20. MASTER RENDER
   ============================================================ */

function renderAll(){
  recalcAll();
  renderKPIs();
  renderCharts();
  renderDashboardLists();
  renderInventoryTable();
  renderRiskView();
  renderDependenciesView();
  updateCustomerChip();
}

/* ============================================================
   21. WORKSPACE SWITCHER
   ============================================================ */

function renderWorkspaceListInto(containerId){
  const el = document.getElementById(containerId);
  if (!workspaces.length){ el.innerHTML = emptyInline('Inga arbetsrum finns ännu — skapa det första nedan.'); return; }
  el.innerHTML = workspaces.map(w => `
    <div class="list-row" data-select-workspace="${w.id}">
      <div class="list-main">
        <div class="list-title">${esc(w.name)}${w.id === currentWorkspaceId ? ' <span class="badge badge-low">Aktivt</span>' : ''}</div>
        <div class="list-sub">${esc(w.customer || 'Ingen kund angiven')} · ${esc(w.consultant || 'Ingen konsult angiven')}</div>
      </div>
      <i class="fa-solid fa-arrow-right" style="color:var(--c-text-muted);"></i>
    </div>
  `).join('');
  el.querySelectorAll('[data-select-workspace]').forEach(row => {
    row.addEventListener('click', () => selectWorkspace(row.dataset.selectWorkspace));
  });
}
function renderWorkspaceList(){ renderWorkspaceListInto('workspaceList'); }

async function createWorkspaceAndOpen(name, customer, consultant){
  if (!name.trim()){ showToast('Namn krävs för arbetsrummet.', 'error'); return; }
  try{
    const ws = await apiPost('/workspaces', { name: name.trim(), customer: customer.trim(), consultant: consultant.trim() });
    workspaces.unshift(ws);
    await selectWorkspace(ws.id);
  } catch(err){
    showToast('Kunde inte skapa arbetsrum: ' + err.message, 'error');
  }
}

function showWelcomeScreen(){
  document.getElementById('welcomeStepHero').style.display = 'block';
  document.getElementById('welcomeStepWorkspace').style.display = 'none';
  document.getElementById('welcomeScreen').classList.add('active');
}
function showWelcomeWorkspaceStep(){
  document.getElementById('welcomeWorkspaceListWrap').style.display = workspaces.length ? 'block' : 'none';
  renderWorkspaceListInto('welcomeWorkspaceList');
  document.getElementById('welcomeStepHero').style.display = 'none';
  document.getElementById('welcomeStepWorkspace').style.display = 'block';
}
function hideWelcomeScreen(){
  document.getElementById('welcomeScreen').classList.remove('active');
}

async function selectWorkspace(id){
  try{
    await loadWorkspaceData(id);
    document.getElementById('workspaceModalOverlay').classList.remove('active');
    document.getElementById('closeWorkspaceModal').style.display = workspaces.length ? 'flex' : 'none';
    hideWelcomeScreen();
    renderAll();
    showToast(`Arbetsrum: ${settings.name}`, 'success');
  } catch(err){
    showToast('Kunde inte öppna arbetsrummet: ' + err.message, 'error');
  }
}

function openWorkspaceModal(){
  renderWorkspaceList();
  document.getElementById('closeWorkspaceModal').style.display = currentWorkspaceId ? 'flex' : 'none';
  document.getElementById('workspaceModalOverlay').classList.add('active');
}

function initWorkspaceSwitcher(){
  document.getElementById('workspaceSwitcherBtn').addEventListener('click', openWorkspaceModal);
  document.getElementById('closeWorkspaceModal').addEventListener('click', () => {
    document.getElementById('workspaceModalOverlay').classList.remove('active');
  });
  document.getElementById('createWorkspaceBtn').addEventListener('click', () => {
    const name = document.getElementById('ws_name').value;
    const customer = document.getElementById('ws_customer').value;
    const consultant = document.getElementById('ws_consultant').value;
    createWorkspaceAndOpen(name, customer, consultant).then(() => {
      document.getElementById('ws_name').value = '';
      document.getElementById('ws_customer').value = '';
      document.getElementById('ws_consultant').value = '';
    });
  });

  document.getElementById('welcomeGetStartedBtn').addEventListener('click', showWelcomeWorkspaceStep);
  document.getElementById('welcomeBackBtn').addEventListener('click', () => {
    document.getElementById('welcomeStepWorkspace').style.display = 'none';
    document.getElementById('welcomeStepHero').style.display = 'block';
  });
  document.getElementById('welcomeCreateWorkspaceBtn').addEventListener('click', () => {
    const name = document.getElementById('welcome_ws_name').value;
    const customer = document.getElementById('welcome_ws_customer').value;
    const consultant = document.getElementById('welcome_ws_consultant').value;
    createWorkspaceAndOpen(name, customer, consultant);
  });
}

/* ============================================================
   22. INIT
   ============================================================ */

async function initApp(){
  initNav();
  initGlobalSearch();
  initSystemForm();
  initInventoryControls();
  initDrawer();
  initReports();
  initSettings();
  initGlobalDelegation();
  initWorkspaceSwitcher();

  try{
    await loadWorkspaces();
  } catch(err){
    showToast('Kunde inte nå API:et. Kör du detta via `wrangler pages dev`?', 'error');
    return;
  }

  const lastId = localStorage.getItem(LAST_WORKSPACE_KEY);
  const lastStillExists = lastId && workspaces.some(w => w.id === lastId);

  if (lastStillExists){
    await selectWorkspace(lastId);
  } else if (workspaces.length === 1){
    await selectWorkspace(workspaces[0].id);
  } else {
    // No remembered workspace (or it was deleted) — greet the user with the
    // full-screen onboarding gate instead of dropping them into an empty dashboard.
    showWelcomeScreen();
  }
}

document.addEventListener('DOMContentLoaded', initApp);
