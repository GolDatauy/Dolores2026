/**
 * MOTOR DE GESTIÓN - CAMPEONATO BABY FÚTBOL 2026
 * 
 * Este script se encarga de:
 * 1. Sincronizar datos desde Google Sheets usando proxies para evitar errores de CORS.
 * 2. Procesar y calcular tablas de posiciones (Apertura, Clausura y Anual).
 * 3. Renderizar estadísticas avanzadas (Goleadores, Valla menos vencida, Balance y Efectividad).
 * 4. Gestionar el Fixture y el Historial de partidos segmentados por categoría.
 * 5. Controlar la visibilidad dinámica del dashboard (ocultar publicidad en estadísticas).
 */

// URL de publicación en la web del Google Sheets (formato CSV)
const DATA_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0ZWgVHyBlRk_nB1XxGtBMIvTd3wH_Bh9rneYgLQHpmj1JV5vVUOsVyTybUSGPkAqMYhk_55b9OE5B/pub?output=csv";

/**
 * Función para obtener la URL a través de un proxy.
 * Ayuda a cargar datos cuando la web se ejecuta localmente o en servidores con restricciones.
 */
const getProxy = (url, type = 'corsproxy') => {
    // Agregar cache-busting para evitar bloqueos por archivos viejos
    const bustUrl = `${url}&t=${Date.now()}`;
    
    if (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || !window.location.hostname) {
        if (type === 'corsproxy') return `https://corsproxy.io/?${encodeURIComponent(bustUrl)}`;
        if (type === 'allorigins') return `https://api.allorigins.win/raw?url=${encodeURIComponent(bustUrl)}`;
        if (type === 'cloud') return `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(bustUrl)}`;
    }
    return bustUrl;
};

// Variables de Estado Global
let rawMatches = [];     // Datos crudos del CSV
let categories = [];     // Lista de categorías únicas (2014, 2015, etc)
let currentMode = 'standard'; // Modos: 'standard' (tablas), 'acumulada', 'estadisticas'

// Estado de Resultados por Equipo en Estadísticas
let selectedTeamStats = null;   // Equipo seleccionado
let selectedTeamCatStats = null; // Categoría seleccionada

// Lista Maestra de los 9 Clubes que participan en la liga
const CLUBS_LIST = [
    "La Villa", "Nacional", "San Salvador", "Libertad",
    "Bella Vista", "Peñarol", "Danubio", "Barracas", "Progreso"
].sort();

// Mapeo de Escudos de equipos
const TEAM_LOGOS = {
    "La Villa": "escudos/La Villa.png",
    "Nacional": "escudos/Nacional.png",
    "San Salvador": "escudos/San Salvador.png",
    "Libertad": "escudos/Libertad.png",
    "Bella Vista": "escudos/Bella Vista.png",
    "Peñarol": "escudos/Peñarol.png",
    "Danubio": "escudos/Danubio.png",
    "Barracas": "escudos/Barracas.png",
    "Progreso": "escudos/Progreso.png"
};

/**
 * Retorna el HTML de un escudo si existe
 */
function getLogoHTML(teamName, className = "team-logo") {
    const path = TEAM_LOGOS[teamName];
    if (path) {
        return `<img src="${path}" class="${className}" alt="${teamName}" onerror="this.style.display='none'">`;
    }
    return "";
}

// Referencias a Elementos del DOM (Interfaz)
const loader = document.getElementById('loader');
const statusInd = document.getElementById('status-indicator');
const dashboardContainer = document.querySelector('.dashboard-container');
const tableDisplay = document.getElementById('tableDisplay');
const statsDisplay = document.getElementById('statsDisplay');
const tournamentSelect = document.getElementById('tournamentSelect');
const categorySelect = document.getElementById('categorySelect');
const categoryWrapper = document.getElementById('categoryWrapper');
const btnAcumulada = document.getElementById('btnAcumulada');
const btnEstadisticas = document.getElementById('btnEstadisticas');
const displayTitle = document.getElementById('displayTitle');
const displaySubtitle = document.getElementById('displaySubtitle');
const tableBody = document.getElementById('tableBody');
const btnSync = document.getElementById('btnSync');

