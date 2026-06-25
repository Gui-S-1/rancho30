import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scrapeFaturamento } from '../src/scraper.mjs';
import 'dotenv/config';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const EXPORT = fileURLToPath(new URL('../export/', import.meta.url));
const DATA = PUBLIC + 'data.json';
mkdirSync(PUBLIC, { recursive: true });
mkdirSync(EXPORT, { recursive: true });

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const HOTEL = process.env.HOTEL_NOME || 'Ranchos 30 Hotel';

const ymd = d => d.toLocaleDateString('en-CA');

/** "Mirante Luxo - 6" -> "Mirante Luxo" ; "Mirante Premium 14" -> "Mirante Premium" */
function categoria(nome) {
  let s = String(nome).trim();
  let m = s.match(/^(.*?)\s*-\s*\S+$/);          // "Cat - id"
  if (m) return m[1].trim();
  m = s.match(/^(.*?)\s+\d+\s*$/);               // "Cat 14"
  if (m) return m[1].trim();
  return s;
}

/** [inicio, fim] do mês (Date) em yyyy-mm-dd, fim = hoje se for o mês corrente */
function monthBounds(year, monthIdx) {
  const first = new Date(year, monthIdx, 1);
  const lastDay = new Date(year, monthIdx + 1, 0);
  const hoje = new Date();
  const fim = (year === hoje.getFullYear() && monthIdx === hoje.getMonth()) ? hoje : lastDay;
  return [ymd(first), ymd(fim), `${year}-${String(monthIdx + 1).padStart(2, '0')}`, `${MESES[monthIdx]}/${year}`];
}

function buildMes(mes, label, inicio, fim, raw) {
  const unidades = raw.unidades.map(u => ({ ...u, categoria: categoria(u.unidade) }))
    .sort((a, b) => b.faturamento - a.faturamento);

  // consumo agregado por PDV
  const pdvMap = new Map();
  for (const c of (raw.consumo || [])) {
    const k = c.pdv;
    const cur = pdvMap.get(k) || { pdv: k, qtde: 0, total: 0 };
    cur.qtde += c.qtde; cur.total += (c.faturado || c.total);
    pdvMap.set(k, cur);
  }
  const consumo = [...pdvMap.values()].sort((a, b) => b.total - a.total);

  const totais = {
    faturamento: +unidades.reduce((s, u) => s + u.faturamento, 0).toFixed(2),
    diarias: unidades.reduce((s, u) => s + u.diarias, 0),
    reservas: unidades.reduce((s, u) => s + u.qtde, 0),
    pessoas: unidades.reduce((s, u) => s + u.pessoas, 0),
    ocupacaoMedia: unidades.length ? +(unidades.reduce((s, u) => s + u.ocupacao, 0) / unidades.length).toFixed(1) : 0,
    revparMedio: unidades.length ? +(unidades.reduce((s, u) => s + u.revpar, 0) / unidades.length).toFixed(2) : 0,
    consumoTotal: +consumo.reduce((s, c) => s + c.total, 0).toFixed(2),
  };
  return { mes, label, inicio, fim, unidades, pagamentos: raw.pagamentos, consumo, totais };
}

function csv(rows, headers) {
  const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [headers.map(h => h.label).join(',')]
    .concat(rows.map(r => headers.map(h => esc(r[h.key])).join(','))).join('\r\n');
}

function exportCsv(meses) {
  const fatRows = [], pagRows = [], pdvRows = [];
  for (const m of meses) {
    for (const u of m.unidades) fatRows.push({ ...u, mes: m.mes });
    for (const p of m.pagamentos) pagRows.push({ ...p, mes: m.mes });
    for (const c of m.consumo) pdvRows.push({ ...c, mes: m.mes });
  }
  writeFileSync(EXPORT + 'faturamento_por_chale.csv', csv(fatRows, [
    { key: 'mes', label: 'Mes' }, { key: 'ordem', label: 'Ordem' }, { key: 'unidade', label: 'Chale' },
    { key: 'categoria', label: 'Categoria' }, { key: 'qtde', label: 'Reservas' }, { key: 'faturamento', label: 'Faturamento' },
    { key: 'diarias', label: 'Diarias' }, { key: 'diariaMedia', label: 'Diaria_Media' }, { key: 'pessoas', label: 'Pessoas' },
    { key: 'ocupacao', label: 'Ocupacao_Pct' }, { key: 'revpar', label: 'RevPAR' },
  ]), 'utf8');
  writeFileSync(EXPORT + 'consumo_pdv.csv', csv(pdvRows, [
    { key: 'mes', label: 'Mes' }, { key: 'pdv', label: 'PDV' }, { key: 'qtde', label: 'Itens' }, { key: 'total', label: 'Total' },
  ]), 'utf8');
  writeFileSync(EXPORT + 'formas_pagamento.csv', csv(pagRows, [
    { key: 'mes', label: 'Mes' }, { key: 'descricao', label: 'Forma_Pagamento' }, { key: 'total', label: 'Total' },
  ]), 'utf8');
}

// ---- quais meses coletar ----
function mesesAlvo() {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--backfill');
  const n = bi >= 0 ? parseInt(args[bi + 1] || '12', 10) : 0;
  const hoje = new Date();
  const lista = [];
  for (let k = n; k >= 0; k--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - k, 1);
    lista.push([d.getFullYear(), d.getMonth()]);
  }
  return lista;
}

async function main() {
  const existing = existsSync(DATA) ? JSON.parse(readFileSync(DATA, 'utf8')) : { hotel: HOTEL, meses: [] };
  const byMes = new Map((existing.meses || []).map(m => [m.mes, m]));

  for (const [y, mi] of mesesAlvo()) {
    const [inicio, fim, mes, label] = monthBounds(y, mi);
    process.stdout.write(`coletando ${label} (${inicio}..${fim}) ... `);
    let ok = false;
    for (let tentativa = 1; tentativa <= 3 && !ok; tentativa++) {
      try {
        const raw = await scrapeFaturamento(inicio, fim);
        if (!raw.unidades.length) throw new Error('0 unidades (sessão/retorno vazio)');
        byMes.set(mes, buildMes(mes, label, inicio, fim, raw));
        console.log(`ok: ${raw.unidades.length} unidades, R$ ${byMes.get(mes).totais.faturamento.toLocaleString('pt-BR')}`);
        ok = true;
      } catch (e) {
        if (tentativa === 3) {
          console.log('FALHA:', e.message);
          if (!byMes.has(mes)) throw e; // sem dado anterior pra esse mês -> erro real
        }
      }
    }
  }

  const meses = [...byMes.values()].sort((a, b) => a.mes.localeCompare(b.mes));
  const out = { hotel: HOTEL, gerado_em: new Date().toISOString(), meses };
  writeFileSync(DATA, JSON.stringify(out));
  exportCsv(meses);
  console.log(`\n✓ ${meses.length} meses salvos em public/data.json + CSVs em export/`);
}

main().catch(e => { console.error('ERRO FATAL:', e.message); process.exit(1); });
