/* ════════════════════════════════════════════════════════
   AB2S Sécurité — Suivi des factures — Frontend
   (même socle visuel et mêmes composants que la base clients)
════════════════════════════════════════════════════════ */

const API = window.location.origin;

const state = {
  me: null,
  page: 'dashboard',
  annee: String(new Date().getFullYear()),
  annees: [],
  categories: [],
  factures: null,          // dernière page chargée { rows, total, page, pageSize }
  priority: [],            // factures « À traiter » du tableau de bord
  kpi: null,               // KPI de l'année affichée sur le tableau de bord
  kpiStats: null,          // KPI de l'onglet Statistiques
  pageNum: 1,
  editingId: null,
  pendingKeys: new Set(),  // éléments supprimés en attente (bouton « Annuler »)
};

const STATUTS = ['À traiter', 'En cours', 'Récupérée', 'Annulée', 'Impossible à récupérer'];
const ACTIONS = ['En attente', 'Plateforme en ligne', 'Appeler fournisseur', 'Envoyer mail', 'Relance comptable'];
// Couleurs d'état (réservées aux statuts, toujours accompagnées du libellé)
const STATUT_STYLE = {
  'À traiter':              { pill: 'pill-danger',  color: 'var(--danger)' },
  'En cours':               { pill: 'pill-warning', color: 'var(--warning)' },
  'Récupérée':              { pill: 'pill-success', color: 'var(--success)' },
  'Annulée':                { pill: 'pill-neutral', color: 'var(--neutral)' },
  'Impossible à récupérer': { pill: 'pill-plum',    color: 'var(--plum)' },
};
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// ─── Init ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const me = await api('/api/me');
  if (!me || !me.nom) { window.location.href = '/login.html'; return; }
  state.me = me;
  document.getElementById('connected-as').textContent = me.nom;
  document.getElementById('user-avatar').textContent = me.nom.trim().charAt(0);
  const h = new Date().getHours();
  document.getElementById('dash-greeting').textContent = `${h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour'} ${me.nom}`;
  document.getElementById('dash-date').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('kbd-hint').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';

  updateThemeButton();
  setupKeyboard();
  setupPalette();
  setupDialog();
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', debounce(renderVisibleCharts, 150));
  window.addEventListener('pagehide', flushPendingDeleteOnExit);
  setupIdleLogout();
  await Promise.all([loadCategories(), initAnnees()]);
  route();
});

async function logout() {
  await api('/api/logout', { method: 'POST', body: {} });
  window.location.href = '/login.html';
}

async function changePassword() {
  await uiDialog({
    title: 'Changer mon mot de passe',
    message: 'Le nouveau mot de passe doit faire au moins 6 caractères.',
    icon: 'key',
    okText: 'Changer le mot de passe',
    fields: [
      { name: 'ancien', label: 'Mot de passe actuel', type: 'password', autocomplete: 'current-password' },
      { name: 'nouveau', label: 'Nouveau mot de passe', type: 'password', autocomplete: 'new-password' },
      { name: 'confirmation', label: 'Confirmer le nouveau mot de passe', type: 'password', autocomplete: 'new-password' },
    ],
    validate: async v => {
      if (!v.ancien || !v.nouveau) return 'Tous les champs sont obligatoires';
      if (v.nouveau.length < 6) return 'Le nouveau mot de passe doit faire au moins 6 caractères';
      if (v.nouveau !== v.confirmation) return 'Les deux mots de passe ne correspondent pas';
      const r = await api('/api/change-password', { method: 'POST', body: { ancien: v.ancien, nouveau: v.nouveau } });
      if (!r || !r.ok) return (r && r.error) || 'Erreur';
      return null;
    }
  }) && toast('Mot de passe changé');
}

function exportCSV() {
  window.open(API + '/api/export/csv', '_blank');
}

// ─── Navigation (#/page) ──────────────────────────────
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
function showTab(name) { go('#/' + name); }

function route() {
  flushPendingDelete();
  const [, page = 'dashboard'] = (location.hash || '#/dashboard').split('/');
  const name = document.getElementById('tab-' + page) ? page : 'dashboard';
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === name));
  state.page = name;
  window.scrollTo({ top: 0 });

  if (name === 'dashboard') loadDashboard();
  if (name === 'factures')  loadFactures();
  if (name === 'kpi')       loadKPI();
}

// ─── Années (un seul choix, partagé par toutes les pages) ───
async function initAnnees() {
  const kpi = await api('/api/kpi');
  if (!kpi) return;
  state.annees = kpi.annees || [];
  if (state.annee && !state.annees.includes(parseInt(state.annee))) state.annee = state.annees.length ? String(state.annees[0]) : '';
  ['dash-annee', 'factures-annee', 'kpi-annee'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">Toutes les années</option>' + state.annees.map(a => `<option value="${a}">${a}</option>`).join('');
    sel.value = state.annee;
  });
  updateBadge(kpi);
}

function setAnnee(value) {
  state.annee = value;
  ['dash-annee', 'factures-annee', 'kpi-annee'].forEach(id => { document.getElementById(id).value = value; });
  document.getElementById('filter-mois').value = '';
  state.pageNum = 1;
  route();
}

function anneeParam(prefix = '?') { return state.annee ? `${prefix}annee=${state.annee}` : ''; }

function updateBadge(kpiGlobal) {
  // kpiGlobal = KPI toutes années : compteur réel des factures encore à traiter
  const n = kpiGlobal.a_traiter;
  const badge = document.getElementById('badge-traiter');
  badge.textContent = n;
  badge.style.display = n > 0 ? '' : 'none';
}

// ─── Catégories (Type) ────────────────────────────────
async function loadCategories() {
  const cats = await api('/api/categories') || [];
  state.categories = cats.map(c => c.nom);
  const sel = document.getElementById('f-type');
  const current = sel.value;
  sel.innerHTML = state.categories.map(c => `<option>${esc(c)}</option>`).join('');
  if (current) sel.value = current;
}

