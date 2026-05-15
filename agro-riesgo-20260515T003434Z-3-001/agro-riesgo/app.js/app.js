// ============================================================
// app.js  — Lógica principal de la aplicación AgroRiesgo
// ============================================================

// ── Estado global de la aplicación
const AppState = {
  zonas:         [],      // Lista de zonas dibujadas
  zonaActual:    null,    // Zona seleccionada actualmente
  zonaContador:  0,       // Contador para nombrar zonas
  cultivoActual: "trigo",
  layerActual:   "ndvi",
  analizando:    false,
};

// ── Referencias DOM
const dom = {
  panelEmpty:    document.getElementById("panel-empty"),
  panelResults:  document.getElementById("panel-results"),
  statusPill:    document.getElementById("status-pill"),
  statusDot:     document.querySelector(".status-dot"),
  statusText:    document.getElementById("status-text"),
  priceTicker:   document.getElementById("price-ticker"),
  loadingOverlay:document.getElementById("loading-overlay"),
  loadingText:   document.getElementById("loading-text"),
  btnAnalyze:    document.getElementById("btn-analyze"),
  btnClear:      document.getElementById("btn-clear"),
  btnDraw:       document.getElementById("btn-draw"),
  btnExport:     document.getElementById("btn-export"),
  cultivoSelect: document.getElementById("cultivo-select"),
  layerSelect:   document.getElementById("layer-select"),
};

// ====================================================
// MAPA — Inicialización con Leaflet
// ====================================================

// Centro inicial: Valle Central de Chile
const map = L.map("map", {
  center: [-34.5, -71.0],
  zoom: 9,
  zoomControl: true,
});

// Capas base
const capas = {
  satelite: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "© Esri", maxZoom: 19 }
  ),
  osm: L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { attribution: "© OpenStreetMap", maxZoom: 19 }
  ),
  topoChile: L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    { attribution: "© OpenTopoMap", maxZoom: 17 }
  ),
};

// Capa satélite por defecto
capas.satelite.addTo(map);

// Control de capas base
L.control.layers({
  "🛰️ Satélite": capas.satelite,
  "🗺️ OpenStreetMap": capas.osm,
  "🏔️ Topográfico": capas.topoChile,
}, {}, { position: "topright" }).addTo(map);

// ── FeatureGroup para polígonos dibujados
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// ── Control de dibujo de polígonos
const drawControl = new L.Control.Draw({
  position: "topleft",
  draw: {
    polygon: {
      allowIntersection: false,
      showArea: true,
      shapeOptions: {
        color: "#39d353",
        fillColor: "#39d353",
        fillOpacity: 0.15,
        weight: 2,
      },
    },
    rectangle: {
      shapeOptions: {
        color: "#58a6ff",
        fillColor: "#58a6ff",
        fillOpacity: 0.15,
        weight: 2,
      },
    },
    // Desactivar herramientas no necesarias
    circle:       false,
    circlemarker: false,
    marker:       false,
    polyline:     false,
  },
  edit: {
    featureGroup: drawnItems,
    remove: true,
  },
});
map.addControl(drawControl);

// ====================================================
// EVENTOS DEL MAPA
// ====================================================

// Cuando se termina de dibujar un polígono
map.on(L.Draw.Event.CREATED, (e) => {
  const layer = e.layer;
  AppState.zonaContador++;
  const zonaId = `Z-${String(AppState.zonaContador).padStart(2, "0")}`;

  layer.zonaId = zonaId;
  layer.bindTooltip(zonaId, {
    permanent: true,
    className: "zona-label",
    direction: "center",
  });

  drawnItems.addLayer(layer);

  // Guardar zona
  const coordenadas = layer.getLatLngs()[0].map(ll => [ll.lng, ll.lat]);
  const zona = {
    id:          zonaId,
    layer:       layer,
    coordenadas: coordenadas,
    cultivo:     AppState.cultivoActual,
    resultado:   null,
  };
  AppState.zonas.push(zona);
  AppState.zonaActual = zona;

  // Click en la zona para seleccionarla
  layer.on("click", () => seleccionarZona(zona));

  // Auto-analizar al dibujar
  analizarZonaActual();
});

// Cuando se elimina una capa
map.on(L.Draw.Event.DELETED, (e) => {
  e.layers.eachLayer(layer => {
    AppState.zonas = AppState.zonas.filter(z => z.layer !== layer);
  });
  if (AppState.zonas.length === 0) {
    AppState.zonaActual = null;
    mostrarPanelVacio();
  }
});

// ====================================================
// ANÁLISIS DE ZONA
// ====================================================

