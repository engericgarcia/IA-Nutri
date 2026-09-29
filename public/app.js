const $ = (id) => document.getElementById(id);
const STORE_KEY = "ianutri.meals";
const GOAL_KEY = "ianutri.goal";

let currentImage = null; // { dataUrl, base64, mediaType, thumb }
let lastResult = null;

// ---------- armazenamento local ----------
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
const todayKey = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD local
const getMeals = () => load(STORE_KEY, []);
const PROFILE_KEY = "ianutri.profile";
const getProfile = () => load(PROFILE_KEY, null);
const nf = (n) => Math.round(n).toLocaleString("pt-BR");

// ---------- corpo: IMC, TMB (Mifflin-St Jeor), gasto diário e meta ----------
function calcBody(p) {
  if (!p?.peso || !p?.altura || !p?.idade) return null;
  const imc = p.peso / (p.altura / 100) ** 2;
  const imcCat =
    imc < 18.5 ? "Abaixo do peso" : imc < 25 ? "Peso normal" : imc < 30 ? "Sobrepeso"
    : imc < 35 ? "Obesidade grau I" : imc < 40 ? "Obesidade grau II" : "Obesidade grau III";
  const tmb = 10 * p.peso + 6.25 * p.altura - 5 * p.idade + (p.sexo === "f" ? -161 : 5);
  const gasto = tmb * (Number(p.atividade) || 1.55);
  const fator = { perder: 0.8, manter: 1, ganhar: 1.1 }[p.objetivo] ?? 1;
  let recomendada = Math.round((gasto * fator) / 50) * 50;
  // não recomenda abaixo do mínimo seguro sem acompanhamento profissional
  const piso = p.sexo === "f" ? 1200 : 1500;
  if (recomendada < piso) recomendada = Math.min(piso, Math.round(gasto / 50) * 50);
  return { imc, imcCat, tmb: Math.round(tmb), gasto: Math.round(gasto), recomendada, meta: Number(p.metaManual) || recomendada };
}

// meta = quanto comer; gasto = manutenção (abaixo dele = déficit, acima = superávit)
function targets() {
  const body = calcBody(getProfile());
  if (body) return { meta: body.meta, gasto: body.gasto, body };
  const g = load(GOAL_KEY, 2000);
  return { meta: g, gasto: g, body: null };
}

function balance(kcal, gasto) {
  const d = kcal - gasto;
  return d > 0 ? { cls: "surplus", label: "Superávit", v: d } : { cls: "deficit", label: "Déficit", v: -d };
}

// ---------- imagem: redimensiona para economizar tokens ----------
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
      const ts = 96 / Math.max(img.width, img.height);
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
  if (!file) return;
  try {
    currentImage = await resizeImage(file);
    $("preview").src = currentImage.dataUrl;
    $("preview").hidden = false;
    $("photoHint").hidden = true;
    $("analyzeBtn").disabled = false;
    $("result").hidden = true;
  } catch (err) {
    alert(err.message);
  }
  e.target.value = "";
}

