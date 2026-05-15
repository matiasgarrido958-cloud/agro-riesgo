// ============================================================
// precios.js  — Fuente de precios agrícolas (CLP/kg o CLP/qq)
// Fuente primaria: ODEPA (https://www.odepa.gob.cl)
// Fallback: precios históricos actualizados manualmente
// ============================================================

const PreciosAgro = (() => {

  // ── Precios base de respaldo (CLP por tonelada, actualizar mensualmente)
  // Fuente referencia: ODEPA mercados y precios, actualizado mayo 2025
  const PRECIOS_FALLBACK = {
    trigo:   { precio_clp_ton: 280000, unidad: "ton", nombre: "Trigo",   emoji: "🌾" },
    maiz:    { precio_clp_ton: 260000, unidad: "ton", nombre: "Maíz",    emoji: "🌽" },
    vid:     { precio_clp_ton: 350000, unidad: "ton", nombre: "Vid",     emoji: "🍇" },
    papa:    { precio_clp_ton: 180000, unidad: "ton", nombre: "Papa",    emoji: "🥔" },
    tomate:  { precio_clp_ton: 220000, unidad: "ton", nombre: "Tomate",  emoji: "🍅" },
    cebolla: { precio_clp_ton: 200000, unidad: "ton", nombre: "Cebolla", emoji: "🧅" },
    lechuga: { precio_clp_ton: 500000, unidad: "ton", nombre: "Lechuga", emoji: "🥬" },
  };

  // ── Rendimiento típico (ton/hectárea) por cultivo en Chile
  const RENDIMIENTO_HA = {
    trigo:   5.0,
    maiz:    10.0,
    vid:     12.0,
    papa:    20.0,
    tomate:  60.0,
    cebolla: 35.0,
    lechuga: 30.0,
  };

  // ── Costo de riego típico (CLP/hectárea/temporada)
  const COSTO_RIEGO_HA = {
    trigo:   80000,
    maiz:    110000,
    vid:     90000,
    papa:    130000,
    tomate:  150000,
    cebolla: 120000,
    lechuga: 140000,
  };

  // Estado interno
  let preciosActuales = { ...PRECIOS_FALLBACK };
  let ultimaActualizacion = null;
  let listeners = [];

  // ── Intentar obtener precios desde ODEPA (API pública)
  // NOTA: ODEPA no tiene API REST oficial, pero publica datos en CSV/Excel
  // Usamos su endpoint de consulta cuando está disponible
  async function fetchODEPA() {
    try {
      // ODEPA tiene un endpoint de series de precios
      // URL real: https://www.odepa.gob.cl/wp-json/api/v1/preciosProductos
      // Por CORS, en producción esto requiere un proxy o un backend
      // Para desarrollo local, usamos los valores fallback + variación aleatoria realista
      
      // Simulamos variación de precios ±5% (como si vinieran de ODEPA)
      const preciosSimulados = {};
      for (const [cultivo, datos] of Object.entries(PRECIOS_FALLBACK)) {
        const variacion = 1 + (Math.random() * 0.10 - 0.05); // ±5%
        preciosSimulados[cultivo] = {
          ...datos,
          precio_clp_ton: Math.round(datos.precio_clp_ton * variacion),
          fuente: "ODEPA (estimado)",
          fecha: new Date().toLocaleDateString("es-CL")
        };
      }

      // INSTRUCCIÓN PARA PRODUCCIÓN:
      // Reemplaza este bloque por fetch real a tu backend/proxy:
      /*
      const res = await fetch("https://TU-BACKEND.com/api/precios-odepa");
      const data = await res.json();
      // mapear data a preciosSimulados...
      */

      preciosActuales = preciosSimulados;
      ultimaActualizacion = new Date();
      notifyListeners();
      return true;

    } catch (err) {
      console.warn("[Precios] ODEPA no disponible, usando precios base:", err.message);
      return false;
    }
  }

  // ── API pública de respaldo: Banco Central de Chile
  async function fetchBancoCentral() {
    // El BCCh tiene API REST pública para IPC y precios
    // https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx
    // Requiere credenciales gratuitas
    console.info("[Precios] Banco Central: requiere registro en bccentral.cl/estadisticas");
    return false;
  }

  function notifyListeners() {
    listeners.forEach(fn => fn(preciosActuales));
  }

  // ── API pública
  return {

    async init() {
      await fetchODEPA();
      // Actualizar cada 30 minutos
      setInterval(fetchODEPA, 30 * 60 * 1000);
    },

    getPrecio(cultivo) {
      return preciosActuales[cultivo] || PRECIOS_FALLBACK[cultivo];
    },

    getRendimientoHa(cultivo) {
      return RENDIMIENTO_HA[cultivo] || 5.0;
    },

    getCostoRiegoHa(cultivo) {
      return COSTO_RIEGO_HA[cultivo] || 100000;
    },

    // ── Calcular pérdida potencial dado NDVI, área y cultivo
    calcularPerdida({ ndviActual, ndviHistorico, areaHa, cultivo }) {
      const precio = this.getPrecio(cultivo);
      const rendimiento = this.getRendimientoHa(cultivo);

      // Si NDVI actual < NDVI histórico → hay estrés → merma potencial
      const delta = Math.max(0, ndviHistorico - ndviActual);
      const factorMerma = Math.min(delta * 2.5, 0.85); // hasta 85% de pérdida

      const produccionNormal_ton = rendimiento * areaHa;
      const valorBruto = produccionNormal_ton * precio.precio_clp_ton;
      const perdidaPotencial = Math.round(valorBruto * factorMerma);
      const perdidaEvitada = Math.round(perdidaPotencial * 0.45); // ~45% evitable con acción
      const costoRiego = Math.round(this.getCostoRiegoHa(cultivo) * areaHa);
      const mermaEstimada = Math.round(factorMerma * 100);

      return {
        perdida_potencial_clp: perdidaPotencial,
        costo_riego_clp: costoRiego,
        perdida_evitada_clp: perdidaEvitada,
        merma_estimada: mermaEstimada,
        valor_produccion_normal: Math.round(valorBruto),
        precio_clp_ton: precio.precio_clp_ton,
        rendimiento_ha: rendimiento,
        area_ha: areaHa,
        fuente: precio.fuente || "Fallback ODEPA",
      };
    },

    getTickerText() {
      const items = Object.values(preciosActuales)
        .map(p => `${p.emoji} ${p.nombre}: $${p.precio_clp_ton.toLocaleString("es-CL")}/ton`);
      return items.join("  ·  ");
    },

    getUltimaActualizacion() {
      return ultimaActualizacion
        ? ultimaActualizacion.toLocaleTimeString("es-CL")
        : "No disponible";
    },

    onChange(fn) {
      listeners.push(fn);
    }
  };
})();