async function analizarZonaActual() {
  const zona = AppState.zonaActual;
  if (!zona || AppState.analizando) return;

  AppState.analizando = true;
  mostrarLoading("Consultando imágenes satelitales...");

  try {
    // 1. Obtener datos satelitales
    const satelital = await GEE.analizar({
      coordenadas: zona.coordenadas,
      cultivo:     zona.cultivo,
    });

    // 2. Calcular pérdidas económicas
    const economico = PreciosAgro.calcularPerdida({
      ndviActual:    satelital.ndvi_actual,
      ndviHistorico: satelital.ndvi_historico,
      areaHa:        satelital.area_ha,
      cultivo:       zona.cultivo,
    });

    // 3. Combinar resultados
    const resultado = {
      zona:                  zona.id,
      nivel_riesgo:          satelital.riesgo.nivel,
      recomendacion:         satelital.recomendacion,
      ndvi_actual:           satelital.ndvi_actual,
      ndvi_historico:        satelital.ndvi_historico,
      ndwi_actual:           satelital.ndwi_actual,
      ndwi_historico:        satelital.ndwi_historico,
      perdida_potencial_clp: economico.perdida_potencial_clp,
      costo_riego_clp:       economico.costo_riego_clp,
      perdida_evitada_clp:   economico.perdida_evitada_clp,
      merma_estimada:        economico.merma_estimada,
      area_ha:               satelital.area_ha,
      cultivo:               zona.cultivo,
      fuente_satelital:      satelital.fuente,
      fuente_precios:        economico.fuente,
      riesgo:                satelital.riesgo,
      timestamp:             satelital.timestamp,
    };

    zona.resultado = resultado;

    // 4. Actualizar color de polígono según riesgo
    actualizarColorZona(zona.layer, satelital.riesgo);

    // 5. Mostrar resultados en panel
    mostrarResultados(resultado);

  } catch (err) {
    console.error("[App] Error al analizar zona:", err);
    setStatus("error", "Error al consultar datos");
  } finally {
    AppState.analizando = false;
    ocultarLoading();
  }
}

function actualizarColorZona(layer, riesgo) {
  const colores = {
    normal:  "#58a6ff",
    bajo:    "#39d353",
    medio:   "#d29922",
    alto:    "#f85149",
    critico: "#ff0000",
  };
  const color = colores[riesgo.nivel] || "#39d353";
  layer.setStyle({
    color:       color,
    fillColor:   color,
    fillOpacity: 0.2,
    weight:      2.5,
  });
}

// ====================================================
// PANEL DE RESULTADOS
// ====================================================

function mostrarResultados(r) {
  dom.panelEmpty.style.display = "none";
  dom.panelResults.style.display = "flex";
  dom.panelResults.style.flexDirection = "column";
  dom.panelResults.style.gap = "8px";

  // Zona y riesgo
  document.getElementById("zone-badge").textContent = r.zona;
  
  const riskBadge = document.getElementById("risk-badge");
  riskBadge.textContent = r.nivel_riesgo.toUpperCase();
  riskBadge.className = `risk-badge ${r.nivel_riesgo}`;

  // Valores económicos
  document.getElementById("val-perdida-potencial").textContent =
    formatCLP(r.perdida_potencial_clp);
  document.getElementById("val-perdida-evitada").textContent =
    formatCLP(r.perdida_evitada_clp);
  document.getElementById("val-costo-riego").textContent =
    formatCLP(r.costo_riego_clp);
  document.getElementById("val-merma").textContent =
    r.merma_estimada + "%";

  // Índices satelitales con barras animadas
  actualizarIndice("ndvi-actual", r.ndvi_actual, "bar-ndvi-actual", "val-ndvi-actual");
  actualizarIndice("ndvi-hist",   r.ndvi_historico, "bar-ndvi-hist", "val-ndvi-historico");
  actualizarIndice("ndwi-actual", r.ndwi_actual, "bar-ndwi-actual", "val-ndwi-actual");
  actualizarIndice("ndwi-hist",   r.ndwi_historico, "bar-ndwi-hist", "val-ndwi-historico");

  // Recomendación
  document.getElementById("recommendation-box").textContent = r.recomendacion;
}

function actualizarIndice(id, valor, barId, valId) {
  const pct = Math.round(((valor + 1) / 2) * 100); // -1..1 → 0..100%
  const bar = document.getElementById(barId);
  const val = document.getElementById(valId);
  if (bar) bar.style.width = Math.max(2, pct) + "%";
  if (val) val.textContent = valor.toFixed(3);
}

function mostrarPanelVacio() {
  dom.panelEmpty.style.display = "flex";
  dom.panelResults.style.display = "none";
}

function seleccionarZona(zona) {
  AppState.zonaActual = zona;
  if (zona.resultado) {
    mostrarResultados(zona.resultado);
  } else {
    analizarZonaActual();
  }
}

// ====================================================
// UTILIDADES UI
// ====================================================

function formatCLP(valor) {
  if (!valor || valor === 0) return "$0";
  if (valor >= 1_000_000) {
    return `$${(valor / 1_000_000).toFixed(1)}M`;
  }
  return `$${valor.toLocaleString("es-CL")}`;
}

function mostrarLoading(texto = "Procesando...") {
  dom.loadingText.textContent = texto;
  dom.loadingOverlay.style.display = "flex";
}

function ocultarLoading() {
  dom.loadingOverlay.style.display = "none";
}

