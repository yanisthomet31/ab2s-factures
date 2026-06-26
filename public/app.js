const API = '';

// ─── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('date-today').textContent = new Date().toLocaleDateString('fr-FR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  showTab('dashboard');
});

// ─── Navigation ───────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  if (name === 'dashboard') loadDashboard();
  else if (name === 'factures') loadFactures();
  else if (name === 'kpi') loadKPI();
}

// ─── Dashboard ────────────────────────────────────────
let chartMois = null, chartStatut = null;

async function loadDashboard() {
  const kpi = await fetchJSON('/api/kpi');
  if (!kpi) return;

  document.getElementById('d-total').textContent  = kpi.total;
  document.getElementById('d-traiter').textContent = kpi.a_traiter;
  document.getElementById('d-cours').textContent  = kpi.en_cours;
  document.getElementById('d-recup').textContent  = kpi.recuperees;
  document.getElementById('d-montant').textContent = formatEUR(kpi.montant_total);

  const badge = document.getElementById('badge-traiter');
  if (kpi.a_traiter > 0) { badge.textContent = kpi.a_traiter; badge.style.display = ''; }
  else badge.style.display = 'none';

  buildMoisChart(kpi.par_mois);
  buildStatutChart(kpi.par_statut);

  const factures = await fetchJSON('/api/factures?statut=%C3%80%20traiter');
  const tbody = document.getElementById('dash-priority-body');
  if (!factures || !factures.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:20px">Aucune facture à traiter 🎉</td></tr>';
    return;
  }
  tbody.innerHTML = factures.slice(0,8).map(f => `
    <tr onclick="openModal(${f.id})">
      <td><span class="type-badge">${f.type}</span></td>
      <td><strong>${f.fournisseur}</strong></td>
      <td>${formatEUR(f.montant)}</td>
      <td>${formatDate(f.periode)}</td>
      <td>${f.action}</td>
      <td>${statutBadge(f.statut)}</td>
    </tr>`).join('');
}

function buildMoisChart(data) {
  const ctx = document.getElementById('chart-mois');
  if (!ctx) return;
  if (chartMois) chartMois.destroy();
  chartMois = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.mois),
      datasets: [{
        label: 'Nb factures',
        data: data.map(d => d.n),
        backgroundColor: 'rgba(57,73,171,.7)',
        borderRadius: 5
      }, {
        label: 'Montant (€)',
        data: data.map(d => parseFloat(d.montant)),
        backgroundColor: 'rgba(245,124,0,.6)',
        borderRadius: 5,
        yAxisID: 'y2'
      }]
    },
    options: {
      responsive:true, interaction:{mode:'index'},
      plugins:{legend:{position:'bottom'}},
      scales:{
        y:{beginAtZero:true,title:{display:true,text:'Nb'}},
        y2:{beginAtZero:true,position:'right',title:{display:true,text:'€'},grid:{drawOnChartArea:false}}
      }
    }
  });
}

function buildStatutChart(data) {
  const ctx = document.getElementById('chart-statut');
  if (!ctx) return;
  if (chartStatut) chartStatut.destroy();
  const colors = {'À traiter':'#D32F2F','En cours':'#F57C00','Récupérée':'#388E3C','Annulée':'#9E9E9E','Impossible à récupérer':'#6A1B9A'};
  chartStatut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.statut),
      datasets: [{ data: data.map(d => d.n), backgroundColor: data.map(d => colors[d.statut]||'#1A237E'), borderWidth:2 }]
    },
    options: { responsive:true, plugins:{ legend:{ position:'bottom', labels:{font:{size:11}} } } }
  });
}

