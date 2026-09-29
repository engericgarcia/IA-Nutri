const $ = (id) => document.getElementById(id);
const STORE_KEY = "ianutri.meals";
const GOAL_KEY = "ianutri.goal";
const PROFILE_KEY = "ianutri.profile";

let currentImage = null; // { dataUrl, base64, mediaType, thumb }
let lastResult = null;

// ---------- armazenamento local ----------
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
const getMeals = () => load(STORE_KEY, []);
const getProfile = () => load(PROFILE_KEY, null);

// ---------- utilidades ----------
const nf = (n) => Math.round(n).toLocaleString("pt-BR");
const r0 = (n) => Math.round(Number(n) || 0);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (name) => `<svg><use href="#i-${name}" /></svg>`;
const dayKey = (d) => d.toLocaleDateString("sv-SE"); // AAAA-MM-DD local
const todayKey = () => dayKey(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); }; // segunda
const fmt = (d, opts) => d.toLocaleDateString("pt-BR", opts);
const time = (ts) => new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function sumMeals(meals) {
  return meals.reduce((a, m) => ({ kcal: a.kcal + m.kcal, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }), { kcal: 0, p: 0, c: 0, f: 0 });
}

function toast(msg) {
  const t = $("toast");
  t.innerHTML = `${icon("check")}${esc(msg)}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2400);
}

// ---------- corpo: IMC, TMB (Mifflin-St Jeor), gasto diário e meta ----------
function imcCategory(imc) {
  return imc < 18.5 ? "Abaixo do peso" : imc < 25 ? "Peso normal" : imc < 30 ? "Sobrepeso"
    : imc < 35 ? "Obesidade grau I" : imc < 40 ? "Obesidade grau II" : "Obesidade grau III";
}

function calcBody(p) {
  if (!p?.peso || !p?.altura || !p?.idade) return null;
  const imc = p.peso / (p.altura / 100) ** 2;
  const tmb = 10 * p.peso + 6.25 * p.altura - 5 * p.idade + (p.sexo === "f" ? -161 : 5);
  const gasto = tmb * (Number(p.atividade) || 1.55);
  const fator = { perder: 0.8, manter: 1, ganhar: 1.1 }[p.objetivo] ?? 1;
  let recomendada = Math.round((gasto * fator) / 50) * 50;
  // não recomenda abaixo do mínimo seguro sem acompanhamento profissional
  const piso = p.sexo === "f" ? 1200 : 1500;
  if (recomendada < piso) recomendada = Math.min(piso, Math.round(gasto / 50) * 50);
  return { imc, imcCat: imcCategory(imc), tmb: Math.round(tmb), gasto: Math.round(gasto), recomendada, meta: Number(p.metaManual) || recomendada };
}

// meta = quanto comer; gasto = manutenção (abaixo dele = déficit, acima = superávit)
function targets() {
  const profile = getProfile();
  const body = calcBody(profile);
  const meta = body ? body.meta : load(GOAL_KEY, 2000);
  return { meta, gasto: body ? body.gasto : meta, body, macros: macroTargets(meta, profile) };
}

// proteína por kg de peso; gordura 25% da meta; carboidrato completa o restante
function macroTargets(meta, profile) {
  const perKg = profile?.objetivo === "manter" ? 1.6 : 2.0;
  let p = profile?.peso ? profile.peso * perKg : (meta * 0.3) / 4;
  p = Math.round(Math.min(p, (meta * 0.4) / 4));
  const f = Math.round((meta * 0.25) / 9);
  const c = Math.max(0, Math.round((meta - p * 4 - f * 9) / 4));
  return { p, c, f };
}

function balance(kcal, gasto) {
  const d = kcal - gasto;
  return d > 0 ? { cls: "surplus", label: "Superávit", v: d } : { cls: "deficit", label: "Déficit", v: -d };
}

// ---------- navegação ----------
function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => (p.hidden = p.dataset.page !== name));
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.go === name));
  $("fab").hidden = name !== "history"; // na tela inicial o cartão de captura já cumpre esse papel
  if (name === "profile") fillProfileForm();
  window.scrollTo({ top: 0 });
}
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]")?.dataset.go;
  if (go) showPage(go);
});

// ---------- início ----------
function renderHome() {
  const now = new Date();
  const h = now.getHours();
  $("hello").textContent = h < 12 ? "Bom dia 👋" : h < 18 ? "Boa tarde 👋" : "Boa noite 👋";
  $("todayDate").textContent = fmt(now, { weekday: "long", day: "numeric", month: "long" }).replace("-feira", "");

  const { meta, gasto, body, macros } = targets();
  const meals = getMeals().filter((m) => m.day === todayKey()).sort((a, b) => b.at - a.at);
  const sum = sumMeals(meals);
  const restante = meta - sum.kcal;

  // anel de calorias
  const R = 62, C = 2 * Math.PI * R;
  const frac = Math.min(1, sum.kcal / meta);
  $("ring").className = "ring" + (restante < 0 ? " over" : "");
  $("ring").innerHTML = `
    <svg viewBox="0 0 148 148"><circle class="rtrack" cx="74" cy="74" r="${R}" stroke-width="12" />
      <circle class="prog" cx="74" cy="74" r="${R}" stroke-width="12" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}" /></svg>
    <div class="ring-center"><b>${nf(Math.abs(restante))}</b><span>${restante >= 0 ? "kcal restantes" : "kcal acima da meta"}</span></div>`;

  $("heroStats").innerHTML = `
    <div class="hstat"><span class="dot">${icon("flame")}</span><div><b>${nf(sum.kcal)}</b><span>consumidas</span></div></div>
    <div class="hstat"><span class="dot">${icon("check")}</span><div><b>${nf(meta)}</b><span>meta do dia</span></div></div>
    <div class="hstat"><span class="dot">${icon("chart")}</span><div><b>${body ? nf(gasto) : "—"}</b><span>gasto diário</span></div></div>`;

  if (body) {
    const bal = balance(sum.kcal, gasto);
    $("balanceChip").innerHTML = `
      <div class="chip ${bal.cls}">
        <span class="chip-ico">${icon(bal.cls === "deficit" ? "down" : "up")}</span>
        <div><b>${bal.label} de ${nf(bal.v)} kcal</b><small>em relação ao seu gasto de ${nf(gasto)} kcal/dia</small></div>
      </div>`;
    $("profileCta").innerHTML = "";
  } else {
    $("balanceChip").innerHTML = "";
    $("profileCta").innerHTML = `
      <section class="card cta">
        <span class="cta-ico">${icon("user")}</span>
        <div><b>Complete seu perfil</b><p>Para calcular IMC, gasto diário e déficit.</p></div>
        <button data-go="profile">Preencher</button>
      </section>`;
  }

  // macros
  $("macroHint").textContent = body ? "meta baseada no seu peso" : "meta padrão";
  const mrow = (label, color, val, alvo) => `
    <div>
      <div class="mbar-top"><span><i style="background:${color}"></i>${label}</span><em><b>${nf(val)}g</b> / ${nf(alvo)}g</em></div>
      <div class="track"><div style="width:${Math.min(100, (val / (alvo || 1)) * 100)}%;background:${color}"></div></div>
    </div>`;
  $("macroBars").innerHTML =
    mrow("Proteína", "var(--prot)", sum.p, macros.p) +
    mrow("Carboidrato", "var(--carb)", sum.c, macros.c) +
    mrow("Gordura", "var(--fat)", sum.f, macros.f);

  // refeições de hoje
  $("todayCount").textContent = meals.length;
  $("todayMeals").innerHTML = meals.length
    ? meals.map(mealItem).join("")
    : `<li class="empty"><span class="big">🍽️</span>Nenhuma refeição registrada hoje.<br>Tire uma foto do seu prato!</li>`;
}

function mealItem(m) {
  return `
    <li class="meal">
      ${m.thumb ? `<img src="${m.thumb}" alt="" />` : `<div class="ph">${icon("flame")}</div>`}
      <div class="info"><div class="name">${esc(m.prato)}</div><div class="meta">${time(m.at)} · P${m.p} C${m.c} G${m.f}</div></div>
      <div class="kcal">${nf(m.kcal)}<small>kcal</small></div>
      <button class="del" data-id="${esc(m.id)}" aria-label="Remover refeição">${icon("trash")}</button>
    </li>`;
}

document.addEventListener("click", (e) => {
  const del = e.target.closest(".meal .del");
  if (!del || !confirm("Remover esta refeição?")) return;
  save(STORE_KEY, getMeals().filter((m) => m.id !== del.dataset.id));
  renderAll();
  toast("Refeição removida");
});

// ---------- captura da foto ----------
function resizeImage(file, maxSide = 1568, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);

      const t = document.createElement("canvas");
      const ts = 120 / Math.min(img.width, img.height);
      t.width = Math.round(img.width * ts);
      t.height = Math.round(img.height * ts);
      t.getContext("2d").drawImage(img, 0, 0, t.width, t.height);

      URL.revokeObjectURL(img.src);
      resolve({ dataUrl, base64: dataUrl.split(",")[1], mediaType: "image/jpeg", thumb: t.toDataURL("image/jpeg", 0.7) });
    };
    img.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    img.src = URL.createObjectURL(file);
  });
}

async function onFile(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    currentImage = await resizeImage(file);
  } catch (err) {
    return toast(err.message);
  }
  showPage("home");
  $("preview").src = currentImage.dataUrl;
  $("captureEmpty").hidden = true;
  $("captureFilled").hidden = false;
  $("captureCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetCapture() {
  currentImage = null;
  lastResult = null;
  $("captureEmpty").hidden = false;
  $("captureFilled").hidden = true;
  $("desc").value = "";
}

// ---------- análise (bottom sheet) ----------
const sheet = $("sheet");
function openSheet(html) {
  $("sheetBody").innerHTML = html;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
}
sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });

const LOADING_STEPS = ["Identificando os alimentos", "Estimando as porções", "Consultando a tabela TACO", "Calculando calorias e macros"];

async function analyze() {
  if (!currentImage) return;
  let step = 0;
  openSheet(`
    <div class="scan"><img src="${currentImage.dataUrl}" alt="" /><div class="beam"></div></div>
    <div class="scan-text"><b id="scanStep">${LOADING_STEPS[0]}…</b><span>Isso leva alguns segundos</span></div>`);
  const timer = setInterval(() => {
    step = (step + 1) % LOADING_STEPS.length;
    const el = $("scanStep");
    if (el) el.textContent = LOADING_STEPS[step] + "…";
  }, 1800);

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: currentImage.base64, mediaType: currentImage.mediaType, description: $("desc").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    lastResult = data;
    renderResult(data);
  } catch (err) {
    const msg = err.message === "Failed to fetch" ? "Sem conexão com o servidor." : err.message;
    openSheet(`
      <div class="err"><span class="big">😕</span><b>Não deu para analisar</b><span class="muted">${esc(msg)}</span>
        <button class="primary" id="retryBtn">${icon("refresh")}Tentar de novo</button>
        <button class="ghost-btn" id="closeSheet">Fechar</button></div>`);
    $("retryBtn").onclick = analyze;
    $("closeSheet").onclick = () => sheet.close();
  } finally {
    clearInterval(timer);
  }
}

function renderResult(d) {
  if (!d.itens?.length) {
    openSheet(`
      <div class="err"><span class="big">🤔</span><b>Não encontrei comida nessa foto</b><span class="muted">${esc(d.observacoes)}</span>
        <button class="primary" id="closeSheet">Tirar outra foto</button></div>`);
    $("closeSheet").onclick = () => { sheet.close(); resetCapture(); $("photoInput").click(); };
    return;
  }

  const kP = r0(d.total_proteina_g) * 4, kC = r0(d.total_carboidrato_g) * 4, kF = r0(d.total_gordura_g) * 9;
  const kT = kP + kC + kF || 1;
  const { meta } = targets();
  const consumido = sumMeals(getMeals().filter((m) => m.day === todayKey())).kcal;
  const depois = meta - consumido - r0(d.total_kcal);

  openSheet(`
    <div class="sheet-handle"></div>
    <div class="r-hero">
      <img src="${currentImage.dataUrl}" alt="" />
      <span class="conf ${esc(d.confianca)}">confiança ${esc(d.confianca === "media" ? "média" : d.confianca)}</span>
      <div class="r-over">
        <h2>${esc(d.prato)}</h2>
        <div class="r-kcal"><b>${nf(r0(d.total_kcal))}</b><span>kcal · faixa ${nf(r0(d.faixa_kcal_min))}–${nf(r0(d.faixa_kcal_max))}</span></div>
      </div>
    </div>
    <div class="sheet-body">
      <div>
        <div class="split">
          <div style="width:${(kP / kT) * 100}%;background:var(--prot)"></div>
          <div style="width:${(kC / kT) * 100}%;background:var(--carb)"></div>
          <div style="width:${(kF / kT) * 100}%;background:var(--fat)"></div>
        </div>
        <div class="split-legend">
          <div><b>${r0(d.total_proteina_g)}g</b><span><i style="background:var(--prot)"></i>Proteína</span></div>
          <div><b>${r0(d.total_carboidrato_g)}g</b><span><i style="background:var(--carb)"></i>Carbo</span></div>
          <div><b>${r0(d.total_gordura_g)}g</b><span><i style="background:var(--fat)"></i>Gordura</span></div>
        </div>
      </div>

      <div>
        <h3>Itens identificados</h3>
        <ul class="items">${d.itens.map((i) => `
          <li><div><div class="n">${esc(i.nome)}</div><div class="sub">${r0(i.porcao_g)}g · ${esc(i.medida_caseira)} · P${r0(i.proteina_g)} C${r0(i.carboidrato_g)} G${r0(i.gordura_g)}</div></div>
          <span class="k">${nf(r0(i.kcal))} kcal</span></li>`).join("")}
        </ul>
      </div>

      <div class="tipbox">
        <div class="t">${icon("bulb")}Avaliação fit</div>
        ${esc(d.avaliacao_fit)}
        ${d.dicas?.length ? `<ul>${d.dicas.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      </div>

      ${d.observacoes ? `<p class="note">${icon("info")}<span>${esc(d.observacoes)}</span></p>` : ""}

      <div class="impact">${icon("flame")}<span>${depois >= 0
        ? `Depois desta refeição ainda restam <b>${nf(depois)} kcal</b> da sua meta de hoje.`
        : `Com esta refeição você passa <b class="neg">${nf(-depois)} kcal</b> da sua meta de hoje.`}</span></div>

      <div class="actions">
        <button class="ghost-btn" id="discardBtn">Descartar</button>
        <button class="primary" id="saveBtn">${icon("check")}Registrar</button>
      </div>
    </div>`);
  $("saveBtn").onclick = saveMeal;
  $("discardBtn").onclick = () => { sheet.close(); resetCapture(); };
}

