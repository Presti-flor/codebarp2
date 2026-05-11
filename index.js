require("dotenv").config();

const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.use(express.urlencoded({
  extended: true
}));

app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

// =====================================================
// CONEXIÓN Y TABLA DE ESTADO
// =====================================================
(async () => {
  try {
    const c = await pool.connect();

    console.log("✅ Conectado a PostgreSQL");

    c.release();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sistema_estado (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      INSERT INTO sistema_estado (clave, valor, updated_at)
      VALUES ('viaje_activo', 'Viaje 1', NOW())
      ON CONFLICT (clave)
      DO NOTHING
    `);

    console.log("✅ sistema_estado verificado");

  } catch (e) {
    console.error("❌ Error conexión/configuración:", e.message);
  }
})();

// =====================================================
// VIAJES EN MEMORIA
// =====================================================
const sesionesViaje = {};

sesionesViaje["Viaje 1"] = {
  activa: true
};

function getViajesFijos() {
  return Array.from(
    { length: 20 },
    (_, i) => `Viaje ${i + 1}`
  );
}

function asegurarViaje(nombre) {
  if (!sesionesViaje[nombre]) {
    sesionesViaje[nombre] = {
      activa: true
    };
  }

  return sesionesViaje[nombre];
}

// =====================================================
// HELPERS
// =====================================================
function parseCode(codeRaw) {
  const code = String(codeRaw || "").trim();

  if (!/^\d+$/.test(code)) {
    throw new Error("Barcode inválido");
  }

  const tipo = code.slice(0, 2);
  const serial = code.slice(2);

  return {
    barcode: code,
    tipo,
    serial
  };
}

function limpiarTamano(tamano) {
  const value = String(tamano || "").trim();

  if (!value) return null;
  if (value.toLowerCase() === "na") return null;

  return value;
}

// =====================================================
// VIAJE ACTIVO DESDE POSTGRESQL
// =====================================================
app.get("/api/viaje-activo", async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT valor
      FROM sistema_estado
      WHERE clave = 'viaje_activo'
      LIMIT 1
    `);

    if (!r.rows.length) {
      return res.json({
        ok: false,
        error: "No hay viaje activo"
      });
    }

    return res.json({
      ok: true,
      viaje: r.rows[0].valor
    });

  } catch (err) {
    console.error("❌ /api/viaje-activo:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// ACTIVAR VIAJE POR NAVEGADOR - TEMPORAL
// Ejemplo: /api/activar-viaje/Viaje%201
// =====================================================
app.get("/api/activar-viaje/:nombre", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre || "").trim();

    if (!nombre) {
      return res.status(400).json({
        ok: false,
        error: "Falta nombre del viaje"
      });
    }

    Object.keys(sesionesViaje).forEach(v => {
      sesionesViaje[v].activa = false;
    });

    asegurarViaje(nombre).activa = true;

    await pool.query(`
      INSERT INTO sistema_estado (clave, valor, updated_at)
      VALUES ('viaje_activo', $1, NOW())
      ON CONFLICT (clave)
      DO UPDATE SET
        valor = EXCLUDED.valor,
        updated_at = NOW()
    `, [nombre]);

    return res.json({
      ok: true,
      mensaje: "Viaje activado",
      viaje: nombre
    });

  } catch (err) {
    console.error("❌ /api/activar-viaje:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// VIAJES
// =====================================================
app.get("/api/viajes", async (_req, res) => {
  return res.json({
    ok: true,
    data: getViajesFijos()
  });
});

app.post("/api/viajes/activar", async (req, res) => {
  try {
    const nombre = String(req.body.nombre || "").trim();

    if (!nombre) {
      return res.status(400).json({
        ok: false,
        error: "Falta nombre"
      });
    }

    Object.keys(sesionesViaje).forEach(v => {
      sesionesViaje[v].activa = false;
    });

    asegurarViaje(nombre).activa = true;

    await pool.query(`
      INSERT INTO sistema_estado (clave, valor, updated_at)
      VALUES ('viaje_activo', $1, NOW())
      ON CONFLICT (clave)
      DO UPDATE SET
        valor = EXCLUDED.valor,
        updated_at = NOW()
    `, [nombre]);

    return res.json({
      ok: true,
      data: {
        nombre,
        activa: true
      }
    });

  } catch (err) {
    console.error("❌ /api/viajes/activar:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.post("/api/viajes/finalizar", async (req, res) => {
  try {
    const nombre = String(req.body.nombre || "").trim();

    if (!nombre || !sesionesViaje[nombre]) {
      return res.status(404).json({
        ok: false,
        error: "Viaje no encontrado"
      });
    }

    sesionesViaje[nombre].activa = false;

    const viajeActivo = await pool.query(`
      SELECT valor
      FROM sistema_estado
      WHERE clave = 'viaje_activo'
      LIMIT 1
    `);

    if (viajeActivo.rows[0]?.valor === nombre) {
      await pool.query(`
        DELETE FROM sistema_estado
        WHERE clave = 'viaje_activo'
      `);
    }

    return res.json({
      ok: true,
      data: {
        nombre,
        activa: false
      }
    });

  } catch (err) {
    console.error("❌ /api/viajes/finalizar:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// ESCANEO PRINCIPAL
// =====================================================
app.post("/api/escanear", async (req, res) => {
  try {
    const viajeNombre = String(req.body.viaje || "").trim();
    const codeInput = String(req.body.barcode || "").trim();

    if (!viajeNombre) {
      return res.status(400).json({
        ok: false,
        error: "Debes seleccionar un viaje"
      });
    }

    asegurarViaje(viajeNombre);

    await pool.query(`
      INSERT INTO sistema_estado (clave, valor, updated_at)
      VALUES ('viaje_activo', $1, NOW())
      ON CONFLICT (clave)
      DO UPDATE SET
        valor = EXCLUDED.valor,
        updated_at = NOW()
    `, [viajeNombre]);

    const {
      barcode,
      tipo,
      serial
    } = parseCode(codeInput);

    const tipoRow = await pool.query(
      `
      SELECT
        tipo,
        variedad,
        bloque,
        tamano,
        tallos
      FROM tipos_variedad
      WHERE tipo = $1
      LIMIT 1
      `,
      [tipo]
    );

    if (!tipoRow.rowCount) {
      return res.json({
        ok: true,
        resultado: "NO_EXISTE",
        error: "Tipo no existe"
      });
    }

    const t = tipoRow.rows[0];

    const insert = await pool.query(
      `
      INSERT INTO registros (
        barcode,
        tipo,
        serial,
        variedad,
        bloque,
        tamano,
        tallos,
        etapa,
        viaje
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9
      )
      ON CONFLICT (barcode)
      DO NOTHING
      RETURNING barcode
      `,
      [
        barcode,
        tipo,
        serial,
        t.variedad,
        t.bloque,
        t.tamano,
        t.tallos,
        "Ingreso",
        viajeNombre
      ]
    );

    if (!insert.rowCount) {
      return res.json({
        ok: true,
        resultado: "YA_REGISTRADO"
      });
    }

    return res.json({
      ok: true,
      resultado: "OK"
    });

  } catch (err) {
    console.error("❌ /api/escanear:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// RESUMEN VIAJE
// Compatible con frontend antiguo: devuelve resumen y sesionActual.
// =====================================================
app.get("/api/viajes/:nombre/resumen", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);

    const q = `
      SELECT
        COUNT(*) AS total
      FROM registros
      WHERE viaje = $1
    `;

    const r = await pool.query(q, [nombre]);
    const total = Number(r.rows[0]?.total || 0);

    return res.json({
      ok: true,
      viaje: {
        nombre,
        activa: true
      },
      resumen: {
        total,
        ok: total,
        duplicados: 0,
        errores: 0
      },
      sesionActual: {
        ok: total,
        reregistrados: 0,
        duplicados: 0,
        errores: 0
      }
    });

  } catch (err) {
    console.error("❌ /api/viajes/:nombre/resumen:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// RESUMEN BD
// =====================================================
app.get("/api/viajes/:nombre/resumen-db", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);

    const q = `
      SELECT
        COUNT(*) AS ok
      FROM registros
      WHERE viaje = $1
    `;

    const r = await pool.query(q, [nombre]);

    return res.json({
      ok: true,
      data: {
        ok: Number(r.rows[0]?.ok || 0),
        reregistrados: 0
      }
    });

  } catch (err) {
    console.error("❌ /api/viajes/:nombre/resumen-db:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// PIVOT VIAJE
// =====================================================
app.get("/api/viajes/:nombre/pivot", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);

    const q = `
      SELECT
        bloque,
        variedad,
        tamano,
        tallos,
        etapa,
        COUNT(*) AS tabacos,
        SUM(COALESCE(tallos,0)) AS suma_tallos
      FROM registros
      WHERE viaje = $1
      GROUP BY
        bloque,
        variedad,
        tamano,
        tallos,
        etapa
      ORDER BY
        bloque ASC,
        variedad ASC
    `;

    const r = await pool.query(q, [nombre]);

    const data = r.rows.map(row => ({
      bloque: row.bloque ?? "",
      variedad: row.variedad ?? "",
      tamano: row.tamano ?? "",
      tallos: row.tallos ?? "",
      etapa: row.etapa ?? "",
      tabacos: Number(row.tabacos || 0),
      suma_tallos: Number(row.suma_tallos || 0)
    }));

    return res.json({
      ok: true,
      data
    });

  } catch (err) {
    console.error("❌ /api/viajes/:nombre/pivot:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// DETALLE VIAJE
// =====================================================
app.get("/api/viajes/:nombre/detalle", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);

    const q = `
      SELECT
        barcode,
        tipo,
        serial,
        variedad,
        bloque,
        tamano,
        tallos,
        etapa,
        form_id,
        form,
        barcode_origen,
        es_reregistro,
        created_at,
        viaje
      FROM registros
      WHERE viaje = $1
      ORDER BY created_at DESC
      LIMIT 1000
    `;

    const r = await pool.query(q, [nombre]);

    const data = r.rows.map(row => ({
      fecha: row.created_at,
      barcode: row.barcode,
      tipo: row.tipo,
      serial: row.serial,
      variedad: row.variedad,
      bloque: row.bloque,
      tamano: row.tamano,
      tallos: row.tallos,
      etapa: row.etapa,
      form_id: row.form_id,
      form: row.form,
      barcode_origen: row.barcode_origen,
      es_reregistro: row.es_reregistro,
      viaje: row.viaje,
      resultado: "OK",
      observacion: ""
    }));

    return res.json({
      ok: true,
      data
    });

  } catch (err) {
    console.error("❌ /api/viajes/:nombre/detalle:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// SUBMIT FORMULARIO
// =====================================================
app.post("/submit", async (req, res) => {
  try {
    const body = req.body || {};

    const fid = String(body.fid || "").trim();
    const bloque = String(body.bloque || "").trim();
    const etapa = String(body.etapa || "Ingreso").trim();
    const form = String(body.form || "fin_corte").trim();
    const seleccion = String(body.seleccion || "").trim();

    const tallosNum = parseInt(
      body.tallos || "0",
      10
    );

    if (!fid || !bloque || !seleccion || !tallosNum) {
      return res.status(400).send("Datos incompletos");
    }

    const viajeActivoRes = await pool.query(`
      SELECT valor
      FROM sistema_estado
      WHERE clave = 'viaje_activo'
      LIMIT 1
    `);

    if (!viajeActivoRes.rows.length) {
      return res.status(400).send("No hay viaje activo");
    }

    const viajeActivo = viajeActivoRes.rows[0].valor;

    let variedad = seleccion;
    let tamano = null;

    if (seleccion.includes("|")) {
      const parts = seleccion.split("|");

      variedad = parts[0] || "";
      tamano = limpiarTamano(parts[1]);
    }

    const now = Date.now();
    const barcode = `99${now}`;
    const tipo = "99";
    const serial = String(now);

    const q = `
      INSERT INTO registros (
        barcode,
        tipo,
        serial,
        variedad,
        bloque,
        tamano,
        tallos,
        etapa,
        form,
        form_id,
        viaje
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
      )
      ON CONFLICT (form_id)
      DO NOTHING
      RETURNING barcode
    `;

    const r = await pool.query(q, [
      barcode,
      tipo,
      serial,
      variedad,
      bloque,
      tamano,
      tallosNum,
      etapa,
      form,
      fid,
      viajeActivo
    ]);

    if (!r.rowCount) {
      return res.send(`
        <h1>YA REGISTRADO</h1>
        <p>Esta etiqueta ya fue usada.</p>
      `);
    }

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
        background:#ecfdf5;
        font-family:system-ui,Arial,sans-serif;
        padding:18px;
      ">
        <div style="
          background:white;
          border-radius:24px;
          padding:32px;
          max-width:520px;
          width:100%;
          text-align:center;
          box-shadow:0 20px 50px rgba(0,0,0,.15);
        ">
          <div style="
            width:90px;
            height:90px;
            border-radius:50%;
            background:#16a34a;
            color:white;
            display:flex;
            align-items:center;
            justify-content:center;
            font-size:3rem;
            margin:0 auto 16px;
          ">✓</div>

          <h1 style="color:#14532d;">REGISTRO EXITOSO</h1>

          <p><strong>Viaje:</strong> ${viajeActivo}</p>
          <p><strong>Bloque:</strong> ${bloque}</p>
          <p><strong>Variedad:</strong> ${variedad}</p>
          <p><strong>Tamaño:</strong> ${tamano || "No aplica"}</p>
          <p><strong>Tallos:</strong> ${tallosNum}</p>

          <p style="margin-top:18px;color:#065f46;">
            El tabaco fue sumado al viaje actual.
          </p>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    console.error("❌ /submit:", err);

    return res.status(500).send(err.message);
  }
});

// =====================================================
// CONTADOR GENERAL
// =====================================================
app.get("/api/contador-general", async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) AS total,
        SUM(COALESCE(tallos,0)) AS total_tallos
      FROM registros
    `);

    return res.json({
      ok: true,
      total: Number(r.rows[0]?.total || 0),
      total_tallos: Number(r.rows[0]?.total_tallos || 0)
    });

  } catch (err) {
    console.error("❌ /api/contador-general:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// Compatibilidad con app.js antiguo
app.get("/api/general/contador", async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) AS total,
        SUM(COALESCE(tallos,0)) AS total_tallos
      FROM registros
    `);

    return res.json({
      ok: true,
      total: Number(r.rows[0]?.total || 0),
      total_tallos: Number(r.rows[0]?.total_tallos || 0)
    });

  } catch (err) {
    console.error("❌ /api/general/contador:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// CONSULTA BARCODE
// =====================================================
app.get("/api/registro/:barcode", async (req, res) => {
  try {
    const barcode = String(req.params.barcode || "").trim();

    const r = await pool.query(
      `
      SELECT
        barcode,
        tipo,
        serial,
        variedad,
        bloque,
        tamano,
        tallos,
        created_at,
        etapa,
        form_id,
        form,
        viaje
      FROM registros
      WHERE barcode = $1
      LIMIT 1
      `,
      [barcode]
    );

    return res.json({
      ok: true,
      data: r.rows[0] || null
    });

  } catch (err) {
    console.error("❌ /api/registro/:barcode:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// TEST
// =====================================================
app.get("/api/test", async (_req, res) => {
  try {
    const r = await pool.query(
      "SELECT COUNT(*) AS total FROM registros"
    );

    return res.json({
      ok: true,
      total: Number(r.rows[0]?.total || 0)
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// START
// =====================================================
app.listen(port, () => {
  console.log(`✅ Servidor activo en puerto ${port}`);
});