// ---------- análise ----------
async function analyze() {
  if (!currentImage) return;
  const box = $("result");
  box.hidden = false;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>Analisando seu prato…</div>`;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  $("analyzeBtn").disabled = true;

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
    box.innerHTML = `<p class="error">⚠️ ${esc(err.message === "Failed to fetch" ? "Sem conexão com o servidor." : err.message)}</p>`;
  } finally {
    $("analyzeBtn").disabled = false;
  }
}

const r0 = (n) => Math.round(Number(n) || 0);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function renderResult(d) {
  const box = $("result");
  if (!d.itens?.length) {
    box.innerHTML = `<p>🤔 Não identifiquei comida nessa foto.</p><p class="muted">${esc(d.observacoes)}</p>`;
    return;
  }
  box.innerHTML = `
    <h2>${esc(d.prato)} <span class="badge">confiança ${esc(d.confianca)}</span></h2>
    <p class="kcal-big">${r0(d.total_kcal)} <small>kcal</small></p>
    <p class="muted">Faixa provável: ${r0(d.faixa_kcal_min)}–${r0(d.faixa_kcal_max)} kcal</p>
    <div class="macros">
      <div class="macro p"><b>${r0(d.total_proteina_g)}g</b><span>Proteína</span></div>
      <div class="macro c"><b>${r0(d.total_carboidrato_g)}g</b><span>Carbo</span></div>
      <div class="macro f"><b>${r0(d.total_gordura_g)}g</b><span>Gordura</span></div>
    </div>
    <ul class="items">
      ${d.itens.map((i) => `
        <li><div>${esc(i.nome)}<div class="sub">${r0(i.porcao_g)}g · ${esc(i.medida_caseira)} · P${r0(i.proteina_g)} C${r0(i.carboidrato_g)} G${r0(i.gordura_g)}</div></div>
        <span class="k">${r0(i.kcal)} kcal</span></li>`).join("")}
    </ul>
    <div class="tip-box"><b>Avaliação fit:</b> ${esc(d.avaliacao_fit)}
      ${d.dicas?.length ? `<ul>${d.dicas.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    </div>
    ${d.observacoes ? `<p class="muted">ℹ️ ${esc(d.observacoes)}</p>` : ""}
    <div class="actions">
      <button class="ghost" id="discardBtn">Descartar</button>
      <button class="primary" id="saveBtn">Registrar refeição</button>
    </div>`;
  $("saveBtn").onclick = saveMeal;
  $("discardBtn").onclick = resetCapture;
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
  resetCapture();
  renderToday();
}

function resetCapture() {
  currentImage = null;
  lastResult = null;
  $("preview").hidden = true;
  $("photoHint").hidden = false;
  $("desc").value = "";
  $("analyzeBtn").disabled = true;
  $("result").hidden = true;
}

// ---------- painel de hoje ----------
function sumMeals(meals) {
  return meals.reduce((a, m) => ({ kcal: a.kcal + m.kcal, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }), { kcal: 0, p: 0, c: 0, f: 0 });
}

function renderToday() {
  const { meta, gasto, body } = targets();
  const sum = sumMeals(getMeals().filter((m) => m.day === todayKey()));
  const bal = balance(sum.kcal, gasto);
  $("todayKcal").textContent = nf(sum.kcal);
  $("goalKcal").textContent = nf(meta);
  $("todayBar").style.width = Math.min(100, (sum.kcal / meta) * 100) + "%";
  $("todayBar").parentElement.classList.toggle("over", bal.cls === "surplus");
  $("todayMacros").innerHTML = `<span>P ${sum.p}g</span><span>C ${sum.c}g</span><span>G ${sum.f}g</span><span>Restam ${nf(Math.max(0, meta - sum.kcal))} kcal</span>`;

  if (!body) {
    $("balanceBox").innerHTML = "";
    $("bodyBox").innerHTML = `<div class="setup" style="grid-column:1/-1"><p class="muted" style="margin:0 0 8px">Preencha peso, altura e idade para calcular seu IMC, seu gasto diário e a meta recomendada.</p><button class="primary" id="setupBtn">Preencher meu perfil</button></div>`;
    $("setupBtn").onclick = openProfile;
  } else {
    $("balanceBox").innerHTML = `
      <div class="balance ${bal.cls}">
        <span class="ico">${bal.cls === "deficit" ? "▼" : "▲"}</span>
        <div><b>${bal.label} de ${nf(bal.v)} kcal</b><small>em relação ao seu gasto estimado de ${nf(gasto)} kcal/dia</small></div>
      </div>`;
    $("bodyBox").innerHTML = `
      <div class="stat"><b>${body.imc.toFixed(1).replace(".", ",")}</b><span>IMC · ${body.imcCat}</span></div>
      <div class="stat"><b>${nf(body.gasto)}</b><span>gasto kcal/dia</span></div>
      <div class="stat"><b>${nf(body.recomendada)}</b><span>meta recomendada</span></div>`;
  }
  renderHistory();
}

// ---------- histórico: dia / semana / mês ----------
const hist = { view: "day", anchor: new Date() }; // anchor = data de referência do período exibido

const dayKey = (d) => d.toLocaleDateString("sv-SE");
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); }; // segunda
const fmt = (d, opts) => d.toLocaleDateString("pt-BR", opts);

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