function saveMeal() {
  const d = lastResult;
  const meals = getMeals();
  meals.push({
    id: crypto.randomUUID?.() ?? String(Date.now()),
    day: todayKey(),
    at: Date.now(),
    prato: d.prato,
    kcal: r0(d.total_kcal),
    p: r0(d.total_proteina_g),
    c: r0(d.total_carboidrato_g),
    f: r0(d.total_gordura_g),
    thumb: currentImage?.thumb,
  });
  // mantém 1 ano de histórico; fotos em miniatura só dos últimos 40 dias (economiza espaço)
  const now = Date.now();
  save(STORE_KEY, meals
    .filter((m) => m.at > now - 400 * 864e5)
    .map((m) => (m.thumb && m.at < now - 40 * 864e5 ? { ...m, thumb: undefined } : m)));
  sheet.close();
  resetCapture();
  renderAll();
  toast("Refeição registrada!");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- histórico: dia / semana / mês ----------
const hist = { view: "day", anchor: new Date() }; // anchor = data de referência do período exibido

function periodDays() {
  const a = hist.anchor;
  if (hist.view === "week") {
    const s = startOfWeek(a);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  const n = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
  return Array.from({ length: n }, (_, i) => new Date(a.getFullYear(), a.getMonth(), i + 1));
}

function shiftPeriod(dir) {
  const a = hist.anchor;
  if (hist.view === "day") hist.anchor = addDays(a, dir);
  else if (hist.view === "week") hist.anchor = addDays(a, dir * 7);
  else hist.anchor = new Date(a.getFullYear(), a.getMonth() + dir, 1);
  renderHistory();
}

function isCurrentPeriod() {
  const now = new Date();
  if (hist.view === "day") return dayKey(hist.anchor) >= dayKey(now);
  if (hist.view === "week") return dayKey(startOfWeek(hist.anchor)) >= dayKey(startOfWeek(now));
  return hist.anchor.getFullYear() * 12 + hist.anchor.getMonth() >= now.getFullYear() * 12 + now.getMonth();
}

function renderHistory() {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.view === hist.view));
  $("nextPeriod").disabled = isCurrentPeriod();
  if (hist.view === "day") renderDayView();
  else renderRangeView();
}

