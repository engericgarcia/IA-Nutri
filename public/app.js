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
const getGoal = () => load(GOAL_KEY, 2000);

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
  // mantém só os últimos 60 dias
  const cutoff = Date.now() - 60 * 864e5;
  save(STORE_KEY, meals.filter((m) => m.at > cutoff));
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

// ---------- painel do dia ----------
function renderToday() {
  const meals = getMeals().filter((m) => m.day === todayKey());
  const goal = getGoal();
  const sum = meals.reduce((a, m) => ({ kcal: a.kcal + m.kcal, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }), { kcal: 0, p: 0, c: 0, f: 0 });

  $("todayKcal").textContent = sum.kcal;
  $("goalKcal").textContent = goal;
  $("todayBar").style.width = Math.min(100, (sum.kcal / goal) * 100) + "%";
  $("todayBar").parentElement.classList.toggle("over", sum.kcal > goal);
  $("todayMacros").innerHTML = `<span>P ${sum.p}g</span><span>C ${sum.c}g</span><span>G ${sum.f}g</span><span>Restam ${Math.max(0, goal - sum.kcal)} kcal</span>`;

  $("historyEmpty").hidden = meals.length > 0;
  $("historyList").innerHTML = meals
    .slice()
    .reverse()
    .map((m) => `
      <li>
        ${m.thumb ? `<img src="${m.thumb}" alt="" />` : ""}
        <div class="info"><div>${esc(m.prato)}</div>
          <span class="muted">${new Date(m.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${m.kcal} kcal</span></div>
        <button class="del" data-id="${esc(m.id)}" aria-label="Remover">✕</button>
      </li>`)
    .join("");
}

$("historyList").addEventListener("click", (e) => {
  const id = e.target.closest(".del")?.dataset.id;
  if (!id || !confirm("Remover esta refeição?")) return;
  save(STORE_KEY, getMeals().filter((m) => m.id !== id));
  renderToday();
});

// ---------- meta ----------
$("goalBtn").onclick = () => {
  $("goalInput").value = getGoal();
  $("goalDialog").showModal();
};
$("goalDialog").addEventListener("close", () => {
  if ($("goalDialog").returnValue !== "ok") return;
  const v = parseInt($("goalInput").value, 10);
  if (v >= 800 && v <= 6000) save(GOAL_KEY, v);
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