async function addCategorie() {
  const v = await uiDialog({
    title: 'Nouvelle catégorie', icon: 'plus', okText: 'Ajouter',
    fields: [{ name: 'nom', label: 'Nom de la catégorie', placeholder: 'Ex. Carburant' }],
    validate: v => (v.nom ? null : 'Indiquez un nom')
  });
  if (!v) return;
  await api('/api/categories', { method: 'POST', body: { nom: v.nom } });
  await loadCategories();
  document.getElementById('f-type').value = v.nom;
  toast('Catégorie ajoutée');
}

// ═════════════════════════════════════════════════════
//  TABLEAU DE BORD
// ═════════════════════════════════════════════════════
async function loadDashboard() {
  const prio = document.getElementById('dash-priority-body');
  if (!prio.children.length) prio.innerHTML = skeletonRows(4, 7);
  ['chart-mois', 'chart-statut'].forEach(id => {
    const el = document.getElementById(id);
    if (!el.children.length) el.innerHTML = '<div class="skeleton skeleton-chart"></div>';
  });

  const [kpi, prioData] = await Promise.all([
    api('/api/kpi' + anneeParam()),
    api('/api/factures?statut=' + encodeURIComponent('À traiter') + anneeParam('&') + '&limit=8'),
  ]);
  if (!kpi) return;
  state.kpi = kpi;

  // Toutes années
  countUp('g-total', kpi.global_total);
  countUp('g-mont-traiter', kpi.global_montant_a_traiter, v => fmtEUR(v));
  countUp('g-mont-recup', kpi.global_montant_recupere, v => fmtEUR(v));
  countUp('g-mont-impossible', kpi.global_montant_impossible, v => fmtEUR(v));

  // Année choisie
  document.getElementById('zone-annee-label').textContent = state.annee ? `Année ${state.annee}` : 'Toutes les années';
  const stat = (label, value, statut) => `
    <div class="hero-stat">
      <span class="hs-label">${statut ? `<i class="hs-dot" style="background:${STATUT_STYLE[statut].color}"></i>` : ''}${label}</span>
      <span class="hs-value big">${value}</span>
    </div>`;
  document.getElementById('year-stats').innerHTML =
    stat('Factures', kpi.total) +
    stat('À traiter', kpi.a_traiter, 'À traiter') +
    stat('En cours', kpi.en_cours, 'En cours') +
    stat('Récupérées', kpi.recuperees, 'Récupérée') +
    stat('Impossibles', kpi.impossibles, 'Impossible à récupérer');
  const base = kpi.total - kpi.impossibles;
  const taux = base > 0 ? Math.round(kpi.recuperees / base * 100) : 0;
  document.getElementById('taux-pct').textContent = `${taux} %`;
  requestAnimationFrame(() => { document.getElementById('taux-fill').style.width = `${taux}%`; });

  // Tableau « à traiter » (corrige l'ancien affichage toujours vide : l'API renvoie { rows })
  state.priority = prioData ? prioData.rows : [];
  renderPriority();
  renderDashboardCharts();
}

