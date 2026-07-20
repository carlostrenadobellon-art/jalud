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

  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.tab-panel').forEach((p) => p.classList.add('hidden'));
      $('#tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)).classList.remove('hidden');
    });
  });

  let tecnicoInit = false;

  function initTecnico() {
    if (tecnicoInit) return;
    tecnicoInit = true;

    apiGet('calendario').then((res) => {
      if (!res.ok) return;
      const hoy = new Date().toISOString().slice(0, 10);
      let semanaActual = res.semanas[0].numSemana;
      res.semanas.forEach((s) => {
        if (hoy >= s.fechaInicio && hoy <= s.fechaFin) semanaActual = s.numSemana;
        const opt = document.createElement('option');
        opt.value = s.numSemana;
        opt.textContent = 'Semana ' + s.numSemana + ' (' + s.fechaInicio + ' a ' + s.fechaFin + ')';
        $('#selectSemana').appendChild(opt);
      });
      $('#selectSemana').value = semanaActual;
      cargarSemana(semanaActual);
    });

    $('#selectSemana').addEventListener('change', (e) => cargarSemana(e.target.value));

    const hoyISO = new Date().toISOString().slice(0, 10);
    $('#altaFecha').value = hoyISO;
    $('#bajaFecha').value = hoyISO;
    [$('#altaFecha'), $('#bajaFecha')].forEach((inp) => {
      inp.addEventListener('click', function () { this.showPicker && this.showPicker(); });
    });
    cargarJugadoresParaBaja();

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

    const mesActual = new Date().toISOString().slice(0, 7);
    $('#selectMes').value = mesActual;
    $('#selectMes').addEventListener('change', () => cargarRankings($('#selectMes').value));
    cargarRankings(mesActual);
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

  let semanaEnCurso = null;

  function cargarSemana(numSemana) {
    semanaEnCurso = numSemana;
    apiGet('semana', { numSemana }).then((res) => {
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
    });
    apiGet('rankingAnual').then((res) => {
      if (!res.ok) return;
      chartAnual = pintarChart('chartAnual', chartAnual, res.ranking);
      pintarTop5('#top5Anual', res.ranking.slice(0, 5));
    });
  }

  function pintarChart(canvasId, existente, ranking) {
    const top = ranking.slice(0, 10);
    if (existente) existente.destroy();
    return new Chart($('#' + canvasId), {
      type: 'bar',
      data: {
        labels: top.map((r) => r.jugador),
        datasets: [{ label: 'Puntos', data: top.map((r) => r.puntosTotales), backgroundColor: '#38bdf8' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  function pintarTop5(sel, top5) {
    $(sel).innerHTML = top5.map((r) => '<li>' + r.jugador + ' — ' + r.puntosTotales + ' pts</li>').join('') || '<li>Sin datos</li>';
  }

  // ---------- Vista Jugador ----------

  let jugadorInit = false;
  let chartJugadorMensual, chartJugadorAnual;

  function initJugador() {
    if (jugadorInit) return;
    jugadorInit = true;

    $('#jugadorSaludo').textContent = 'Hola, ' + session.nombre;

    const mesActual = new Date().toISOString().slice(0, 7);
    $('#jugadorSelectMes').value = mesActual;
    $('#jugadorSelectMes').addEventListener('change', () => cargarRankingsJugador($('#jugadorSelectMes').value));
    cargarRankingsJugador(mesActual);
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

  // ---------- Arranque ----------

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js'));
  }

  loadSession();
  render();
})();