function renderDayView() {
  const key = dayKey(hist.anchor);
  const today = key === todayKey();
  const yesterday = key === dayKey(addDays(new Date(), -1));
  $("periodLabel").textContent = today ? "Hoje" : yesterday ? "Ontem" : fmt(hist.anchor, { weekday: "short", day: "numeric", month: "short" });

  const meals = getMeals().filter((m) => m.day === key).sort((a, b) => b.at - a.at);
  const sum = sumMeals(meals);
  const bal = balance(sum.kcal, targets().gasto);
  $("historyBody").innerHTML = !meals.length
    ? `<p class="muted">Nenhuma refeição registrada ${today ? "hoje" : "neste dia"}.</p>`
    : `
    <div class="stats">
      <div class="stat"><b>${nf(sum.kcal)} kcal</b><span class="${bal.cls === "deficit" ? "pos" : "neg"}">${bal.label} de ${nf(bal.v)} kcal</span></div>
      <div class="stat"><b>${meals.length}</b><span>refeições</span></div>
    </div>
    <p class="muted" style="margin:0 0 6px">Proteína ${sum.p}g · Carbo ${sum.c}g · Gordura ${sum.f}g</p>
    <ul>${meals.map((m) => `
      <li>
        ${m.thumb ? `<img src="${m.thumb}" alt="" />` : ""}
        <div class="info"><div>${esc(m.prato)}</div>
          <span class="muted">${new Date(m.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${m.kcal} kcal · P${m.p} C${m.c} G${m.f}</span></div>
        <button class="del" data-id="${esc(m.id)}" aria-label="Remover">✕</button>
      </li>`).join("")}</ul>`;
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
    $("historyBody").innerHTML = `<p class="muted">Nenhuma refeição registrada ${hist.view === "week" ? "nesta semana" : "neste mês"}.</p>`;
    return;
  }

  const avg = (k) => Math.round(logged.reduce((a, r) => a + r[k], 0) / logged.length);
  const deficitDays = logged.filter((r) => r.kcal <= gasto).length;
  const saldo = logged.reduce((a, r) => a + (r.kcal - gasto), 0); // negativo = déficit acumulado
  const avgBal = balance(avg("kcal"), gasto);
  const kgGordura = (Math.abs(saldo) / 7700).toFixed(1).replace(".", ","); // ~7.700 kcal por kg de gordura

  $("historyBody").innerHTML = `
    <div class="stats">
      <div class="stat"><b>${nf(avg("kcal"))} kcal</b><span>média por dia · P ${avg("p")}g</span></div>
      <div class="stat"><b>${deficitDays}/${logged.length}</b><span>dias em déficit</span></div>
      <div class="stat"><b class="${avgBal.cls === "deficit" ? "pos" : "neg"}">${avgBal.cls === "deficit" ? "−" : "+"}${nf(avgBal.v)} kcal</b><span>${avgBal.label.toLowerCase()} médio/dia</span></div>
      <div class="stat"><b class="${saldo <= 0 ? "pos" : "neg"}">${saldo <= 0 ? "−" : "+"}${kgGordura} kg</b><span>${saldo <= 0 ? "gordura queimada (estim.)" : "gordura ganha (estim.)"}</span></div>
    </div>
    ${chartSvg(rows, meta, gasto)}
    <ul class="day-rows">${logged.slice().reverse().map((r) => `
      <li data-day="${r.key}">
        <span class="d">${fmt(r.date, { weekday: "short", day: "numeric", month: "short" })}</span>
        <span class="v ${balance(r.kcal, gasto).cls}">${nf(r.kcal)} kcal <small>· ${balance(r.kcal, gasto).cls === "deficit" ? "−" : "+"}${nf(balance(r.kcal, gasto).v)} ›</small></span>
      </li>`).join("")}</ul>`;
  bindChart(rows, gasto);
}

// Gráfico de barras: kcal por dia; verde = déficit, vermelho = superávit
// linha contínua = gasto diário (manutenção), tracejada = meta
function chartSvg(rows, meta, gasto) {
  const W = 340, H = 170, top = 14, bottom = 20, left = 4, right = 4;
  const max = Math.max(gasto * 1.15, meta * 1.15, ...rows.map((r) => r.kcal));
  const plotH = H - top - bottom;
  const slot = (W - left - right) / rows.length;
  const gap = 2;
  const bw = Math.max(2, Math.min(28, slot - gap));
  const y = (v) => top + plotH - (v / max) * plotH;
  const today = todayKey();
  const labelEvery = rows.length > 7 ? 5 : 1;

  const bars = rows.map((r, i) => {
    const cx = left + slot * i + slot / 2;
    const h = r.kcal ? Math.max(3, (r.kcal / max) * plotH) : 0;
    const x = cx - bw / 2, yTop = top + plotH - h, rad = Math.min(4, bw / 2, h);
    // topo arredondado 4px, base reta
    const path = h ? `M${x},${top + plotH}V${yTop + rad}Q${x},${yTop} ${x + rad},${yTop}H${x + bw - rad}Q${x + bw},${yTop} ${x + bw},${yTop + rad}V${top + plotH}Z` : "";
    const lbl = hist.view === "week" ? fmt(r.date, { weekday: "narrow" }) : r.date.getDate();
    const showLbl = hist.view === "week" || (r.date.getDate() === 1 || r.date.getDate() % labelEvery === 0);
    return `
      <rect class="hit" data-i="${i}" x="${left + slot * i}" y="${top}" width="${slot}" height="${plotH + bottom}"></rect>
      <path class="bar ${r.kcal > gasto ? "surplus" : ""}" d="${path}"></path>
      ${r.key === today ? `<circle class="today-dot" cx="${cx}" cy="${H - 3}" r="2"></circle>` : ""}
      ${showLbl ? `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${lbl}</text>` : ""}`;
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
    tip.innerHTML = `<b>${fmt(r.date, { weekday: "short", day: "numeric", month: "short" })}</b><br>` +
      (r.n ? `${nf(r.kcal)} kcal · ${balance(r.kcal, gasto).label.toLowerCase()} ${nf(balance(r.kcal, gasto).v)}<br>P${r.p} C${r.c} G${r.f}` : "sem registro");
    tip.hidden = false;
    const x = Math.min(Math.max(box.left + box.width / 2 - base.left, 60), base.width - 60);
    tip.style.left = x + "px";
  };
  const hide = () => { tip.hidden = true; wrap.querySelectorAll(".hit.active").forEach((h) => h.classList.remove("active")); };
  svg.querySelectorAll(".hit").forEach((h) => {
    h.addEventListener("mouseenter", () => show(h));
    h.addEventListener("click", () => show(h));
  });
  svg.addEventListener("mouseleave", hide);
}

$("historyBody").addEventListener("click", (e) => {
  const del = e.target.closest(".del");
  if (del) {
    if (!confirm("Remover esta refeição?")) return;
    save(STORE_KEY, getMeals().filter((m) => m.id !== del.dataset.id));
    return renderToday();
  }
  const row = e.target.closest(".day-rows li");
  if (row) {
    const [y, mo, d] = row.dataset.day.split("-").map(Number);
    hist.view = "day";
    hist.anchor = new Date(y, mo - 1, d);
    renderHistory();
  }
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
    sexo: f.get("sexo"), idade: num("idade"), peso: num("peso"), altura: num("altura"),
    atividade: num("atividade"), objetivo: f.get("objetivo"), metaManual: num("metaManual"),
  };
}

function renderPreview() {
  const b = calcBody(readForm());
  $("profilePreview").innerHTML = !b ? "" : `
    <div class="stat"><b>${b.imc.toFixed(1).replace(".", ",")}</b><span>IMC · ${b.imcCat}</span></div>
    <div class="stat"><b>${nf(b.tmb)} kcal</b><span>TMB (metabolismo basal)</span></div>
    <div class="stat"><b>${nf(b.gasto)} kcal</b><span>gasto diário (manutenção)</span></div>
    <div class="stat"><b class="pos">${nf(b.recomendada)} kcal</b><span>meta recomendada/dia</span></div>`;
}

function openProfile() {
  const p = getProfile() || {};
  for (const [k, v] of Object.entries(p)) if (form.elements[k] && v != null) form.elements[k].value = v;
  renderPreview();
  $("profileDialog").showModal();
}

form.addEventListener("input", renderPreview);
$("profileBtn").onclick = openProfile;
$("profileDialog").addEventListener("close", () => {
  if ($("profileDialog").returnValue !== "ok") return;
  const p = readForm();
  if (calcBody(p)) save(PROFILE_KEY, p);
  renderToday();
});

// ---------- eventos ----------
$("photoInput").addEventListener("change", onFile);
$("galleryInput").addEventListener("change", onFile);
$("galleryBtn").onclick = () => $("galleryInput").click();
$("analyzeBtn").onclick = analyze;

renderToday();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
