const $ = s => document.querySelector(s);
const BRL = v => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BRLk = v => v >= 1000 ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : BRL(v);
const NUM = v => (v || 0).toLocaleString('pt-BR');
const PCT = v => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const PAL = ['#22c58b', '#4f9cf0', '#f0b24a', '#ef5f6b', '#9b8cf0', '#3fd0c8', '#e879a9', '#c0a37a', '#7dd957', '#5a8bd6'];

let DATA = null, meses = [];
let state = { de: null, ate: null, visao: 'chale', cat: '', sort: { key: 'faturamento', dir: -1 }, unidadeSel: null };
let trendChart, pdvChart, payChart;

async function boot() {
  try {
    const r = await fetch('data.json?_=' + Date.now());
    DATA = await r.json();
  } catch (e) {
    $('#loading').innerHTML = '<div class="empty">Não consegui carregar <b>data.json</b>.<br>Rode o coletor (<code>npm run scrape</code>) ou aguarde a primeira atualização na nuvem.</div>';
    return;
  }
  meses = DATA.meses || [];
  if (!meses.length) { $('#loading').innerHTML = '<div class="empty">Sem dados ainda.</div>'; return; }
  $('#hotelName').textContent = 'DashLucros · ' + (DATA.hotel || '');
  $('#updated').textContent = 'Atualizado: ' + new Date(DATA.gerado_em).toLocaleString('pt-BR');

  const opts = meses.map(m => `<option value="${m.mes}">${m.label}</option>`).join('');
  $('#mesDe').innerHTML = opts; $('#mesAte').innerHTML = opts;
  state.de = state.ate = meses[meses.length - 1].mes;
  $('#mesDe').value = state.de; $('#mesAte').value = state.ate;

  bindEvents();
  render();
  $('#loading').classList.add('off');
}

// ---- agregação do período selecionado (de..ate) ----
function periodoMeses() {
  const di = meses.findIndex(m => m.mes === state.de);
  const ai = meses.findIndex(m => m.mes === state.ate);
  const [a, b] = di <= ai ? [di, ai] : [ai, di];
  return meses.slice(a, b + 1);
}

function aggUnidades(ms) {
  const map = new Map();
  for (const m of ms) for (const u of m.unidades) {
    const c = map.get(u.unidade) || { ordem: u.ordem, unidade: u.unidade, categoria: u.categoria, qtde: 0, faturamento: 0, diarias: 0, pessoas: 0, _ocup: 0, _revpar: 0, _n: 0 };
    c.qtde += u.qtde; c.faturamento += u.faturamento; c.diarias += u.diarias; c.pessoas += u.pessoas;
    c._ocup += u.ocupacao; c._revpar += u.revpar; c._n++;
    map.set(u.unidade, c);
  }
  return [...map.values()].map(c => ({
    ...c, faturamento: +c.faturamento.toFixed(2),
    diariaMedia: c.diarias ? +(c.faturamento / c.diarias).toFixed(2) : 0,
    ocupacao: c._n ? +(c._ocup / c._n).toFixed(1) : 0,
    revpar: c._n ? +(c._revpar / c._n).toFixed(2) : 0,
  }));
}

function agrupaPorCategoria(unidades) {
  const map = new Map();
  for (const u of unidades) {
    const c = map.get(u.categoria) || { unidade: u.categoria, categoria: u.categoria, qtde: 0, faturamento: 0, diarias: 0, pessoas: 0, _ocup: 0, _revpar: 0, _n: 0, _un: 0 };
    c.qtde += u.qtde; c.faturamento += u.faturamento; c.diarias += u.diarias; c.pessoas += u.pessoas;
    c._ocup += u.ocupacao; c._revpar += u.revpar; c._n++; c._un++;
    map.set(u.categoria, c);
  }
  return [...map.values()].map(c => ({
    ...c, faturamento: +c.faturamento.toFixed(2), unidades_qtd: c._un,
    diariaMedia: c.diarias ? +(c.faturamento / c.diarias).toFixed(2) : 0,
    ocupacao: c._n ? +(c._ocup / c._n).toFixed(1) : 0,
    revpar: c._n ? +(c._revpar / c._n).toFixed(2) : 0,
  }));
}

function aggSimples(ms, campo) {
  const map = new Map();
  for (const m of ms) for (const x of m[campo]) {
    const key = x.descricao ?? x.pdv;
    const c = map.get(key) || { nome: key, total: 0, qtde: 0 };
    c.total += x.total; c.qtde += (x.qtde || 0);
    map.set(key, c);
  }
  return [...map.values()].filter(x => x.total > 0).sort((a, b) => b.total - a.total);
}