function renderPriority() {
  const rows = state.priority.filter(f => !isPending('f', f.id));
  const tbody = document.getElementById('dash-priority-body');
  if (!rows.length) {
    tbody.innerHTML = `<tr class="skeleton-row"><td colspan="7">${emptyBlock('check-circle', 'Aucune facture à traiter')}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((f, i) => factureRow(f, i, false)).join('');
}

function renderDashboardCharts() {
  const kpi = state.kpi;
  if (!kpi || state.page !== 'dashboard') return;
  const map = Object.fromEntries(kpi.par_mois.map(d => [d.mois, d]));
  const months = state.annee
    ? Array.from({ length: 12 }, (_, i) => `${state.annee}-${String(i + 1).padStart(2, '0')}`)
    : continuousMonths(kpi.par_mois.map(d => d.mois));
  document.getElementById('chart-mois-sub').textContent = state.annee ? `Année ${state.annee}, selon la période des factures` : 'Toutes les années, selon la période des factures';
  barChart(document.getElementById('chart-mois'), months.map(m => {
    const d = map[m] || { n: 0, montant: 0 };
    return { label: monthShort(m) + (state.annee ? '' : ` ${m.slice(2, 4)}`), title: `${monthLong(m)} · ${d.n} facture${d.n > 1 ? 's' : ''}`, value: Number(d.montant), current: m === monthKey(new Date()) };
  }), { format: v => fmtEUR(v, 2), axisFormat: v => fmtEURCompact(v), empty: 'Aucune facture sur cette période' });

  donutChart(document.getElementById('chart-statut'), statutSeries(kpi.par_statut), 'facture');
}

// Tous les mois entre le premier et le dernier (sans trou), au format 'YYYY-MM'
function continuousMonths(list) {
  if (!list.length) return [];
  const sorted = [...list].sort();
  const [y0, m0] = sorted[0].split('-').map(Number);
  const [y1, m1] = sorted[sorted.length - 1].split('-').map(Number);
  return monthRange(new Date(y0, m0 - 1, 1), (y1 - y0) * 12 + (m1 - m0) + 1);
}

function statutSeries(parStatut) {
  const counts = Object.fromEntries(parStatut.map(d => [d.statut, parseInt(d.n)]));
  return STATUTS.map(s => ({ label: s, value: counts[s] || 0, color: STATUT_STYLE[s].color }));
}

function renderVisibleCharts() {
  if (state.page === 'dashboard') renderDashboardCharts();
  if (state.page === 'kpi') renderKPICharts();
}

function voirATraiter() {
  document.getElementById('filter-statut').value = 'À traiter';
  state.pageNum = 1;
  go('#/factures');
}

// ═════════════════════════════════════════════════════
//  LISTE DES FACTURES
// ═════════════════════════════════════════════════════
const loadFacturesDebounced = debounce(() => loadFactures(), 200);

function changePage(delta) {
  state.pageNum += delta;
  loadFactures();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadFactures() {
  await refreshMoisFilter();
  const params = new URLSearchParams();
  const v = id => document.getElementById(id).value;
  if (v('search-input')) params.append('search', v('search-input').trim());
  if (state.annee) params.append('annee', state.annee);
  if (v('filter-mois')) params.append('mois', v('filter-mois'));
  if (v('filter-statut')) params.append('statut', v('filter-statut'));
  if (v('filter-action')) params.append('action', v('filter-action'));
  params.append('page', state.pageNum);

  const tbody = document.getElementById('factures-body');
  if (!tbody.children.length) tbody.innerHTML = skeletonRows(8, 8);

  const data = await api('/api/factures?' + params.toString());
  if (!data) return;
  state.factures = data;
  renderFactures();
}

function renderFactures() {
  const { rows: all, total, page, pageSize } = state.factures;
  const rows = all.filter(f => !isPending('f', f.id));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  document.getElementById('factures-count').textContent = `${total} facture${total > 1 ? 's' : ''}${totalPages > 1 ? ` · page ${page} sur ${totalPages}` : ''}`;

  const tbody = document.getElementById('factures-body');
  const empty = document.getElementById('factures-empty');
  const pagination = document.getElementById('pagination');
  if (!rows.length) {
    tbody.innerHTML = '';
    empty.style.display = '';
    pagination.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  pagination.style.display = totalPages > 1 ? '' : 'none';
  document.getElementById('page-info').textContent = `Page ${page} / ${totalPages}`;
  document.getElementById('page-prev').disabled = page <= 1;
  document.getElementById('page-next').disabled = page >= totalPages;
  tbody.innerHTML = rows.map((f, i) => factureRow(f, i, true)).join('');
}

function factureRow(f, i, withComment) {
  const urgent = f.statut === 'À traiter' && (Date.now() - new Date(f.created_at).getTime()) > 30 * 86400000;
  return `
    <tr class="${urgent ? 'row-urgent' : ''}" onclick="openModal(${f.id})" style="animation-delay:${Math.min(i, 15) * 25}ms">
      <td><span class="pill pill-neutral">${esc(f.type)}</span></td>
      <td><strong>${esc(f.fournisseur)}</strong>${urgent ? '<span class="urgence-tag" title="À traiter depuis plus de 30 jours">+30 j</span>' : ''}</td>
      <td class="num">${fmtEUR(f.montant, 2)}</td>
      <td>${f.periode ? formatDateShort(String(f.periode).slice(0, 10)) : dash()}</td>
      <td>${esc(f.action) || dash()}</td>
      <td>${statutPill(f.statut)}</td>
      ${withComment ? `<td class="cell-comment" title="${esc(f.comment)}">${esc(f.comment) || ''}</td>` : ''}
      <td style="text-align:right">${f.statut !== 'Récupérée'
        ? `<button class="btn-recup" onclick="event.stopPropagation(); marquerRecuperee(${f.id})" title="Marquer comme récupérée">${ic('check')}Récupérée</button>` : '<span></span>'}</td>
    </tr>`;
}

async function refreshMoisFilter() {
  const sel = document.getElementById('filter-mois');
  const current = sel.value;
  const kpi = await api('/api/kpi' + anneeParam());
  if (!kpi) return;
  const mois = [...new Set(kpi.par_mois.map(d => d.mois))].sort().reverse();
  sel.innerHTML = '<option value="">Tous les mois</option>' + mois.map(m => `<option value="${m}">${monthLong(m)}</option>`).join('');
  sel.value = mois.includes(current) ? current : '';
}

function resetFilters() {
  state.pageNum = 1;
  ['search-input', 'filter-mois', 'filter-statut', 'filter-action'].forEach(id => { document.getElementById(id).value = ''; });
  loadFactures();
}

async function marquerRecuperee(id) {
  const f = findFacture(id);
  const avant = f ? f.statut : 'À traiter';
  const r = await api(`/api/factures/${id}/statut`, { method: 'PATCH', body: { statut: 'Récupérée' } });
  if (!r || !r.ok) return toast('Erreur lors de la mise à jour', true);
  toast(`${f ? f.fournisseur : 'Facture'} marquée comme récupérée`, {
    action: 'Annuler', duration: 5000,
    onAction: async () => {
      await api(`/api/factures/${id}/statut`, { method: 'PATCH', body: { statut: avant } });
      toast('Statut rétabli');
      refreshAll();
    }
  });
  refreshAll();
}

function findFacture(id) {
  return (state.factures?.rows || []).find(f => f.id === id) || state.priority.find(f => f.id === id);
}

// ═════════════════════════════════════════════════════
//  STATISTIQUES
// ═════════════════════════════════════════════════════
async function loadKPI() {
  const cards = document.getElementById('kpi-cards');
  if (!cards.children.length) cards.innerHTML = [1, 2, 3, 4].map(() => '<div class="kpi-card"><div class="skeleton" style="height:84px"></div></div>').join('');
  const kpi = await api('/api/kpi' + anneeParam());
  if (!kpi) return;
  state.kpiStats = kpi;
  const card = (tone, icon, label, value) => `
    <div class="kpi-card ${tone}">
      <div class="kpi-icon">${ic(icon, '')}</div>
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
    </div>`;
  cards.innerHTML =
    card('blue', 'receipt', 'Factures', kpi.total) +
    card('red', 'clock', 'À traiter', kpi.a_traiter) +
    card('teal', 'check-circle', 'Récupérées', kpi.recuperees) +
    card('orange', 'wallet', 'Montant total', fmtEUR(kpi.montant_recupere + kpi.montant_a_traiter + kpi.montant_impossible));

  const maxN = Math.max(1, ...kpi.par_type.map(t => parseInt(t.n)));
  document.getElementById('k-types').innerHTML = kpi.par_type.length ? kpi.par_type.map((t, i) => `
    <div class="hbar">
      <span class="hbar-label" title="${esc(t.type)}">${esc(t.type)}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${parseInt(t.n) / maxN * 100}%;animation-delay:${i * 50}ms"></div></div>
      <span class="hbar-value">${t.n} <small>· ${fmtEUR(t.montant)}</small></span>
    </div>`).join('') : emptyBlock('pie', 'Aucune facture sur cette période');
  renderKPICharts();
}

function renderKPICharts() {
  const kpi = state.kpiStats;
  if (!kpi || state.page !== 'kpi') return;
  donutChart(document.getElementById('k-chart-statut'), statutSeries(kpi.par_statut), 'facture');

  const statuts = ['À traiter', 'En cours', 'Récupérée', 'Impossible à récupérer'];
  const months = state.annee
    ? Array.from({ length: 12 }, (_, i) => `${state.annee}-${String(i + 1).padStart(2, '0')}`)
    : continuousMonths([...new Set(kpi.par_mois_statut.map(d => d.mois))].sort());
  const idx = {};
  kpi.par_mois_statut.forEach(d => { idx[`${d.mois}|${d.statut}`] = d; });
  const series = key => statuts.map(s => ({
    label: s, color: STATUT_STYLE[s].color,
    values: months.map(m => Number(idx[`${m}|${s}`]?.[key] || 0))
  }));
  const labels = months.map(m => ({ label: monthShort(m) + (state.annee ? '' : ` ${m.slice(2, 4)}`), title: monthLong(m) }));
  stackedBarChart(document.getElementById('k-chart-mois-nb'), labels, series('n'), { integer: true, format: v => `${v} facture${v > 1 ? 's' : ''}`, axisFormat: String });
  stackedBarChart(document.getElementById('k-chart-mois-mont'), labels, series('montant'), { format: v => fmtEUR(v, 2), axisFormat: fmtEURCompact });
}

// Barres empilées (statuts), même anatomie que barChart : 2px d'écart entre segments, survol par mois
function stackedBarChart(el, labels, series, opts = {}) {
  const totals = labels.map((_, i) => series.reduce((s, se) => s + se.values[i], 0));
  if (!totals.some(Boolean)) {
    el.innerHTML = `<div class="chart-empty">${ic('trend', 'i-lg')}<p>Aucune facture sur cette période</p></div>`;
    return;
  }
  const W = Math.max(el.clientWidth, 280), H = 240;
  const m = { top: 14, right: 6, bottom: 28, left: 52 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const { step, top } = niceScale(Math.max(...totals), opts.integer);
  const band = iw / labels.length;
  const bw = Math.min(34, band * 0.62);
  const y = v => m.top + ih - (v / top) * ih;
  const labelEvery = band < 34 ? 2 : 1;

  let grid = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid += `<line class="chart-grid${v === 0 ? ' base' : ''}" x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}"/>
             <text class="chart-axis" x="${m.left - 10}" y="${y(v) + 4}" text-anchor="end">${esc(opts.axisFormat(v))}</text>`;
  }
  const bars = labels.map((l, i) => {
    const x = m.left + band * i + (band - bw) / 2;
    let acc = 0;
    const segs = series.map(se => {
      const v = se.values[i];
      if (!v) return '';
      const y1 = y(acc + v), y0 = y(acc);
      acc += v;
      const h = Math.max(0, y0 - y1 - (acc < totals[i] ? 0 : 0));
      return `<rect class="bar stack" x="${x}" y="${y1}" width="${bw}" height="${Math.max(0, h - 1)}" rx="${acc === totals[i] ? 3 : 0}" style="fill:${se.color}"/>`;
    }).join('');
    return `<g class="bar-g" data-i="${i}" style="--d:${i * 30}ms">
      ${segs}
      <rect class="bar-hit" x="${m.left + band * i}" y="${m.top}" width="${band}" height="${ih}"/>
      ${i % labelEvery === 0 ? `<text class="chart-axis" x="${m.left + band * i + band / 2}" y="${H - 8}" text-anchor="middle">${esc(l.label)}</text>` : ''}
    </g>`;
  }).join('');

  el.innerHTML = `
    <div class="legend-inline">${series.map(se => `<span><i style="background:${se.color}"></i>${esc(se.label)}</span>`).join('')}</div>
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">${grid}${bars}</svg>`;
  el.querySelectorAll('.bar-g').forEach(g => {
    const i = +g.dataset.i;
    const detail = series.filter(se => se.values[i]).map(se => `${se.label} : ${opts.format(se.values[i])}`).join(' · ');
    g.addEventListener('mousemove', e => showTip(e, `${labels[i].title} — ${opts.format(totals[i])}`, detail || 'Aucune'));
    g.addEventListener('mouseenter', () => el.classList.add('hovering'));
    g.addEventListener('mouseleave', () => { el.classList.remove('hovering'); hideTip(); });
  });
}

