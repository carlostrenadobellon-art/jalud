(function () {
  'use strict';

  const STORAGE_KEY = 'competitivaJA_session';
  let session = null; // { token, rol, nombre }

  // ---------- API ----------

  function apiGet(action, params) {
    params = params || {};
    const usp = new URLSearchParams(Object.assign({ action: action }, params));
    if (session) usp.set('token', session.token);
    return fetch(window.API_URL + '?' + usp.toString())
      .then((r) => r.json())
      .then(checkSession_);
  }

  function apiPost(action, body) {
    const payload = Object.assign({ action: action }, body || {});
    if (session) payload.token = session.token;
    // Sin cabecera Content-Type explícita: el navegador usa text/plain con un
    // body string, lo que evita el preflight CORS que Apps Script no soporta.
    return fetch(window.API_URL, { method: 'POST', body: JSON.stringify(payload) })
      .then((r) => r.json())
      .then(checkSession_);
  }

  function checkSession_(res) {
    if (res && res.ok === false && res.code === 401) {
      logout();
      throw new Error('Sesión caducada, vuelve a iniciar sesión');
    }
    return res;
  }

  // ---------- Sesión ----------

  function loadSession() {
    const raw = localStorage.getItem(STORAGE_KEY);
    session = raw ? JSON.parse(raw) : null;
  }

  function saveSession(s) {
    session = s;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  function logout() {
    session = null;
    localStorage.removeItem(STORAGE_KEY);
    render();
  }

  // ---------- Vistas ----------

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function render() {
    $('#viewLogin').classList.toggle('hidden', !!session);
    $('#viewTecnico').classList.toggle('hidden', !(session && session.rol === 'tecnico'));
    $('#viewJugador').classList.toggle('hidden', !(session && session.rol === 'jugador'));
    $('#userBadge').classList.toggle('hidden', !session);

    if (session) {
      $('#userName').textContent = session.nombre + ' (' + session.rol + ')';
      if (session.rol === 'tecnico') initTecnico();
      if (session.rol === 'jugador') initJugador();
    }
  }

  // ---------- Login ----------

  $('#formLogin').addEventListener('submit', (e) => {
    e.preventDefault();
    const usuario = $('#loginUsuario').value.trim();
    const password = $('#loginPassword').value;
    $('#loginError').classList.add('hidden');

    apiPost('login', { usuario, password }).then((res) => {
      if (!res.ok) {
        $('#loginError').textContent = res.error;
        $('#loginError').classList.remove('hidden');
        return;
      }
      saveSession({ token: res.token, rol: res.rol, nombre: res.nombre });
      render();
    }).catch((err) => {
      $('#loginError').textContent = err.message;
      $('#loginError').classList.remove('hidden');
    });
  });

  $('#btnLogout').addEventListener('click', logout);

  // ---------- Vista Técnico ----------

  function activarTab(nombre) {
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === nombre));
    $$('.tab-panel').forEach((p) => p.classList.add('hidden'));
    $('#tab' + nombre.charAt(0).toUpperCase() + nombre.slice(1)).classList.remove('hidden');
  }

  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activarTab(btn.dataset.tab));
  });

  let tecnicoInit = false;

  function initTecnico() {
    if (tecnicoInit) return;
    tecnicoInit = true;

    apiGet('calendario').then((res) => {
      if (!res.ok) return;
      const hoy = new Date().toISOString().slice(0, 10);
      let semanaActual = res.semanas[0].numSemana;
      const mesesSet = new Set();
      res.semanas.forEach((s) => {
        if (hoy >= s.fechaInicio && hoy <= s.fechaFin) semanaActual = s.numSemana;
        mesesSet.add(s.mesAsignado);
        const opt = document.createElement('option');
        opt.value = s.numSemana;
        opt.textContent = 'Semana ' + s.numSemana + ' (' + s.fechaInicio + ' a ' + s.fechaFin + ')';
        $('#selectSemana').appendChild(opt);
      });
      $('#selectSemana').value = semanaActual;
      cargarSemana(semanaActual);

      const meses = Array.from(mesesSet).sort();
      const mesActual = poblarSelectMeses($('#selectMes'), meses, hoy.slice(0, 7));
      cargarRankings(mesActual);
    });

    $('#selectSemana').addEventListener('change', (e) => cargarSemana(e.target.value));
    $('#selectMes').addEventListener('change', () => cargarRankings($('#selectMes').value));

    const hoyISO = new Date().toISOString().slice(0, 10);
    $('#altaFecha').value = hoyISO;
    $('#bajaFecha').value = hoyISO;
    [$('#altaFecha'), $('#bajaFecha')].forEach((inp) => {
      inp.addEventListener('click', function () { this.showPicker && this.showPicker(); });
    });
    cargarJugadoresParaBaja();
    initPerfilJugador();
    initHistorial();
    initDescargaPdf();
    initInformeSemanal();

    $('#formAlta').addEventListener('submit', (e) => {
      e.preventDefault();
      apiPost('alta', {
        nombre: $('#altaNombre').value.trim(),
        email: $('#altaEmail').value.trim(),
        fechaAlta: $('#altaFecha').value
      }).then((res) => {
        mostrarMsgJugadores(res.ok ? 'Jugador dado de alta.' : res.error);
        if (res.ok) { $('#formAlta').reset(); $('#altaFecha').value = hoyISO; cargarJugadoresParaBaja(); }
      });
    });

    $('#formBaja').addEventListener('submit', (e) => {
      e.preventDefault();
      apiPost('baja', {
        jugadorNum: $('#bajaJugador').value,
        fechaBaja: $('#bajaFecha').value
      }).then((res) => {
        mostrarMsgJugadores(res.ok ? 'Jugador dado de baja.' : res.error);
        if (res.ok) cargarJugadoresParaBaja();
      });
    });
  }

  /**
   * Rellena un <select> con los meses de la temporada (formato "Julio 2026"),
   * y devuelve el mes que debería quedar seleccionado (el mes actual si
   * pertenece a la temporada, si no el último disponible).
   */
  function poblarSelectMeses(selectEl, meses, mesPreferido) {
    selectEl.innerHTML = '';
    meses.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = formatMesLabel_(m);
      selectEl.appendChild(opt);
    });
    const mesElegido = meses.includes(mesPreferido) ? mesPreferido : meses[meses.length - 1];
    selectEl.value = mesElegido;
    return mesElegido;
  }

  function formatMesLabel_(mesISO) {
    const [y, m] = mesISO.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    const label = d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function mostrarMsgJugadores(texto) {
    const el = $('#jugadoresMsg');
    el.textContent = texto;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  }

  function cargarJugadoresParaBaja() {
    apiGet('jugadoresActivos').then((res) => {
      if (!res.ok) return;
      const sel = $('#bajaJugador');
      sel.innerHTML = '';
      res.jugadores.forEach((j) => {
        const opt = document.createElement('option');
        opt.value = j.numero;
        opt.textContent = j.numero + ' - ' + j.nombre;
        sel.appendChild(opt);
      });
    });
  }

  // ---------- Perfil de jugador ----------

  let chartPerfilEvolucion;
  let perfilInit = false;

  function initPerfilJugador() {
    if (perfilInit) return;
    perfilInit = true;

    apiGet('jugadoresTodos').then((res) => {
      if (!res.ok) return;
      const sel = $('#selectPerfilJugador');
      sel.innerHTML = '';
      res.jugadores.forEach((j) => {
        const opt = document.createElement('option');
        opt.value = j.nombre;
        opt.textContent = j.nombre + (j.fechaBaja ? ' (baja)' : '');
        sel.appendChild(opt);
      });
      if (res.jugadores.length > 0) cargarPerfilJugador(sel.value);
    });

    $('#selectPerfilJugador').addEventListener('change', (e) => cargarPerfilJugador(e.target.value));
  }

  function cargarPerfilJugador(jugador) {
    if (!jugador) return;
    apiGet('perfilJugador', { jugador }).then((res) => {
      if (!res.ok) return;

      const sinDatos = res.semanas.length === 0 && res.meses.length === 0 && !res.anual;
      $('#perfilContenido').classList.toggle('hidden', sinDatos);
      $('#perfilSinDatos').classList.toggle('hidden', !sinDatos);
      if (sinDatos) return;

      chartPerfilEvolucion = pintarChartEvolucion(res.semanas, chartPerfilEvolucion);
      pintarResumenAnual(res.anual);
      pintarTablaPerfilMensual(res.meses);
      pintarTablaPerfilSemanal(res.semanas);
    });
  }

  function pintarChartEvolucion(semanas, existente) {
    if (existente) existente.destroy();
    return new Chart($('#chartPerfilEvolucion'), {
      type: 'line',
      data: {
        labels: semanas.map((s) => 'S' + s.numSemana),
        datasets: [{
          label: 'Puntos',
          data: semanas.map((s) => s.puntosTotales),
          borderColor: '#2f8fd1',
          backgroundColor: 'rgba(13,108,176,.25)',
          tension: .3,
          fill: true
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  function pintarResumenAnual(anual) {
    const el = $('#perfilAnualResumen');
    if (!anual) { el.innerHTML = '<p>Sin datos todavía.</p>'; return; }
    el.innerHTML = '<div class="stat-row">'
      + statTile_(anual.puntosTotales, 'Puntos')
      + statTile_(anual.numTareas, 'Tareas')
      + statTile_(anual.promedio.toFixed(2), 'Promedio')
      + statTile_('#' + anual.posicion + ' / ' + anual.deTotal, 'Posición anual')
      + '</div>';
  }

  function statTile_(valor, etiqueta) {
    return '<div class="stat-tile"><div class="valor">' + valor + '</div><div class="etiqueta">' + etiqueta + '</div></div>';
  }

  function pintarTablaPerfilMensual(meses) {
    let html = '<table class="grid"><thead><tr><th>Mes</th><th>Puntos</th><th>Tareas</th><th>Promedio</th><th>Posición</th></tr></thead><tbody>';
    meses.forEach((m) => {
      html += '<tr><td class="name">' + formatMesLabel_(m.mes) + '</td><td>' + m.puntosTotales + '</td><td>' + m.numTareas
        + '</td><td>' + m.promedio.toFixed(2) + '</td><td>#' + m.posicion + ' / ' + m.deTotal + '</td></tr>';
    });
    html += '</tbody></table>';
    $('#tablaPerfilMensual').innerHTML = html;
  }

  function pintarTablaPerfilSemanal(semanas) {
    let html = '<table class="grid"><thead><tr><th>Semana</th><th>Fechas</th><th>Puntos</th><th>Tareas</th><th>Promedio</th><th>Posición</th></tr></thead><tbody>';
    semanas.forEach((s) => {
      html += '<tr><td class="name">Semana ' + s.numSemana + '</td><td>' + s.fechaInicio + ' a ' + s.fechaFin + '</td><td>' + s.puntosTotales
        + '</td><td>' + s.numTareas + '</td><td>' + s.promedio.toFixed(2) + '</td><td>#' + s.posicion + ' / ' + s.deTotal + '</td></tr>';
    });
    html += '</tbody></table>';
    $('#tablaPerfilSemanal').innerHTML = html;
  }

  // ---------- Historial de tareas ----------

  let historialInit = false;

  function initHistorial() {
    if (historialInit) return;
    historialInit = true;
    cargarHistorico();
  }

  function cargarHistorico() {
    apiGet('historicoTareas').then((res) => {
      if (!res.ok) return;
      pintarHistorico(res.tareas);
    });
  }

  function pintarHistorico(tareas) {
    if (tareas.length === 0) {
      $('#historicoContainer').innerHTML = '<p>Todavía no hay ninguna tarea registrada.</p>';
      return;
    }
    let html = '<table class="grid"><thead><tr><th>Fecha</th><th>Tarea</th><th>Semana</th><th>Jugadores</th><th>Puntos</th><th>Acciones</th></tr></thead><tbody>';
    tareas.forEach((t) => {
      html += '<tr>'
        + '<td>' + t.fecha + '</td>'
        + '<td class="name">' + t.tarea + '</td>'
        + '<td>' + t.semana + '</td>'
        + '<td>' + t.numJugadores + '</td>'
        + '<td>' + t.puntosTotales + '</td>'
        + '<td><div class="row-actions">'
        + '<button type="button" class="btn-editar-tarea" data-semana="' + t.semana + '" data-tarea="' + encodeURIComponent(t.tarea) + '" data-fecha="' + t.fecha + '">Editar</button>'
        + '<button type="button" class="btn-eliminar btn-eliminar-tarea" data-tarea="' + encodeURIComponent(t.tarea) + '" data-fecha="' + t.fecha + '">Eliminar</button>'
        + '</div></td>'
        + '</tr>';
    });
    html += '</tbody></table>';
    $('#historicoContainer').innerHTML = html;

    $$('.btn-editar-tarea').forEach((btn) => {
      btn.addEventListener('click', () => {
        irAEditarTarea(btn.dataset.semana, decodeURIComponent(btn.dataset.tarea), btn.dataset.fecha);
      });
    });

    $$('.btn-eliminar-tarea').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tarea = decodeURIComponent(btn.dataset.tarea);
        const fecha = btn.dataset.fecha;
        if (!confirm('¿Eliminar la tarea "' + tarea + '" del ' + fecha + ' para todos los jugadores? Esta acción no se puede deshacer desde la app.')) return;
        apiPost('eliminarTarea', { tarea, fecha }).then((res) => {
          if (!res.ok) { alert(res.error); return; }
          cargarHistorico();
        });
      });
    });
  }

  /** Reabre una tarea ya guardada, en la pestaña "Entrada semanal", lista para corregir/completar. */
  function irAEditarTarea(semana, tarea, fecha) {
    activarTab('entrada');
    $('#selectSemana').value = semana;
    cargarSemana(semana).then(() => {
      const btn = document.querySelector(
        '.tarea-link[data-tarea="' + encodeURIComponent(tarea) + '"][data-fecha="' + fecha + '"]'
      );
      if (btn) btn.click();
    });
  }

  let semanaEnCurso = null;

  function cargarSemana(numSemana) {
    semanaEnCurso = numSemana;
    return apiGet('semana', { numSemana }).then((res) => {
      if (!res.ok) { $('#gridContainer').innerHTML = '<p class="error">' + res.error + '</p>'; return; }
      pintarGrid(res);
    });
  }

  function pintarGrid(data) {
    const { semana, jugadores, puntuaciones } = data;

    // Resumen TOT/SES/PROM por jugador a partir de lo ya guardado esta semana
    // (el backend ya deduplica jugador+tarea+fecha, así que una corrección no cuenta dos veces).
    const resumen = {};
    jugadores.forEach((j) => { resumen[j.nombre] = { tot: 0, ses: 0 }; });
    puntuaciones.forEach((p) => {
      if (!resumen[p.jugador]) resumen[p.jugador] = { tot: 0, ses: 0 };
      resumen[p.jugador].tot += Number(p.puntos);
      resumen[p.jugador].ses += 1;
    });

    const tareas = Array.from(new Set(puntuaciones.map((p) => p.tarea + '|' + p.fecha)))
      .map((k) => { const [tarea, fecha] = k.split('|'); return { tarea, fecha }; })
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    const hoyISO = new Date().toISOString().slice(0, 10);
    const fechaPorDefecto = (hoyISO >= semana.fechaInicio && hoyISO <= semana.fechaFin) ? hoyISO : semana.fechaInicio;

    let html = '';
    html += '<h3 id="tituloFormTarea">Nueva tarea</h3>';
    html += '<label>Nombre de la tarea</label><input type="text" id="nuevaTareaNombre" placeholder="Ej: Rondo, Test físico...">';
    html += '<label>Fecha</label><input type="date" id="nuevaTareaFecha" value="' + fechaPorDefecto + '" min="' + semana.fechaInicio + '" max="' + semana.fechaFin + '">';
    html += '<table class="grid" id="tablaEntrada"><thead><tr><th>Jugador</th><th>Puntos</th></tr></thead><tbody>';
    jugadores.forEach((j) => {
      html += '<tr><td class="name">' + j.nombre + '</td><td><input type="number" step="any" data-jugador="' + j.nombre + '"></td></tr>';
    });
    html += '</tbody></table>';
    html += '<button id="btnGuardarTarea">Guardar tarea</button>';
    html += '<button type="button" id="btnNuevaTarea" style="background:#334155;color:#e2e8f0;">Empezar tarea nueva (limpiar)</button>';
    html += '<p id="entradaMsg" class="msg hidden"></p>';

    html += '<h3>Tareas registradas esta semana</h3>';
    html += tareas.length
      ? '<ul>' + tareas.map((t) =>
          '<li><button type="button" class="tarea-link" data-tarea="' + encodeURIComponent(t.tarea) + '" data-fecha="' + t.fecha + '">'
          + t.tarea + ' (' + t.fecha + ') — corregir / completar</button></li>'
        ).join('') + '</ul>'
      : '<p>Ninguna todavía.</p>';

    html += '<h3>Resumen de la semana</h3>';
    html += '<table class="grid"><thead><tr><th>Jugador</th><th>TOT</th><th>SES</th><th>PROM</th></tr></thead><tbody>';
    jugadores.forEach((j) => {
      const r = resumen[j.nombre] || { tot: 0, ses: 0 };
      const prom = r.ses > 0 ? (r.tot / r.ses).toFixed(2) : '-';
      html += '<tr><td class="name">' + j.nombre + '</td><td>' + r.tot + '</td><td>' + r.ses + '</td><td>' + prom + '</td></tr>';
    });
    html += '</tbody></table>';

    $('#gridContainer').innerHTML = html;

    // Clic en cualquier punto del campo de fecha abre el calendario nativo (no solo en el icono).
    $('#nuevaTareaFecha').addEventListener('click', function () { this.showPicker && this.showPicker(); });

    $('#btnGuardarTarea').addEventListener('click', () => {
      const tarea = $('#nuevaTareaNombre').value.trim();
      const fecha = $('#nuevaTareaFecha').value;
      if (!tarea || !fecha) { alert('Falta el nombre de la tarea o la fecha'); return; }

      const puntuacionesLote = $$('#tablaEntrada input[data-jugador]')
        .filter((inp) => inp.value !== '')
        .map((inp) => ({ jugador: inp.dataset.jugador, tarea, puntos: Number(inp.value) }));

      if (puntuacionesLote.length === 0) { alert('Introduce al menos una puntuación'); return; }

      apiPost('guardarPuntosLote', { semana: semanaEnCurso, fecha, puntuaciones: puntuacionesLote }).then((res) => {
        const msg = $('#entradaMsg');
        msg.textContent = res.ok ? ('Guardadas ' + res.guardadas + ' puntuaciones.') : res.error;
        msg.classList.remove('hidden');
        if (res.ok) cargarSemana(semanaEnCurso);
      });
    });

    $('#btnNuevaTarea').addEventListener('click', () => cargarSemana(semanaEnCurso));

    $$('.tarea-link').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tarea = decodeURIComponent(btn.dataset.tarea);
        const fecha = btn.dataset.fecha;
        $('#nuevaTareaNombre').value = tarea;
        $('#nuevaTareaFecha').value = fecha;
        $('#tituloFormTarea').textContent = 'Corrigiendo: ' + tarea + ' (' + fecha + ')';

        // Precarga lo ya guardado para esa tarea+fecha; los jugadores sin
        // puntuación quedan en blanco (son los que faltaban por meter).
        const puntosPorJugador = {};
        puntuaciones
          .filter((p) => p.tarea === tarea && p.fecha === fecha)
          .forEach((p) => { puntosPorJugador[p.jugador] = p.puntos; });

        $$('#tablaEntrada input[data-jugador]').forEach((inp) => {
          const v = puntosPorJugador[inp.dataset.jugador];
          inp.value = (v === undefined) ? '' : v;
        });

        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  // ---------- Rankings (técnico) ----------

  let chartMensual, chartAnual;

  function cargarRankings(mes) {
    apiGet('rankingMensual', { mes }).then((res) => {
      if (!res.ok) return;
      chartMensual = pintarChart('chartMensual', chartMensual, res.ranking);
      pintarTop5('#top5Mensual', res.ranking.slice(0, 5));
      pintarTablaRanking('tablaRankingMensual', res.ranking, 'mensual');
    });
    apiGet('rankingAnual').then((res) => {
      if (!res.ok) return;
      chartAnual = pintarChart('chartAnual', chartAnual, res.ranking);
      pintarTop5('#top5Anual', res.ranking.slice(0, 5));
      pintarTablaRanking('tablaRankingAnual', res.ranking, 'anual');
    });
  }

  function pintarChart(canvasId, existente, ranking) {
    const top = ranking.slice(0, 10);
    if (existente) existente.destroy();
    return new Chart($('#' + canvasId), {
      type: 'bar',
      data: {
        labels: top.map((r) => r.jugador),
        datasets: [{ label: 'Puntos', data: top.map((r) => r.puntosTotales), backgroundColor: '#2f8fd1' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  function pintarTop5(sel, top5) {
    $(sel).innerHTML = top5.map((r) =>
      '<li>' + r.jugador + ' — ' + r.puntosTotales + ' pts · ' + r.numTareas + ' tareas · promedio ' + r.promedio.toFixed(2) + '</li>'
    ).join('') || '<li>Sin datos</li>';
  }

  // Estado de ordenación de cada tabla, para recordar qué columna está activa
  // al recargar los datos (cambio de mes, etc.).
  const sortState = {
    mensual: { key: 'puntosTotales', asc: false },
    anual: { key: 'puntosTotales', asc: false }
  };

  const COLUMNAS_RANKING = [
    { key: 'jugador', label: 'Jugador' },
    { key: 'puntosTotales', label: 'Puntos' },
    { key: 'numTareas', label: 'Nº Tareas' },
    { key: 'promedio', label: 'Promedio' }
  ];

  function pintarTablaRanking(containerId, ranking, tipo) {
    const estado = sortState[tipo];
    const ordenado = ranking.slice().sort((a, b) => {
      let va = a[estado.key], vb = b[estado.key];
      if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      if (va < vb) return estado.asc ? -1 : 1;
      if (va > vb) return estado.asc ? 1 : -1;
      return 0;
    });

    let html = '<table class="grid ranking-table"><thead><tr>';
    COLUMNAS_RANKING.forEach((c) => {
      const activa = c.key === estado.key;
      const flecha = activa ? (estado.asc ? ' ▲' : ' ▼') : '';
      html += '<th class="sortable' + (activa ? ' active' : '') + '" data-key="' + c.key + '">' + c.label + flecha + '</th>';
    });
    html += '</tr></thead><tbody>';
    if (ordenado.length === 0) {
      html += '<tr><td colspan="4">Sin datos todavía.</td></tr>';
    }
    ordenado.forEach((r) => {
      html += '<tr><td class="name">' + r.jugador + '</td><td>' + r.puntosTotales + '</td><td>' + r.numTareas + '</td><td>' + r.promedio.toFixed(2) + '</td></tr>';
    });
    html += '</tbody></table>';

    const container = $('#' + containerId);
    container.innerHTML = html;
    container.querySelectorAll('th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (estado.key === key) {
          estado.asc = !estado.asc;
        } else {
          estado.key = key;
          estado.asc = (key === 'jugador');
        }
        pintarTablaRanking(containerId, ranking, tipo);
      });
    });
  }

  // ---------- Vista Jugador ----------

  let jugadorInit = false;
  let chartJugadorMensual, chartJugadorAnual;

  function initJugador() {
    if (jugadorInit) return;
    jugadorInit = true;

    $('#jugadorSaludo').textContent = 'Hola, ' + session.nombre;

    apiGet('calendario').then((res) => {
      if (!res.ok) return;
      const hoy = new Date().toISOString().slice(0, 7);
      const meses = Array.from(new Set(res.semanas.map((s) => s.mesAsignado))).sort();
      const mesActual = poblarSelectMeses($('#jugadorSelectMes'), meses, hoy);
      cargarRankingsJugador(mesActual);
    });

    $('#jugadorSelectMes').addEventListener('change', () => cargarRankingsJugador($('#jugadorSelectMes').value));
  }

  function cargarRankingsJugador(mes) {
    apiGet('rankingMensual', { mes }).then((res) => {
      if (!res.ok) return;
      chartJugadorMensual = pintarChart('chartJugadorMensual', chartJugadorMensual, res.ranking);
      pintarTop5('#jugadorTop5Mensual', res.ranking.slice(0, 5));
    });
    apiGet('rankingAnual').then((res) => {
      if (!res.ok) return;
      chartJugadorAnual = pintarChart('chartJugadorAnual', chartJugadorAnual, res.ranking);
      pintarTop5('#jugadorTop5Anual', res.ranking.slice(0, 5));
    });
  }

  // ---------- Descargar PDF (imprimir con estilo de marca) ----------

  let descargaPdfInit = false;

  function initDescargaPdf() {
    if (descargaPdfInit) return;
    descargaPdfInit = true;

    window.addEventListener('afterprint', () => {
      $$('.printing-target').forEach((el) => el.classList.remove('printing-target'));
    });

    $('#btnDescargarPdfRankings').addEventListener('click', () => {
      const mesLabel = formatMesLabel_($('#selectMes').value);
      $('#printSubtitleRankings').textContent = 'Ranking de ' + mesLabel + ' y acumulado anual — generado el ' + new Date().toLocaleDateString('es-ES');
      imprimirTarjeta_('#tabRankings');
    });

    $('#btnDescargarPdfPerfil').addEventListener('click', () => {
      const jugador = $('#selectPerfilJugador').value;
      $('#printSubtitlePerfil').textContent = 'Perfil de jugador — ' + jugador + ' — generado el ' + new Date().toLocaleDateString('es-ES');
      imprimirTarjeta_('#tabPerfil');
    });
  }

  function imprimirTarjeta_(selectorPanel) {
    const tarjeta = $(selectorPanel).querySelector('.card');
    tarjeta.classList.add('printing-target');
    window.print();
  }

  // ---------- Informe semanal (póster para el vestuario) ----------

  let informeInit = false;
  let chartInformeEvolucion;
  const COLORES_EVOLUCION = ['#0d6cb0', '#b51e45', '#f5b400', '#2f8f4e', '#7c3aed'];

  function initInformeSemanal() {
    if (informeInit) return;
    informeInit = true;

    apiGet('calendario').then((res) => {
      if (!res.ok) return;
      const hoy = new Date().toISOString().slice(0, 10);
      let semanaActual = res.semanas[0].numSemana;
      res.semanas.forEach((s) => {
        if (hoy >= s.fechaInicio && hoy <= s.fechaFin) semanaActual = s.numSemana;
        const opt = document.createElement('option');
        opt.value = s.numSemana;
        opt.textContent = 'Semana ' + s.numSemana + ' (' + s.fechaInicio + ' a ' + s.fechaFin + ')';
        $('#selectInformeSemana').appendChild(opt);
      });
      $('#selectInformeSemana').value = semanaActual;
      cargarInformeSemanal(semanaActual);
    });

    $('#selectInformeSemana').addEventListener('change', (e) => cargarInformeSemanal(e.target.value));

    $('#btnDescargarInforme').addEventListener('click', () => {
      $('#informePoster').classList.add('printing-target');
      window.print();
    });
  }

  function cargarInformeSemanal(numSemana) {
    apiGet('informeSemanal', { numSemana }).then((res) => {
      if (!res.ok) { $('#informePoster').innerHTML = '<p>' + res.error + '</p>'; return; }
      pintarInforme(res);
    });
  }

  function pintarInforme(data) {
    $('#informeSubtitulo').textContent = 'Semana ' + data.semana.numSemana + ' (' + data.semana.fechaInicio
      + ' a ' + data.semana.fechaFin + ') · ' + formatMesLabel_(data.mes);

    pintarPosterTop5_('#posterTop5Semanal', data.top5Semanal);
    pintarPosterTop5_('#posterTop5Mensual', data.top5Mensual);
    pintarPosterTop5_('#posterTop5Anual', data.top5Anual);

    chartInformeEvolucion = pintarChartEvolucionInforme_(data.evolucion, chartInformeEvolucion);
  }

  function pintarPosterTop5_(sel, top5) {
    if (top5.length === 0) {
      $(sel).innerHTML = '<li>Sin datos todavía.</li>';
      return;
    }
    $(sel).innerHTML = top5.map((r, idx) => {
      const rango = idx < 3 ? 'rank-' + (idx + 1) : '';
      return '<li class="' + rango + '"><span class="medal">' + (idx + 1) + '</span>'
        + '<div class="datos">'
        + '<span class="nombre">' + r.jugador + '</span>'
        + '<span class="substats">' + r.numTareas + ' tareas · promedio ' + r.promedio.toFixed(2) + '</span>'
        + '</div>'
        + '<span class="puntos">' + r.puntosTotales + ' pts</span></li>';
    }).join('');
  }

  function pintarChartEvolucionInforme_(evolucion, existente) {
    if (existente) existente.destroy();
    if (evolucion.jugadores.length === 0 || evolucion.semanas.length === 0) return null;

    const datasets = evolucion.jugadores.map((nombre, idx) => ({
      label: nombre,
      data: evolucion.semanas.map((s) => s.puntos[nombre] || 0),
      borderColor: COLORES_EVOLUCION[idx % COLORES_EVOLUCION.length],
      backgroundColor: 'transparent',
      tension: .3
    }));

    return new Chart($('#chartInformeEvolucion'), {
      type: 'line',
      data: { labels: evolucion.semanas.map((s) => 'S' + s.numSemana), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { ticks: { color: '#444' } }, y: { ticks: { color: '#444' } } },
        plugins: { legend: { display: true, labels: { color: '#222' } } }
      }
    });
  }

  // ---------- Arranque ----------

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js'));
  }

  loadSession();
  render();
})();