// ---- render ----
function render() {
  let ms = periodoMeses();
  let unidades = aggUnidades(ms);
  if (state.cat) unidades = unidades.filter(u => u.categoria === state.cat);
  const linhas = state.visao === 'categoria' ? agrupaPorCategoria(unidades) : unidades;

  renderKpis(unidades, ms);
  renderTable(linhas);
  renderTrend(ms);
  renderDonut('pdvChart', aggSimples(ms, 'consumo'), 'pdv');
  renderDonut('payChart', aggSimples(ms, 'pagamentos'), 'pag');
  fillCatFilter(ms);

  const lbl = ms.length === 1 ? ms[0].label : `${ms[0].label} → ${ms[ms.length - 1].label}`;
  $('#rankChip').textContent = `${lbl} · ${linhas.length} ${state.visao === 'categoria' ? 'categorias' : 'chalés'}`;
}

function renderKpis(u, ms) {
  const fat = u.reduce((s, x) => s + x.faturamento, 0);
  const diarias = u.reduce((s, x) => s + x.diarias, 0);
  const reservas = u.reduce((s, x) => s + x.qtde, 0);
  const ocup = u.length ? u.reduce((s, x) => s + x.ocupacao, 0) / u.length : 0;
  const consumo = ms.reduce((s, m) => s + (m.consumo || []).reduce((t, c) => t + c.total, 0), 0);
  const ticket = diarias ? fat / diarias : 0;
  const cards = [
    { k: 'Faturamento', v: BRL(fat), s: `${u.length} chalés`, main: true },
    { k: 'Diárias', v: NUM(diarias), s: `${NUM(reservas)} reservas` },
    { k: 'Diária média', v: BRL(ticket), s: 'por diária' },
    { k: 'Ocupação média', v: PCT(ocup), s: 'no período' },
    { k: 'Consumo (PDV)', v: BRL(consumo), s: 'frigobar, recepção…' },
  ];
  $('#kpis').innerHTML = cards.map(c =>
    `<div class="kpi ${c.main ? 'main' : ''}"><div class="k">${c.k}</div><div class="v">${c.v}</div><div class="s">${c.s}</div></div>`).join('');
}

function occPill(o) { const c = o >= 45 ? 'hi' : o >= 25 ? 'mid' : 'lo'; return `<span class="pill ${c}">${PCT(o)}</span>`; }

function renderTable(rows) {
  const isCat = state.visao === 'categoria';
  const cols = [
    { k: 'unidade', label: isCat ? 'Categoria' : 'Chalé', t: 'txt' },
    { k: 'qtde', label: 'Reservas', t: 'int' },
    { k: 'faturamento', label: 'Faturamento', t: 'bar' },
    { k: 'diarias', label: 'Diárias', t: 'int' },
    { k: 'diariaMedia', label: 'Diária méd.', t: 'money' },
    { k: 'ocupacao', label: 'Ocupação', t: 'occ' },
    { k: 'revpar', label: 'RevPAR', t: 'money' },
  ];
  const key = state.sort.key;
  const getv = x => key === 'unidade' ? (x.ordem ?? x.unidade) : x[key];
  const sorted = [...rows].sort((a, b) => { const av = getv(a), bv = getv(b); return (av > bv ? 1 : av < bv ? -1 : 0) * state.sort.dir; });
  const max = Math.max(1, ...rows.map(x => x.faturamento));
  const head = '<thead><tr><th class="rank">#</th>' +
    cols.map(c => {
      const on = key === c.k;
      const arrow = on ? (state.sort.dir < 0 ? '↓' : '↑') : '↕';
      return `<th data-k="${c.k}" class="${on ? 'sorton' : ''}">${c.label} <span class="sa">${arrow}</span></th>`;
    }).join('') + '</tr></thead>';
  const body = '<tbody>' + sorted.map((x, i) => {
    const tds = cols.map(c => {
      if (c.t === 'txt') return `<td class="chale">${x.unidade}${isCat ? ` <span class="cat">(${x.unidades_qtd} un.)</span>` : `<div class="cat">${x.categoria}</div>`}</td>`;
      if (c.t === 'int') return `<td>${NUM(x[c.k])}</td>`;
      if (c.t === 'money') return `<td class="money">${BRL(x[c.k])}</td>`;
      if (c.t === 'occ') return `<td>${occPill(x.ocupacao)}</td>`;
      if (c.t === 'bar') { const w = (x.faturamento / max * 100).toFixed(1); return `<td class="barcell"><span class="bar" style="width:${w}%"></span><span class="money">${BRL(x.faturamento)}</span></td>`; }
    }).join('');
    const sel = (!isCat && x.unidade === state.unidadeSel) ? ' class="sel"' : '';
    return `<tr data-u="${encodeURIComponent(x.unidade)}"${sel}><td class="rank">${i + 1}</td>${tds}</tr>`;
  }).join('') + '</tbody>';
  const t = $('#rankTable');
  t.innerHTML = rows.length ? head + body : '<tbody><tr><td class="empty">Sem dados para o filtro.</td></tr></tbody>';
  t.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => {
    const k = th.dataset.k; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 }; renderTable(rows);
  });
  t.querySelectorAll('tr[data-u]').forEach(tr => tr.onclick = () => {
    if (isCat) return;
    const u = decodeURIComponent(tr.dataset.u);
    state.unidadeSel = state.unidadeSel === u ? null : u;
    render();
  });
}

