/* ==========================================================================
   admin.js — panel de administracion de la tienda.
   Usa la misma capa de datos (Store.*) que la tienda: sirve igual en
   MODO_DEMO y con Firebase real. El acceso se decide con Store.esAdmin
   (nodo /admins/{uid} en Firebase; cuenta de prueba en demo).
   ========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var S = { usuario: null, admin: false, cargado: false };
  var offs = [];   // desuscripciones activas

  var ESTADOS = [
    'pendiente_pago', 'pago_informado', 'pago_confirmado', 'preparando',
    'listo_retirar', 'enviado', 'entregado', 'cancelado'
  ];
  var ESTADO_TXT = {
    pendiente_pago: 'Pendiente de pago', pago_informado: 'Pago informado',
    pago_confirmado: 'Pago confirmado', preparando: 'Preparando',
    listo_retirar: 'Listo para retirar', enviado: 'Enviado',
    entregado: 'Entregado', cancelado: 'Cancelado'
  };
  var PAY_TXT = { pendiente: 'Pago pendiente', informado: 'Pago informado', confirmado: 'Pago confirmado' };

  // ---------- utilidades ----------------------------------------------------
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtFecha(t) {
    if (!t) return '—';
    try { return new Date(t).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return '—'; }
  }
  var toastT = null;
  function toast(msg) {
    var el = $('toast'); if (!el) return;
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.classList.remove('on'); }, 2600);
  }
  function eta(extra, txt) { return '<span class="etiqueta ' + extra + '">' + esc(txt) + '</span>'; }

  // ---------- foto: arrastrar / elegir / pegar URL ---------------------------
  // Guarda el base64 cargado por arrastre (uno por formulario: producto y rec).
  var FOTO = { p: '', r: '' };
  var DROP = {};

  // Lee un archivo de imagen, lo achica a 1024px y lo devuelve como base64 (JPEG).
  function comprimirImagen(file, cb) {
    if (!file || !/^image\//.test(file.type || '')) return cb('Ese archivo no es una imagen.');
    if (file.size > 8 * 1024 * 1024) return cb('La imagen es muy grande (máximo 8 MB).');
    var fr = new FileReader();
    fr.onerror = function () { cb('No pude leer el archivo.'); };
    fr.onload = function () {
      var im = new Image();
      im.onerror = function () { cb('No pude abrir la imagen.'); };
      im.onload = function () {
        try {
          var max = 1024, w = im.width, h = im.height;
          var esc = Math.min(1, max / Math.max(w, h));
          w = Math.max(1, Math.round(w * esc)); h = Math.max(1, Math.round(h * esc));
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);   // fondo blanco (sin transparencias raras)
          ctx.drawImage(im, 0, 0, w, h);
          cb(null, c.toDataURL('image/jpeg', 0.82));
        } catch (e) { cb('No pude procesar la imagen.'); }
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  // Monta una zona de arrastre para un formulario (pref 'p' o 'r').
  function montarDrop(pref) {
    var key = pref;
    var zona = $(pref + 'Drop'), file = $(pref + 'File'), prev = $(pref + 'Prev'),
        txt = $(pref + 'DropTxt'), quitar = $(pref + 'Quitar'), url = $(pref + 'Img');
    if (!zona) return null;

    function pintar(src) {
      if (src) {
        prev.src = src; prev.style.display = 'block';
        if (txt) txt.style.display = 'none';
        if (quitar) quitar.style.display = 'inline-block';
      } else {
        prev.removeAttribute('src'); prev.style.display = 'none';
        if (txt) txt.style.display = 'block';
        if (quitar) quitar.style.display = 'none';
      }
    }
    function elegir(f) {
      comprimirImagen(f, function (err, data) {
        if (err) return toast(err);
        FOTO[key] = data; if (url) url.value = '';
        pintar(data); toast('Foto lista.');
      });
    }

    zona.addEventListener('click', function () { file.click(); });
    zona.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); }
    });
    file.addEventListener('change', function () { if (file.files && file.files[0]) elegir(file.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); zona.classList.add('on'); });
    });
    zona.addEventListener('dragleave', function (e) {
      if (!zona.contains(e.relatedTarget)) zona.classList.remove('on');
    });
    zona.addEventListener('dragend', function () { zona.classList.remove('on'); });
    zona.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation(); zona.classList.remove('on');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) elegir(f);
    });
    url.addEventListener('input', function () {
      var v = (url.value || '').trim();
      if (v) { FOTO[key] = ''; pintar(v); } else if (!FOTO[key]) pintar('');
    });
    quitar.addEventListener('click', function () {
      FOTO[key] = ''; if (url) url.value = ''; if (file) file.value = ''; pintar('');
    });

    return { pintar: pintar };
  }

  // Deja el formulario mostrando la imagen guardada (base64 o URL).
  function ponerFoto(key, img) {
    img = img || '';
    var drop = DROP[key], url = $(key + 'Img');
    if (/^data:/.test(img)) { FOTO[key] = img; if (url) url.value = ''; }
    else { FOTO[key] = ''; if (url) url.value = img; }
    if (drop) drop.pintar(img);
  }

  // Valor final de la foto al guardar: gana el arrastre (base64), si no la URL.
  function valorFoto(key) { return FOTO[key] || ((($(key + 'Img').value) || '').trim()); }

  // ---------- arranque ------------------------------------------------------
  function boot() {
    var m = window.CFG && CFG.marca;
    if (m) {
      if ($('marcaNombre')) $('marcaNombre').textContent = (m.nombre || 'Tienda') + ' · Panel';
      if ($('marcaLogo') && m.nombre) $('marcaLogo').textContent = String(m.nombre).trim().charAt(0).toUpperCase() || 'T';
      document.title = (m.nombre || 'Tienda') + ' — Panel';
    }
    if (Store.modo === 'demo' && $('bandaDemo')) $('bandaDemo').style.display = 'block';

    Store.init().then(function () {
      // En modo demo el acceso es una clave simple (no hay cuentas reales),
      // y no depende de la sesion de cliente de la tienda.
      if (Store.modo !== 'firebase') {
        if ($('loginDemo')) $('loginDemo').style.display = 'block';
        if ($('loginFb')) $('loginFb').style.display = 'none';
        return puerta();
      }
      if ($('loginDemo')) $('loginDemo').style.display = 'none';
      if ($('loginFb')) $('loginFb').style.display = 'block';
      Store.onUsuario(function (u) {
        S.usuario = u;
        if (!u) { S.admin = false; return puerta(); }
        Store.esAdmin(u.uid, u.email, function (ok) {
          S.admin = ok;
          puerta();
        });
      });
    }).catch(function (e) {
      toast('No se pudo inicializar la tienda.');
      if (window.console) console.error(e);
    });

    // login demo (clave simple)
    var btnDemo = $('btnEntrarDemo');
    if (btnDemo) btnDemo.addEventListener('click', entrarDemo);
    if ($('aPassDemo')) $('aPassDemo').addEventListener('keydown', function (e) { if (e.key === 'Enter') entrarDemo(); });

    // login firebase
    $('btnEntrarAdmin').addEventListener('click', function () {
      var email = ($('aEmail').value || '').trim();
      var pass = $('aPass').value || '';
      if (!email || !pass) return toast('Completá mail y contraseña.');
      this.disabled = true;
      var yo = this;
      Store.entrar(email, pass, function (res) {
        yo.disabled = false;
        if (res && res.error) return toast(res.error);
        toast('Bienvenido.');
      });
    });
    $('aPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btnEntrarAdmin').click(); });

    $('btnSalir').addEventListener('click', salir);
    $('btnSalirDenegado').addEventListener('click', salir);

    // tabs
    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.tab') : null;
      if (!b) return;
      var tab = b.getAttribute('data-tab');
      var tabs = document.querySelectorAll('.tab');
      for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i] === b);
      var visitas = ['pedidos', 'productos', 'recompensas', 'canjes', 'puntos', 'inicio'];
      visitas.forEach(function (v) {
        var el = $('v-' + v); if (el) el.classList.toggle('on', v === tab);
      });
    });

    enlazarForms();
  }

  // Acceso al panel con clave simple (modo demo y modo REST): sin cuenta real.
  function entrarDemo() {
    var el = $('aPassDemo');
    var pass = (el && el.value) || '';
    if (!pass) return toast('Escribí la contraseña.');
    var esperada = (Store.modo === 'rest')
      ? ((window.CFG && CFG.rest && CFG.rest.adminPass) || '')
      : ((window.CFG && CFG.demo && CFG.demo.adminPass) || '');
    if (pass !== esperada) return toast('Contraseña incorrecta.');
    S.usuario = { uid: (Store.modo === 'rest' ? 'admin' : 'demo-admin'), email: '', nombre: 'Administrador' };
    S.admin = true;
    if (el) el.value = '';
    toast('Bienvenido.');
    puerta();
  }

  function salir() {
    desconectar();
    S.cargado = false;
    if (Store.modo !== 'firebase') {
      S.usuario = null; S.admin = false;
      if ($('aPassDemo')) $('aPassDemo').value = '';
      toast('Sesión cerrada.');
      return puerta();
    }
    S.admin = false;
    Store.salir(function () { toast('Sesión cerrada.'); });
  }

  function desconectar() {
    offs.forEach(function (f) { try { f && f(); } catch (e) {} });
    offs = [];
  }

  // Muestra login, "sin permiso" o el panel.
  function puerta() {
    var p = $('puerta'), pan = $('panel');
    // MODO_DEMO: o entraste con la clave, o ves el login. No existe "sin permiso".
    if (Store.modo !== 'firebase') {
      if (S.admin) {
        p.style.display = 'none'; pan.style.display = 'block';
        if (!S.cargado) { S.cargado = true; cargarTodo(); }
      } else {
        p.style.display = 'block'; pan.style.display = 'none';
        $('puertaLogin').style.display = 'block';
        $('puertaDenegado').style.display = 'none';
      }
      return;
    }
    if (!S.usuario) {
      p.style.display = 'block'; pan.style.display = 'none';
      $('puertaLogin').style.display = 'block';
      $('puertaDenegado').style.display = 'none';
      return;
    }
    if (!S.admin) {
      p.style.display = 'block'; pan.style.display = 'none';
      $('puertaLogin').style.display = 'none';
      $('puertaDenegado').style.display = 'block';
      if ($('uidActual')) $('uidActual').textContent = S.usuario.uid || '—';
      return;
    }
    p.style.display = 'none'; pan.style.display = 'block';
    if (!S.cargado) { S.cargado = true; cargarTodo(); }
  }

  function cargarTodo() {
    offs.push(Store.onPedidos(pintarPedidos));
    offs.push(Store.onCanjesAdmin(pintarCanjes));
    offs.push(Store.onProductosAdmin(pintarProductos));
    offs.push(Store.onRecompensasAdmin(pintarRecompensas));
    Store.onCategoriasAdmin(function (cats) { cats = cats || []; llenarCategorias(cats); pintarCatsAdmin(cats); });
    offs.push(Store.onHero(pintarHero));
  }

  // ==========================================================================
  //  PEDIDOS
  // ==========================================================================
  function pintarPedidos(ps) {
    var cont = $('listaPedidos'); if (!cont) return;
    ps = ps || [];
    cont._datos = ps;   // ultimo snapshot, lo usa confirmarPago
    if (!ps.length) { cont.innerHTML = '<p class="aviso">Todavía no hay pedidos.</p>'; return; }
    cont.innerHTML = ps.map(function (p) {
      var cli = p.cliente || {};
      var pagoOk = p.pointsCredited || p.payStatus === 'confirmado';
      var tel = String(cli.telefono || '').replace(/\D/g, '');
      var wa = tel ? '<a class="btn-mini" target="_blank" rel="noopener" href="https://wa.me/' + esc(tel) + '">WhatsApp</a>' : '';
      var items = (p.items || []).map(function (i) {
        return esc(i.nombre) + ' ×' + i.cant + ' — ' + CFG.money(i.subtotal);
      }).join('<br>');
      var opts = ESTADOS.map(function (e) {
        return '<option value="' + e + '"' + (p.estado === e ? ' selected' : '') + '>' + esc(ESTADO_TXT[e] || e) + '</option>';
      }).join('');
      return '' +
        '<div class="admin-card">' +
          '<h3>' + esc(cli.nombre || 'Sin nombre') + ' · ' + CFG.money(p.total) + '</h3>' +
          '<p class="meta">' + fmtFecha(p.creadoEn) + ' · ' + esc(cli.telefono || 'sin teléfono') + '</p>' +
          '<p class="meta">' + items + '</p>' +
          '<p class="meta">' + (p.entrega === 'envio' ? 'Envío' : 'Retiro en local') + ' · ' + (p.pago === 'transferencia' ? 'Transferencia' : 'Efectivo') +
            ' · Puntos: ' + (p.puntosGanados || 0) + '</p>' +
          '<div class="equipo">' +
            eta(pagoOk ? 'ok' : (p.payStatus === 'informado' ? 'warn' : ''), PAY_TXT[p.payStatus] || 'Pago pendiente') +
            eta('', ESTADO_TXT[p.estado] || p.estado) +
          '</div>' +
          '<div class="acciones">' +
            '<button class="btn-mini ok" data-acc="pagar" data-id="' + esc(p.id) + '"' + (pagoOk ? ' disabled' : '') + '>Confirmar pago</button>' +
            '<select class="btn-mini" data-acc="estado" data-id="' + esc(p.id) + '">' + opts + '</select>' +
            wa +
          '</div>' +
        '</div>';
    }).join('');
  }

  // ==========================================================================
  //  CANJES
  // ==========================================================================
  function pintarCanjes(cs) {
    var cont = $('listaCanjes'); if (!cont) return;
    cs = cs || [];
    if (!cs.length) { cont.innerHTML = '<p class="aviso">No hay canjes.</p>'; return; }
    cont.innerHTML = cs.map(function (c) {
      var cls = c.status === 'aprobado' || c.status === 'entregado' ? 'ok' : (c.status === 'rechazado' ? 'mal' : 'warn');
      var acc = '';
      if (c.status === 'solicitado') {
        acc = '<button class="btn-mini ok" data-acc="aprobar" data-id="' + esc(c.id) + '">Aprobar</button>' +
              '<button class="btn-mini peligro" data-acc="rechazar" data-id="' + esc(c.id) + '">Rechazar</button>';
      } else if (c.status === 'aprobado') {
        acc = '<button class="btn-mini" data-acc="entregar" data-id="' + esc(c.id) + '">Marcar entregado</button>';
      }
      return '' +
        '<div class="admin-card">' +
          '<h3>' + esc(c.rewardNombre || 'Recompensa') + ' · ' + (c.costo || 0) + ' pts</h3>' +
          '<p class="meta">' + fmtFecha(c.creadoEn) + ' · cliente ' + esc(c.uid || '—') + '</p>' +
          '<div class="equipo">' + eta(cls, c.status || 'solicitado') + '</div>' +
          '<div class="acciones">' + acc + '</div>' +
        '</div>';
    }).join('');
  }

  // ==========================================================================
  //  PRODUCTOS
  // ==========================================================================
  function llenarCategorias(cats) {
    var sel = $('pCat'); if (!sel) return;
    var val = sel.value;
    sel.innerHTML = '<option value="">(sin categoría)</option>' + (cats || []).map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
    }).join('');
    sel.value = val;
  }

  function pintarProductos(arr) {
    var cont = $('listaProductos'); if (!cont) return;
    arr = arr || [];
    if (!arr.length) { cont.innerHTML = '<p class="aviso">No hay productos cargados.</p>'; return; }
    cont.innerHTML = arr.map(function (p) {
      return '' +
        '<div class="admin-card">' +
          '<h3>' + esc(p.name) + '</h3>' +
          '<p class="meta">' + CFG.money(p.price) + ' · stock ' + (p.stock || 0) + ' · ' + (p.pts || 0) + ' pts/u</p>' +
          '<div class="equipo">' + eta(p.active === false ? 'mal' : 'ok', p.active === false ? 'Oculto' : 'Visible') + '</div>' +
          '<div class="acciones">' +
            '<button class="btn-mini" data-acc="editarP" data-id="' + esc(p.id) + '">Editar</button>' +
            '<button class="btn-mini peligro" data-acc="borrarP" data-id="' + esc(p.id) + '">Borrar</button>' +
          '</div>' +
        '</div>';
    }).join('');
    cont._datos = arr;
  }

  function limpiarFormProd() {
    $('pId').value = ''; $('pNombre').value = ''; $('pPrecio').value = '';
    $('pStock').value = ''; $('pPts').value = ''; $('pDesc').value = ''
    ; $('pImg').value = ''; $('pActivo').checked = true; $('pCat').value = '';
    ponerFoto('p', '');
    $('tituloFormProd').textContent = 'Nuevo producto';
  }

  // ==========================================================================
  //  RECOMPENSAS
  // ==========================================================================
  function pintarRecompensas(arr) {
    var cont = $('listaRecompensas'); if (!cont) return;
    arr = arr || [];
    if (!arr.length) { cont.innerHTML = '<p class="aviso">No hay recompensas cargadas.</p>'; return; }
    cont.innerHTML = arr.map(function (r) {
      return '' +
        '<div class="admin-card">' +
          '<h3>' + esc(r.name) + '</h3>' +
          '<p class="meta">' + (r.cost || 0) + ' puntos · stock ' + (r.stock || 0) + '</p>' +
          '<div class="equipo">' + eta(r.active === false ? 'mal' : 'ok', r.active === false ? 'No disponible' : 'Disponible') + '</div>' +
          '<div class="acciones">' +
            '<button class="btn-mini" data-acc="editarR" data-id="' + esc(r.id) + '">Editar</button>' +
            '<button class="btn-mini peligro" data-acc="borrarR" data-id="' + esc(r.id) + '">Borrar</button>' +
          '</div>' +
        '</div>';
    }).join('');
    cont._datos = arr;
  }

  function limpiarFormRec() {
    $('rId').value = ''; $('rNombre').value = ''; $('rCosto').value = '';
    $('rStock').value = ''; $('rDesc').value = ''; $('rImg').value = '';
    ponerFoto('r', '');
    $('rActivo').checked = true; $('tituloFormRec').textContent = 'Nueva recompensa';
  }

  // ==========================================================================
  //  INICIO (imagenes del carrusel)
  // ==========================================================================
  function pintarHero(arr) {
    var gal = $('heroGaleria'); if (!gal) return;
    S.hero = (arr || []).map(function (im) { return im && im.src ? im : { src: im }; });
    if (!S.hero.length) {
      gal.innerHTML = '<p class="aviso">Todavía no cargaste ninguna imagen. La tienda muestra las de por defecto.</p>';
      return;
    }
    gal.innerHTML = S.hero.map(function (im, i) {
      return '<div class="hero-mini">' +
        '<img src="' + esc(im.src) + '" alt="Imagen del inicio ' + (i + 1) + '">' +
        '<button type="button" class="btn-mini" data-acc="quitarHero" data-idx="' + i + '">Quitar</button>' +
      '</div>';
    }).join('');
  }

  // Zona de arrastre MULTI para el hero (el max size y la compresion son iguales que en productos).
  function montarHeroDrop() {
    var zona = $('heroDrop'), file = $('heroFile');
    if (!zona) return;

    function elegirVarias(files) {
      var cola = Array.prototype.slice.call(files || []);
      if (!cola.length) return;
      var lista = (S.hero || []).slice();
      var pend = cola.length;

      cola.forEach(function (f) {
        comprimirImagen(f, function (err, data) {
          if (err) { toast(err); }
          else { lista.push({ src: data }); }
          pend -= 1;
          if (pend === 0) {
            Store.guardarHero(lista, function (r) {
              if (r && r.error) return toast(r.error);
              toast('Imágenes del inicio actualizadas (' + (r && r.n) + ').');
            });
          }
        });
      });
    }

    zona.addEventListener('click', function () { file.click(); });
    zona.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); }
    });
    file.addEventListener('change', function () { if (file.files && file.files.length) elegirVarias(file.files); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); zona.classList.add('on'); });
    });
    zona.addEventListener('dragleave', function (e) {
      if (!zona.contains(e.relatedTarget)) zona.classList.remove('on');
    });
    zona.addEventListener('dragend', function () { zona.classList.remove('on'); });
    zona.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation(); zona.classList.remove('on');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) elegirVarias(e.dataTransfer.files);
    });
    // despues de elegir, se puede volver a elegir el mismo archivo
    file.addEventListener('click', function () { this.value = ''; });
  }

  // ==========================================================================
  //  CATEGORIAS (administracion)
  // ==========================================================================
  function pintarCatsAdmin(cats) {
    var lista = $('listaCats'); if (!lista) return;
    cats = cats || [];
    if (!cats.length) { lista.innerHTML = '<span class="aviso">Sin categorías todavía.</span>'; return; }
    lista.innerHTML = cats.map(function (c) {
      return '<span class="etiqueta cat-chip">' + esc(c.name) +
        '<button type="button" class="cat-x" data-acc="borrarCat" data-id="' + esc(c.id) + '" title="Borrar categoría">×</button></span>';
    }).join('');
  }

  // ==========================================================================
  //  EVENTOS
  // ==========================================================================
  function buscarObj(contId, id) {
    var c = $(contId); var arr = (c && c._datos) || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  function enlazarForms() {
    // ---- fotos (arrastrar / elegir) ----
    DROP.p = montarDrop('p');
    DROP.r = montarDrop('r');

    // ---- inicio (hero): drop multi + galeria ----
    montarHeroDrop();
    $('heroGaleria').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-acc="quitarHero"]') : null;
      if (!b) return;
      var idx = Number(b.getAttribute('data-idx'));
      var lista = (S.hero || []).slice();
      if (isNaN(idx) || idx < 0 || idx >= lista.length) return;
      lista.splice(idx, 1);
      Store.guardarHero(lista, function (r) {
        if (r && r.error) return toast(r.error);
        toast('Imagen quitada.');
      });
    });

    // ---- categorias admin ----
    function nuevaCategoria() {
      var inp = $('nuevaCat'), v = (inp.value || '').trim();
      if (!v) return toast('Escribí el nombre de la categoría.');
      var yo = $('btnNuevaCat'); if (yo) yo.disabled = true;
      Store.guardarCategoria({ name: v }, function (r) {
        if (yo) yo.disabled = false;
        if (r && r.error) return toast(r.error);
        inp.value = ''; toast('Categoría agregada.');
      });
    }
    $('btnNuevaCat').addEventListener('click', nuevaCategoria);
    $('nuevaCat').addEventListener('keydown', function (e) { if (e.key === 'Enter') nuevaCategoria(); });
    $('listaCats').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-acc="borrarCat"]') : null;
      if (!b) return;
      var id = b.getAttribute('data-id');
      if (!window.confirm('¿Borrar la categoría? Los productos que la usen quedan sin categoría.')) return;
      Store.borrarCategoria(id, function (r) {
        if (r && r.error) return toast(r.error);
        toast('Categoría borrada.');
      });
    });
    // ---- pedidos y canjes (delegacion) ----
    $('listaPedidos').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-acc]') : null;
      if (!b) return;
      var acc = b.getAttribute('data-acc'), id = b.getAttribute('data-id');
      if (acc === 'pagar') {
        var ped = buscarPedido(id);
        b.disabled = true;
        Store.confirmarPago(id, ped, function (r) {
          if (r && r.error) { b.disabled = false; return toast(r.error); }
          toast('Pago confirmado' + (r && r.puntos ? ' · +' + r.puntos + ' puntos' : '') + '.');
        });
      }
    });
    $('listaPedidos').addEventListener('change', function (e) {
      var s = e.target.closest ? e.target.closest('[data-acc="estado"]') : null;
      if (!s) return;
      Store.cambiarEstadoPedido(s.getAttribute('data-id'), s.value, function (r) {
        if (r && r.error) return toast(r.error);
        toast('Estado actualizado.');
      });
    });

    $('listaCanjes').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-acc]') : null;
      if (!b) return;
      var acc = b.getAttribute('data-acc'), id = b.getAttribute('data-id');
      var map = { aprobar: 'aprobado', rechazar: 'rechazado', entregar: 'entregado' };
      var canje = buscarObj('listaCanjes', id);
      b.disabled = true;
      Store.resolverCanje(id, canje, map[acc], function (r) {
        if (r && r.error) { b.disabled = false; return toast(r.error); }
        toast('Canje ' + map[acc] + '.');
      });
    });

    // ---- productos ----
    $('listaProductos').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-acc]') : null;
      if (!b) return;
      var acc = b.getAttribute('data-acc'), id = b.getAttribute('data-id');
      if (acc === 'editarP') {
        var p = buscarObj('listaProductos', id); if (!p) return;
        $('pId').value = p.id || ''; $('pNombre').value = p.name || '';
        $('pPrecio').value = p.price != null ? p.price : ''; $('pStock').value = p.stock != null ? p.stock : '';
        $('pPts').value = p.pts != null ? p.pts : ''; $('pDesc').value = p.desc || '';
        $('pImg').value = p.img || ''; $('pCat').value = p.cat || '';
        ponerFoto('p', p.img || '');
        $('pActivo').checked = p.active !== false;
        $('tituloFormProd').textContent = 'Editar producto';
        document.querySelector('.tabs') && $('v-productos').scrollIntoView({ behavior: 'smooth' });
      } else if (acc === 'borrarP') {
        if (!window.confirm('¿Borrar el producto? No se puede deshacer.')) return;
        Store.borrarProducto(id, function (r) { toast(r && r.error ? r.error : 'Producto borrado.'); });
      }
    });
    $('btnGuardarProd').addEventListener('click', function () {
      var p = {
        id: $('pId').value || '', name: ($('pNombre').value || '').trim(),
        price: $('pPrecio').value, stock: $('pStock').value, pts: $('pPts').value,
        cat: $('pCat').value, desc: ($('pDesc').value || '').trim(),
        img: valorFoto('p'), active: $('pActivo').checked
      };
      if (!p.name) return toast('El producto necesita un nombre.');
      var yo = this; yo.disabled = true;
      Store.guardarProducto(p, function (r) {
        yo.disabled = false;
        if (r && r.error) return toast(r.error);
        toast('Producto guardado.'); limpiarFormProd();
      });
    });
    $('btnNuevoProd').addEventListener('click', limpiarFormProd);

    // ---- recompensas ----
    $('listaRecompensas').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-acc]') : null;
      if (!b) return;
      var acc = b.getAttribute('data-acc'), id = b.getAttribute('data-id');
      if (acc === 'editarR') {
        var r = buscarObj('listaRecompensas', id); if (!r) return;
        $('rId').value = r.id || ''; $('rNombre').value = r.name || '';
        $('rCosto').value = r.cost != null ? r.cost : ''; $('rStock').value = r.stock != null ? r.stock : '';
        $('rDesc').value = r.desc || ''; $('rImg').value = r.img || '';
        ponerFoto('r', r.img || '');
        $('rActivo').checked = r.active !== false;
        $('tituloFormRec').textContent = 'Editar recompensa';
        $('v-recompensas').scrollIntoView({ behavior: 'smooth' });
      } else if (acc === 'borrarR') {
        if (!window.confirm('¿Borrar la recompensa?')) return;
        Store.borrarRecompensa(id, function (r) { toast(r && r.error ? r.error : 'Recompensa borrada.'); });
      }
    });
    $('btnGuardarRec').addEventListener('click', function () {
      var r = {
        id: $('rId').value || '', name: ($('rNombre').value || '').trim(),
        cost: $('rCosto').value, stock: $('rStock').value,
        desc: ($('rDesc').value || '').trim(), img: valorFoto('r'),
        active: $('rActivo').checked
      };
      if (!r.name) return toast('La recompensa necesita un nombre.');
      var yo = this; yo.disabled = true;
      Store.guardarRecompensa(r, function (res) {
        yo.disabled = false;
        if (res && res.error) return toast(res.error);
        toast('Recompensa guardada.'); limpiarFormRec();
      });
    });
    $('btnNuevaRec').addEventListener('click', limpiarFormRec);

    // ---- puntos ----
    $('btnCargarPuntos').addEventListener('click', function () {
      var email = ($('ptEmail').value || '').trim();
      var puntos = $('ptPuntos').value;
      var motivo = ($('ptMotivo').value || '').trim();
      if (!email) return toast('Falta el mail del cliente.');
      if (!Number(puntos)) return toast('Poné una cantidad de puntos.');
      var yo = this; yo.disabled = true;
      Store.buscarUidPorEmail(email, function (uid) {
        if (!uid) { yo.disabled = false; return toast('No encontré un cliente con ese mail.'); }
        Store.cargarPuntos(uid, email, puntos, motivo, function (r) {
          yo.disabled = false;
          if (r && r.error) return toast(r.error);
          toast('Puntos cargados.'); $('ptPuntos').value = ''; $('ptMotivo').value = '';
        });
      });
    });
    $('btnVencimientos').addEventListener('click', function () {
      var yo = this; yo.disabled = true;
      Store.procesarVencimientos(function (r) {
        yo.disabled = false;
        if (r && r.error) return toast(r.error);
        toast('Vencimientos procesados: ' + ((r && r.procesados) || 0) + '.');
      });
    });
  }

  function buscarPedido(id) {
    return buscarObj('listaPedidos', id);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