const emptyState = (txt) => `<div class="card empty"><span class="big">📭</span>${txt}</div>`;

function renderDayView() {
  const key = dayKey(hist.anchor);
  const today = key === todayKey();
  const yesterday = key === dayKey(addDays(new Date(), -1));
  $("periodLabel").textContent = today ? "Hoje" : yesterday ? "Ontem" : fmt(hist.anchor, { weekday: "long", day: "numeric", month: "short" });

  const meals = getMeals().filter((m) => m.day === key).sort((a, b) => b.at - a.at);
  if (!meals.length) return ($("historyBody").innerHTML = emptyState(`Nenhuma refeição registrada ${today ? "hoje" : "neste dia"}.`));

  const sum = sumMeals(meals);
  const bal = balance(sum.kcal, targets().gasto);
  $("historyBody").innerHTML = `
    <div class="stats">
      <div class="stat"><b>${nf(sum.kcal)} kcal</b><span class="badge ${bal.cls}">${bal.label} de ${nf(bal.v)}</span></div>
      <div class="stat"><b>${meals.length}</b><span>refeições</span></div>
      <div class="stat" style="grid-column:1/-1">
        <span>Proteína <b style="display:inline;font-size:1rem;color:var(--prot)">${sum.p}g</b> · Carbo <b style="display:inline;font-size:1rem;color:var(--carb)">${sum.c}g</b> · Gordura <b style="display:inline;font-size:1rem;color:var(--fat)">${sum.f}g</b></span>
      </div>
    </div>
    <section class="card" style="margin-top:14px"><ul class="meal-list">${meals.map(mealItem).join("")}</ul></section>`;
}