function setStatus(tipo, texto) {
  dom.statusText.textContent = texto;
  dom.statusDot.className = "status-dot " + tipo;
}

// ====================================================
// TICKER DE PRECIOS
// ====================================================

let tickerOffset = 0;
let tickerText   = "";

function animarTicker() {
  if (!tickerText) return;
  const el = dom.priceTicker;
  el.style.transition = "none";
  el.textContent = tickerText;
}

// ====================================================
// BOTONES Y CONTROLES
// ====================================================

dom.btnClear.addEventListener("click", () => {
  if (AppState.zonas.length === 0) return;
  if (!confirm("¿Eliminar todas las zonas?")) return;
  drawnItems.clearLayers();
  AppState.zonas = [];
  AppState.zonaActual = null;
  AppState.zonaContador = 0;
  mostrarPanelVacio();
});

dom.btnAnalyze.addEventListener("click", () => {
  if (AppState.zonaActual) {
    AppState.zonaActual.resultado = null; // forzar re-análisis
    analizarZonaActual();
  }
});

dom.cultivoSelect.addEventListener("change", (e) => {
  AppState.cultivoActual = e.target.value;
  if (AppState.zonaActual) {
    AppState.zonaActual.cultivo = e.target.value;
  }
});

dom.layerSelect.addEventListener("change", (e) => {
  AppState.layerActual = e.target.value;
  const legend = document.getElementById("map-legend");
  const bar = legend.querySelector(".legend-bar");
  const title = legend.querySelector(".legend-title");

  if (e.target.value === "ndwi") {
    bar.className = "legend-bar ndwi-bar";
    title.textContent = "NDWI";
  } else {
    bar.className = "legend-bar ndvi-bar";
    title.textContent = "NDVI";
  }
});

dom.btnExport.addEventListener("click", () => {
  const zona = AppState.zonaActual;
  if (!zona?.resultado) return;
  const r = zona.resultado;

  const texto = `
AgroRiesgo · Reporte de Zona
==============================
Zona:              ${r.zona}
Cultivo:           ${r.cultivo}
Nivel de riesgo:   ${r.nivel_riesgo.toUpperCase()}
Área:              ${r.area_ha} ha

ÍNDICES SATELITALES
NDVI actual:       ${r.ndvi_actual}
NDVI histórico:    ${r.ndvi_historico}
NDWI actual:       ${r.ndwi_actual}
NDWI histórico:    ${r.ndwi_historico}

ESTIMACIONES ECONÓMICAS (CLP)
Pérdida potencial: $${r.perdida_potencial_clp?.toLocaleString("es-CL")}
Pérdida evitada:   $${r.perdida_evitada_clp?.toLocaleString("es-CL")}
Costo de riego:    $${r.costo_riego_clp?.toLocaleString("es-CL")}
Merma estimada:    ${r.merma_estimada}%

RECOMENDACIÓN
${r.recomendacion}

Fuente satelital:  ${r.fuente_satelital}
Fuente precios:    ${r.fuente_precios}
Generado:          ${new Date(r.timestamp).toLocaleString("es-CL")}

⚠️ ESTIMACIÓN ÚNICAMENTE — No reemplaza análisis agronómico profesional.
  `.trim();

  navigator.clipboard.writeText(texto).then(() => {
    dom.btnExport.textContent = "✅ Copiado al portapapeles";
    setTimeout(() => { dom.btnExport.textContent = "📋 Copiar resumen"; }, 2500);
  });
});

// ====================================================
// INICIALIZACIÓN
// ====================================================

async function init() {
  setStatus("", "Iniciando...");

  try {
    // 1. Inicializar módulo de precios
    await PreciosAgro.init();
    
    // 2. Actualizar ticker
    tickerText = PreciosAgro.getTickerText();
    animarTicker();

    // Listener de cambio de precios
    PreciosAgro.onChange(() => {
      tickerText = PreciosAgro.getTickerText();
      animarTicker();
    });

    // 3. Estado final
    const modoDemo = GEE.esModoDemo();
    setStatus("online", modoDemo ? "Demo activo · GEE sin conectar" : "En línea · GEE conectado");
    dom.statusDot.classList.add("online");

    console.info(`
╔════════════════════════════════════════╗
║         AgroRiesgo · Listo             ║
╠════════════════════════════════════════╣
║  Modo GEE:    ${modoDemo ? "DEMO (sin credenciales)" : "REAL (conectado)    "}  ║
║  Para datos reales:                    ║
║  1. Obtén credenciales GEE             ║
║  2. Edita CONFIG en gee.js             ║
║  3. Cambia modoDemo: false             ║
╚════════════════════════════════════════╝
    `);

  } catch (err) {
    console.error("[App] Error de inicialización:", err);
    setStatus("error", "Error de inicio");
  }
}

// Arrancar cuando DOM esté listo
document.addEventListener("DOMContentLoaded", init);

// Atajo de teclado: Enter para analizar zona actual
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && AppState.zonaActual) {
    analizarZonaActual();
  }
});
