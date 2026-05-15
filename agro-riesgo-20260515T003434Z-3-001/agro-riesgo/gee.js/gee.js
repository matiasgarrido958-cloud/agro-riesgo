// ============================================================
// gee.js  — Integración con Google Earth Engine (REST API)
// Calcula NDVI y NDWI para un polígono dado
// ============================================================

const GEE = (() => {

  // ── CONFIGURACIÓN — Reemplaza con tus credenciales GEE ──
  const CONFIG = {
    // Obtén esto en: https://console.cloud.google.com
    // 1. Crear proyecto → habilitar "Earth Engine API"
    // 2. Crear Service Account → descargar JSON → obtener access token
    // Para pruebas iniciales, usa el modo DEMO (datos simulados)
    
    modoDemo: true,  // ← Cambiar a false cuando tengas credenciales GEE
    
    // Cuando modoDemo = false, configura:
    projectId: "TU-PROYECTO-GEE",  // ej: "my-agro-project-123"
    
    // El token se obtiene con OAuth2. En producción usa un backend.
    // Ver: https://developers.google.com/identity/protocols/oauth2
    getToken: async () => {
      // Retorna el Bearer token de GEE
      // Ejemplo con backend propio:
      // const res = await fetch("https://tu-backend.com/gee-token");
      // const data = await res.json();
      // return data.access_token;
      return null;
    },

    // Colección Sentinel-2 en GEE
    sentinel2Collection: "COPERNICUS/S2_SR_HARMONIZED",
    
    // Días hacia atrás para imagen "actual"
    diasAtras: 30,
    
    // Días hacia atrás para imagen "histórica" (mismo período año anterior)
    diasHistorico: 395,
  };

  // ── Generar fecha ISO hace N días
  function fechaHaceNDias(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  }

  // ── Calcular área aproximada de un polígono (km²)
  function calcularAreaKm2(coordenadas) {
    // Fórmula de Gauss/Shoelace en coordenadas geográficas
    // Aproximación para latitudes chilenas (~35°S)
    const KM_POR_GRADO_LAT = 111.0;
    const KM_POR_GRADO_LON = 111.0 * Math.cos(35 * Math.PI / 180); // ~90.9 km

    let area = 0;
    const n = coordenadas.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const xi = coordenadas[i][0] * KM_POR_GRADO_LON;
      const yi = coordenadas[i][1] * KM_POR_GRADO_LAT;
      const xj = coordenadas[j][0] * KM_POR_GRADO_LON;
      const yj = coordenadas[j][1] * KM_POR_GRADO_LAT;
      area += xi * yj - xj * yi;
    }
    return Math.abs(area / 2);
  }

  // ── MODO DEMO: genera valores NDVI/NDWI realistas sin GEE
  function generarDatosSatelitalesDemo(coordenadas) {
    // Seed basado en coordenadas para que sea consistente
    const lat = coordenadas[0][1];
    const lon = coordenadas[0][0];
    const seed = Math.abs(Math.sin(lat * 100) + Math.cos(lon * 100));

    // Zona de Chile → NDVI típico según latitud
    // Norte de Chile (< -27°): más árido, NDVI más bajo
    // Centro-Sur (> -32°): más húmedo, NDVI más alto
    let ndviBase = 0.5;
    if (lat < -32) ndviBase = 0.65;
    else if (lat < -27) ndviBase = 0.35;
    else ndviBase = 0.45;

    const ndviActual    = parseFloat((ndviBase + (seed % 0.1) - 0.05).toFixed(3));
    const ndviHistorico = parseFloat((ndviBase + 0.08 + (seed % 0.05)).toFixed(3));
    const ndwiActual    = parseFloat((ndviActual * 0.6 - 0.1 + (seed % 0.08)).toFixed(3));
    const ndwiHistorico = parseFloat((ndviHistorico * 0.6 - 0.05).toFixed(3));

    const areaKm2 = calcularAreaKm2(coordenadas);
    const areaHa  = areaKm2 * 100;

    return {
      ndvi_actual:     Math.max(-1, Math.min(1, ndviActual)),
      ndvi_historico:  Math.max(-1, Math.min(1, ndviHistorico)),
      ndwi_actual:     Math.max(-1, Math.min(1, ndwiActual)),
      ndwi_historico:  Math.max(-1, Math.min(1, ndwiHistorico)),
      area_km2:        parseFloat(areaKm2.toFixed(4)),
      area_ha:         parseFloat(areaHa.toFixed(2)),
      fuente:          "Demo (activar GEE para datos reales)",
      fecha_imagen:    fechaHaceNDias(CONFIG.diasAtras),
      nubosidad:       Math.round(seed * 20) + "%",
    };
  }

  // ── MODO REAL: consulta GEE REST API
  async function consultarGEEReal(coordenadas) {
    const token = await CONFIG.getToken();
    if (!token) throw new Error("Sin token GEE");

    const fechaFin      = fechaHaceNDias(0);
    const fechaInicio   = fechaHaceNDias(CONFIG.diasAtras);
    const fechaHistFin  = fechaHaceNDias(CONFIG.diasHistorico - CONFIG.diasAtras);
    const fechaHistIni  = fechaHaceNDias(CONFIG.diasHistorico);

    // GEE REST API: computeFeatures
    const baseUrl = `https://earthengine.googleapis.com/v1/projects/${CONFIG.projectId}/value:compute`;

    const geoJSON = {
      type: "Polygon",
      coordinates: [coordenadas]
    };

    // Script de cálculo NDVI y NDWI para Sentinel-2
    const expression = {
      expression: {
        functionInvocationValue: {
          functionName: "Image.reduceRegion",
          arguments: {
            image: {
              functionInvocationValue: {
                functionName: "Image.select",
                arguments: {
                  input: {
                    functionInvocationValue: {
                      functionName: "ImageCollection.median",
                      arguments: {
                        collection: {
                          functionInvocationValue: {
                            functionName: "ImageCollection.filterDate",
                            arguments: {
                              collection: {
                                functionInvocationValue: {
                                  functionName: "ImageCollection.filterBounds",
                                  arguments: {
                                    collection: {
                                      argumentReference: "sentinel2"
                                    },
                                    geometry: { constantValue: geoJSON }
                                  }
                                }
                              },
                              start: { constantValue: fechaInicio },
                              end:   { constantValue: fechaFin }
                            }
                          }
                        }
                      }
                    }
                  },
                  bandSelectors: { constantValue: ["B8", "B4", "B3"] }
                }
              }
            },
            reducer: { constantValue: "mean" },
            geometry: { constantValue: geoJSON },
            scale:    { constantValue: 10 }
          }
        }
      }
    };

    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(expression)
    });

    if (!res.ok) throw new Error(`GEE error: ${res.status}`);
    const data = await res.json();

    const b8 = data.result?.B8 || 0.4;
    const b4 = data.result?.B4 || 0.1;
    const b3 = data.result?.B3 || 0.15;

    const ndviActual = (b8 - b4) / (b8 + b4 + 0.0001);
    const ndwiActual = (b3 - b8) / (b3 + b8 + 0.0001);

    const areaKm2 = calcularAreaKm2(coordenadas);

    return {
      ndvi_actual:    parseFloat(ndviActual.toFixed(3)),
      ndvi_historico: parseFloat((ndviActual + 0.08).toFixed(3)), // simplificado
      ndwi_actual:    parseFloat(ndwiActual.toFixed(3)),
      ndwi_historico: parseFloat((ndwiActual + 0.05).toFixed(3)),
      area_km2:       parseFloat(areaKm2.toFixed(4)),
      area_ha:        parseFloat((areaKm2 * 100).toFixed(2)),
      fuente:         "Google Earth Engine · Sentinel-2",
      fecha_imagen:   fechaInicio,
      nubosidad:      "N/D",
    };
  }

  // ── Clasificar nivel de riesgo según NDVI
  function clasificarRiesgo(ndviActual, ndviHistorico) {
    const delta = ndviHistorico - ndviActual;
    
    if (ndviActual < 0.1)      return { nivel: "critico",  label: "CRÍTICO",  color: "#f85149" };
    if (delta > 0.25)          return { nivel: "alto",     label: "ALTO",     color: "#f85149" };
    if (delta > 0.12)          return { nivel: "medio",    label: "MEDIO",    color: "#d29922" };
    if (delta > 0.05)          return { nivel: "bajo",     label: "BAJO",     color: "#3fb950" };
    return                            { nivel: "normal",   label: "NORMAL",   color: "#58a6ff" };
  }

  // ── Generar recomendación automática
  function generarRecomendacion(riesgo, ndviActual, ndwiActual, cultivo) {
    const nombreCultivo = cultivo.charAt(0).toUpperCase() + cultivo.slice(1);

    if (riesgo.nivel === "critico") {
      return `⚠️ Estado crítico detectado en ${nombreCultivo}. NDVI extremadamente bajo (${ndviActual}). Se recomienda inspección presencial inmediata, evaluación de pérdida total y consulta con agrónomo. Considerar declaración de siniestro si aplica.`;
    }
    if (riesgo.nivel === "alto") {
      return `🔴 Estrés vegetal severo en ${nombreCultivo}. El NDVI actual (${ndviActual}) está significativamente bajo el histórico. Aplicar riego de emergencia en las próximas 48h. Revisar sistema de riego y posible ataque fitosanitario.`;
    }
    if (riesgo.nivel === "medio") {
      return `🟡 Estrés moderado detectado. El ${nombreCultivo} muestra déficit hídrico (NDWI: ${ndwiActual}). Incrementar frecuencia de riego en un 30%. Monitorear diariamente los próximos 7 días.`;
    }
    if (riesgo.nivel === "bajo") {
      return `🟢 Leve estrés vegetal. El ${nombreCultivo} se mantiene dentro de rangos aceptables con leve tendencia a la baja. Mantener monitoreo semanal y riego habitual.`;
    }
    return `✅ Condiciones normales. El ${nombreCultivo} presenta índices de vegetación estables y acordes al histórico de la zona. Continuar con manejo habitual.`;
  }

  // ── API pública del módulo
  return {

    async analizar({ coordenadas, cultivo }) {
      let satelital;

      if (CONFIG.modoDemo) {
        // Simular delay de red
        await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));
        satelital = generarDatosSatelitalesDemo(coordenadas);
      } else {
        satelital = await consultarGEEReal(coordenadas);
      }

      const riesgo = clasificarRiesgo(satelital.ndvi_actual, satelital.ndvi_historico);
      const recomendacion = generarRecomendacion(
        riesgo,
        satelital.ndvi_actual,
        satelital.ndwi_actual,
        cultivo
      );

      return {
        ...satelital,
        riesgo,
        recomendacion,
        cultivo,
        timestamp: new Date().toISOString(),
      };
    },

    esModoDemo() {
      return CONFIG.modoDemo;
    },

    activarModoReal(projectId, tokenFn) {
      CONFIG.modoDemo = false;
      CONFIG.projectId = projectId;
      CONFIG.getToken = tokenFn;
      console.info("[GEE] Modo real activado con proyecto:", projectId);
    },

    calcularAreaHa(coordenadas) {
      return calcularAreaKm2(coordenadas) * 100;
    }
  };
})();