function renderRangeView() {
  const days = periodDays();
  const first = days[0], last = days.at(-1);
  $("periodLabel").textContent = hist.view === "week"
    ? `${fmt(first, { day: "numeric", month: "short" })} – ${fmt(last, { day: "numeric", month: "short" })}`
    : fmt(first, { month: "long", year: "numeric" });

  const { meta, gasto } = targets();
  const byDay = new Map();
  for (const m of getMeals()) {
    if (m.day < dayKey(first) || m.day > dayKey(last)) continue;
    if (!byDay.has(m.day)) byDay.set(m.day, []);
    byDay.get(m.day).push(m);
  }
  const rows = days.map((d) => {
    const meals = byDay.get(dayKey(d)) || [];
    return { date: d, key: dayKey(d), n: meals.length, ...sumMeals(meals) };
  });
  const logged = rows.filter((r) => r.n > 0);
  if (!logged.length) {
    $("historyBody").innerHTML = emptyState(`Nenhuma refeição registrada ${hist.view === "week" ? "nesta semana" : "neste mês"}.`);
    return;
  }

  const avg = (k) => Math.round(logged.reduce((a, r) => a + r[k], 0) / logged.length);
  const deficitDays = logged.filter((r) => r.kcal <= gasto).length;
  const saldo = logged.reduce((a, r) => a + (r.kcal - gasto), 0); // negativo = déficit acumulado
  const avgBal = balance(avg("kcal"), gasto);
  const kgGordura = (Math.abs(saldo) / 7700).toFixed(1).replace(".", ","); // ~7.700 kcal por kg de gordura

  $("historyBody").innerHTML = `
    <div class="stats">
      <div class="stat"><b>${nf(avg("kcal"))}</b><span>kcal média/dia · P ${avg("p")}g</span></div>
      <div class="stat"><b>${deficitDays}<small style="font-size:.9rem;color:var(--muted)">/${logged.length}</small></b><span>dias em déficit</span></div>
      <div class="stat"><b class="${avgBal.cls === "deficit" ? "pos" : "neg"}">${avgBal.cls === "deficit" ? "−" : "+"}${nf(avgBal.v)}</b><span>kcal de ${avgBal.label.toLowerCase()} médio/dia</span></div>
      <div class="stat"><b class="${saldo <= 0 ? "pos" : "neg"}">${saldo <= 0 ? "−" : "+"}${kgGordura} kg</b><span>${saldo <= 0 ? "gordura queimada (estim.)" : "gordura ganha (estim.)"}</span></div>
    </div>
    <section class="card" style="margin-top:14px">
      <div class="card-head" style="margin-bottom:0"><h2>Calorias por dia</h2></div>
      ${chartSvg(rows, meta, gasto)}
    </section>
    <section class="card" style="margin-top:14px">
      <ul class="day-rows">${logged.slice().reverse().map((r) => {
        const b = balance(r.kcal, gasto);
        return `
        <li data-day="${r.key}">
          <span class="d">${fmt(r.date, { weekday: "short", day: "numeric", month: "short" })}</span>
          <span class="v">${nf(r.kcal)} kcal <span class="badge ${b.cls}">${b.cls === "deficit" ? "−" : "+"}${nf(b.v)}</span>${icon("right")}</span>
        </li>`;
      }).join("")}</ul>
    </section>`;
  bindChart(rows, gasto);
}

