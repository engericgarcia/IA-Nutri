import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

// Carrega .env simples (sem dependências) se existir
try {
  const env = await fs.readFile(path.join(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const client = new Anthropic();

const SYSTEM_PROMPT = `Você é um nutricionista esportivo brasileiro experiente, especialista em dieta "fit", contagem de calorias e macros.
Sua tarefa: analisar a FOTO de um prato de comida e estimar calorias e macronutrientes da refeição.

Como estimar:
- Identifique cada alimento visível. Considere a culinária brasileira (arroz, feijão, farofa, frango grelhado, batata-doce, ovos, cuscuz, tapioca, açaí, whey, etc.).
- Estime a porção em gramas usando referências visuais: prato raso padrão ~26 cm, talheres, mãos, copos, embalagens.
- Use valores nutricionais de referência da Tabela TACO (UNICAMP) e da TBCA/USP para alimentos brasileiros; USDA FoodData Central para o restante. Use o alimento já preparado (cozido/grelhado), não cru.
- Considere gordura "escondida": óleo de preparo, manteiga, molhos, azeite. Se o alimento parece frito ou refogado, some esse óleo e mencione.
- Se o usuário enviar uma descrição ou pesos, ela tem prioridade sobre o que você estima pela foto.
- Seja realista, não otimista: é melhor errar levemente para cima do que subestimar numa dieta.
- Se a imagem não for comida, retorne itens vazios e explique em "observacoes".

Responda sempre em português do Brasil.`;

const itemSchema = {
  type: "object",
  properties: {
    nome: { type: "string", description: "Nome do alimento, ex: 'Arroz branco cozido'" },
    porcao_g: { type: "number", description: "Porção estimada em gramas (ou ml)" },
    medida_caseira: { type: "string", description: "Ex: '4 colheres de sopa'" },
    kcal: { type: "number" },
    proteina_g: { type: "number" },
    carboidrato_g: { type: "number" },
    gordura_g: { type: "number" },
  },
  required: ["nome", "porcao_g", "medida_caseira", "kcal", "proteina_g", "carboidrato_g", "gordura_g"],
  additionalProperties: false,
};

const resultSchema = {
  type: "object",
  properties: {
    prato: { type: "string", description: "Nome curto da refeição" },
    itens: { type: "array", items: itemSchema },
    total_kcal: { type: "number" },
    total_proteina_g: { type: "number" },
    total_carboidrato_g: { type: "number" },
    total_gordura_g: { type: "number" },
    faixa_kcal_min: { type: "number", description: "Limite inferior plausível do total" },
    faixa_kcal_max: { type: "number", description: "Limite superior plausível do total" },
    confianca: { type: "string", enum: ["baixa", "media", "alta"] },
    avaliacao_fit: { type: "string", description: "1-2 frases avaliando a refeição para quem está de dieta" },
    dicas: { type: "array", items: { type: "string" }, description: "Até 3 dicas práticas para deixar o prato mais fit" },
    observacoes: { type: "string", description: "Suposições feitas (óleo, molhos, porções ocultas) ou avisos" },
  },
  required: [
    "prato", "itens", "total_kcal", "total_proteina_g", "total_carboidrato_g", "total_gordura_g",
    "faixa_kcal_min", "faixa_kcal_max", "confianca", "avaliacao_fit", "dicas", "observacoes",
  ],
  additionalProperties: false,
};

async function analyzeMeal({ image, mediaType, description }) {
  const userText = description?.trim()
    ? `Analise esta refeição. Informações do usuário: "${description.trim().slice(0, 500)}"`
    : "Analise esta refeição.";

  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: resultSchema },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: userText },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw Object.assign(new Error("A IA não conseguiu analisar esta imagem. Tente outra foto."), { status: 422 });
  }
  if (response.stop_reason === "max_tokens") {
    throw Object.assign(new Error("Resposta incompleta da IA. Tente novamente."), { status: 502 });
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw Object.assign(new Error("Resposta vazia da IA."), { status: 502 });
  return JSON.parse(text);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Imagem muito grande."), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleAnalyze(req, res) {
  try {
    const { image, mediaType, description } = await readBody(req);
    if (!image || !["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
      return sendJson(res, 400, { error: "Envie uma imagem JPEG, PNG ou WebP." });
    }
    const result = await analyzeMeal({ image, mediaType, description });
    sendJson(res, 200, result);
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.AuthenticationError) {
      return sendJson(res, 500, { error: "Chave da API Anthropic inválida ou ausente no servidor (.env)." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return sendJson(res, 429, { error: "Muitas requisições. Aguarde alguns segundos." });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return sendJson(res, 502, { error: "Não foi possível conectar à IA. Verifique a internet do servidor." });
    }
    if (err instanceof Anthropic.APIError) {
      return sendJson(res, 502, { error: `Erro da IA (${err.status}). Tente novamente.` });
    }
    sendJson(res, err.status || 500, { error: err.message || "Erro inesperado." });
  }
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const filePath = path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "Proibido" });
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Não encontrado");
  }
}

http
  .createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/analyze") return handleAnalyze(req, res);
    if (req.method === "GET") return serveStatic(req, res);
    res.writeHead(405);
    res.end();
  })
  .listen(PORT, () => console.log(`IA Nutri rodando em http://localhost:${PORT}`));