// ─── Factures ─────────────────────────────────────────
async function loadFactures() {
  const params = new URLSearchParams();
  const search = document.getElementById('search-input')?.value;
  const type   = document.getElementById('filter-type')?.value;
  const statut = document.getElementById('filter-statut')?.value;
  const action = document.getElementById('filter-action')?.value;
  if (search) params.append('search', search);
  if (type)   params.append('type', type);
  if (statut) params.append('statut', statut);
  if (action) params.append('action', action);

  const data = await fetchJSON('/api/factures?' + params.toString());
  if (!data) return;

  document.getElementById('factures-count').textContent = `${data.length} facture${data.length > 1 ? 's' : ''}`;

  const tbody = document.getElementById('factures-body');
  const empty = document.getElementById('factures-empty');

  if (!data.length) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  tbody.innerHTML = data.map(f => `
    <tr onclick="openModal(${f.id})">
      <td><span class="type-badge">${f.type}</span></td>
      <td><strong>${f.fournisseur}</strong></td>
      <td>${formatEUR(f.montant)}</td>
      <td>${formatDate(f.periode)}</td>
      <td>${f.action}</td>
      <td>${statutBadge(f.statut)}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)">${f.comment||''}</td>
      <td>
        <button class="btn-ghost btn-sm" onclick="event.stopPropagation();openModal(${f.id})">✏️</button>
      </td>
    </tr>`).join('');
}

function resetFilters() {
  document.getElementById('search-input').value = '';
  document.getElementById('filter-type').value = '';
  document.getElementById('filter-statut').value = '';
  document.getElementById('filter-action').value = '';
  loadFactures();
}

// ─── KPI ─────────────────────────────────────────────
let kChartType = null, kChartStatut = null, kChartMontant = null;

async function loadKPI() {
  const kpi = await fetchJSON('/api/kpi');
  if (!kpi) return;

  document.getElementById('k-total').textContent   = kpi.total;
  document.getElementById('k-traiter').textContent = kpi.a_traiter;
  document.getElementById('k-recup').textContent   = kpi.recuperees;
  document.getElementById('k-montant').textContent = formatEUR(kpi.montant_total);

  const colors = ['#1A237E','#F57C00','#388E3C','#D32F2F','#6A1B9A','#0277BD','#558B2F'];

  if (kChartType) kChartType.destroy();
  kChartType = new Chart(document.getElementById('k-chart-type'), {
    type:'doughnut',
    data:{ labels: kpi.par_type.map(d=>d.type), datasets:[{ data: kpi.par_type.map(d=>d.n), backgroundColor: colors, borderWidth:2 }] },
    options:{ responsive:true, plugins:{ legend:{ position:'bottom', labels:{font:{size:11}} } } }
  });

  const sColors = {'À traiter':'#D32F2F','En cours':'#F57C00','Récupérée':'#388E3C','Annulée':'#9E9E9E','Impossible à récupérer':'#6A1B9A'};
  if (kChartStatut) kChartStatut.destroy();
  kChartStatut = new Chart(document.getElementById('k-chart-statut'), {
    type:'doughnut',
    data:{ labels: kpi.par_statut.map(d=>d.statut), datasets:[{ data: kpi.par_statut.map(d=>d.n), backgroundColor: kpi.par_statut.map(d=>sColors[d.statut]||'#1A237E'), borderWidth:2 }] },
    options:{ responsive:true, plugins:{ legend:{ position:'bottom', labels:{font:{size:11}} } } }
  });

  if (kChartMontant) kChartMontant.destroy();
  kChartMontant = new Chart(document.getElementById('k-chart-montant'), {
    type:'bar',
    data:{
      labels: kpi.par_type.map(d=>d.type),
      datasets:[{ label:'Montant (€)', data: kpi.par_type.map(d=>parseFloat(d.montant)), backgroundColor: colors, borderRadius:5 }]
    },
    options:{ responsive:true, plugins:{legend:{display:false}}, scales:{ y:{beginAtZero:true} } }
  });
}

// ─── Modal ────────────────────────────────────────────
let currentId = null;

async function openModal(id) {
  currentId = id || null;
  document.getElementById('modal-title').textContent = id ? 'Modifier la facture' : 'Nouvelle facture';
  document.getElementById('btn-delete').style.display = id ? '' : 'none';

  if (id) {
    const f = await fetchJSON(`/api/factures/${id}`);
    if (!f) return;
    document.getElementById('f-id').value         = f.id;
    document.getElementById('f-type').value       = f.type;
    document.getElementById('f-fournisseur').value = f.fournisseur;
    document.getElementById('f-montant').value    = f.montant || '';
    document.getElementById('f-periode').value    = f.periode ? f.periode.slice(0,10) : '';
    document.getElementById('f-action').value     = f.action;
    document.getElementById('f-statut').value     = f.statut;
    document.getElementById('f-detail').value     = f.detail || '';
    document.getElementById('f-comment').value    = f.comment || '';
  } else {
    document.getElementById('f-id').value = '';
    document.getElementById('f-type').value = 'Matériels/Fournitures';
    document.getElementById('f-fournisseur').value = '';
    document.getElementById('f-montant').value = '';
    document.getElementById('f-periode').value = '';
    document.getElementById('f-action').value = 'En attente';
    document.getElementById('f-statut').value = 'À traiter';
    document.getElementById('f-detail').value = '';
    document.getElementById('f-comment').value = '';
  }
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.remove('open');
}