// ═════════════════════════════════════════════════════
//  MODAL FACTURE
// ═════════════════════════════════════════════════════
async function openModal(id = null) {
  state.editingId = id;
  document.getElementById('modal-title').textContent = id ? 'Modifier la facture' : 'Nouvelle facture';
  document.getElementById('btn-delete').style.display = id ? '' : 'none';
  const set = (fid, v) => { document.getElementById(fid).value = v ?? ''; };
  if (id) {
    const f = await api(`/api/factures/${id}`);
    if (!f || f.error) return toast('Facture introuvable', true);
    set('f-id', f.id);
    if (!state.categories.includes(f.type)) {
      document.getElementById('f-type').insertAdjacentHTML('beforeend', `<option>${esc(f.type)}</option>`);
    }
    set('f-type', f.type);
    set('f-fournisseur', f.fournisseur);
    set('f-montant', Number(f.montant) || '');
    set('f-periode', f.periode ? String(f.periode).slice(0, 10) : '');
    set('f-action', f.action || 'En attente');
    set('f-statut', f.statut || 'À traiter');
    set('f-detail', f.detail);
    set('f-comment', f.comment);
  } else {
    document.getElementById('facture-form').reset();
    set('f-id', '');
    set('f-type', state.categories.includes('Matériels/Fournitures') ? 'Matériels/Fournitures' : state.categories[0]);
    set('f-action', 'En attente');
    set('f-statut', 'À traiter');
  }
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('f-fournisseur').focus(), 80);
}