// Contenedores de Estadísticas (Barras)
const topGoleadores = document.getElementById('topGoleadores');
const topDefensa = document.getElementById('topDefensa');
const balanceGoles = document.getElementById('balanceGoles');
const efectividadList = document.getElementById('efectividadList');

// Contenedores de Partidos
const adBanner = document.querySelector('.ad-banner-strip');
const matchesDisplay = document.getElementById('matchesDisplay');
const historialMatches = document.getElementById('historialMatches');
const fixtureMatches = document.getElementById('fixtureMatches');
const lastUpdateEl = document.getElementById('lastUpdate');
const adRail = document.getElementById('adRail');

// Iniciar aplicación al cargar la ventana
window.addEventListener('load', init);

/**
 * Función principal de arranque
 */
async function init() {
    try {
        statusInd.textContent = "Obteniendo datos de partidos...";
        await fetchData();

        populateCategories();
        loader.style.display = 'none';

        // Renderizado inicial: Categoría 2018 por defecto si existe, sino la primera
        if (categories.includes("2018")) {
            categorySelect.value = "2018";
            updateDisplay();
        } else if (categories.length > 0) {
            categorySelect.value = categories[0];
            updateDisplay();
        } else {
            throw new Error("No hay categorías en el documento CSV.");
        }

    } catch (error) {
        statusInd.textContent = "Error de red: " + error.message;
        statusInd.style.color = "var(--danger)";
        document.querySelector('.spinner').style.display = 'none';
        console.error(error);
    }

    // --- EVENTOS DE INTERACCIÓN ---

    // Cambio de Torneo (Apertura/Clausura)
    tournamentSelect.addEventListener('change', () => {
        if (currentMode !== 'standard') switchMode('standard');
        updateDisplay();
    });

    // Cambio de Categoría
    categorySelect.addEventListener('change', () => {
        if (currentMode !== 'standard' && currentMode !== 'estadisticas') switchMode('standard');
        updateDisplay();

        // Registrar evento en Google Analytics
        const selectedCat = categorySelect.value;
        if (selectedCat && typeof gtag === 'function') {
            gtag('event', 'select_category', {
                'event_category': 'Engagement',
                'event_label': selectedCat
            });
        }
    });

    // Botón Tabla Acumulada
    btnAcumulada.addEventListener('click', () => {
        if (currentMode === 'acumulada') {
            switchMode('standard');
        } else {
            switchMode('acumulada');
        }
        updateDisplay();
    });

    // Botón Estadísticas
    btnEstadisticas.addEventListener('click', () => {
        if (currentMode === 'estadisticas') {
            switchMode('standard');
        } else {
            switchMode('estadisticas');

            // Registrar evento al abrir estadísticas en Google Analytics
            if (typeof gtag === 'function') {
                gtag('event', 'view_statistics', {
                    'event_category': 'Engagement',
                    'event_label': categorySelect.value || 'General'
                });
            }
        }
        updateDisplay();
    });

    if (btnSync) {
        btnSync.addEventListener('click', async () => {
            if (btnSync.classList.contains('syncing')) return;
            btnSync.classList.add('syncing');
            btnSync.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>`;
            
            await fetchData();
            updateDisplay();
            
            btnSync.classList.remove('syncing');
            btnSync.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>`;
        });
    }

    // --- REGRESAR A INICIO (CLIC EN TÍTULO) ---
    const mainTitle = document.querySelector('.cyber-header h1');
    if (mainTitle) {
        mainTitle.addEventListener('click', () => {
            if (categories.length > 0) {
                categorySelect.value = categories[0];
                tournamentSelect.value = "Apertura";
                switchMode('standard');
                updateDisplay();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }

    // --- SELECTORES PARA RESULTADOS EN ESTADÍSTICAS ---
    const teamStatsSel = document.getElementById('teamStatsSelect');
    if (teamStatsSel) {
        teamStatsSel.addEventListener('change', () => {
            selectedTeamStats = teamStatsSel.value;
            updateTeamResults();

            // Registrar evento al seleccionar equipo en estadísticas
            if (selectedTeamStats && typeof gtag === 'function') {
                gtag('event', 'select_team_stats', {
                    'event_category': 'Engagement',
                    'event_label': selectedTeamStats
                });
            }
        });
    }

    const teamCatStatsSel = document.getElementById('teamCatStatsSelect');
    if (teamCatStatsSel) {
        teamCatStatsSel.addEventListener('change', () => {
            selectedTeamCatStats = teamCatStatsSel.value;
            updateTeamResults();
        });
    }
}

/**
 * Controla qué secciones se muestran según el modo activo
 */
function updateDisplay() {
    tableDisplay.style.display = 'none';
    statsDisplay.style.display = 'none';
    matchesDisplay.style.display = 'none';

    // Ocultar publicidad en Estadísticas y Acumulado
    if (currentMode === 'estadisticas' || currentMode === 'acumulada') {
        if (adBanner) adBanner.style.display = 'none';
        dashboardContainer.style.maxWidth = '1000px';
    } else {
        if (adBanner) adBanner.style.display = 'block';
        dashboardContainer.style.maxWidth = '1000px';
    }

    if (currentMode === 'estadisticas') {
        statsDisplay.style.display = 'block';
        renderStats();
    } else {
        tableDisplay.style.display = 'block';
        if (currentMode === 'acumulada') {
            renderAcumulada();
        } else {
            renderStandardStandings();
            matchesDisplay.style.display = 'block';
            renderMatches();
        }
    }
}

/**
 * Gestiona el estado visual de los botones y selectores
 */
function switchMode(mode) {
    currentMode = mode;

    // Resetear estados de botones
    btnAcumulada.classList.remove('active');
    btnAcumulada.innerText = "VER ACUMULADO DE CLUBES";
    btnEstadisticas.classList.remove('active');
    btnEstadisticas.innerText = "VER ESTADÍSTICAS";

    // Habilitar selectores por defecto
    categoryWrapper.style.opacity = '1';
    categorySelect.disabled = false;
    tournamentSelect.style.opacity = '1';
    tournamentSelect.disabled = false;

    if (mode === 'acumulada') {
        btnAcumulada.classList.add('active');
        btnAcumulada.innerText = "VOLVER A TORNEOS";
        categoryWrapper.style.opacity = '0.3';
        categorySelect.disabled = true;
        tournamentSelect.style.opacity = '0.3';
        tournamentSelect.disabled = true;
    } else if (mode === 'estadisticas') {
        btnEstadisticas.classList.add('active');
        btnEstadisticas.innerText = "VOLVER A TABLAS";
        tournamentSelect.style.opacity = '0.3';
        tournamentSelect.disabled = true;
    }
}

/**
 * Descarga y parsea los datos con rotación de proxies
 */
async function fetchData() {
    console.log("Sincronizando con base de datos...");
    let success = false;
    const bustedUrl = `${DATA_URL}&_t=${Date.now()}`;

    // 1. Intento Directo (Google Sheets envía Access-Control-Allow-Origin: * nativamente)
    try {
        const response = await fetch(bustedUrl);
        if (response.ok) {
            const text = await response.text();
            if (text.includes(",") || text.includes("\n")) {
                rawMatches = parseCSV(text);
                success = true;
                console.log("✅ Datos sincronizados directamente con Google Sheets");
            }
        }
    } catch (e) {
        console.warn("Conexión directa no disponible, intentando proxies de respaldo...", e);
    }

    // 2. Si la conexión directa falla, intentar rotación de proxies
    if (!success) {
        const proxies = ['corsproxy', 'allorigins', 'cloud'];
        for (const p of proxies) {
            try {
                let url = getProxy(bustedUrl, p);
                const response = await fetch(url);
                if (!response.ok) throw new Error();
                const text = await response.text();

                if (text.includes(",") || text.includes("\n")) {
                    rawMatches = parseCSV(text);
                    success = true;
                    console.log("✅ Datos sincronizados via " + p);
                    break;
                }
            } catch (e) {
                // Falla silenciosa para probar el siguiente proxy
            }
        }
    }

    // 3. Respaldo de seguridad final con AllOrigins JSON
    if (!success) {
        try {
            const backupUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(DATA_URL)}`;
            const backupRes = await fetch(backupUrl);
            const json = await backupRes.json();
            if (json && json.contents) {
                rawMatches = parseCSV(json.contents);
                success = true;
            }
        } catch (err) {
            throw new Error("Conexión fallida tras múltiples intentos.");
        }
    }

    if (!success) throw new Error("Fallo crítico en la conexión de datos.");

    // Detectar categorías únicas y fecha de actualización
    const catSet = new Set();
    let latestUpdate = "";

    rawMatches.forEach(m => {
        if (m.Categoria && m.Categoria.trim() !== "") {
            catSet.add(m.Categoria.trim());
        }
        if (m.Actualizacion && m.Actualizacion.trim() !== "") {
            // Asumimos que la fecha más reciente está en los últimos registros o simplemente tomamos la última no vacía
            latestUpdate = m.Actualizacion.trim();
        }
    });
    categories = Array.from(catSet).sort();

    if (latestUpdate) {
        lastUpdateEl.textContent = `Actualizado: ${latestUpdate}`;
    } else {
        lastUpdateEl.style.display = 'none';
    }
}

/**
 * Parser de CSV robusto (maneja comas dentro de comillas)
 */
function parseCSV(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = splitCSVLine(lines[0]);
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const currentLine = splitCSVLine(lines[i]);
        if (currentLine.length < headers.length) continue;

        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = currentLine[index] !== undefined ? currentLine[index].trim() : "";
        });
        data.push(obj);
    }
    return data;
}

function splitCSVLine(line) {
    const result = [];
    let startValue = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') inQuotes = !inQuotes;
        else if (line[i] === ',' && !inQuotes) {
            result.push(line.substring(startValue, i).replace(/^"|"$/g, '').trim());
            startValue = i + 1;
        }
    }
    result.push(line.substring(startValue).replace(/^"|"$/g, '').trim());
    return result;
}

/**
 * Llena el selector de categorías
 */
function populateCategories() {
    categorySelect.innerHTML = "";
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categorySelect.appendChild(option);
    });
}

/**
 * Renderiza la tabla de posiciones estándar (filtrada)
 */
function renderStandardStandings() {
    const selectedTorneo = tournamentSelect.value;
    const selectedCat = categorySelect.value;
    let matches = rawMatches.filter(m => m.Categoria === selectedCat);

    // Filtrar por torneo
    if (selectedTorneo === "Apertura") {
        matches = matches.filter(m => (m.Torneo || "Apertura").trim().toLowerCase() === "apertura");
    } else if (selectedTorneo === "Clausura") {
        matches = matches.filter(m => (m.Torneo || "").trim().toLowerCase() === "clausura");
    }

    displayTitle.textContent = selectedTorneo === "Anual" ? "TABLA ANUAL" : `TORNEO ${selectedTorneo.toUpperCase()}`;
    displaySubtitle.textContent = `Categoría ${selectedCat}`;

    const tableData = calcStandings(matches);
    drawTable(tableData);
}

/**
 * Renderiza la tabla acumulada de clubes (todos los datos)
 */
function renderAcumulada() {
    displayTitle.textContent = "ACUMULADO DE CLUBES";
    displaySubtitle.textContent = "Sumatoria Total de todas las Categorías e Instancias";

    const tableData = calcStandings(rawMatches);
    drawTable(tableData);
}

/**
 * Genera el tablero de estadísticas visuales
 */
function renderStats() {
    const selectedCat = categorySelect.value;
    const selectedTorneo = tournamentSelect.value;

    let matches = currentMode === 'acumulada' ? rawMatches : rawMatches.filter(m => m.Categoria === selectedCat);

    if (currentMode !== 'acumulada') {
        if (selectedTorneo === "Apertura") {
            matches = matches.filter(m => (m.Torneo || "Apertura").trim().toLowerCase() === "apertura");
        } else if (selectedTorneo === "Clausura") {
            matches = matches.filter(m => (m.Torneo || "").trim().toLowerCase() === "clausura");
        }
    }

    const standingsData = calcStandings(matches);

    const finalData = [...standingsData];

    // 1. TOP GOLEADORES (Ofensiva)
    const scorers = [...finalData].sort((a, b) => b.GF - a.GF || a.team.localeCompare(b.team));
    const maxGF = Math.max(...scorers.map(s => s.GF), 1);
    topGoleadores.innerHTML = scorers.map(s => {
        const barWidth = (s.GF / maxGF) * 100;
        return `
            <div class="mini-item-block">
                <div class="mini-item-info">
                    <div class="team-label">
                        ${getLogoHTML(s.team, "mini-logo")}
                        <span>${s.team}</span>
                    </div>
                    <span>${s.GF} Goles (${s.PJ} PJ)</span>
                </div>
                <div class="mini-bar-bg"><div class="mini-bar-fill offense" style="width: ${barWidth}%"></div></div>
            </div>`;
    }).join('');

    // 2. MURO DEFENSA (Defensiva)
    const defense = [...finalData].sort((a, b) => a.GC - b.GC || a.team.localeCompare(b.team));
    const maxGC = Math.max(...defense.map(s => s.GC), 1);
    topDefensa.innerHTML = defense.map(s => {
        const barWidth = (s.GC / maxGC) * 100;
        return `
            <div class="mini-item-block">
                <div class="mini-item-info">
                    <div class="team-label">
                        ${getLogoHTML(s.team, "mini-logo")}
                        <span>${s.team}</span>
                    </div>
                    <span>${s.GC} Recibidos (${s.PJ} PJ)</span>
                </div>
                <div class="mini-bar-bg"><div class="mini-bar-fill defense" style="width: ${barWidth}%"></div></div>
            </div>`;
    }).join('');

    // 3. BALANCE DE GOL (DG)
    const balance = [...finalData].sort((a, b) => b.DG - a.DG || a.team.localeCompare(b.team));
    const maxDG = Math.max(...balance.map(s => Math.abs(s.DG)), 1);
    balanceGoles.innerHTML = balance.map(s => {
        const width = (Math.abs(s.DG) / maxDG) * 100;
        const type = s.DG >= 0 ? 'positive' : 'negative';
        return `
            <div class="dg-item">
                <div class="dg-info">
                    <div class="team-label">
                        ${getLogoHTML(s.team, "mini-logo")}
                        <span>${s.team}</span>
                    </div>
                    <span class="dg-value ${type}">${s.DG > 0 ? '+'+s.DG : s.DG}</span>
                </div>
                <div class="dg-bar-container"><div class="dg-bar-fill ${type}" style="width: ${width}%"></div></div>
            </div>`;
    }).join('');

    // 4. BARRA DE EFECTIVIDAD (%)
    efectividadList.innerHTML = finalData.sort((a, b) => b.Pts - a.Pts || a.team.localeCompare(b.team)).map(s => {
        const totalPossible = s.PJ * 3;
        const perc = totalPossible > 0 ? ((s.Pts / totalPossible) * 100).toFixed(1) : 0;
        return `
            <div class="efectividad-item">
                <div class="efectividad-info">
                    <div class="team-label">
                        ${getLogoHTML(s.team, "mini-logo")}
                        <span>${s.team}</span>
                    </div>
                    <span>${s.Pts}/${totalPossible} Pts (${perc}%)</span>
                </div>
                <div class="efectividad-bar-bg"><div class="efectividad-bar-fill" style="width: ${perc}%"></div></div>
            </div>`;
    }).join('');

    // --- RESULTADOS POR EQUIPO (APERTURA Y CLAUSURA) ---
    populateTeamStatsSelectors();
    updateTeamResults();
}

/**
 * Actualiza los resultados del equipo seleccionado basándose en sus selectores
 */
function updateTeamResults() {
    selectedTeamCatStats = document.getElementById('teamCatStatsSelect')?.value || selectedTeamCatStats;
    selectedTeamStats = document.getElementById('teamStatsSelect')?.value || selectedTeamStats;

    renderTeamResults();
}

/**
 * Utilidad: Detecta si un texto indica jornada "Libre"
 */
function isLibre(teamName) {
    if (!teamName) return true;
    const lower = teamName.trim().toLowerCase();
    return lower === "libre" || lower === "libe";
}

/**
 * LÓGICA CORE: Calcula puntos y estadísticas desde un array de partidos
 */
function calcStandings(matchesArray) {
    const standings = {};
    const initTeam = (t) => {
        if (t && t.trim() !== "" && !isLibre(t) && !standings[t]) {
            standings[t] = { Pts: 0, PJ: 0, GF: 0, GC: 0 };
        }
    };

    // Inicializar equipos
    matchesArray.forEach(m => { initTeam(m.Local); initTeam(m.Visitante); });

    // Procesar resultados
    matchesArray.forEach(m => {
        // Validación estricta: Solo procesar si el estado es "Jugado"
        if ((m.Estado || "").trim().toLowerCase() !== "jugado") return;

        // Verificación de seguridad por si faltan goles
        if (m.Goles_L === "" || m.Goles_V === "") return;

        const local = m.Local;
        const visit = m.Visitante;
        if (isLibre(local) || isLibre(visit)) return;

        const gl = parseInt(m.Goles_L);
        const gv = parseInt(m.Goles_V);
        if (isNaN(gl) || isNaN(gv)) return;
        if (!standings[local] || !standings[visit]) return;

        standings[local].PJ++; standings[visit].PJ++;
        standings[local].GF += gl; standings[visit].GF += gv;
        standings[local].GC += gv; standings[visit].GC += gl;

        if (gl > gv) standings[local].Pts += 3;
        else if (gv > gl) standings[visit].Pts += 3;
        else { standings[local].Pts += 1; standings[visit].Pts += 1; }
    });

    // Convertir a Array y ordenar
    const ordered = Object.keys(standings).map(t => ({
        team: t, ...standings[t], DG: standings[t].GF - standings[t].GC
    }));

    ordered.sort((a, b) => {
        if (b.Pts !== a.Pts) return b.Pts - a.Pts;
        if (b.DG !== a.DG) return b.DG - a.DG;
        return b.GF - a.GF;
    });

    return ordered;
}

/**
 * Renderiza físicamente las filas de la tabla en el HTML
 */
function drawTable(data) {
    tableBody.innerHTML = "";
    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: #888;">No hay registros.</td></tr>`;
        return;
    }

    data.forEach((row, idx) => {
        const tr = document.createElement('tr');
        const dgClass = row.DG > 0 ? 'val-dg-pos' : (row.DG < 0 ? 'val-dg-neg' : '');
        tr.innerHTML = `
            <td><span class="pos-badge">${idx + 1}</span></td>
            <td class="team-cell">
                <div class="team-label-table">
                    ${getLogoHTML(row.team, "table-logo")}
                    <span>${row.team}</span>
                </div>
            </td>
            <td class="val-pts">${row.Pts}</td>
            <td>${row.PJ}</td>
            <td>${row.GF}</td>
            <td>${row.GC}</td>
            <td class="${dgClass}">${row.DG > 0 ? '+' + row.DG : row.DG}</td>`;
        tableBody.appendChild(tr);
    });
}

/**
 * Renderiza los listados de Historial y Fixture
 */
function renderMatches() {
    const selectedCat = categorySelect.value;
    const selectedTorneo = tournamentSelect.value;
    let matches = rawMatches.filter(m => m.Categoria === selectedCat);

    if (selectedTorneo === "Apertura") {
        matches = matches.filter(m => (m.Torneo || "Apertura").trim().toLowerCase() === "apertura");
    } else if (selectedTorneo === "Clausura") {
        matches = matches.filter(m => (m.Torneo || "").trim().toLowerCase() === "clausura");
    }

    const played = matches.filter(m => {
        const est = (m.Estado || "").trim().toLowerCase();
        return (est === "jugado" || est === "no finalizado") && m.Goles_L !== "" && m.Goles_V !== "";
    });

    // Ordenar jugados por Fecha descendente (para que lo más reciente quede arriba)
    played.sort((a, b) => {
        const numA = parseInt((a.Fecha || "0").replace(/[^0-9]/g, '')) || 0;
        const numB = parseInt((b.Fecha || "0").replace(/[^0-9]/g, '')) || 0;
        return numB - numA;
    });

    const pending = matches.filter(m => (m.Estado || "").trim().toLowerCase() !== "jugado");

    // Render Jugados (con resaltado de ganador)
    historialMatches.innerHTML = played.length === 0 ? `<p class="empty-msg">No hay jugados.</p>` :
        played.map(m => {
            const gl = parseInt(m.Goles_L), gv = parseInt(m.Goles_V);
            const isParcial = (m.Estado || "").trim().toLowerCase() === "no finalizado";
            
            const middleContent = isParcial 
                ? `<div class="m-score-parcial"><span class="badge-parcial">PARCIAL</span><span>${gl} - ${gv}</span></div>`
                : `<div class="m-score">${gl} - ${gv}</div>`;
            const extraClass = isParcial ? "match-parcial" : "";
            
            // Si es parcial, no hay ganador todavía
            const winLClass = (!isParcial && gl > gv) ? 'winner' : '';
            const winVClass = (!isParcial && gv > gl) ? 'winner' : '';

            return `
                <div class="match-card ${extraClass}">
                    <div class="match-fecha">${m.Fecha || 'F. Pend'}</div>
                    <div class="m-team ${winLClass}">${getLogoHTML(m.Local, "match-logo")} ${m.Local}</div>
                    ${middleContent}
                    <div class="m-team ${winVClass}">${getLogoHTML(m.Visitante, "match-logo")} ${m.Visitante}</div>
                </div>`;
        }).join('');

    // Render Pendientes (estilo minimalista)
    fixtureMatches.innerHTML = pending.length === 0 ? `<p class="empty-msg">No hay partidos pendientes.</p>` :
        pending.map(m => {
            const isParcial = (m.Estado || "").trim().toLowerCase() === "no finalizado";
            const middleContent = isParcial && m.Goles_L !== "" && m.Goles_V !== "" 
                ? `<div class="m-score-parcial"><span class="badge-parcial">PARCIAL</span><span>${m.Goles_L} - ${m.Goles_V}</span></div>`
                : `<div class="m-vs">VS</div>`;
            const extraClass = isParcial ? "match-parcial" : "";

            return `
                <div class="match-card ${extraClass}">
                    <div class="match-fecha">${m.Fecha || 'F. Prox'}</div>
                    <div class="m-team">${getLogoHTML(m.Local, "match-logo")} ${m.Local}</div>
                    ${middleContent}
                    <div class="m-team">${getLogoHTML(m.Visitante, "match-logo")} ${m.Visitante}</div>
                </div>`;
        }).join('');
}

/**
 * Llena los selectores de equipo y categoría en estadísticas
 */
function populateTeamStatsSelectors() {
    const teamStatsSel = document.getElementById('teamStatsSelect');
    if (teamStatsSel && teamStatsSel.options.length === 0) {
        CLUBS_LIST.forEach((t, idx) => {
            const option = document.createElement('option');
            option.value = t;
            option.textContent = t;
            if (idx === 0) option.selected = true;
            teamStatsSel.appendChild(option);
        });
        selectedTeamStats = CLUBS_LIST[0];
    }

    const teamCatStatsSel = document.getElementById('teamCatStatsSelect');
    if (teamCatStatsSel && teamCatStatsSel.options.length === 0) {
        categories.forEach((cat, idx) => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            if (cat === categorySelect.value || idx === 0) option.selected = true;
            teamCatStatsSel.appendChild(option);
        });
        selectedTeamCatStats = teamCatStatsSel.value || categories[0];
    }
}

/**
 * Renderiza los resultados del equipo seleccionado separados en Torneo Apertura y Torneo Clausura
 */
function renderTeamResults() {
    const aperturaList = document.getElementById('aperturaResultsList');
    const clausuraList = document.getElementById('clausuraResultsList');
    if (!aperturaList || !clausuraList) return;

    if (!selectedTeamStats || !selectedTeamCatStats) {
        aperturaList.innerHTML = `<p class="empty-msg">Seleccione equipo y categoría.</p>`;
        clausuraList.innerHTML = `<p class="empty-msg">Seleccione equipo y categoría.</p>`;
        return;
    }

    // Filtrar todos los partidos del equipo en la categoría seleccionada
    const teamMatches = rawMatches.filter(m => 
        m.Categoria === selectedTeamCatStats &&
        (m.Local === selectedTeamStats || m.Visitante === selectedTeamStats) &&
        !isLibre(m.Local) && !isLibre(m.Visitante)
    );

    const aperturaMatches = teamMatches.filter(m => (m.Torneo || "Apertura").trim().toLowerCase() === "apertura");
    const clausuraMatches = teamMatches.filter(m => (m.Torneo || "").trim().toLowerCase() === "clausura");

    const renderList = (matches, container) => {
        if (matches.length === 0) {
            container.innerHTML = `<p class="empty-msg">No hay partidos registrados.</p>`;
            return;
        }

        // Ordenar cronológicamente por número de Fecha
        matches.sort((a, b) => {
            const numA = parseInt((a.Fecha || "0").replace(/[^0-9]/g, '')) || 0;
            const numB = parseInt((b.Fecha || "0").replace(/[^0-9]/g, '')) || 0;
            return numA - numB;
        });

        container.innerHTML = matches.map(m => {
            const est = (m.Estado || "").trim().toLowerCase();
            const isPlayed = est === "jugado" && m.Goles_L !== "" && m.Goles_V !== "";
            const isParcial = est === "no finalizado";

            let middleContent = `<div class="m-vs">VS</div>`;
            let resultClass = "";

            if (isPlayed) {
                const gl = parseInt(m.Goles_L);
                const gv = parseInt(m.Goles_V);
                middleContent = `<div class="m-score">${gl} - ${gv}</div>`;
                
                const isLocal = (m.Local === selectedTeamStats);
                if (gl === gv) {
                    resultClass = "res-draw"; // Empate -> Azul
                } else if ((isLocal && gl > gv) || (!isLocal && gv > gl)) {
                    resultClass = "res-win";  // Victoria del equipo seleccionado -> Verde
                } else {
                    resultClass = "res-loss"; // Derrota del equipo seleccionado -> Rojo
                }
            } else if (isParcial && m.Goles_L !== "" && m.Goles_V !== "") {
                middleContent = `<div class="m-score-parcial"><span class="badge-parcial">PARCIAL</span><span>${m.Goles_L} - ${m.Goles_V}</span></div>`;
            }

            const extraClass = isParcial ? "match-parcial" : "";

            return `
                <div class="team-match-card ${resultClass} ${extraClass}">
                    <div class="m-team">${getLogoHTML(m.Local, "match-logo")} <span>${m.Local}</span></div>
                    ${middleContent}
                    <div class="m-team">${getLogoHTML(m.Visitante, "match-logo")} <span>${m.Visitante}</span></div>
                </div>`;
        }).join('');
    };

    renderList(aperturaMatches, aperturaList);
    renderList(clausuraMatches, clausuraList);
}
