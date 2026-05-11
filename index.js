
require("dotenv").config();

const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

// =====================================================
// CONEXIÓN
// =====================================================
(async () => {
  try {

    const c = await pool.connect();

    console.log("✅ Conectado a PostgreSQL");

    c.release();

  } catch (e) {

    console.error("❌ Error conexión:", e.message);
  }
})();

// =====================================================
// VIAJES EN MEMORIA
// =====================================================
const sesionesViaje = {};

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

// =====================================================
// VIAJE ACTIVO
// =====================================================
app.get("/api/viaje-activo", async (req, res) => {

  try {

    const viajeActivo = Object.keys(sesionesViaje)
      .find(nombre => sesionesViaje[nombre]?.activa === true);

    if (!viajeActivo) {

      return res.json({
        ok: false,
        error: "No hay viaje activo"
      });
    }

    return res.json({
      ok: true,
      viaje: viajeActivo
    });

  } catch (err) {

    console.error(err);

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

    return res.json({
      ok: true,
      data: {
        nombre,
        activa: true
      }
    });

  } catch (err) {

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

    return res.json({
      ok: true
    });

  } catch (err) {

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
        ok: false,
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
      ON CONFLICT (barcode) DO NOTHING
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

    console.error(err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// RESUMEN VIAJE
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

    const row = r.rows[0];

    return res.json({
      ok: true,
      viaje: {
        nombre,
        activa: true
      },
      resumen: {
        total: Number(row.total || 0),
        ok: Number(row.total || 0),
        duplicados: 0,
        errores: 0
      }
    });

  } catch (err) {

    console.error(err);

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

    console.error(err);

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
        created_at
      FROM registros
      WHERE viaje = $1
      ORDER BY created_at DESC
      LIMIT 1000
    `;

    const r = await pool.query(q, [nombre]);

    return res.json({
      ok: true,
      data: r.rows
    });

  } catch (err) {

    console.error(err);

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

    const fid = String(req.body.fid || "").trim();
    const bloque = String(req.body.bloque || "").trim();
    const etapa = String(req.body.etapa || "Ingreso").trim();
    const form = String(req.body.form || "fin_corte").trim();

    const seleccion = String(
      req.body.seleccion || ""
    ).trim();

    const tallosNum = parseInt(
      req.body.tallos || "0",
      10
    );

    if (!fid || !bloque || !seleccion || !tallosNum) {

      return res.status(400).send(
        "Datos incompletos"
      );
    }

    const viajeActivo = Object.keys(sesionesViaje)
  .find(nombre => sesionesViaje[nombre]?.activa === true);

if (!viajeActivo) {

  return res.status(400).send(
    "No hay viaje activo"
  );
}


    let variedad = seleccion;
    let tamano = null;

    if (seleccion.includes("|")) {

      const parts = seleccion.split("|");

      variedad = parts[0];

      tamano = parts[1] || null;

      if (tamano === "na") {
        tamano = null;
      }
    }

    const barcode = `99${Date.now()}`;

    const tipo = "99";

    const serial = String(Date.now());

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

      return res.send(
        "YA REGISTRADO"
      );
    }

    return res.send(`
      <h1>✅ Registro exitoso</h1>
      <p>Viaje: ${viajeActivo}</p>
    `);

  } catch (err) {

    console.error(err);

    return res.status(500).send(err.message);
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
      total: r.rows[0].total
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

  console.log(
    `✅ Servidor activo en puerto ${port}`
  );
});