function closeFactureModal() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay.classList.contains('open')) return;
  overlay.classList.add('closing');
  setTimeout(() => overlay.classList.remove('open', 'closing'), 180);
  state.editingId = null;
}

function closeModal(e) {
  if (e && e.target === document.getElementById('modal-overlay')) closeFactureModal();
}

async function saveFacture() {
  const v = fid => document.getElementById(fid).value;
  const fournisseur = v('f-fournisseur').trim();
  if (!fournisseur) { toast('Le fournisseur est obligatoire', true); document.getElementById('f-fournisseur').focus(); return; }
  const body = {
    type: v('f-type'), fournisseur,
    montant: v('f-montant') || 0, periode: v('f-periode') || null,
    action: v('f-action'), statut: v('f-statut'),
    detail: v('f-detail').trim(), comment: v('f-comment').trim(),
  };
  const id = state.editingId;
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  const r = await api(id ? `/api/factures/${id}` : '/api/factures', { method: id ? 'PUT' : 'POST', body });
  btn.disabled = false;
  if (!r || r.error) return toast((r && r.error) || 'Erreur lors de l\'enregistrement', true);
  closeFactureModal();
  toast(id ? 'Facture mise à jour' : 'Facture ajoutée');
  refreshAll();
}

function deleteFacture() {
  const id = state.editingId;
  if (!id) return;
  const nom = document.getElementById('f-fournisseur').value;
  closeFactureModal();
  deleteWithUndo({
    key: `f:${id}`, url: `/api/factures/${id}`,
    message: `Facture ${nom} supprimée`,
    rerender: rerenderLists,
    after: refreshAll,
  });
}

function rerenderLists() {
  if (state.page === 'factures' && state.factures) renderFactures();
  if (state.page === 'dashboard') renderPriority();
}

// Rafraîchit les années, le compteur du menu et la page affichée
async function refreshAll() {
  await initAnnees();
  if (state.page === 'dashboard') loadDashboard();
  if (state.page === 'factures') loadFactures();
  if (state.page === 'kpi') loadKPI();
}

// ═════════════════════════════════════════════════════
//  IMPORT / EXPORT
// ═════════════════════════════════════════════════════
function dzOver(e) { e.preventDefault(); e.currentTarget.classList.add('over'); }
function dzLeave(e) { e.currentTarget.classList.remove('over'); }
function dzDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('over');
  if (e.dataTransfer.files.length) importCSV(e.dataTransfer.files[0]);
}

async function importCSV(file) {
  if (!file) return;
  const out = document.getElementById('import-result');
  const dz = document.getElementById('dropzone');
  dz.classList.add('busy');
  out.innerHTML = `<div class="notice info">${ic('clock')}Import de ${esc(file.name)} en cours…</div>`;
  const fd = new FormData();
  fd.append('file', file);
  const r = await api('/api/import/csv', { method: 'POST', body: fd });
  dz.classList.remove('busy');
  if (r && r.ok) {
    out.innerHTML = `<div class="notice success">${ic('check-circle')}${r.imported} facture${r.imported > 1 ? 's' : ''} importée${r.imported > 1 ? 's' : ''}.</div>`;
    toast(`${r.imported} facture${r.imported > 1 ? 's' : ''} importée${r.imported > 1 ? 's' : ''}`);
    initAnnees();
  } else {
    out.innerHTML = `<div class="notice error">${ic('alert')}Erreur : ${esc((r && r.error) || 'import impossible')}</div>`;
  }
}

// ═════════════════════════════════════════════════════
//  RECHERCHE RAPIDE : éléments propres aux factures
// ═════════════════════════════════════════════════════
function defaultPaletteItems() {
  const nav = (icon, title, hash) => ({ group: 'Aller à', icon, title, run: () => go(hash) });
  return [
    { group: 'Actions', icon: 'plus', title: 'Nouvelle facture', run: () => openModal() },
    { group: 'Actions', icon: 'clock', title: 'Voir les factures à traiter', run: voirATraiter },
    { group: 'Actions', icon: currentTheme() === 'dark' ? 'sun' : 'moon', title: currentTheme() === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre', run: toggleTheme },
    nav('dashboard', 'Tableau de bord', '#/dashboard'),
    nav('receipt', 'Factures', '#/factures'),
    nav('pie', 'Statistiques', '#/kpi'),
    nav('swap', 'Import / Export', '#/import'),
  ];
}

async function searchPalette(q) {
  if (!q) return renderPaletteItems(defaultPaletteItems(), '');
  const seq = ++palette.seq;
  const r = await api(`/api/factures?search=${encodeURIComponent(q)}&limit=10`);
  if (!r || seq !== palette.seq) return;
  renderPaletteItems(r.rows.map(f => ({
    group: 'Factures', icon: 'receipt', title: f.fournisseur,
    sub: [f.type, fmtEUR(f.montant, 2), f.statut, f.periode ? formatDateShort(String(f.periode).slice(0, 10)) : ''].filter(Boolean).join(' · '),
    run: () => openModal(f.id)
  })), q);
}

function statutPill(s) {
  const st = STATUT_STYLE[s] || { pill: 'pill-neutral' };
  return `<span class="pill pill-dot ${st.pill}">${esc(s) || '—'}</span>`;
}


// ═════════════════════════════════════════════════════
//  SOCLE COMMUN (identique à la base clients)
// ═════════════════════════════════════════════════════
// ─── API helper ───────────────────────────────────────
async function api(path, opts = {}) {
  try {
    const r = await fetch(API + path, {
      headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body
    });
    if (r.status === 401) {
      const j = await r.json().catch(() => ({}));
      window.location.href = j.expired ? '/login.html?expired=1' : '/login.html';
      return null;
    }
    return r.json().catch(() => null);
  } catch (e) {
    toast('Erreur de connexion au serveur', true);
    return null;
  }
}

// ─── DÉCONNEXION APRÈS INACTIVITÉ ─────────────────────
// Le serveur coupe la session après 30 min sans requête. Tant que l'utilisateur
// bouge la souris ou tape au clavier, on envoie un signe de vie toutes les 4 min ;
// après 30 min sans aucune activité, on se déconnecte proprement.
const INACTIVITE_MAX_MS = 30 * 60 * 1000;
function setupIdleLogout() {
  let lastActivity = Date.now(), lastPing = Date.now();
  const bump = () => { lastActivity = Date.now(); };
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'].forEach(ev =>
    window.addEventListener(ev, bump, { passive: true }));
  setInterval(async () => {
    const now = Date.now();
    if (now - lastActivity > INACTIVITE_MAX_MS) {
      flushPendingDeleteOnExit();
      await fetch(API + '/api/logout', { method: 'POST' }).catch(() => {});
      window.location.href = '/login.html?expired=1';
    } else if (lastActivity > lastPing && now - lastPing > 4 * 60 * 1000) {
      lastPing = now;
      api('/api/me');
    }
  }, 30 * 1000);
}

