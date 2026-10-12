/* ==========================================================================
   store.js — capa de datos de la tienda.
   Tres modos, misma API para la UI:
     - MODO_DEMO  (nada configurado): datos de ejemplo en localStorage.
     - FIREBASE   (CFG.configurado = true): Realtime Database + Auth reales.
     - REST       (CFG.rest.base seteado): Realtime Database por HTTP puro, sin
                   SDK ni Auth, todo namespaceado bajo ese nodo (ej. /vibe).
   La UI nunca sabe en cual esta: solo llama a Store.* y recibe callbacks.
   ========================================================================== */
(function () {
  'use strict';

  var SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var LS_DEMO = 'tienda_demo_v1';
  var LS_SESION = 'vibe_sesion_v1';

  // Modo REST (Realtime Database por HTTP puro, sin SDK/Auth). Si CFG.rest.base
  // esta seteado, todo vive bajo ese nodo (ej. /vibe) y gana sobre los otros modos.
  var REST_BASE = (CFG.rest && CFG.rest.mode === 'rest') ? String(CFG.rest.base).replace(/\/+$/, '') : '';
  var REST_POLL = 8000;

  var db = null, auth = null, FB = null;

  var S = {
    modo: REST_BASE ? 'rest' : (CFG.configurado ? 'firebase' : 'demo'),
    usuario: null
  };

  // ---------- utilidades ----------------------------------------------------
  function ahora() { return Date.now(); }
  function num(n) { return Math.round(Number(n) || 0); }
  function clon(x) { return (typeof x === 'string') ? x : Object.assign({}, x); }

  // Bus del modo demo: emula el ref.on('value') de Firebase para que, al
  // guardar o borrar algo, las vistas del panel se refresquen solas.
  var DEMO_BUS = [];
  function demoOn(fn) { DEMO_BUS.push(fn); return fn; }
  function demoOff(fn) { var i = DEMO_BUS.indexOf(fn); if (i >= 0) DEMO_BUS.splice(i, 1); }
  function demoEmit() {
    var a = DEMO_BUS.slice();
    for (var i = 0; i < a.length; i++) { try { a[i](); } catch (e) {} }
  }

  function emailDeUid(uid) {
    return (uid && String(uid).indexOf('demo-') === 0) ? String(uid).slice(5) : '';
  }

  // ---------- helpers del modo REST ----------------------------------------
  function restUrl(path) { return REST_BASE + '/' + String(path).replace(/^\/+/, '') + '.json'; }

  function restFetch(url, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET' };
    if (init.method !== 'GET' && init.method !== 'DELETE') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opts.body === undefined ? null : opts.body);
    }
    try {
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(12000);
    } catch (e) {}
    return fetch(url, init).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }
  function restLeer(path) {
    return restFetch(restUrl(path)).then(function (txt) { return txt ? JSON.parse(txt) : null; })
      .catch(function () { return null; });
  }
  function restEscribir(path, val) {
    return restFetch(restUrl(path), { method: 'PUT', body: (val === undefined ? null : val) })
      .then(function () { return true; });
  }
  function restPost(path, val) {
    return restFetch(restUrl(path), { method: 'POST', body: (val === undefined ? null : val) })
      .then(function (txt) { var o = txt ? JSON.parse(txt) : {}; return o.name || null; });
  }
  function restBorrar(path) {
    return restFetch(restUrl(path), { method: 'DELETE' }).then(function () { return true; });
  }
  // PATCH multi-path de RTDB: las claves planas ('orders/x', 'pointsLots/u/lote')
  // se mandan TAL CUAL como body. El PATCH de Firebase tiene semantica de update()
  // (fusion SOLO en el primer nivel): si armamos un arbol anidado, cada escritura
  // REEMPLAZA los hijos del nodo padre y se pierden los lotes anteriores.
  // Con los paths como claves, RTDB hace multi-location update y fusiona cada hoja.
  // Verificado contra raki: 2 PATCH separados -> los 2 lotes sobreviven.
  function restActualizar(updates) {
    var body = {};
    for (var k in (updates || {})) {
      if (!Object.prototype.hasOwnProperty.call(updates, k)) continue;
      body[k] = updates[k];
    }
    return restFetch(REST_BASE + '.json', { method: 'PATCH', body: body }).then(function () { return true; });
  }
  // Poll por REST: emite solo si el valor cambio. Devuelve la funcion de baja.
  function restPoll(path, cb, ms) {
    var ultimo = null, vivo = true;
    function tick() {
      if (!vivo) return;
      restLeer(path).then(function (v) {
        if (!vivo) return;
        var txt = JSON.stringify(v === undefined ? null : v);
        if (txt !== ultimo) { ultimo = txt; cb(v); }
      });
    }
    tick();
    var id = setInterval(tick, ms || REST_POLL);
    return function () { vivo = false; clearInterval(id); };
  }
  // Indice propio mail -> uid. NO usamos orderBy/equalTo porque raki no tiene
  // .indexOn para 'email' y Firebase responde 400 "Index not defined".
  // Las claves de RTDB no admiten . # $ [ ] / -> se normalizan.
  function emailKey(email) {
    return String(email || '').toLowerCase().trim()
      .replace(/\./g, ',').replace(/[#$\[\]\/]/g, '_') || '_';
  }
  function restEmailPath(email) { return 'usersByEmail/' + emailKey(email); }
  function restSesionGuardar(u) { try { localStorage.setItem(LS_SESION, JSON.stringify(u || {})); } catch (e) {} }
  function restSesionLeer() { try { return JSON.parse(localStorage.getItem(LS_SESION)) || null; } catch (e) { return null; } }
  function restSesionLimpiar() { try { localStorage.removeItem(LS_SESION); } catch (e) {} }

  // ---------- estado del modo demo -----------------------------------------
  // El demo vive en localStorage. Garantizamos siempre las colecciones base y
  // una cuenta de administrador para poder probar el panel sin Firebase.
  function seedDemo(d) {
    d = d || {};
    d.cuentas = d.cuentas || {};
    d.admins = d.admins || {};
    d.pedidos = d.pedidos || [];
    d.canjes = d.canjes || [];
    d.lotes = d.lotes || {};
    d.ledger = d.ledger || {};
    return d;
  }
  function leerDemo() {
    try { return seedDemo(JSON.parse(localStorage.getItem(LS_DEMO)) || {}); }
    catch (e) { return seedDemo({}); }
  }
  function guardarDemo(d) {
    try { localStorage.setItem(LS_DEMO, JSON.stringify(d)); } catch (e) {}
    demoEmit();
  }

  // Helpers que devuelven la coleccion demo "viva" (editada por el admin).
  function demoProductos(d) { return d.productos || CFG.demo.products; }
  function demoRecompensas(d) { return d.recompensas || CFG.demo.rewards; }
  function demoCategorias(d) { return d.categorias || CFG.demo.categories; }

  // Resuelve la coleccion demo de una ruta de Firebase (products/rewards/...).
  function demoArr(ruta) {
    var d = leerDemo();
    if (ruta === 'products') return demoProductos(d);
    if (ruta === 'rewards') return demoRecompensas(d);
    if (ruta === 'categories') return demoCategorias(d);
    return d[ruta] || [];
  }

  // Saldo vigente a partir de los lotes (los vencidos no cuentan).
  function saldoDeLotes(lotes, t) {
    var s = 0;
    for (var k in (lotes || {})) {
      var l = lotes[k];
      if (!l) continue;
      if (l.expiresAt && l.expiresAt < t) continue;
      s += num(l.remaining);
    }
    return s;
  }

  // Consume puntos FIFO sobre los lotes vigentes (el mas proximo a vencer primero).
  function consumirFIFO(lotes, costo, t) {
    var falta = num(costo);
    var consumido = {};
    var ids = Object.keys(lotes || {}).filter(function (k) {
      var l = lotes[k];
      return l && num(l.remaining) > 0 && !(l.expiresAt && l.expiresAt < t);
    }).sort(function (a, b) {
      return num((lotes[a] || {}).expiresAt || 0) - num((lotes[b] || {}).expiresAt || 0);
    });
    for (var i = 0; i < ids.length && falta > 0; i++) {
      var k = ids[i], r = num((lotes[k] || {}).remaining);
      var toma = Math.min(r, falta);
      if (toma > 0) { consumido[k] = toma; falta -= toma; }
    }
    return { ok: falta <= 0, consumido: consumido, falta: falta };
  }

  // Acredita puntos en el demo: escribe lote + entrada del ledger (unificado).
  function acreditar(d, email, puntos, motivo, lotId) {
    var t = ahora();
    d.lotes = d.lotes || {}; d.lotes[email] = d.lotes[email] || {};
    d.lotes[email][lotId] = {
      puntos: num(puntos), remaining: num(puntos), creadoEn: t,
      expiresAt: t + num(CFG.negocio.diasVencimientoPuntos) * 864e5, motivo: motivo
    };
    d.ledger = d.ledger || {}; d.ledger[email] = d.ledger[email] || {};
    d.ledger[email][lotId] = { puntos: num(puntos), motivo: motivo, fecha: t };
  }

  // ---------- carga del SDK de Firebase (solo si esta configurado) ----------
  function cargarScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error('No cargo ' + src)); };
      document.head.appendChild(s);
    });
  }

  function init() {
    if (S.modo === 'rest') {
      var ses = restSesionLeer();
      if (ses && ses.uid) {
        S.usuario = { uid: ses.uid, email: ses.email || '', nombre: ses.nombre || '' };
        // Refrescar datos del usuario desde la base (sin bloquear el arranque).
        restLeer('users/' + ses.uid).then(function (u) {
          if (!u) return;
          S.usuario = { uid: ses.uid, email: u.email || ses.email || '', nombre: u.nombre || ses.nombre || '' };
          avisarUsuario();
        });
      }
      return Promise.resolve(S.modo);
    }
    if (S.modo === 'demo') {
      var d = leerDemo();
      if (d.sesion) {
        S.usuario = { uid: 'demo-' + d.sesion, email: d.sesion,
                      nombre: ((d.cuentas || {})[d.sesion] || {}).nombre || '' };
      }
      return Promise.resolve(S.modo);
    }
    return cargarScript(SDK + 'firebase-app-compat.js')
      .then(function () { return cargarScript(SDK + 'firebase-auth-compat.js'); })
      .then(function () { return cargarScript(SDK + 'firebase-database-compat.js'); })
      .then(function () {
        FB = window.firebase;
        if (!FB.apps.length) FB.initializeApp(CFG.firebase);
        db = FB.database();
        auth = FB.auth();
        return S.modo;
      });
  }

  // ---------- colecciones ---------------------------------------------------
  // En demo: devuelve los datos dados y los "emite" una vez.
  // En firebase: .on('value') y emite en cada cambio.
  function coleccion(ruta, demoDatos, cb) {
    if (S.modo === 'rest') {
      return restPoll(ruta, function (v) {
        v = v || {};
        var arr = Object.keys(v).map(function (k) {
          var o = clon(v[k]); o.id = v[k].id || k; return o;
        });
        cb(arr);
      });
    }
    if (S.modo === 'demo') {
      var fn = function () { cb((demoArr(ruta) || []).map(clon)); };
      setTimeout(fn, 0);
      demoOn(fn);
      return function () { demoOff(fn); };
    }
    var ref = db.ref(ruta);
    var f = ref.on('value', function (snap) {
      var v = snap.val() || {};
      var arr = Object.keys(v).map(function (k) {
        var o = clon(v[k]); o.id = v[k].id || k; return o;
      });
      cb(arr);
    }, function (err) { cb([], err); });
    return function () { ref.off('value', f); };
  }

  function onProductos(cb) {
    return coleccion('products', demoProductos(leerDemo()), function (arr, err) {
      arr = (arr || []).filter(function (p) { return p.active !== false; });
      arr.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
      cb(arr, err);
    });
  }
  function onCategorias(cb) {
    return coleccion('categories', demoCategorias(leerDemo()), function (arr, err) {
      arr.sort(function (a, b) { return num(a.order) - num(b.order); });
      cb(arr, err);
    });
  }
  function onRecompensas(cb) {
    return coleccion('rewards', demoRecompensas(leerDemo()), function (arr, err) {
      arr = (arr || []).filter(function (r) { return r.active !== false; });
      arr.sort(function (a, b) { return num(a.cost) - num(b.cost); });
      cb(arr, err);
    });
  }
  function onConfig(cb) {
    if (S.modo === 'rest') return restPoll('settings', function (v) { cb(v || {}); });
    if (S.modo === 'demo') { setTimeout(function () { cb({}); }, 0); return function () {}; }
    var ref = db.ref('settings');
    var f = ref.on('value', function (snap) { cb(snap.val() || {}); },
      function () { cb({}); });
    return function () { ref.off('value', f); };
  }

  // ---------- auth ----------------------------------------------------------
  function onUsuario(cb) {
    if (S.modo === 'demo' || S.modo === 'rest') {
      setTimeout(function () { cb(S.usuario); }, 0);
      USUARIO_CBS.push(cb);
      return function () {};
    }
    var f = auth.onAuthStateChanged(function (u) {
      S.usuario = u ? { uid: u.uid, email: u.email || '', nombre: (u.displayName || '') } : null;
      cb(S.usuario);
    });
    return function () { auth.offAuthStateChanged ? auth.offAuthStateChanged(f) : 0; };
  }
  var USUARIO_CBS = [];
  function avisarUsuario() { USUARIO_CBS.forEach(function (cb) { cb(S.usuario); }); }

  function entrar(email, pass, cb) {
    if (S.modo === 'rest') {
      return restLeer(restEmailPath(email)).then(function (uid) {
        if (!uid) return cb({ error: 'Mail o contrasena incorrectos.' });
        return restLeer('users/' + uid).then(function (u) {
          if (!u || u.pass !== pass) return cb({ error: 'Mail o contrasena incorrectos.' });
          S.usuario = { uid: uid, email: u.email || email, nombre: u.nombre || '' };
          restSesionGuardar(S.usuario);
          avisarUsuario(); cb({ ok: true });
        });
      }).catch(function () { cb({ error: 'Sin conexion.' }); });
    }
    if (S.modo === 'demo') {
      var d = leerDemo();
      var u = (d.cuentas || {})[email];
      if (!u || u.pass !== pass) return cb({ error: 'Mail o contrasena incorrectos (demo).' });
      d.sesion = email; guardarDemo(d);
      S.usuario = { uid: 'demo-' + email, email: email, nombre: u.nombre || '' };
      avisarUsuario(); return cb({ ok: true });
    }
    auth.signInWithEmailAndPassword(email, pass)
      .then(function () { cb({ ok: true }); })
      .catch(function (e) { cb({ error: traducir(e) }); });
  }

  function registrar(email, pass, nombre, cb) {
    if (S.modo === 'rest') {
      return restLeer(restEmailPath(email)).then(function (ya) {
        if (ya) return cb({ error: 'Ese mail ya esta registrado.' });
        var t = ahora();
        return restPost('users', { nombre: nombre || '', email: email, pass: pass, creadoEn: t })
          .then(function (uid) {
            if (!uid) return cb({ error: 'No se pudo crear la cuenta.' });
            var exp = t + num(CFG.negocio.diasVencimientoPuntos) * 864e5;
            var up = {};
            up['usersByEmail/' + emailKey(email)] = uid;
            up['pointsLots/' + uid + '/bienvenida'] = { puntos: 150, remaining: 150, creadoEn: t, expiresAt: exp, motivo: 'Bienvenida' };
            up['pointsLedger/' + uid + '/bienvenida'] = { puntos: 150, motivo: 'Bienvenida', fecha: t };
            return restActualizar(up).then(function () {
              S.usuario = { uid: uid, email: email, nombre: nombre || '' };
              restSesionGuardar(S.usuario);
              avisarUsuario(); cb({ ok: true });
            });
          });
      }).catch(function () { cb({ error: 'Sin conexion.' }); });
    }
    if (S.modo === 'demo') {
      var d = leerDemo();
      d.cuentas = d.cuentas || {};
      if (d.cuentas[email]) return cb({ error: 'Ese mail ya esta registrado (demo).' });
      d.cuentas[email] = { pass: pass, nombre: nombre || '' };
      // cortesia de bienvenida para poder probar el canje en demo
      acreditar(d, email, 150, 'Bienvenida (demo)', 'bienvenida');
      d.sesion = email;
      guardarDemo(d);
      S.usuario = { uid: 'demo-' + email, email: email, nombre: nombre || '' };
      avisarUsuario(); return cb({ ok: true });
    }
    auth.createUserWithEmailAndPassword(email, pass)
      .then(function (cred) {
        var u = cred.user;
        var up = {};
        if (nombre) up.displayName = nombre;
        up['users/' + u.uid + '/nombre'] = nombre || '';
        up['users/' + u.uid + '/email'] = u.email || email;
        up['users/' + u.uid + '/creadoEn'] = ahora();
        return db.ref().update(up).then(function () { return u.updateProfile({ displayName: nombre || '' }); });
      })
      .then(function () { cb({ ok: true }); })
      .catch(function (e) { cb({ error: traducir(e) }); });
  }

  function salir(cb) {
    if (S.modo === 'rest') {
      restSesionLimpiar();
      S.usuario = null; avisarUsuario(); return cb && cb();
    }
    if (S.modo === 'demo') {
      var d = leerDemo(); d.sesion = null; guardarDemo(d);
      S.usuario = null; avisarUsuario(); return cb && cb();
    }
    auth.signOut().then(function () { cb && cb(); });
  }

  function traducir(e) {
    var c = (e && e.code) || '';
    if (c.indexOf('invalid-email') >= 0) return 'El mail no es valido.';
    if (c.indexOf('user-not-found') >= 0) return 'No existe una cuenta con ese mail.';
    if (c.indexOf('wrong-password') >= 0) return 'Contrasena incorrecta.';
    if (c.indexOf('email-already-in-use') >= 0) return 'Ese mail ya tiene cuenta.';
    if (c.indexOf('weak-password') >= 0) return 'La contrasena es muy corta (minimo 6).';
    if (c.indexOf('network') >= 0) return 'Sin conexion.';
    if (c.indexOf('permission-denied') >= 0) return 'Permiso denegado.';
    return (e && e.message) || 'No se pudo completar la operacion.';
  }

  // ---------- pedidos -------------------------------------------------------
  // El pedido guarda un SNAPSHOT de precios y puntos: si despues cambia el
  // catalogo, el pedido viejo no se altera (y el admin confirma el pago a mano).
  function crearPedido(datos, cb) {
    var items = (datos.items || []).map(function (i) {
      return {
        id: i.product.id, nombre: i.product.name,
        precio: num(i.product.price), cant: num(i.cant),
        pts: num(i.product.pts), subtotal: num(i.product.price) * num(i.cant)
      };
    });
    var subtotal = items.reduce(function (a, i) { return a + i.subtotal; }, 0);
    var envio = num(datos.envio);
    var pedido = {
      uid: datos.uid || '',
      cliente: { nombre: datos.nombre || '', telefono: datos.telefono || '', nota: datos.nota || '' },
      entrega: datos.entrega || 'retiro',
      pago: datos.pago || 'efectivo',
      items: items,
      subtotal: subtotal, envio: envio, total: subtotal + envio,
      puntosGanados: items.reduce(function (a, i) { return a + i.pts * i.cant; }, 0),
      estado: 'pendiente_pago',
      payStatus: 'pendiente',
      pointsCredited: false,
      creadoEn: ahora()
    };

    if (S.modo === 'demo') {
      var d = leerDemo();
      pedido.id = 'demo-' + ahora();
      d.pedidos.unshift(pedido);
      guardarDemo(d);
      return cb({ ok: true, id: pedido.id, pedido: pedido });
    }

    if (S.modo === 'rest') {
      var coid = 'o' + ahora() + Math.random().toString(36).slice(2, 6);
      pedido.id = coid;
      return restEscribir('orders/' + coid, pedido).then(function () {
        if (!pedido.uid) return cb({ ok: true, id: coid, pedido: pedido });
        var upr = {};
        upr['userOrders/' + pedido.uid + '/' + coid] = { oid: coid, creadoEn: pedido.creadoEn, total: pedido.total, estado: pedido.estado };
        upr['users/' + pedido.uid + '/ultimoPedido'] = coid;
        return restActualizar(upr).then(function () { cb({ ok: true, id: coid, pedido: pedido }); });
      }).catch(function () { cb({ error: 'No se pudo guardar el pedido.' }); });
    }

    var oid = db.ref('orders').push().key;
    pedido.id = oid;
    var up = {};
    up['orders/' + oid] = pedido;
    // El indice por usuario y "ultimoPedido" solo tienen sentido con sesion.
    // (Un invitado sin cuenta no puede escribir bajo su uid.)
    if (pedido.uid) {
      up['userOrders/' + pedido.uid + '/' + oid] = { oid: oid, creadoEn: pedido.creadoEn, total: pedido.total, estado: pedido.estado };
      up['users/' + pedido.uid + '/ultimoPedido'] = oid;
    }
    db.ref().update(up)
      .then(function () { cb({ ok: true, id: oid, pedido: pedido }); })
      .catch(function (e) { cb({ error: traducir(e) }); });
  }

  // Los pedidos del cliente se leen por su indice (orders es solo-admin en raiz).
  function onMisPedidos(uid, cb) {
    if (S.modo === 'demo') {
      setTimeout(function () {
        var arr = (leerDemo().pedidos || []).filter(function (p) { return p.uid === uid; });
        arr.sort(function (a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
        cb(arr);
      }, 0);
      return function () {};
    }
    if (S.modo === 'rest') {
      return restPoll('userOrders/' + uid, function (v) {
        var ids = Object.keys(v || {});
        if (!ids.length) return cb([]);
        var out = [], pend = ids.length;
        var listo = function () {
          if (pend > 0) return;
          out.sort(function (a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
          cb(out);
        };
        ids.forEach(function (oid) {
          restLeer('orders/' + oid).then(function (o) {
            if (o) { o.id = oid; out.push(o); } pend--; listo();
          });
        });
      });
    }
    var idx = db.ref('userOrders/' + uid);
    var f = idx.on('value', function (snap) {
      var v = snap.val() || {};
      var ids = Object.keys(v);
      if (!ids.length) return cb([]);
      var out = [], pend = ids.length;
      var listo = function () {
        if (pend > 0) return;
        out.sort(function (a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
        cb(out);
      };
      ids.forEach(function (oid) {
        db.ref('orders/' + oid).once('value').then(function (os) {
          var o = os.val(); if (o) { o.id = oid; out.push(o); }
          pend--; listo();
        }, function () { pend--; listo(); });
      });
    }, function () { cb([]); });
    return function () { idx.off('value', f); };
  }

  // ---------- puntos y canjes ----------------------------------------------
  function onMisPuntos(uid, email, cb) {
    if (S.modo === 'demo') {
      var d = leerDemo();
      var lotes = (d.lotes || {})[email] || {};
      var saldo = saldoDeLotes(lotes, ahora());
      var led = (d.ledger || {})[email];
      var movs;
      if (led && Object.keys(led).length) {
        movs = Object.keys(led).map(function (k) {
          var m = led[k];
          return { id: k, puntos: num(m.puntos), motivo: m.motivo || 'Puntos', fecha: m.fecha };
        });
      } else {
        // Compatibilidad con datos viejos guardados antes del ledger unificado.
        movs = Object.keys(lotes).map(function (k) {
          var l = lotes[k];
          return { id: k, puntos: num(l.puntos), motivo: l.motivo || 'Puntos', fecha: l.creadoEn, vence: l.expiresAt, vencido: !!(l.expiresAt && l.expiresAt < ahora()) };
        });
      }
      movs.sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); });
      setTimeout(function () { cb({ saldo: saldo, movimientos: movs, diasVencimiento: CFG.negocio.diasVencimientoPuntos }); }, 0);
      return function () {};
    }
    if (S.modo === 'rest') {
      return restPoll('pointsLots/' + uid, function (lotes) {
        lotes = lotes || {};
        restLeer('pointsLedger/' + uid).then(function (led) {
          led = led || {};
          var movs = Object.keys(led).map(function (k) {
            var m = led[k];
            return { id: k, puntos: num(m.puntos), motivo: m.motivo || 'Puntos', fecha: m.fecha };
          });
          if (!movs.length) {
            movs = Object.keys(lotes).map(function (k) {
              var l = lotes[k];
              return { id: k, puntos: num(l.puntos), motivo: l.motivo || 'Puntos', fecha: l.creadoEn, vence: l.expiresAt, vencido: !!(l.expiresAt && l.expiresAt < ahora()) };
            });
          }
          movs.sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); });
          cb({ saldo: saldoDeLotes(lotes, ahora()), movimientos: movs, diasVencimiento: CFG.negocio.diasVencimientoPuntos });
        });
      });
    }
    var lotesRef = db.ref('pointsLots/' + uid);
    var ledRef = db.ref('pointsLedger/' + uid);
    function emitir() {
      lotesRef.once('value').then(function (ls) {
        var lotes = ls.val() || {};
        return ledRef.once('value').then(function (lg) {
          var movs = Object.keys(lg.val() || {}).map(function (k) {
            var m = clon(lg.val()[k]); m.id = k; return m;
          }).sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); });
          cb({ saldo: saldoDeLotes(lotes, ahora()), movimientos: movs, diasVencimiento: CFG.negocio.diasVencimientoPuntos });
        });
      }).catch(function () { cb({ saldo: 0, movimientos: [], diasVencimiento: CFG.negocio.diasVencimientoPuntos }); });
    }
    var f1 = lotesRef.on('value', emitir, function () { emitir(); });
    return function () { lotesRef.off('value', f1); };
  }

  function solicitarCanje(uid, reward, cb) {
    var c = {
      uid: uid, rewardId: reward.id, rewardNombre: reward.name,
      costo: num(reward.cost), status: 'solicitado', creadoEn: ahora()
    };
    if (S.modo === 'demo') {
      var d = leerDemo();
      c.id = 'demo-' + ahora();
      d.canjes.unshift(c);
      guardarDemo(d);
      return cb({ ok: true, id: c.id, canje: c });
    }
    if (S.modo === 'rest') {
      var rid = 'c' + ahora() + Math.random().toString(36).slice(2, 6);
      c.id = rid;
      return restEscribir('redemptions/' + rid, c).then(function () {
        var up = {};
        up['userRedemptions/' + uid + '/' + rid] = { rid: rid, creadoEn: c.creadoEn, costo: c.costo, status: c.status };
        return restActualizar(up).then(function () { cb({ ok: true, id: rid, canje: c }); });
      }).catch(function () { cb({ error: 'No se pudo solicitar el canje.' }); });
    }
    var rid = db.ref('redemptions').push().key;
    c.id = rid;
    var up = {};
    up['redemptions/' + rid] = c;
    up['userRedemptions/' + uid + '/' + rid] = { rid: rid, creadoEn: c.creadoEn, costo: c.costo, status: c.status };
    db.ref().update(up)
      .then(function () { cb({ ok: true, id: rid, canje: c }); })
      .catch(function (e) { cb({ error: traducir(e) }); });
  }

  // Los canjes del cliente se leen por su indice (redemptions es solo-admin en raiz).
  function onMisCanjes(cb) {
    var uid = S.usuario ? S.usuario.uid : '-';
    if (S.modo === 'demo') {
      setTimeout(function () {
        var arr = (leerDemo().canjes || []).filter(function (c) { return c.uid === uid; });
        arr.sort(function (a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
        cb(arr);
      }, 0);
      return function () {};
    }
    if (S.modo === 'rest') {
      return restPoll('userRedemptions/' + uid, function (v) {
        var ids = Object.keys(v || {});
        if (!ids.length) return cb([]);
        var out = [], pend = ids.length;
        var listo = function () {
          if (pend > 0) return;
          out.sort(function (a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
          cb(out);
        };
        ids.forEach(function (rid) {
          restLeer('redemptions/' + rid).then(function (o) {
            if (o) { o.id = rid; out.push(o); } pend--; listo();
          });
        });
      });
    }
    var idx = db.ref('userRedemptions/' + uid);
    var f = idx.on('value', function (snap) {
      var v = snap.val() || {};
      var ids = Object.keys(v);
      if (!ids.length) return cb([]);
      var out = [], pend = ids.length;
      var listo = function () {
        if (pend > 0) return;
        out.sort(function (a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
        cb(out);
      };
      ids.forEach(function (rid) {
        db.ref('redemptions/' + rid).once('value').then(function (cs) {
          var o = cs.val(); if (o) { o.id = rid; out.push(o); }
          pend--; listo();
        }, function () { pend--; listo(); });
      });
    }, function () { cb([]); });
    return function () { idx.off('value', f); };
  }

  // ==========================================================================
  //  SECCION ADMIN
  // ==========================================================================

  function esAdmin(uid, email, cb) {
    if (S.modo === 'demo') {
      var d = leerDemo();
      return setTimeout(function () { cb((d.admins || {})[email] === true); }, 0);
    }
    if (S.modo === 'rest') return setTimeout(function () { cb(uid === 'admin'); }, 0);
    if (!uid) return setTimeout(function () { cb(false); }, 0);
    db.ref('admins/' + uid).once('value')
      .then(function (s) { cb(s.val() === true); }, function () { cb(false); });
  }

  function adminLog(accion, extra) {
    if (S.modo === 'rest') {
      var eidR = ahora() + '_' + Math.random().toString(36).slice(2, 8);
      var regR = { accion: accion, fecha: ahora(), por: (S.usuario && (S.usuario.email || S.usuario.nombre)) || 'admin' };
      for (var kR in (extra || {})) { if (extra[kR] !== undefined) regR[kR] = extra[kR]; }
      restEscribir('adminLog/' + eidR, regR).catch(function () {});
      return;
    }
    if (S.modo !== 'firebase') return;
    var eid = ahora() + '_' + Math.random().toString(36).slice(2, 8);
    var reg = { accion: accion, fecha: ahora(), por: (S.usuario && S.usuario.email) || '' };
    for (var k in (extra || {})) { if (extra[k] !== undefined) reg[k] = extra[k]; }
    db.ref('adminLog/' + eid).set(reg).catch(function () {});
  }

  function onPedidos(cb) {
    if (S.modo === 'demo') {
      var fnP = function () {
        var arr = (leerDemo().pedidos || []).slice();
        arr.sort(function (a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
        cb(arr);
      };
      setTimeout(fnP, 0);
      demoOn(fnP);
      return function () { demoOff(fnP); };
    }
    if (S.modo === 'rest') {
      return restPoll('orders', function (v) {
        v = v || {};
        var arr = Object.keys(v).map(function (k) { var o = clon(v[k]); o.id = v[k].id || k; return o; });
        arr.sort(function (a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
        cb(arr);
      });
    }
    var ref = db.ref('orders');
    var f = ref.on('value', function (snap) {
      var v = snap.val() || {};
      var arr = Object.keys(v).map(function (k) { var o = clon(v[k]); o.id = v[k].id || k; return o; });
      arr.sort(function (a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
      cb(arr);
    }, function () { cb([]); });
    return function () { ref.off('value', f); };
  }

  function onCanjesAdmin(cb) {
    if (S.modo === 'demo') {
      var fnC = function () {
        var arr = (leerDemo().canjes || []).slice();
        arr.sort(function (a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
        cb(arr);
      };
      setTimeout(fnC, 0);
      demoOn(fnC);
      return function () { demoOff(fnC); };
    }
    if (S.modo === 'rest') {
      return restPoll('redemptions', function (v) {
        v = v || {};
        var arr = Object.keys(v).map(function (k) { var o = clon(v[k]); o.id = v[k].id || k; return o; });
        arr.sort(function (a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
        cb(arr);
      });
    }
    var ref = db.ref('redemptions');
    var f = ref.on('value', function (snap) {
      var v = snap.val() || {};
      var arr = Object.keys(v).map(function (k) { var o = clon(v[k]); o.id = v[k].id || k; return o; });
      arr.sort(function (a, b) { return (b.creadoEn || 0) - (a.creadoEn || 0); });
      cb(arr);
    }, function () { cb([]); });
    return function () { ref.off('value', f); };
  }

  function onProductosAdmin(cb) {
    return coleccion('products', demoProductos(leerDemo()).slice(), function (arr, err) {
      arr.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
      cb(arr, err);
    });
  }
  function onRecompensasAdmin(cb) {
    return coleccion('rewards', demoRecompensas(leerDemo()).slice(), function (arr, err) {
      arr.sort(function (a, b) { return num(a.cost) - num(b.cost); });
      cb(arr, err);
    });
  }
  function onCategoriasAdmin(cb) {
    return coleccion('categories', demoCategorias(leerDemo()).slice(), function (arr, err) {
      arr.sort(function (a, b) { return num(a.order) - num(b.order); });
      cb(arr, err);
    });
  }

  function guardarProducto(p, cb) {
    if (!p || !p.name) return cb({ error: 'El producto necesita un nombre.' });
    var obj = {
      name: p.name, desc: p.desc || '', price: num(p.price), cat: p.cat || '',
      img: p.img || '', stock: num(p.stock), pts: num(p.pts), active: p.active !== false
    };
    if (S.modo === 'demo') {
      var d = leerDemo();
      d.productos = d.productos || CFG.demo.products.map(clon);
      obj.id = p.id || ('p' + ahora());
      var idx = -1;
      for (var i = 0; i < d.productos.length; i++) if (d.productos[i].id === obj.id) { idx = i; break; }
      if (idx >= 0) d.productos[idx] = obj; else d.productos.unshift(obj);
      guardarDemo(d);
      return cb({ ok: true, id: obj.id });
    }
    if (S.modo === 'rest') {
      obj.id = p.id || ('p' + ahora());
      return restEscribir('products/' + obj.id, obj).then(function () {
        adminLog('producto_guardado', { id: obj.id, name: obj.name });
        cb({ ok: true, id: obj.id });
      }).catch(function () { cb({ error: 'No se pudo guardar el producto.' }); });
    }
    obj.id = p.id || db.ref('products').push().key;
    db.ref('products/' + obj.id).set(obj).then(function () {
      adminLog('producto_guardado', { id: obj.id, name: obj.name });
      cb({ ok: true, id: obj.id });
    }).catch(function (e) { cb({ error: traducir(e) }); });
  }

  function borrarProducto(id, cb) {
    if (!id) return cb({ error: 'Falta el id del producto.' });
    if (S.modo === 'demo') {
      var d = leerDemo();
      d.productos = (d.productos || CFG.demo.products).filter(function (x) { return x.id !== id; });
      guardarDemo(d);
      return cb({ ok: true });
    }
    if (S.modo === 'rest') {
      return restBorrar('products/' + id).then(function () {
        adminLog('producto_borrado', { id: id }); cb({ ok: true });
      }).catch(function () { cb({ error: 'No se pudo borrar el producto.' }); });
    }
    db.ref('products/' + id).remove().then(function () {
      adminLog('producto_borrado', { id: id }); cb({ ok: true });
    }).catch(function (e) { cb({ error: traducir(e) }); });
  }

  function guardarRecompensa(r, cb) {
    if (!r || !r.name) return cb({ error: 'La recompensa necesita un nombre.' });
    if (num(r.cost) <= 0) return cb({ error: 'El costo en puntos debe ser mayor a 0.' });
    var obj = { name: r.name, desc: r.desc || '', cost: num(r.cost), stock: num(r.stock), img: r.img || '', active: r.active !== false };
    if (S.modo === 'demo') {
      var d = leerDemo();
      d.recompensas = d.recompensas || CFG.demo.rewards.map(clon);
      obj.id = r.id || ('r' + ahora());
      var idx = -1;
      for (var i = 0; i < d.recompensas.length; i++) if (d.recompensas[i].id === obj.id) { idx = i; break; }
      if (idx >= 0) d.recompensas[idx] = obj; else d.recompensas.unshift(obj);
      guardarDemo(d);
      return cb({ ok: true, id: obj.id });
    }
    if (S.modo === 'rest') {
      obj.id = r.id || ('r' + ahora());
      return restEscribir('rewards/' + obj.id, obj).then(function () {
        adminLog('recompensa_guardada', { id: obj.id, name: obj.name });
        cb({ ok: true, id: obj.id });
      }).catch(function () { cb({ error: 'No se pudo guardar la recompensa.' }); });
    }
    obj.id = r.id || db.ref('rewards').push().key;
    db.ref('rewards/' + obj.id).set(obj).then(function () {
      adminLog('recompensa_guardada', { id: obj.id, name: obj.name });
      cb({ ok: true, id: obj.id });
    }).catch(function (e) { cb({ error: traducir(e) }); });
  }

  function borrarRecompensa(id, cb) {
    if (!id) return cb({ error: 'Falta el id de la recompensa.' });
    if (S.modo === 'demo') {
      var d = leerDemo();
      d.recompensas = (d.recompensas || CFG.demo.rewards).filter(function (x) { return x.id !== id; });
      guardarDemo(d);
      return cb({ ok: true });
    }
    if (S.modo === 'rest') {
      return restBorrar('rewards/' + id).then(function () {
        adminLog('recompensa_borrada', { id: id }); cb({ ok: true });
      }).catch(function () { cb({ error: 'No se pudo borrar la recompensa.' }); });
    }
    db.ref('rewards/' + id).remove().then(function () {
      adminLog('recompensa_borrada', { id: id }); cb({ ok: true });
    }).catch(function (e) { cb({ error: traducir(e) }); });
  }

  // Genera un slug válido para la regla de Firebase categories (name + slug).
  function slugDe(txt) {
    return String(txt || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cat';
  }

  function guardarCategoria(cat, cb) {
    if (!cat || !cat.name) return cb({ error: 'La categoría necesita un nombre.' });
    var obj = { name: String(cat.name).trim(), slug: cat.slug || slugDe(cat.name), order: num(cat.order) };
    if (S.modo === 'demo') {
      var d = leerDemo();
      d.categorias = d.categorias || CFG.demo.categories.map(clon);
      obj.id = cat.id || ('c' + ahora());
      if (!num(obj.order)) {
        var max = 0;
        d.categorias.forEach(function (c) { max = Math.max(max, num(c.order)); });
        obj.order = max + 1;
      }
      var idx = -1;
      for (var i = 0; i < d.categorias.length; i++) if (d.categorias[i].id === obj.id) { idx = i; break; }
      if (idx >= 0) d.categorias[idx] = obj; else d.categorias.unshift(obj);
      guardarDemo(d);
      return cb({ ok: true, id: obj.id });
    }
    if (S.modo === 'rest') {
      obj.id = cat.id || ('c' + ahora());
      var grC = function (order) {
        obj.order = order;
        return restEscribir('categories/' + obj.id, obj).then(function () {
          adminLog('categoria_guardada', { id: obj.id, name: obj.name }); cb({ ok: true, id: obj.id });
        }).catch(function () { cb({ error: 'No se pudo guardar la categoría.' }); });
      };
      if (num(obj.order)) return grC(num(obj.order));
      return restLeer('categories').then(function (v) {
        var maxC = 0;
        for (var kC in (v || {})) { maxC = Math.max(maxC, num((v[kC] || {}).order)); }
        return grC(maxC + 1);
      });
    }
    obj.id = cat.id || db.ref('categories').push().key;
    db.ref('categories/' + obj.id).set(obj).then(function () {
      adminLog('categoria_guardada', { id: obj.id, name: obj.name }); cb({ ok: true, id: obj.id });
    }).catch(function (e) { cb({ error: traducir(e) }); });
  }

  function borrarCategoria(id, cb) {
    if (!id) return cb({ error: 'Falta el id de la categoría.' });
    if (S.modo === 'demo') {
      var d = leerDemo();
      d.categorias = (d.categorias || CFG.demo.categories).filter(function (x) { return x.id !== id; });
      guardarDemo(d);
      return cb({ ok: true });
    }
    if (S.modo === 'rest') {
      return restBorrar('categories/' + id).then(function () {
        adminLog('categoria_borrada', { id: id }); cb({ ok: true });
      }).catch(function () { cb({ error: 'No se pudo borrar la categoría.' }); });
    }
    db.ref('categories/' + id).remove().then(function () {
      adminLog('categoria_borrada', { id: id }); cb({ ok: true });
    }).catch(function (e) { cb({ error: traducir(e) }); });
  }

  // Carrusel del inicio: es un ARRAY bajo settings/heroCarousel, así que no
  // pasa por `coleccion` (que espera un objeto de objetos). Igual re-emite en
  // demo gracias a demoEmit() global de guardarDemo().
  function onHero(cb) {
    if (S.modo === 'demo') {
      var fn = function () { cb((leerDemo().hero || []).map(clon)); };
      setTimeout(fn, 0);
      demoOn(fn);
      return function () { demoOff(fn); };
    }
    if (S.modo === 'rest') {
      return restPoll('settings/heroCarousel', function (v) { cb(v || []); });
    }
    var ref = db.ref('settings/heroCarousel');
    var f = ref.on('value', function (snap) { cb(snap.val() || []); });
    return function () { ref.off('value', f); };
  }

  function guardarHero(arr, cb) {
    if (S.modo === 'demo') {
      var d = leerDemo();
      d.hero = (arr || []).map(clon);
      guardarDemo(d);
      return cb({ ok: true, n: d.hero.length });
    }
    if (S.modo === 'rest') {
      return restEscribir('settings/heroCarousel', arr || []).then(function () {
        adminLog('hero_guardado', { n: (arr || []).length }); cb({ ok: true, n: (arr || []).length });
      }).catch(function () { cb({ error: 'No se pudo guardar el hero.' }); });
    }
    db.ref('settings/heroCarousel').set(arr || []).then(function () {
      adminLog('hero_guardado', { n: (arr || []).length }); cb({ ok: true, n: (arr || []).length });
    }).catch(function (e) { cb({ error: traducir(e) }); });
  }

  function confirmarPago(oid, pedido, cb) {
    if (!oid) return cb({ error: 'Falta el pedido.' });
    pedido = pedido || {};
    if (pedido.pointsCredited) return cb({ error: 'Ese pago ya estaba confirmado.' });
    var pts = num(pedido.puntosGanados);
    var t = ahora();
    var exp = t + num(CFG.negocio.diasVencimientoPuntos) * 864e5;
    var lotId = 'pago-' + oid;
    var motivo = 'Pago pedido ' + String(oid).slice(-6);
    var email = emailDeUid(pedido.uid);

    if (S.modo === 'demo') {
      var d = leerDemo();
      var p = null;
      (d.pedidos || []).forEach(function (x) { if (x.id === oid) p = x; });
      if (!p) return cb({ error: 'No encontre ese pedido (demo).' });
      if (p.pointsCredited) return cb({ error: 'Ese pago ya estaba confirmado.' });
      p.payStatus = 'confirmado'; p.estado = 'pago_confirmado';
      p.pointsCredited = true; p.confirmadoEn = t;
      var acreditados = 0;
      if (pts > 0 && email) { acreditar(d, email, pts, motivo, lotId); acreditados = pts; }
      guardarDemo(d);
      return cb({ ok: true, id: oid, puntos: acreditados });
    }

    if (S.modo === 'rest') {
      return restLeer('orders/' + oid).then(function (o) {
        if (!o) return cb({ error: 'No encontre ese pedido.' });
        if (o.pointsCredited) return cb({ error: 'Ese pago ya estaba confirmado.' });
        var upr = {};
        upr['orders/' + oid + '/payStatus'] = 'confirmado';
        upr['orders/' + oid + '/estado'] = 'pago_confirmado';
        upr['orders/' + oid + '/pointsCredited'] = true;
        upr['orders/' + oid + '/confirmadoEn'] = t;
        var puid = o.uid || pedido.uid;
        var acred = 0;
        if (puid && pts > 0) {
          upr['pointsLots/' + puid + '/' + lotId] = { puntos: pts, remaining: pts, creadoEn: t, expiresAt: exp, motivo: motivo };
          upr['pointsLedger/' + puid + '/' + lotId] = { puntos: pts, motivo: motivo, fecha: t };
          acred = pts;
        }
        return restActualizar(upr).then(function () {
          adminLog('pago_confirmado', { oid: oid, puntos: acred });
          cb({ ok: true, id: oid, puntos: acred });
        }).catch(function () { cb({ error: 'No se pudo confirmar el pago.' }); });
      });
    }
    db.ref('orders/' + oid).transaction(function (o) {
      if (o === null) return o;
      if (o.pointsCredited) return;             // aborta: ya estaba acreditado
      o.payStatus = 'confirmado';
      o.estado = 'pago_confirmado';
      o.pointsCredited = true;
      o.confirmadoEn = ahora();
      return o;
    }).then(function (res) {
      if (!res.committed) return cb({ error: 'Ese pago ya estaba confirmado.' });
      var uid = pedido.uid;
      if (!uid || pts <= 0) { adminLog('pago_confirmado', { oid: oid, puntos: 0 }); return cb({ ok: true, id: oid, puntos: 0 }); }
      var up = {};
      up['pointsLots/' + uid + '/' + lotId] = { puntos: pts, remaining: pts, creadoEn: t, expiresAt: exp, motivo: motivo };
      up['pointsLedger/' + uid + '/' + lotId] = { puntos: pts, motivo: motivo, fecha: t };
      db.ref().update(up).then(function () {
        adminLog('pago_confirmado', { oid: oid, puntos: pts });
        cb({ ok: true, id: oid, puntos: pts });
      }).catch(function (e) { cb({ error: traducir(e) }); });
    }).catch(function (e) { cb({ error: traducir(e) }); });
  }

  function cambiarEstadoPedido(oid, estado, cb) {
    if (!oid || !estado) return cb({ error: 'Faltan datos.' });
    if (S.modo === 'demo') {
      var d = leerDemo();
      var p = null;
      (d.pedidos || []).forEach(function (x) { if (x.id === oid) p = x; });
      if (!p) return cb({ error: 'No encontre ese pedido (demo).' });
      p.estado = estado; guardarDemo(d); return cb({ ok: true });
    }
    if (S.modo === 'rest') {
      var ue = {};
      ue['orders/' + oid + '/estado'] = estado;
      return restActualizar(ue).then(function () {
        adminLog('estado_cambiado', { oid: oid, estado: estado }); cb({ ok: true });
      }).catch(function () { cb({ error: 'No se pudo cambiar el estado.' }); });
    }
    db.ref('orders/' + oid).update({ estado: estado }).then(function () {
      adminLog('estado_cambiado', { oid: oid, estado: estado }); cb({ ok: true });
    }).catch(function (e) { cb({ error: traducir(e) }); });
  }

  function resolverCanje(rid, canje, status, cb) {
    if (!rid || !status) return cb({ error: 'Faltan datos.' });
    canje = canje || {};
    if (['aprobado', 'rechazado', 'entregado'].indexOf(status) < 0) return cb({ error: 'Estado de canje invalido.' });
    var t = ahora();
    var email = emailDeUid(canje.uid);

    if (S.modo === 'demo') {
      var d = leerDemo();
      var c = null;
      (d.canjes || []).forEach(function (x) { if (x.id === rid) c = x; });
      if (!c) return cb({ error: 'No encontre ese canje (demo).' });
      if (status === 'rechazado') { c.status = 'rechazado'; c.resueltoEn = t; guardarDemo(d); return cb({ ok: true }); }
      if (c.status !== 'solicitado') return cb({ error: 'Ese canje ya fue resuelto.' });
      var lotes = (d.lotes || {})[email] || {};
      var r = consumirFIFO(lotes, num(c.costo), t);
      if (!r.ok) return cb({ error: 'El cliente no tiene puntos suficientes.' });
      for (var k in r.consumido) lotes[k].remaining = num(lotes[k].remaining) - r.consumido[k];
      d.ledger = d.ledger || {}; d.ledger[email] = d.ledger[email] || {};
      d.ledger[email]['canje-' + rid] = { puntos: -num(c.costo), motivo: 'Canje: ' + (c.rewardNombre || ''), fecha: t };
      c.status = status; c.resueltoEn = t;
      guardarDemo(d);
      return cb({ ok: true });
    }

    if (S.modo === 'rest') {
      if (status === 'rechazado') {
        var urj = {};
        urj['redemptions/' + rid + '/status'] = 'rechazado';
        urj['redemptions/' + rid + '/resueltoEn'] = t;
        return restActualizar(urj).then(function () {
          adminLog('canje_rechazado', { rid: rid }); cb({ ok: true });
        }).catch(function () { cb({ error: 'No se pudo rechazar el canje.' }); });
      }
      var cuid = canje.uid;
      if (!cuid) return cb({ error: 'El canje no tiene usuario asociado.' });
      return restLeer('redemptions/' + rid).then(function (actual) {
        var st = (actual && actual.status) || canje.status || 'solicitado';
        if (st !== 'solicitado') return cb({ error: 'Ese canje ya fue resuelto.' });
        return restLeer('pointsLots/' + cuid).then(function (lotes) {
          lotes = lotes || {};
          var rc = consumirFIFO(lotes, num(canje.costo), t);
          if (!rc.ok) return cb({ error: 'El cliente no tiene puntos suficientes.' });
          var uc = {};
          for (var kc in rc.consumido) uc['pointsLots/' + cuid + '/' + kc + '/remaining'] = num((lotes[kc] || {}).remaining) - rc.consumido[kc];
          uc['redemptions/' + rid + '/status'] = status;
          uc['redemptions/' + rid + '/resueltoEn'] = t;
          uc['pointsLedger/' + cuid + '/canje-' + rid] = { puntos: -num(canje.costo), motivo: 'Canje: ' + (canje.rewardNombre || ''), fecha: t };
          return restActualizar(uc).then(function () {
            adminLog('canje_' + status, { rid: rid, costo: num(canje.costo) });
            cb({ ok: true });
          }).catch(function () { cb({ error: 'No se pudo resolver el canje.' }); });
        });
      });
    }
    if (status === 'rechazado') {
      return db.ref('redemptions/' + rid).update({ status: 'rechazado', resueltoEn: t }).then(function () {
        adminLog('canje_rechazado', { rid: rid }); cb({ ok: true });
      }).catch(function (e) { cb({ error: traducir(e) }); });
    }

    var uid = canje.uid;
    if (!uid) return cb({ error: 'El canje no tiene usuario asociado.' });
    db.ref('pointsLots/' + uid).transaction(function (lotes) {
      if (lotes === null) lotes = {};
      var r = consumirFIFO(lotes, num(canje.costo), ahora());
      if (!r.ok) return;                        // aborta: no alcanzan los puntos
      for (var k in r.consumido) lotes[k].remaining = num(lotes[k].remaining) - r.consumido[k];
      return lotes;
    }).then(function (res) {
      if (!res.committed) return cb({ error: 'El cliente no tiene puntos suficientes.' });
      var up = {};
      up['redemptions/' + rid + '/status'] = status;
      up['redemptions/' + rid + '/resueltoEn'] = t;
      up['pointsLedger/' + uid + '/canje-' + rid] = { puntos: -num(canje.costo), motivo: 'Canje: ' + (canje.rewardNombre || ''), fecha: t };
      db.ref().update(up).then(function () {
        adminLog('canje_' + status, { rid: rid, costo: num(canje.costo) });
        cb({ ok: true });
      }).catch(function (e) { cb({ error: traducir(e) }); });
    }).catch(function (e) { cb({ error: traducir(e) }); });
  }

  function procesarVencimientos(cb) {
    var t = ahora();
    if (S.modo === 'demo') {
      var d = leerDemo();
      var n = 0;
      for (var email in (d.lotes || {})) {
        var lotes = d.lotes[email] || {};
        for (var k in lotes) {
          var l = lotes[k];
          if (l && num(l.remaining) > 0 && l.expiresAt && l.expiresAt < t) {
            var pts = num(l.remaining);
            l.remaining = 0;
            d.ledger = d.ledger || {}; d.ledger[email] = d.ledger[email] || {};
            d.ledger[email]['venc-' + k] = { puntos: -pts, motivo: 'Vencimiento de puntos', fecha: t };
            n++;
          }
        }
      }
      guardarDemo(d);
      return cb({ ok: true, procesados: n });
    }
    if (S.modo === 'rest') {
      return restLeer('pointsLots').then(function (all) {
        all = all || {};
        var uvr = {}, nv = 0;
        for (var uidv in all) {
          var lotesv = all[uidv] || {};
          for (var kv in lotesv) {
            var lv = lotesv[kv];
            if (lv && num(lv.remaining) > 0 && lv.expiresAt && lv.expiresAt < t) {
              var pv = num(lv.remaining);
              uvr['pointsLots/' + uidv + '/' + kv + '/remaining'] = 0;
              uvr['pointsLedger/' + uidv + '/venc-' + kv] = { puntos: -pv, motivo: 'Vencimiento de puntos', fecha: t };
              nv++;
            }
          }
        }
        if (!nv) return cb({ ok: true, procesados: 0 });
        return restActualizar(uvr).then(function () {
          adminLog('vencimientos', { procesados: nv }); cb({ ok: true, procesados: nv });
        }).catch(function () { cb({ error: 'No se pudieron procesar los vencimientos.' }); });
      });
    }
    db.ref('pointsLots').once('value').then(function (snap) {
      var all = snap.val() || {};
      var up = {}, n = 0;
      for (var uid in all) {
        var lotes = all[uid] || {};
        for (var k in lotes) {
          var l = lotes[k];
          if (l && num(l.remaining) > 0 && l.expiresAt && l.expiresAt < t) {
            var pts = num(l.remaining);
            up['pointsLots/' + uid + '/' + k + '/remaining'] = 0;
            up['pointsLedger/' + uid + '/venc-' + k] = { puntos: -pts, motivo: 'Vencimiento de puntos', fecha: t };
            n++;
          }
        }
      }
      if (!n) return cb({ ok: true, procesados: 0 });
      db.ref().update(up).then(function () {
        adminLog('vencimientos', { procesados: n }); cb({ ok: true, procesados: n });
      }).catch(function (e) { cb({ error: traducir(e) }); });
    }).catch(function (e) { cb({ error: traducir(e) }); });
  }

  function cargarPuntos(uid, email, puntos, motivo, cb) {
    var pts = num(puntos);
    if (pts <= 0) return cb({ error: 'Los puntos deben ser mayores a 0.' });
    var lotId = 'manual-' + ahora();
    var t = ahora();
    var mot = motivo || 'Carga manual';
    if (S.modo === 'demo') {
      if (!email) return cb({ error: 'Falta el mail del cliente.' });
      var d = leerDemo();
      acreditar(d, email, pts, mot, lotId);
      guardarDemo(d);
      return cb({ ok: true, id: lotId });
    }
    if (S.modo === 'rest') {
      if (!uid) return cb({ error: 'Falta el uid del cliente.' });
      var upc = {};
      upc['pointsLots/' + uid + '/' + lotId] = { puntos: pts, remaining: pts, creadoEn: t, expiresAt: t + num(CFG.negocio.diasVencimientoPuntos) * 864e5, motivo: mot };
      upc['pointsLedger/' + uid + '/' + lotId] = { puntos: pts, motivo: mot, fecha: t };
      return restActualizar(upc).then(function () {
        adminLog('puntos_cargados', { uid: uid, puntos: pts }); cb({ ok: true, id: lotId });
      }).catch(function () { cb({ error: 'No se pudieron cargar los puntos.' }); });
    }
    if (!uid) return cb({ error: 'Falta el uid del cliente.' });
    var up = {};
    up['pointsLots/' + uid + '/' + lotId] = { puntos: pts, remaining: pts, creadoEn: t, expiresAt: t + num(CFG.negocio.diasVencimientoPuntos) * 864e5, motivo: mot };
    up['pointsLedger/' + uid + '/' + lotId] = { puntos: pts, motivo: mot, fecha: t };
    db.ref().update(up).then(function () {
      adminLog('puntos_cargados', { uid: uid, puntos: pts }); cb({ ok: true, id: lotId });
    }).catch(function (e) { cb({ error: traducir(e) }); });
  }

  // Busca el uid de un cliente por su mail. En REST usa el indice propio
  // usersByEmail (raki no tiene .indexOn para email -> orderBy daria 400).
  function buscarUidPorEmail(email, cb) {
    if (S.modo === 'demo') return setTimeout(function () { cb('demo-' + email); }, 0);
    if (S.modo === 'rest') {
      return restLeer(restEmailPath(email)).then(function (uid) { cb(uid || null); });
    }
    db.ref('users').orderByChild('email').equalTo(email).once('value').then(function (s) {
      var v = s.val() || {};
      var ids = Object.keys(v);
      cb(ids.length ? ids[0] : null);
    }).catch(function () { cb(null); });
  }

  window.Store = {
    modo: S.modo,
    init: init,
    onProductos: onProductos, onCategorias: onCategorias, onRecompensas: onRecompensas, onConfig: onConfig,
    onUsuario: onUsuario, entrar: entrar, registrar: registrar, salir: salir,
    crearPedido: crearPedido, onMisPedidos: onMisPedidos,
    onMisPuntos: onMisPuntos, solicitarCanje: solicitarCanje, onMisCanjes: onMisCanjes,
    saldoDeLotes: saldoDeLotes,
    // admin
    esAdmin: esAdmin, onPedidos: onPedidos, onCanjesAdmin: onCanjesAdmin,
    onProductosAdmin: onProductosAdmin, onRecompensasAdmin: onRecompensasAdmin, onCategoriasAdmin: onCategoriasAdmin,
    guardarProducto: guardarProducto, borrarProducto: borrarProducto,
    guardarRecompensa: guardarRecompensa, borrarRecompensa: borrarRecompensa,
    guardarCategoria: guardarCategoria, borrarCategoria: borrarCategoria,
    onHero: onHero, guardarHero: guardarHero,
    confirmarPago: confirmarPago, cambiarEstadoPedido: cambiarEstadoPedido,
    resolverCanje: resolverCanje, procesarVencimientos: procesarVencimientos,
    cargarPuntos: cargarPuntos, buscarUidPorEmail: buscarUidPorEmail,
    emailDeUid: emailDeUid, consumirFIFO: consumirFIFO
  };
})();
