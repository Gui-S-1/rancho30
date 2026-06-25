# DashLucros — Ranchos 30 Hotel

Coleta o **faturamento por chalé** do sistema Tô de Férias (que não tem API), guarda os dados
no próprio repositório (JSON + CSV) e mostra num **dashboard bonito e mobile**. Tudo **grátis**:
o robô roda na **nuvem do GitHub** a cada 15 min, o site fica no **Vercel** e o **Power BI**
lê os mesmos dados.

```
GitHub Actions (robô, a cada 15 min)
   ├─ raspa o Tô de Férias
   └─ comita public/data.json + export/*.csv no repositório
        ├─→ Vercel  → dashboard HTML (celular)   ← https://SEU-PROJETO.vercel.app
        └─→ Power BI → conecta nos CSV do GitHub
```

## O que o dashboard mostra
- **KPIs**: faturamento, diárias, diária média, ocupação média, consumo (PDV).
- **Tendência por mês** (histórico) — clique numa barra pra focar o mês.
- **Ranking por chalé** ou **por categoria** (botão *Visão*), com filtro de categoria.
- **Clique num chalé** → vê a evolução dele mês a mês.
- **Consumo por PDV** (frigobar, recepção…) e **formas de pagamento**.
- Período: escolha **De/Até** (mês) pra ver um mês só ou um intervalo somado.

---

## Uso local (no seu PC)

```bash
npm install
npm run scrape:backfill   # coleta os últimos 12 meses (1ª vez)
npm run preview           # abre http://localhost:4750
```
Depois, pra atualizar só o mês atual: `npm run scrape`.

As credenciais ficam no arquivo **`.env`** (já existe, e está no `.gitignore` — não vai pro GitHub).

---

## Colocar na nuvem (grátis, sem PC ligado)

### 1) Subir pro GitHub
Crie um repositório no GitHub e envie este projeto:
```bash
git remote add origin https://github.com/SEU_USUARIO/dashlucros.git
git push -u origin main
```
> Recomendo repositório **público** (os minutos do GitHub Actions são ilimitados em repo público;
> em repo privado o limite grátis não cobre rodar a cada 15 min o mês todo). **Suas credenciais
> NÃO ficam no código** — vão nos *Secrets* (passo 2), criptografadas, seguras mesmo em repo público.

### 2) Cadastrar as credenciais (Secrets)
No GitHub: **Settings → Secrets and variables → Actions → New repository secret**. Crie 3:
- `TDF_URL`  → `https://sistema.todeferias.com.br/programas/login.aspx`
- `TDF_USER` → seu usuário
- `TDF_PASS` → sua senha

(Opcional, em *Variables*: `HOTEL_NOME` = `Ranchos 30 Hotel`.)

### 3) Ligar o robô
A aba **Actions** já tem o fluxo "Coletar faturamento". Ele roda sozinho a cada 15 min.
Pra primeira carga com histórico, clique em **Run workflow** e coloque `12` no campo *backfill*.

### 4) Publicar o site (Vercel)
1. Entre em [vercel.com](https://vercel.com) com sua conta GitHub.
2. **Add New → Project** → importe o repositório `dashlucros`.
3. Pode deixar tudo no padrão (o `vercel.json` já aponta pra pasta `public`). **Deploy**.
4. Pronto: a URL `https://SEU-PROJETO.vercel.app` abre no celular. Salve na tela inicial.

O site sempre lê o `data.json` mais recente que o robô comitou — ou seja, atualiza junto, a cada 15 min.

---

## Power BI

Os dados ficam em CSV no GitHub. No Power BI Desktop:
1. **Obter Dados → Web**.
2. Cole a URL "raw" do CSV (troque usuário/repo):
   ```
   https://raw.githubusercontent.com/SEU_USUARIO/dashlucros/main/export/faturamento_por_chale.csv
   https://raw.githubusercontent.com/SEU_USUARIO/dashlucros/main/export/consumo_pdv.csv
   https://raw.githubusercontent.com/SEU_USUARIO/dashlucros/main/export/formas_pagamento.csv
   ```
3. Monte os visuais. Publique no Power BI Service e configure a **atualização agendada**.

> **Atenção:** o Power BI grátis/Pro só atualiza automaticamente **até 8x por dia** (~a cada 3h).
> A cada 15 min de verdade só no plano **Premium**. No Power BI Desktop, o botão *Atualizar* puxa na hora.
> Quem mostra os 15 min ao vivo e de graça é o **dashboard do Vercel**.

---

## Estrutura
```
src/scraper.mjs            login + raspagem do relatório de faturamento (Playwright)
scripts/scrape.mjs         coleta meses, gera public/data.json e export/*.csv
scripts/serve.mjs          servidor estático pra preview local
public/                    dashboard (index.html, app.js, styles.css) + data.json
export/                    CSVs pro Power BI
.github/workflows/scrape.yml  robô da nuvem (cron 15 min)
vercel.json                config do site estático
.env                       credenciais (LOCAL, fora do Git)
```

## Limites conhecidos
- O relatório de Faturamento aceita no máx. **92 dias** por consulta — por isso a coleta é **mês a mês**.
- "Lucro" aqui = **receita por chalé** (faturamento, ocupação, RevPAR, consumo). O Tô de Férias
  não tem custos por chalé; pra lucro líquido seria preciso informar um custo por unidade.

## Segurança
Troque a senha do Tô de Férias periodicamente e atualize o `.env` (local) e o Secret `TDF_PASS` (GitHub).