// Gráfico de barras: kcal por dia; verde = déficit, vermelho = superávit
// linha contínua = gasto diário (manutenção), tracejada = meta
function chartSvg(rows, meta, gasto) {
  const W = 340, H = 180, top = 10, bottom = 20, left = 2, right = 2;
  const max = Math.max(gasto * 1.15, meta * 1.15, ...rows.map((r) => r.kcal));
  const plotH = H - top - bottom;
  const slot = (W - left - right) / rows.length;
  const bw = Math.max(2, Math.min(28, slot - 2));
  const y = (v) => top + plotH - (v / max) * plotH;
  const today = todayKey();

  const bars = rows.map((r, i) => {
    const cx = left + slot * i + slot / 2;
    const h = r.kcal ? Math.max(3, (r.kcal / max) * plotH) : 0;
    const x = cx - bw / 2, yTop = top + plotH - h, rad = Math.min(4, bw / 2, h);
    // topo arredondado 4px, base reta
    const path = h ? `M${x},${top + plotH}V${yTop + rad}Q${x},${yTop} ${x + rad},${yTop}H${x + bw - rad}Q${x + bw},${yTop} ${x + bw},${yTop + rad}V${top + plotH}Z` : "";
    const lbl = hist.view === "week" ? fmt(r.date, { weekday: "narrow" }) : r.date.getDate();
    const showLbl = hist.view === "week" || r.date.getDate() === 1 || r.date.getDate() % 5 === 0;
    return `
      <rect class="hit" data-i="${i}" x="${left + slot * i}" y="${top}" width="${slot}" height="${plotH + bottom}"></rect>
      <path class="bar ${r.kcal > gasto ? "surplus" : ""}" d="${path}"></path>
      ${r.key === today ? `<circle class="today-dot" cx="${cx}" cy="${H - 2}" r="2"></circle>` : ""}
      ${showLbl ? `<text class="axis" x="${cx}" y="${H - 7}" text-anchor="middle">${lbl}</text>` : ""}`;
  }).join("");

  return `
    <div class="chart" id="histChart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Calorias por dia">
        <line class="grid" x1="0" x2="${W}" y1="${top + plotH}" y2="${top + plotH}"></line>
        ${bars}
        ${gasto !== meta ? `<line class="maint" x1="0" x2="${W}" y1="${y(gasto)}" y2="${y(gasto)}"></line>` : ""}
        <line class="goal" x1="0" x2="${W}" y1="${y(meta)}" y2="${y(meta)}"></line>
      </svg>
      <div class="tooltip" hidden></div>
      <div class="legend"><span><i style="background:var(--green)"></i>déficit</span><span><i style="background:var(--red)"></i>superávit</span><span><i class="dash"></i>meta ${nf(meta)}</span>${gasto !== meta ? `<span><i class="line"></i>gasto ${nf(gasto)}</span>` : ""}</div>
    </div>`;
}