async function saveFacture() {
  const fournisseur = document.getElementById('f-fournisseur').value.trim();
  if (!fournisseur) { toast('Fournisseur obligatoire', true); return; }

  const body = {
    type:        document.getElementById('f-type').value,
    fournisseur,
    montant:     document.getElementById('f-montant').value || 0,
    periode:     document.getElementById('f-periode').value || null,
    action:      document.getElementById('f-action').value,
    statut:      document.getElementById('f-statut').value,
    detail:      document.getElementById('f-detail').value,
    comment:     document.getElementById('f-comment').value
  };

  const id = currentId;
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/factures/${id}` : '/api/factures';
  const r = await postJSON(url, body, method);
  if (!r) return;

  document.getElementById('modal-overlay').classList.remove('open');
  toast(id ? 'Facture mise à jour ✓' : 'Facture ajoutée ✓');
  loadFactures();
  loadDashboard();
}

async function deleteFacture() {
  if (!currentId) return;
  if (!confirm('Supprimer cette facture ?')) return;
  await fetch(`/api/factures/${currentId}`, { method:'DELETE' });
  document.getElementById('modal-overlay').classList.remove('open');
  toast('Facture supprimée');
  loadFactures();
  loadDashboard();
}

// ─── Import CSV ───────────────────────────────────────
function handleDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) importCSV(file);
}

async function importCSV(file) {
  if (!file) return;
  const resultEl = document.getElementById('import-result');
  resultEl.innerHTML = '<p style="color:var(--text2)">⏳ Import en cours…</p>';

  const form = new FormData();
  form.append('file', file);

  try {
    const r = await fetch('/api/import/csv', { method:'POST', body:form });
    const data = await r.json();
    if (data.ok) {
      resultEl.innerHTML = `<p style="color:var(--green);font-weight:600">✅ ${data.imported} facture${data.imported > 1 ? 's' : ''} importée${data.imported > 1 ? 's' : ''} avec succès !</p>`;
      toast(`${data.imported} factures importées ✓`);
    } else {
      resultEl.innerHTML = `<p style="color:var(--red)">❌ Erreur : ${data.error}</p>`;
    }
  } catch(e) {
    resultEl.innerHTML = `<p style="color:var(--red)">❌ Erreur réseau</p>`;
  }
}

// ─── Export CSV ───────────────────────────────────────
async function exportCSV() {
  window.location.href = '/api/export/csv';
}

// ─── Helpers ──────────────────────────────────────────
async function fetchJSON(url) {
  try {
    const r = await fetch(API + url);
    if (!r.ok) throw new Error(r.status);
    return r.json();
  } catch(e) {
    toast('Erreur serveur : ' + e.message, true);
    return null;
  }
}

async function postJSON(url, body, method='POST') {
  try {
    const r = await fetch(API + url, {
      method,
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  } catch(e) {
    toast('Erreur : ' + e.message, true);
    return null;
  }
}

function formatEUR(n) {
  const v = parseFloat(n) || 0;
  if (v === 0) return '—';
  return v.toLocaleString('fr-FR', { minimumFractionDigits:0, maximumFractionDigits:2 }) + ' €';
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' });
}

function statutBadge(s) {
  const map = {
    'À traiter':  's-traiter',
    'En cours':   's-cours',
    'Récupérée':  's-recuperee',
    'Annulée':    's-annulee',
    'Impossible à récupérer': 's-impossible'
  };
  return `<span class="statut-badge ${map[s]||''}">${s}</span>`;
}

let toastTimer;
function toast(msg, err=false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (err ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
