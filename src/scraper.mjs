import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const AUTH = fileURLToPath(new URL('../auth-state.json', import.meta.url));
const BASE = 'https://sistema.todeferias.com.br/programas/';
const LOGIN_URL = process.env.TDF_URL || BASE + 'login.aspx';
const FAT = 'FinanceiroMenu1_ascxFaturamento_';

// "8.808,80" -> 8808.80 ; "26,37%" -> 26.37 ; "" -> 0
function num(s) {
  if (s == null) return 0;
  const t = String(s).replace(/%/g, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, '').trim();
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : 0;
}

// "10-Chalé Master - Acerola" -> { ordem:10, unidade:"Chalé Master - Acerola" }
function splitUnidade(s) {
  const m = String(s).match(/^\s*(\d+)\s*-\s*(.+)$/);
  if (m) return { ordem: parseInt(m[1], 10), unidade: m[2].trim() };
  return { ordem: 9999, unidade: String(s).trim() };
}

async function ensureSession(browser) {
  // tenta reusar sessão; se cair na tela de login, refaz login
  let ctx = existsSync(AUTH)
    ? await browser.newContext({ storageState: AUTH })
    : await browser.newContext();
  let page = await ctx.newPage();
  await page.goto(BASE + 'menusistema.aspx', { waitUntil: 'networkidle', timeout: 60000 });
  if (/login\.aspx/i.test(page.url())) {
    await page.fill('#LoginSSL1_tbUsuario', process.env.TDF_USER);
    await page.fill('#LoginSSL1_tbSenha', process.env.TDF_PASS);
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 60000 }),
      page.click('#LoginSSL1_bLogin'),
    ]);
    await page.waitForTimeout(1500);
    if (/login\.aspx/i.test(page.url())) throw new Error('Falha no login — verifique usuário/senha no .env');
    await ctx.storageState({ path: AUTH });
  }
  return { ctx, page };
}

/** Raspa o Relatório de Faturamento (por chalé) para um intervalo <= 92 dias. */
export async function scrapeFaturamento(dataInicio, dataFim) {
  const browser = await chromium.launch({ headless: true });
  let alertMsg = null;
  try {
    const { ctx, page } = await ensureSession(browser);
    page.on('dialog', d => { alertMsg = d.message(); d.accept().catch(() => {}); });

    await page.goto(BASE + 'financeiro.aspx?Opcao=10', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#' + FAT + 'bFiltrar', { timeout: 30000 });
    await page.selectOption('#' + FAT + 'ddlTipo', '0');           // Todos
    await page.fill('#' + FAT + 'tbDataInicial', dataInicio);      // yyyy-mm-dd
    await page.fill('#' + FAT + 'tbDataFinal', dataFim);

    // dispara o postback sem travar esperando "navegação terminar" (o site mantém conexões abertas)
    await page.click('#' + FAT + 'bFiltrar', { noWaitAfter: true });
    // espera a tabela por unidade aparecer (ou o alerta de recusa)
    await page.waitForFunction(() => {
      return !!document.querySelector('table') &&
        [...document.querySelectorAll('table')].some(t =>
          /ocupa|revpar/i.test((t.rows[0]?.innerText || '')));
    }, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1000);

    if (alertMsg) throw new Error('Sistema recusou: ' + alertMsg);

    // extrai todas as tabelas como matriz de strings
    const tables = await page.$$eval('table', tbls =>
      tbls.map(t => [...t.rows].map(r => [...r.cells].map(c => c.innerText.replace(/\s+/g, ' ').trim())))
    );

    // tabela por unidade = header tem "Unidade" e ("Ocupação" ou "RevPAR")
    const unitTable = tables.find(rows => {
      const h = (rows[0] || []).join('|').toLowerCase();
      return h.includes('unidade') && (h.includes('ocupa') || h.includes('revpar'));
    });
    // tabela de pagamentos = header tem "Descrição" e "A Receber"
    const payTable = tables.find(rows => {
      const h = (rows[0] || []).join('|').toLowerCase();
      return h.includes('descri') && h.includes('receber');
    });

    const unidades = [];
    if (unitTable) {
      for (const r of unitTable.slice(1)) {
        if (!r.length || /^total/i.test(r[0] || '')) continue;
        const { ordem, unidade } = splitUnidade(r[0]);
        if (ordem === 9999 && !unidade) continue;
        unidades.push({
          ordem, unidade,
          qtde: num(r[1]), faturamento: num(r[2]), diarias: num(r[3]), diariaMedia: num(r[4]),
          pessoas: num(r[5]), mediaPessoa: num(r[6]), nroDias: num(r[7]),
          ocupacao: num(r[8]), diasDisp: num(r[9]), revpar: num(r[10]),
        });
      }
    }

    const pagamentos = [];
    if (payTable) {
      for (const r of payTable.slice(1)) {
        if (!r.length) continue;
        const desc = (r[0] || '').trim() || '(sem descrição)';
        if (/^total/i.test(desc)) continue;
        pagamentos.push({
          descricao: desc, reserva: num(r[1]), durante: num(r[2]),
          aposSaida: num(r[3]), aReceber: num(r[4]), total: num(r[5]),
        });
      }
    }

    // tabela de consumo PDV = header tem "PDV" e ("Garcon" ou "Faturado")
    const pdvTable = tables.find(rows => {
      const h = (rows[0] || []).join('|').toLowerCase();
      return h.includes('pdv') && (h.includes('garcon') || h.includes('faturado'));
    });
    const consumo = [];
    if (pdvTable) {
      for (const r of pdvTable.slice(1)) {
        if (!r.length || /^total/i.test(r[0] || '')) continue;
        consumo.push({
          pdv: (r[0] || '').trim() || '(sem PDV)',
          tipo: (r[1] || '').trim(),
          garcon: (r[2] || '').trim(),
          qtde: num(r[3]),
          total: num(r[4]),
          faturado: num(r[8]),
        });
      }
    }

    return { dataInicio, dataFim, unidades, pagamentos, consumo };
  } finally {
    await browser.close();
  }
}