function renderTrend(ms) {
  const ctx = $('#trendChart'); trendChart?.destroy();
  let labels, values, title, color = '#22c58b';
  if (state.unidadeSel) {
    labels = meses.map(m => m.label);
    values = meses.map(m => (m.unidades.find(u => u.unidade === state.unidadeSel)?.faturamento) || 0);
    title = `Evolução — ${state.unidadeSel}`; color = '#4f9cf0';
  } else {
    labels = meses.map(m => m.label);
    values = meses.map(m => m.totais.faturamento);
    title = 'Tendência de faturamento por mês';
  }
  $('#trendTitle').textContent = title;
  const sel = new Set(ms.map(m => m.label));
  trendChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, borderRadius: 6,
      backgroundColor: labels.map(l => sel.has(l) ? color : color + '66'),
      borderColor: labels.map(l => sel.has(l) ? '#eaf1fb' : 'transparent'),
      borderWidth: labels.map(l => sel.has(l) ? 1.5 : 0) }] },
    options: {
      onClick: (e, els) => { if (els[0]) { const mm = meses[els[0].index]; state.de = state.ate = mm.mes; $('#mesDe').value = mm.mes; $('#mesAte').value = mm.mes; render(); } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => BRL(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8ea2bd', font: { size: 11 } } },
        y: { grid: { color: '#24344e' }, ticks: { color: '#8ea2bd', callback: v => 'R$' + v / 1000 + 'k' } },
      },
    },
  });
}

function renderDonut(id, data, kind) {
  const ctx = $('#' + id); const old = kind === 'pdv' ? pdvChart : payChart; old?.destroy();
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: data.map(d => d.nome || '—'), datasets: [{ data: data.map(d => d.total), backgroundColor: PAL, borderColor: '#152032', borderWidth: 2 }] },
    options: { cutout: '62%', plugins: {
      legend: { position: 'bottom', labels: { color: '#8ea2bd', font: { size: 11 }, boxWidth: 11, padding: 9 } },
      tooltip: { callbacks: { label: c => `${c.label}: ${BRL(c.raw)}` } } } },
  });
  if (kind === 'pdv') pdvChart = chart; else payChart = chart;
}

function fillCatFilter(ms) {
  if ($('#filtroCat').dataset.filled) return;
  const cats = [...new Set(aggUnidades(meses).map(u => u.categoria))].sort();
  $('#filtroCat').innerHTML = '<option value="">Todas as categorias</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
  $('#filtroCat').dataset.filled = '1';
}

function bindEvents() {
  $('#mesDe').onchange = e => { state.de = e.target.value; render(); };
  $('#mesAte').onchange = e => { state.ate = e.target.value; render(); };
  $('#filtroCat').onchange = e => { state.cat = e.target.value; state.unidadeSel = null; render(); };
  $('#visao').querySelectorAll('button').forEach(b => b.onclick = () => {
    state.visao = b.dataset.v; state.unidadeSel = null;
    $('#visao').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    render();
  });
  // recarrega o data.json a cada 2 min (a nuvem atualiza a cada 15)
  setInterval(async () => {
    try { const r = await fetch('data.json?_=' + Date.now()); const d = await r.json();
      if (d.gerado_em !== DATA.gerado_em) { DATA = d; meses = d.meses; $('#updated').textContent = 'Atualizado: ' + new Date(d.gerado_em).toLocaleString('pt-BR'); render(); }
    } catch {}
  }, 120000);
}

boot();