function bindChart(rows, gasto) {
  const wrap = $("histChart");
  const svg = wrap.querySelector("svg");
  const tip = wrap.querySelector(".tooltip");
  const show = (el) => {
    const r = rows[+el.dataset.i];
    wrap.querySelectorAll(".hit.active").forEach((h) => h.classList.remove("active"));
    el.classList.add("active");
    const box = el.getBoundingClientRect(), base = wrap.getBoundingClientRect();
    const b = balance(r.kcal, gasto);
    tip.innerHTML = `<b>${fmt(r.date, { weekday: "short", day: "numeric", month: "short" })}</b><br>` +
      (r.n ? `${nf(r.kcal)} kcal · ${b.label.toLowerCase()} ${nf(b.v)}<br>P${r.p} C${r.c} G${r.f}` : "sem registro");
    tip.hidden = false;
    tip.style.left = Math.min(Math.max(box.left + box.width / 2 - base.left, 70), base.width - 70) + "px";
  };
  svg.querySelectorAll(".hit").forEach((h) => {
    h.addEventListener("mouseenter", () => show(h));
    h.addEventListener("click", () => show(h));
  });
  svg.addEventListener("mouseleave", () => {
    tip.hidden = true;
    wrap.querySelectorAll(".hit.active").forEach((h) => h.classList.remove("active"));
  });
}

