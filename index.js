// ================== IMPORTS ==================
require("dotenv").config();
console.log("🚀 index.js cargado");

const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const crypto = require("crypto");

// ================== APP ==================
const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ================== POSTGRES ==================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// ✅ prueba de conexión
(async () => {
  try {
    const c = await pool.connect();
    console.log("✅ Conectado a Postgres");
    c.release();
  } catch (e) {
    console.error("❌ No pude conectar a Postgres. Revisa DATABASE_URL.", e.message);
  }
})();

// ================== HELPERS ==================
function capitalizeWords(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  return t
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function makeLabel(variedad, tamano) {
  const v = capitalizeWords(variedad);
  const t = tamano ? String(tamano).toUpperCase() : "";
  return t ? `${v} — ${t}` : v;
}

// ================== BARCODE PARA FORMULARIO ==================
function makeFormBarcode(fid) {
  const hash = crypto.createHash("sha1").update(String(fid)).digest("hex");
  const num = BigInt("0x" + hash.slice(0, 12));
  const serial = (num % 1000000000n).toString().padStart(9, "0"); // 9 dígitos
  const tipo = "99"; // reservado formularios
  const barcode = tipo + serial;
  return { tipo, serial, barcode };
}

// ================== CONFIG BLOQUES ==================
// Nacional: solo variedad (sin tamaño)
// Fin de corte: variedad|tamano
const BLOQUE_CONFIG = {
  "1": {
    fin_corte: ["freedom|largo", "freedom|corto", "freedom|ruso"],
    nacional: ["freedom"],
  },
  "1.1": {
    fin_corte: ["freedom|largo", "freedom|corto", "freedom|ruso"],
    nacional: ["freedom"],
  },
  "2": {
    fin_corte: ["freedom|largo", "freedom|corto", "freedom|ruso"],
    nacional: ["freedom"],
  },
  "3": {
    fin_corte: ["freedom|largo", "freedom|corto", "freedom|ruso"],
    nacional: ["freedom"],
  },
  "4": {
    fin_corte: ["freedom|largo", "freedom|corto", "freedom|ruso"],
    nacional: ["freedom"],
  },
  "5": {
    fin_corte: [
      "freedom|largo",
      "freedom|corto",
      "freedom|ruso",
      "queen berry|na",
      "queen berry|ruso",
      "moody blue|na",
      "moody blue|ruso",
      "pink mondial|na",
      "white ohora|na",
      "pink ohora|na",
    ],
    nacional: ["freedom", "queen berry", "moody blue", "pink mondial", "white ohora", "pink ohora"],
  },
  "6": {
    fin_corte: ["freedom|largo", "freedom|corto", "freedom|ruso"],
    nacional: ["freedom"],
  },

  "7": {
    fin_corte: [
      "mondial|na",
      "mondial|ruso",
      "queen berry|na",
      "queen berry|ruso",
      "momentum|na",
      "momentum|ruso",
      "moody blue|na",
      "moody blue|ruso",
    ],
    nacional: ["mondial", "queen berry", "momentum", "moody blue"],
  },

  "8": {
    fin_corte: [
      "vendela|na",
      "quick sand|na",
      "tifany|na",
      "yellow bikini|na",
    ],
    nacional: ["vendela", "quick sand", "tifany", "yellow bikini"],
  },

  "9": {
    fin_corte: [
      "vendela|na",
      "coral reff|na",
      "coral reff|ruso",
      "pink floyd|na",
      "pink floyd|ruso",
    ],
    nacional: ["vendela", "coral reff", "pink floyd"],
  },

  "10": {
    fin_corte: [
      "mondial|na",
      "hummer|na",
      "hilux|na",
      "blessing|na",
    ],
    nacional: ["mondial", "hummer", "hilux", "blessing"],
  },

  "11": {
    fin_corte: ["vendela|na"],
    nacional: ["vendela"],
  },

  "12": {
    fin_corte: ["freedom|largo", "freedom|corto", "freedom|ruso"],
    nacional: ["freedom"],
  },
};

function getOptionsFor(bloque, form) {
  const b = String(bloque || "").trim();
  const f = String(form || "").toLowerCase().trim(); // fin_corte | nacional
  const cfg = BLOQUE_CONFIG[b];
  if (!cfg) return [];

  if (f === "nacional") {
    return (cfg.nacional || []).map((variedad) => ({
      value: String(variedad),
      label: makeLabel(variedad, null),
    }));
  }

  return (cfg.fin_corte || []).map((v) => {
    const [variedad, tamanoRaw] = String(v).split("|");
    const tam = (tamanoRaw || "").trim();
    return {
      value: String(v),
      label: makeLabel(variedad, tam),
    };
  });
}

function parseSeleccion(form, seleccion) {
  const f = String(form || "").toLowerCase().trim();
  const s = String(seleccion || "").trim();

  if (f === "nacional") {
    return { variedad: s, tamano: null };
  }

  const parts = s.split("|");
  const variedad = (parts[0] || "").trim();
  const tamanoRaw = (parts[1] || "").trim();

  const t = tamanoRaw.toLowerCase();
  const tamano = !tamanoRaw || t === "na" ? null : t;

  return { variedad, tamano };
}

// ================== FORMULARIO (GET) ==================
app.get("/", (req, res) => {
  const bloque = (req.query.bloque || "").trim();
  const etapa = (req.query.etapa || "Ingreso").trim();
  const form = (req.query.form || "fin_corte").trim(); // fin_corte | nacional
  const fid = (req.query.fid || "").trim();

  if (!fid) return res.status(400).send("QR inválido: falta fid");

  const formNorm = form.toLowerCase();
  const isNacional = formNorm === "nacional";
  const opciones = getOptionsFor(bloque, formNorm);

  if (!opciones.length) {
    return res.status(400).send(`Bloque sin configuración: ${bloque} (${formNorm})`);
  }

  res.send(`
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${isNacional ? "Registro Nacional" : "Fin de Corte"}</title>
<style>
  :root{
    --primary: ${isNacional ? "#d85b00" : "#1d4ed8"};
    --soft: ${isNacional ? "rgba(216,91,0,.12)" : "rgba(29,78,216,.12)"};
  }
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui;background:#f5f7fb;padding:18px;}
  .card{background:#fff;padding:24px;border-radius:20px;box-shadow:0 18px 45px rgba(0,0,0,.12);width:100%;max-width:560px;}
  .badge{float:right;background:var(--soft);color:var(--primary);padding:6px 12px;border-radius:999px;font-weight:800;}
  h1{margin:0 0 10px;}
  label{font-weight:800;margin-top:12px;display:block}
  input,select{width:100%;padding:12px;border-radius:12px;border:1px solid #e2e8f0;font-size:1rem;outline:none;}
  input:focus,select:focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--soft);}
  button{width:100%;margin-top:18px;padding:14px;border-radius:999px;border:none;font-weight:900;background:var(--primary);color:#fff;cursor:pointer;}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0 4px;}
  .pill{border:1px dashed #e2e8f0;border-radius:14px;padding:10px 12px;background:#fbfdff;}
  .k{display:block;font-size:.78rem;color:#64748b;margin-bottom:2px}
  .v{font-weight:900;color:var(--primary);word-break:break-word}
  @media(max-width:520px){.meta{grid-template-columns:1fr}}
</style>
</head>
<body>
  <div class="card">
    <div class="badge">${isNacional ? "Nacional" : "Fin de corte"}</div>
    <h1>${isNacional ? "REGISTRO NACIONAL" : "FIN DE CORTE — REGISTRO"}</h1>

    <div style="
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin: 14px 0 18px;
">

  <!-- BLOQUE (GRANDE) -->
  <div style="
    border: 2px dashed #e5e7eb;
    border-radius: 20px;
    padding: 18px 12px;
    background: #f9fafb;
    text-align: center;
  ">
    <div style="
      font-size: 0.9rem;
      color: #6b7280;
      font-weight: 700;
      letter-spacing: 0.18em;
      margin-bottom: 6px;
    ">
      BLOQUE
    </div>
    <div style="
      font-size: 3.2rem;
      font-weight: 900;
      letter-spacing: 0.18em;
      line-height: 1.1;
      color: ${form === "nacional" ? "#d85b00" : "#1d4ed8"};
    ">
      ${bloque || "(sin bloque)"}
    </div>
  </div>

  <!-- FID -->
  <div style="
    border: 1px dashed #e5e7eb;
    border-radius: 20px;
    padding: 18px 12px;
    background: #ffffff;
    text-align: center;
  ">
    <div style="
      font-size: 0.8rem;
      color: #6b7280;
      font-weight: 600;
      letter-spacing: 0.15em;
      margin-bottom: 6px;
    ">
      FID (QR)
    </div>
    <div style="
      font-size: 1.2rem;
      font-weight: 800;
      color: #111827;
      word-break: break-word;
    ">
      ${fid}
    </div>
  </div>

</div>

    <form method="POST" action="/submit" id="registroForm">
      <input type="hidden" name="fid" value="${fid}">
      <input type="hidden" name="bloque" value="${bloque}">
      <input type="hidden" name="etapa" value="${etapa}">
      <input type="hidden" name="form" value="${formNorm}">

      <label>${isNacional ? "Variedad" : "Variedad + Tamaño"}</label>
      <select name="seleccion" required>
        ${opciones.map(o => `<option value="${o.value}">${o.label}</option>`).join("")}
      </select>

      <label>Tallos</label>
      <input type="number" name="tallos" required min="1" inputmode="numeric" value="">

      <button type="submit">Guardar registro</button>
    </form>

    <p style="margin-top:12px;font-size:.9rem;color:#64748b;text-align:center">
      Cada etiqueta debe tener un <strong>fid</strong> único (si repites fid, dirá “YA REGISTRADO”).
    </p>
  </div>
</body>
</html>
  `);
});

// ================== SUBMIT (POST) ==================
app.post("/submit", async (req, res) => {
  const fid = String(req.body.fid || "").trim();
  const bloque = String(req.body.bloque || "").trim();
  const etapa = String(req.body.etapa || "Ingreso").trim();
  const form = String(req.body.form || "fin_corte").toLowerCase().trim();
  const seleccion = String(req.body.seleccion || "").trim();
  const tallos = req.body.tallos;

  if (!fid || !bloque || !seleccion || !tallos) {
    return res.status(400).send("Datos incompletos");
  }

  // valida selección contra bloque/form
  const opciones = getOptionsFor(bloque, form);
  if (!opciones.some(o => o.value === seleccion)) {
    return res.status(400).send("Selección inválida para este bloque/formulario");
  }

  const tallosNum = parseInt(tallos, 10);
  if (Number.isNaN(tallosNum) || tallosNum < 1) {
    return res.status(400).send("Tallos inválidos");
  }

  const { variedad, tamano } = parseSeleccion(form, seleccion);
  const { tipo, serial, barcode } = makeFormBarcode(fid);

  try {
    const q = `
      INSERT INTO registros
      (barcode, tipo, serial, variedad, bloque, tamano, tallos, etapa, form, form_id)
      VALUES
      ($1,$2,$3,$4,$5::numeric,$6,$7::int,$8,$9,$10)
      ON CONFLICT (form_id) DO NOTHING
      RETURNING barcode;
    `;

    const r = await pool.query(q, [
      barcode,
      tipo,
      serial,
      variedad,
      bloque,
      form === "nacional" ? null : tamano,
      tallosNum,
      etapa || "Ingreso",
      form,
      fid,
    ]);

    if (r.rowCount === 0) {
  return res.status(400).send(`
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Ya registrado</title>
</head>
<body style="
  margin:0;
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  background: radial-gradient(1200px 600px at 20% 10%, rgba(245,158,11,.18), transparent 60%),
              radial-gradient(1200px 600px at 90% 90%, rgba(248,113,113,.14), transparent 60%),
              #fff7ed;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  padding: 18px;
">

  <div style="
    background:#ffffff;
    border-radius:28px;
    box-shadow:0 22px 60px rgba(15,23,42,.22);
    padding:32px 26px 26px;
    max-width:560px;
    width:100%;
    text-align:center;
    border: 2px solid rgba(245,158,11,.25);
  ">

    <div style="
      width:92px;
      height:92px;
      margin: 0 auto 14px;
      border-radius:50%;
      background:#f59e0b;
      color:white;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:3rem;
      box-shadow:0 14px 30px rgba(245,158,11,.45);
      font-weight:900;
    ">
      !
    </div>

    <h1 style="
      margin: 6px 0 8px;
      font-size: 2rem;
      font-weight: 900;
      color:#7c2d12;
      letter-spacing:.03em;
    ">
      YA REGISTRADO
    </h1>

    <p style="
      margin: 0 0 14px;
      font-size: 1.05rem;
      color:#9a3412;
      font-weight:650;
      line-height:1.4;
    ">
      Esta <strong>Etiqueta</strong> ya fue usada hoy.
    </p>

    <div style="
      margin: 14px 0 14px;
      text-align:left;
      background:#fff7ed;
      border:1px dashed rgba(245,158,11,.45);
      padding:14px 14px;
      border-radius:16px;
      color:#7c2d12;
      font-size:.98rem;
    ">
      
    </div>

    <div style="
      margin-top: 10px;
      padding: 14px 12px;
      border-radius: 16px;
      background: #fef3c7;
      color:#7c2d12;
      font-size: .95rem;
      font-weight: 650;
    ">
     
    </div>

    <button onclick="history.back()" style="
      width:100%;
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      font-weight: 900;
      font-size: 1rem;
      background: #7c2d12;
      color: white;
      box-shadow: 0 12px 26px rgba(124,45,18,.25);
    ">
      Volver
    </button>

  </div>
</body>
</html>
  `);
}

    const variedadShow = capitalizeWords(variedad);
    const tamanoShow =
      form === "nacional" ? "(No aplica)" : (tamano ? String(tamano).toUpperCase() : "(Vacío)");
    const formShow = form === "fin_corte" ? "Fin de corte" : "Nacional";

    return res.send(`
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Registro exitoso</title>
</head>
<body style="
  margin:0;
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  background: linear-gradient(135deg, #ecfeff, #f0fdf4);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  padding: 18px;
">

  <div style="
    background:#ffffff;
    border-radius:28px;
    box-shadow:0 22px 60px rgba(15,23,42,.25);
    padding:34px 28px 30px;
    max-width:520px;
    width:100%;
    text-align:center;
    border: 2px solid #16a34a22;
  ">

    <!-- ICONO -->
    <div style="
      width:92px;
      height:92px;
      margin: 0 auto 14px;
      border-radius:50%;
      background:#16a34a;
      color:white;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:3.2rem;
      box-shadow:0 14px 30px rgba(22,163,74,.45);
    ">
      ✓
    </div>

    <!-- TITULO -->
    <h1 style="
      margin: 6px 0 6px;
      font-size: 2.1rem;
      font-weight: 900;
      color:#14532d;
      letter-spacing:.04em;
    ">
      REGISTRO EXITOSO
    </h1>

    <p style="
      margin: 0 0 18px;
      font-size: 1.05rem;
      color:#065f46;
      font-weight:600;
    ">
      El registro fue guardado correctamente
    </p>

    <!-- DATOS -->
    <div style="
      text-align:left;
      border-top:1px dashed #d1fae5;
      padding-top:16px;
      margin-top:10px;
      font-size:1rem;
    ">
      <p><strong>Bloque:</strong> ${bloque}</p>
      <p><strong>Variedad:</strong> ${variedad}</p>
      <p><strong>Tamaño:</strong> ${form === "nacional" ? "No aplica" : (tamano || "—")}</p>
      <p><strong>Tallos:</strong> ${tallosNum}</p>
      <p><strong>Etapa:</strong> ${etapa}</p>
      <p><strong>Tipo:</strong> ${form === "nacional" ? "Nacional" : "Fin de corte"}</p>
    </div>

    <!-- MENSAJE FINAL -->
    <div style="
      margin-top:18px;
      padding:14px 12px;
      background:#ecfdf5;
      border-radius:14px;
      color:#065f46;
      font-size:.95rem;
      font-weight:600;
    ">
      Puedes cerrar esta pantalla o escanear el siguiente código.
    </div>

  </div>
</body>
</html>
`);

  } catch (err) {
    console.error("[ERROR BD]", err);
    return res.status(500).send(`
      <h2>Error al guardar ❌</h2>
      <pre style="white-space:pre-wrap">${err.message}</pre>
    `);
  }
});

// ================== LISTEN ==================
app.listen(port, () => {
  console.log(`✅ Servidor activo en http://localhost:${port}`);
});