// ─── THÈME CLAIR / SOMBRE ─────────────────────────────
function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.classList.add('theme-anim');
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('ab2s-theme', next); } catch (e) {}
  setTimeout(() => document.documentElement.classList.remove('theme-anim'), 400);
  updateThemeButton();
  renderVisibleCharts();
}

function updateThemeButton() {
  const dark = currentTheme() === 'dark';
  document.getElementById('theme-icon').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  document.getElementById('theme-label').textContent = dark ? 'Mode clair' : 'Mode sombre';
}

// ─── CLAVIER ──────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      isOpen('palette-overlay') ? closePalette() : openPalette();
      return;
    }
    if (e.key === 'Escape') {
      if (isOpen('dialog-overlay')) return; // géré par la boîte de dialogue
      if (isOpen('palette-overlay')) return closePalette();
      if (isOpen('modal-overlay')) return closeFactureModal();
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing && !anyOverlayOpen()) { e.preventDefault(); openPalette(); }
  });
}
function isOpen(id) { return document.getElementById(id).classList.contains('open'); }
function anyOverlayOpen() { return ['dialog-overlay', 'palette-overlay', 'modal-overlay'].some(isOpen); }

function countUp(id, target, format = v => String(v)) {
  const el = document.getElementById(id);
  const from = parseFloat(el.dataset.value) || 0;
  el.dataset.value = target;
  if (from === target || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = format(target); return; }
  const start = performance.now(), dur = 700;
  const step = now => {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = format(Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ═════════════════════════════════════════════════════
//  GRAPHIQUES (SVG maison, thémés par variables CSS)
// ═════════════════════════════════════════════════════
function barChart(el, data, opts = {}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) {
    el.innerHTML = `<div class="chart-empty">${ic('trend', 'i-lg')}<p>${opts.empty || 'Aucune donnée'}</p>${opts.emptyAction || ''}</div>`;
    return;
  }
  const W = Math.max(el.clientWidth, 280), H = opts.height || 220;
  const m = { top: 14, right: 6, bottom: 28, left: 52 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const max = Math.max(...data.map(d => d.value));
  const { step, top } = niceScale(max, opts.integer);
  const band = iw / data.length;
  const bw = Math.min(34, band * 0.62);
  const y = v => m.top + ih - (v / top) * ih;

  let grid = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid += `<line class="chart-grid${v === 0 ? ' base' : ''}" x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}"/>
             <text class="chart-axis" x="${m.left - 10}" y="${y(v) + 4}" text-anchor="end">${esc((opts.axisFormat || String)(v))}</text>`;
  }
  const labelEvery = band < 34 ? 2 : 1;
  const bars = data.map((d, i) => {
    const x = m.left + band * i + (band - bw) / 2;
    const h = Math.max(0, (d.value / top) * ih);
    const r = Math.min(4, h / 2, bw / 2);
    const y0 = m.top + ih;
    const path = h > 0
      ? `M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + bw - r} Q${x + bw},${y0 - h} ${x + bw},${y0 - h + r} V${y0} Z`
      : '';
    return `<g class="bar-g${d.current ? ' current' : ''}" data-i="${i}" style="--d:${i * 30}ms">
      ${path ? `<path class="bar" d="${path}"/>` : ''}
      <rect class="bar-hit" x="${m.left + band * i}" y="${m.top}" width="${band}" height="${ih}"/>
      ${i % labelEvery === 0 ? `<text class="chart-axis" x="${m.left + band * i + band / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>` : ''}
    </g>`;
  }).join('');

  el.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">${grid}${bars}</svg>`;
  el.querySelectorAll('.bar-g').forEach(g => {
    const d = data[+g.dataset.i];
    g.addEventListener('mousemove', e => showTip(e, d.title || d.label, (opts.format || String)(d.value)));
    g.addEventListener('mouseenter', () => el.classList.add('hovering'));
    g.addEventListener('mouseleave', () => { el.classList.remove('hovering'); hideTip(); });
  });
}

function donutChart(el, data, unit = 'client') {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) { el.innerHTML = `<div class="chart-empty">${ic('pie', 'i-lg')}<p>Aucune donnée sur cette période</p></div>`; return; }
  const S = 180, R = 84, r = 58, cx = S / 2, cy = S / 2;
  let a0 = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    if (!d.value) return '';
    const a1 = a0 + (d.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
    const full = d.value === total;
    const path = full
      ? `M${cx},${cy - R} A${R},${R} 0 1 1 ${cx - 0.01},${cy - R} L${cx - 0.01},${cy - r} A${r},${r} 0 1 0 ${cx},${cy - r} Z`
      : `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`;
    a0 = a1;
    return `<path class="donut-seg" data-i="${i}" d="${path}" style="fill:${d.color}"/>`;
  }).join('');

  el.innerHTML = `
    <div class="donut-wrap">
      <svg class="donut" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="Répartition par catégorie">
        ${arcs}
        <text class="donut-total" x="${cx}" y="${cy + 4}" text-anchor="middle">${total}</text>
        <text class="donut-sub" x="${cx}" y="${cy + 22}" text-anchor="middle">${unit}${total > 1 ? 's' : ''}</text>
      </svg>
      <ul class="legend">
        ${data.map((d, i) => `
          <li data-i="${i}">
            <i style="background:${d.color}"></i>
            <span class="legend-label">${esc(d.label)}</span>
            <span class="legend-value">${d.value}</span>
            <span class="legend-pct">${Math.round(d.value / total * 100)} %</span>
          </li>`).join('')}
      </ul>
    </div>`;
  const setActive = i => {
    el.querySelectorAll('[data-i]').forEach(n => n.classList.toggle('dim', i !== null && +n.dataset.i !== i));
  };
  el.querySelectorAll('.donut-seg, .legend li').forEach(n => {
    const d = data[+n.dataset.i];
    n.addEventListener('mouseenter', () => setActive(+n.dataset.i));
    n.addEventListener('mousemove', e => n.tagName === 'path' && showTip(e, d.label, `${d.value} ${unit}${d.value > 1 ? 's' : ''} · ${Math.round(d.value / total * 100)} %`));
    n.addEventListener('mouseleave', () => { setActive(null); hideTip(); });
  });
}

function niceScale(max, integer) {
  if (max <= 0) return { step: 1, top: 1 };
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  let step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  if (integer) step = Math.max(1, Math.ceil(step));
  return { step, top: Math.ceil(max / step) * step };
}

function showTip(e, title, value) {
  const tip = document.getElementById('chart-tip');
  tip.innerHTML = `<div class="tip-title">${esc(title)}</div><div class="tip-value">${esc(value)}</div>`;
  tip.classList.add('show');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, yy = e.clientY - h - 12;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
  if (yy < 8) yy = e.clientY + 16;
  tip.style.transform = `translate(${x}px, ${yy}px)`;
}
function hideTip() { document.getElementById('chart-tip').classList.remove('show'); }

// ═════════════════════════════════════════════════════
//  RECHERCHE RAPIDE (Ctrl+K / ⌘K)
// ═════════════════════════════════════════════════════
const palette = { items: [], index: 0, seq: 0 };

function setupPalette() {
  const input = document.getElementById('palette-input');
  input.addEventListener('input', debounce(() => searchPalette(input.value.trim()), 120));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(palette.index); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
}

function openPalette() {
  const overlay = document.getElementById('palette-overlay');
  overlay.classList.add('open');
  const input = document.getElementById('palette-input');
  input.value = '';
  renderPaletteItems(defaultPaletteItems(), '');
  setTimeout(() => input.focus(), 30);
}

function closePalette() {
  document.getElementById('palette-overlay').classList.remove('open');
}

function renderPaletteItems(items, q) {
  palette.items = items;
  palette.index = 0;
  const el = document.getElementById('palette-results');
  if (!items.length) {
    el.innerHTML = `<div class="palette-empty">Aucun résultat pour « ${esc(q)} »</div>`;
    return;
  }
  let lastGroup = null;
  el.innerHTML = items.map((it, i) => {
    const head = it.group !== lastGroup ? `<div class="palette-group">${it.group}</div>` : '';
    lastGroup = it.group;
    return `${head}
      <div class="palette-item${i === 0 ? ' active' : ''}" data-i="${i}" onmousemove="setPaletteIndex(${i})" onclick="runPaletteItem(${i})">
        ${it.avatar || `<span class="palette-icon">${ic(it.icon)}</span>`}
        <div class="palette-text">
          <div class="palette-title">${highlight(it.title, q)}</div>
          ${it.sub ? `<div class="palette-sub">${highlight(it.sub, q)}</div>` : ''}
        </div>
        <span class="palette-enter">${ic('enter')}</span>
      </div>`;
  }).join('');
}

function setPaletteIndex(i) {
  if (palette.index === i) return;
  palette.index = i;
  document.querySelectorAll('.palette-item').forEach(n => n.classList.toggle('active', +n.dataset.i === i));
}

function movePalette(d) {
  if (!palette.items.length) return;
  setPaletteIndex((palette.index + d + palette.items.length) % palette.items.length);
  document.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
}

function runPaletteItem(i) {
  const it = palette.items[i];
  if (!it) return;
  closePalette();
  it.run();
}

function highlight(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return safe;
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

// ═════════════════════════════════════════════════════
//  BOÎTES DE DIALOGUE (remplacent confirm / prompt)
// ═════════════════════════════════════════════════════
const dialog = { resolve: null, opts: null };

function setupDialog() {
  document.getElementById('dialog-cancel').addEventListener('click', () => closeDialog(null));
  document.getElementById('dialog-ok').addEventListener('click', submitDialog);
  document.getElementById('dialog-form').addEventListener('submit', e => { e.preventDefault(); submitDialog(); });
  document.getElementById('dialog-overlay').addEventListener('mousedown', e => { if (e.target.id === 'dialog-overlay') closeDialog(null); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen('dialog-overlay')) { e.stopPropagation(); closeDialog(null); } }, true);
}

function uiDialog(opts) {
  flushPendingDelete();
  dialog.opts = opts;
  const danger = !!opts.danger;
  document.getElementById('dialog-title').textContent = opts.title || '';
  document.getElementById('dialog-message').textContent = opts.message || '';
  document.getElementById('dialog-icon').className = 'dialog-icon' + (danger ? ' danger' : '');
  document.getElementById('dialog-icon').innerHTML = ic(opts.icon || (danger ? 'trash' : 'info'), '');
  document.getElementById('dialog-error').textContent = '';
  const ok = document.getElementById('dialog-ok');
  ok.textContent = opts.okText || 'Valider';
  ok.className = danger ? 'btn-danger solid' : 'btn-primary';
  ok.disabled = false;
  document.getElementById('dialog-cancel').textContent = opts.cancelText || 'Annuler';

  const form = document.getElementById('dialog-form');
  form.innerHTML = (opts.fields || []).map(f => {
    const attrs = `name="${f.name}" id="dlg-${f.name}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}`;
    const input = f.type === 'select'
      ? `<select ${attrs}>${f.options.map(o => `<option value="${esc(o.value)}"${String(o.value) === String(f.value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
      : `<input type="${f.type || 'text'}" ${attrs} value="${esc(f.value ?? '')}">`;
    return `<div class="form-group"><label for="dlg-${f.name}">${esc(f.label)}</label>${input}</div>`;
  }).join('') + '<button type="submit" hidden></button>';
  form.style.display = opts.fields && opts.fields.length ? '' : 'none';

  document.getElementById('dialog-overlay').classList.add('open');
  setTimeout(() => (form.querySelector('input, select') || ok).focus(), 50);
  return new Promise(resolve => { dialog.resolve = resolve; });
}

function uiConfirm(opts) {
  return uiDialog(opts).then(v => v !== null);
}

async function submitDialog() {
  const values = formValues(document.getElementById('dialog-form'));
  if (dialog.opts.validate) {
    const ok = document.getElementById('dialog-ok');
    ok.disabled = true;
    const err = await dialog.opts.validate(values);
    ok.disabled = false;
    if (err) {
      const el = document.getElementById('dialog-error');
      el.textContent = err;
      el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
      return;
    }
  }
  closeDialog(values);
}

function closeDialog(values) {
  const overlay = document.getElementById('dialog-overlay');
  overlay.classList.add('closing');
  setTimeout(() => overlay.classList.remove('open', 'closing'), 160);
  const r = dialog.resolve;
  dialog.resolve = null;
  r && r(values);
}

// ═════════════════════════════════════════════════════
//  SUPPRESSION AVEC « ANNULER »
// ═════════════════════════════════════════════════════
let pendingDelete = null;

function deleteWithUndo({ key, url, message, rerender, after }) {
  flushPendingDelete();
  state.pendingKeys.add(key);
  rerender && rerender();
  const p = { key, url, after };
  p.timer = setTimeout(() => commitDelete(p), 5000);
  pendingDelete = p;
  toast(message, {
    action: 'Annuler', duration: 5000,
    onAction: () => {
      clearTimeout(p.timer);
      if (pendingDelete === p) pendingDelete = null;
      state.pendingKeys.delete(key);
      rerender && rerender();
      toast('Suppression annulée');
    }
  });
}

async function commitDelete(p) {
  if (pendingDelete === p) pendingDelete = null;
  await api(p.url, { method: 'DELETE' });
  state.pendingKeys.delete(p.key);
  p.after && p.after();
}

function flushPendingDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  commitDelete(pendingDelete);
}

function flushPendingDeleteOnExit() {
  if (!pendingDelete) return;
  fetch(API + pendingDelete.url, { method: 'DELETE', keepalive: true });
  pendingDelete = null;
}

function isPending(kind, id) { return state.pendingKeys.has(`${kind}:${id}`); }

// ═════════════════════════════════════════════════════
//  UTILITAIRES
// ═════════════════════════════════════════════════════
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function ic(name, cls = 'i-sm') {
  return `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;
}

function dash() { return '<span class="muted">—</span>'; }

function delBtn(onclick) {
  return `<button type="button" class="activite-del" onclick="event.stopPropagation(); ${onclick}" title="Supprimer">${ic('trash')}</button>`;
}

function emptyBlock(icon, text, extra = '') {
  return `<div class="empty-state"><div class="empty-icon">${ic(icon, 'i-lg')}</div><p>${text}</p>${extra}</div>`;
}

function skeletonRows(n, cols) {
  return Array.from({ length: n }, () =>
    `<tr class="skeleton-row">${Array.from({ length: cols }, (_, i) =>
      `<td><div class="skeleton" style="width:${i === 0 ? 70 : 40 + Math.random() * 40}%"></div></td>`).join('')}</tr>`).join('');
}

function skeletonList(n) {
  return Array.from({ length: n }, () => `
    <div class="list-row skeleton-row">
      <div class="skeleton" style="width:36px;height:36px;border-radius:10px"></div>
      <div class="list-main"><div class="skeleton" style="width:60%"></div><div class="skeleton mt8" style="width:35%;height:10px"></div></div>
    </div>`).join('');
}

function formValues(form) {
  const out = {};
  new FormData(form).forEach((v, k) => { out[k] = typeof v === 'string' ? v.trim() : v; });
  return out;
}

function timeAgo(d) {
  if (!d) return '';
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 30) return `il y a ${Math.floor(diff / 86400)} j`;
  return formatDateShort(String(d).slice(0, 10));
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(d) {
  if (!d) return '—';
  return new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Mois au format 'YYYY-MM'
function monthKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function addMonths(date, n) { return new Date(date.getFullYear(), date.getMonth() + n, 1); }
function monthRange(start, n) { return Array.from({ length: n }, (_, i) => monthKey(addMonths(start, i))); }
function monthShort(key) { return MOIS_COURTS[parseInt(key.slice(5, 7)) - 1]; }
function monthLong(key) {
  const s = new Date(parseInt(key.slice(0, 4)), parseInt(key.slice(5, 7)) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtEUR(v, decimals = 0) {
  return Number(v || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtEURCompact(v) {
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`;
  if (v >= 1e3) return `${(v / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`;
  return `${v} €`;
}
function fmtNum(v) { return Math.round(v).toLocaleString('fr-FR'); }
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

let toastTimer;
function toast(msg, opts = false) {
  if (typeof opts === 'boolean') opts = { error: opts };
  const el = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  const btn = document.getElementById('toast-action');
  if (opts.action) {
    btn.textContent = opts.action;
    btn.style.display = '';
    btn.onclick = () => { btn.onclick = null; opts.onAction(); };
  } else {
    btn.style.display = 'none';
    btn.onclick = null;
  }
  el.className = 'toast' + (opts.error ? ' error' : '');
  void el.offsetWidth; // relance l'animation
  el.classList.add('show');
  el.style.setProperty('--toast-dur', `${opts.duration || 3200}ms`);
  el.classList.toggle('timed', !!opts.action);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), opts.duration || 3200);
}