$("historyBody").addEventListener("click", (e) => {
  const row = e.target.closest(".day-rows li");
  if (!row) return;
  const [y, mo, d] = row.dataset.day.split("-").map(Number);
  hist.view = "day";
  hist.anchor = new Date(y, mo - 1, d);
  renderHistory();
  window.scrollTo({ top: 0 });
});
document.querySelector(".tabs").addEventListener("click", (e) => {
  const v = e.target.closest("button")?.dataset.view;
  if (!v) return;
  hist.view = v;
  hist.anchor = new Date();
  renderHistory();
});
$("prevPeriod").onclick = () => shiftPeriod(-1);
$("nextPeriod").onclick = () => shiftPeriod(1);

// ---------- perfil ----------
const form = $("profileForm");

function readForm() {
  const f = new FormData(form);
  const num = (k) => parseFloat(String(f.get(k) || "").replace(",", ".")) || null;
  return {
    sexo: f.get("sexo") || "m", idade: num("idade"), peso: num("peso"), altura: num("altura"),
    atividade: num("atividade") || 1.55, objetivo: f.get("objetivo") || "perder", metaManual: num("metaManual"),
  };
}

function fillProfileForm() {
  const p = getProfile();
  if (p) for (const [k, v] of Object.entries(p)) if (form.elements[k] && v != null) form.elements[k].value = v;
  $("formError").hidden = true;
  renderProfile();
}

function renderProfile() {
  const b = calcBody(readForm());
  const card = $("imcCard");
  if (!b) {
    card.innerHTML = `
      <div class="imc-head"><div><small>Seu IMC</small><div class="imc-value">—</div>
        <span class="imc-cat">preencha peso, altura e idade</span></div><span style="font-size:2rem">⚖️</span></div>`;
    $("profilePreview").innerHTML = "";
    return;
  }
  const pos = Math.min(100, Math.max(0, ((b.imc - 15) / 25) * 100));
  card.innerHTML = `
    <div class="imc-head">
      <div><small>Seu IMC</small><div class="imc-value">${b.imc.toFixed(1).replace(".", ",")}</div><span class="imc-cat">${b.imcCat}</span></div>
      <span style="font-size:2rem">⚖️</span>
    </div>
    <div class="imc-scale"><div class="marker" style="left:${pos}%"></div></div>
    <div class="imc-labels"><span style="left:14%">18,5</span><span style="left:40%">25</span><span style="left:60%">30</span><span style="left:80%">35</span></div>
    <div class="imc-grid">
      <div><b>${nf(b.tmb)}</b><span>TMB (repouso)</span></div>
      <div><b>${nf(b.gasto)}</b><span>gasto diário</span></div>
      <div><b>${nf(b.recomendada)}</b><span>meta recomendada</span></div>
    </div>`;
  const m = macroTargets(b.meta, readForm());
  $("profilePreview").innerHTML = `
    <div><b class="pos">${nf(b.meta)} kcal</b><span>sua meta diária${readForm().metaManual ? " (personalizada)" : ""}</span></div>
    <div><b>${nf(b.gasto - b.meta)} kcal</b><span>${b.meta <= b.gasto ? "de déficit planejado/dia" : "de superávit planejado/dia"}</span></div>
    <div style="grid-column:1/-1"><span>Macros diários sugeridos</span>
      <b style="font-size:.95rem">Proteína ${m.p}g · Carbo ${m.c}g · Gordura ${m.f}g</b></div>`;
}

form.addEventListener("input", renderProfile);
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const p = readForm();
  const err = !p.idade || p.idade < 14 || p.idade > 100 ? "Informe uma idade entre 14 e 100 anos."
    : !p.peso || p.peso < 30 || p.peso > 300 ? "Informe um peso entre 30 e 300 kg."
    : !p.altura || p.altura < 120 || p.altura > 230 ? "Informe a altura em centímetros (ex: 175)."
    : p.metaManual && (p.metaManual < 800 || p.metaManual > 6000) ? "A meta personalizada deve ficar entre 800 e 6.000 kcal."
    : null;
  $("formError").textContent = err || "";
  $("formError").hidden = !err;
  if (err) return;
  save(PROFILE_KEY, p);
  renderAll();
  toast("Perfil salvo!");
  showPage("home");
});

// ---------- eventos ----------
$("photoInput").addEventListener("change", onFile);
$("galleryInput").addEventListener("change", onFile);
$("camBtn").onclick = () => $("photoInput").click();
$("galBtn").onclick = () => $("galleryInput").click();
$("retakeBtn").onclick = () => $("photoInput").click();
$("fab").onclick = () => $("photoInput").click();
$("analyzeBtn").onclick = analyze;

function renderAll() {
  renderHome();
  renderHistory();
}
renderAll();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
