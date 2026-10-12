/* ==========================================================================
   app.js — logica de la tienda (catalogo, carrito, pedido, cuenta y puntos).
   Depende de CFG (config.js) y Store (store.js).
   ========================================================================== */
(function () {
  'use strict';

  var LS_CARRITO = 'tienda_carrito_v1';

  var E = {
    productos: [], categorias: [], recompensas: [],
    filtroCat: '', busqueda: '',
    carrito: leerCarrito(),
    usuario: null, puntos: null
  };

  // ---------- helpers -------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function leerCarrito() {
    try { return JSON.parse(localStorage.getItem(LS_CARRITO)) || []; } catch (e) { return []; }
  }
  function guardarCarrito() {
    try { localStorage.setItem(LS_CARRITO, JSON.stringify(E.carrito)); } catch (e) {}
    pintarCarrito();
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }
  function totalCarrito() {
    return E.carrito.reduce(function (a, i) { return a + i.precio * i.cant; }, 0);
  }
  function cantidadCarrito() {
    return E.carrito.reduce(function (a, i) { return a + i.cant; }, 0);
  }

  // ---------- catalogo ------------------------------------------------------
  function pintarCategorias() {
    var c = $('cats');
    var html = '<button class="cat ' + (E.filtroCat === '' ? 'on' : '') + '" data-cat="">Todo</button>';
    E.categorias.forEach(function (k) {
      html += '<button class="cat ' + (E.filtroCat === k.id ? 'on' : '') + '" data-cat="' + esc(k.id) + '">' + esc(k.name) + '</button>';
    });
    c.innerHTML = html;
    Array.prototype.forEach.call(c.querySelectorAll('.cat'), function (b) {
      b.addEventListener('click', function () {
        E.filtroCat = b.getAttribute('data-cat');
        pintarCategorias(); pintarProductos();
      });
    });
  }

  function visibles() {
    var q = E.busqueda.trim().toLowerCase();
    return E.productos.filter(function (p) {
      if (E.filtroCat && p.cat !== E.filtroCat) return false;
      if (!q) return true;
      return (String(p.name || '') + ' ' + String(p.desc || '')).toLowerCase().indexOf(q) >= 0;
    });
  }

  function pintarProductos() {
    var g = $('grilla');
    var lista = visibles();
    if (!lista.length) {
      g.innerHTML = '<div class="vacio" style="grid-column:1/-1">No hay productos que coincidan.</div>';
      return;
    }
    g.innerHTML = lista.map(function (p) {
      var sinStock = Number(p.stock) <= 0;
      var img = p.img || p.imageBase64 || '';
      return '' +
        '<article class="card">' +
          '<div class="foto-wrap">' +
            (sinStock ? '<span class="badge">Sin stock</span>' : '') +
            '<div class="foto">' + (img ? '<img src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="lazy">' : '📦') + '</div>' +
          '</div>' +
          '<div class="cuerpo">' +
            '<h3>' + esc(p.name) + '</h3>' +
            (p.desc ? '<p class="desc">' + esc(p.desc) + '</p>' : '') +
            '<div class="pie">' +
              '<span class="precio">' + CFG.money(p.price) + '</span>' +
              (Number(p.pts) > 0 ? '<span class="pts">+' + Number(p.pts) + ' pts</span>' : '') +
              '<button class="btn-add" ' + (sinStock ? 'disabled' : '') + ' data-add="' + esc(p.id) + '">Agregar</button>' +
            '</div>' +
          '</div>' +
        '</article>';
    }).join('');
    Array.prototype.forEach.call(g.querySelectorAll('[data-add]'), function (b) {
      b.addEventListener('click', function () { agregar(b.getAttribute('data-add')); });
    });
  }

  // ---------- carrito -------------------------------------------------------
  function agregar(id) {
    var p = E.productos.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var it = E.carrito.filter(function (x) { return x.id === id; })[0];
    if (it) { it.cant++; }
    else {
      E.carrito.push({
        id: p.id, nombre: p.name, precio: Number(p.price) || 0,
        pts: Number(p.pts) || 0, cant: 1, img: p.img || p.imageBase64 || '', stock: Number(p.stock) || 0
      });
    }
    guardarCarrito();
    toast(p.name + ' agregado');
  }

  function cambiarCant(id, delta) {
    var it = E.carrito.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    it.cant += delta;
    if (it.cant <= 0) E.carrito = E.carrito.filter(function (x) { return x.id !== id; });
    guardarCarrito();
  }

  function quitar(id) {
    E.carrito = E.carrito.filter(function (x) { return x.id !== id; });
    guardarCarrito();
  }

  function pintarCarrito() {
    var n = cantidadCarrito();
    var pill = $('pillCant');
    pill.textContent = n;
    pill.classList.toggle('oculto', n === 0);

    var caja = $('itemsCarrito');
    if (!E.carrito.length) {
      caja.innerHTML = '<div class="vacio">El carrito esta vacio.</div>';
    } else {
      caja.innerHTML = E.carrito.map(function (i) {
        return '' +
          '<div class="item">' +
            '<div class="foto">' + (i.img ? '<img src="' + esc(i.img) + '" alt="">' : '📦') + '</div>' +
            '<div class="datos">' +
              '<h4>' + esc(i.nombre) + '</h4>' +
              '<div class="sub">' + CFG.money(i.precio) + ' c/u</div>' +
              '<div class="cant">' +
                '<button data-menos="' + esc(i.id) + '">−</button>' +
                '<span>' + i.cant + '</span>' +
                '<button data-mas="' + esc(i.id) + '">+</button>' +
                '<button class="quitar" data-quitar="' + esc(i.id) + '">Quitar</button>' +
              '</div>' +
            '</div>' +
            '<div style="font-weight:700">' + CFG.money(i.precio * i.cant) + '</div>' +
          '</div>';
      }).join('');
    }
    $('carritoTotal').textContent = CFG.money(totalCarrito());
    $('btnFinalizar').disabled = !E.carrito.length;

    ['mas', 'menos', 'quitar'].forEach(function (acc) {
      Array.prototype.forEach.call(caja.querySelectorAll('[data-' + acc + ']'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-' + acc);
          if (acc === 'quitar') quitar(id); else cambiarCant(id, acc === 'mas' ? 1 : -1);
        });
      });
    });
  }

  function abrirCarrito(v) {
    $('drawer').classList.toggle('on', v);
    $('velo').classList.toggle('on', v);
  }

  // ---------- modal generico ------------------------------------------------
  function modal(html) { $('modalCaja').innerHTML = html; $('modal').classList.add('on'); }
  function cerrarModal() { $('modal').classList.remove('on'); $('modalCaja').innerHTML = ''; }

  // ---------- pedido --------------------------------------------------------
  function abrirCheckout() {
    if (!E.carrito.length) return;
    modal('' +
      '<h2>Confirmar pedido</h2>' +
      '<div class="campo"><label>Tu nombre</label><input id="ckNombre" value="' + esc(E.usuario ? E.usuario.nombre : '') + '"></div>' +
      '<div class="campo"><label>Telefono</label><input id="ckTel" inputmode="tel"></div>' +
      '<div class="campo"><label>Entrega</label><select id="ckEntrega"><option value="retiro">Retiro en el local</option><option value="envio">Envio a domicilio</option></select></div>' +
      '<div class="campo"><label>Forma de pago</label><select id="ckPago"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option></select></div>' +
      '<div class="campo"><label>Nota (opcional)</label><textarea id="ckNota" rows="2"></textarea></div>' +
      '<div class="total"><span>Total</span><span>' + CFG.money(totalCarrito()) + '</span></div>' +
      '<button class="btn-principal" id="ckEnviar">Enviar pedido por WhatsApp</button>' +
      '<p class="aviso">El pedido queda registrado y el pago se confirma al recibirlo. Los puntos se acreditan cuando el pago queda confirmado.</p>' +
      '<button class="btn-carrito" id="ckCerrar" style="width:100%;margin-top:8px">Cancelar</button>');

    $('ckCerrar').addEventListener('click', cerrarModal);
    $('ckEnviar').addEventListener('click', function () { enviarPedido(); });
  }

  function enviarPedido() {
    var nombre = $('ckNombre').value.trim();
    var tel = $('ckTel').value.trim();
    if (!nombre) { toast('Pone tu nombre'); return; }
    if (!tel) { toast('Pone un telefono'); return; }

    var datos = {
      uid: E.usuario ? E.usuario.uid : null,
      nombre: nombre, telefono: tel,
      entrega: $('ckEntrega').value, pago: $('ckPago').value,
      nota: $('ckNota').value.trim(), envio: 0,
      items: E.carrito.map(function (i) { return { product: { id: i.id, name: i.nombre, price: i.precio, pts: i.pts }, cant: i.cant }; })
    };

    $('ckEnviar').disabled = true;
    Store.crearPedido(datos, function (r) {
      if (r.error) { $('ckEnviar').disabled = false; toast(r.error); return; }
      var texto = armarWa(datos, r.pedido);
      var url = CFG.marca.whatsapp
        ? 'https://wa.me/' + String(CFG.marca.whatsapp).replace(/\D/g, '') + '?text=' + encodeURIComponent(texto)
        : '';
      if (!url) toast('Pedido guardado. Falta configurar TIENDA_WHATSAPP.');
      else window.open(url, '_blank');
      E.carrito = []; guardarCarrito(); cerrarModal(); abrirCarrito(false);
      modal('<h2>Pedido enviado</h2><p class="ok">Listo. Te contactamos para confirmar el pago.</p>' +
            '<p class="aviso">Nro de pedido: ' + esc(String(r.id).slice(-6)) + '</p>' +
            '<button class="btn-principal" id="okCerrar">Cerrar</button>');
      $('okCerrar').addEventListener('click', cerrarModal);
      if (E.usuario) refrescarPuntos();
    });
  }

  function armarWa(d, pedido) {
    var l = ['*Pedido nuevo*'];
    (pedido ? pedido.items : []).forEach(function (i) {
      l.push('• ' + i.nombre + ' x' + i.cant + ' = ' + CFG.money(i.subtotal));
    });
    if (pedido) l.push('*Total: ' + CFG.money(pedido.total) + '*');
    l.push('');
    l.push('Nombre: ' + d.nombre);
    l.push('Telefono: ' + d.telefono);
    l.push('Entrega: ' + (d.entrega === 'envio' ? 'Envio' : 'Retiro en el local'));
    l.push('Pago: ' + (d.pago === 'transferencia' ? 'Transferencia' : 'Efectivo'));
    if (d.nota) l.push('Nota: ' + d.nota);
    return l.join('\n');
  }

  // ---------- cuenta y puntos ----------------------------------------------
  function pintarCuenta() {
    var b = $('btnCuenta');
    b.textContent = E.usuario ? (E.usuario.nombre || E.usuario.email).split(' ')[0] : 'Ingresar';
    var panel = $('panelPuntos');
    panel.style.display = E.usuario ? '' : 'none';
    if (E.usuario) refrescarPuntos();
  }

  function refrescarPuntos() {
    if (!E.usuario) return;
    Store.onMisPuntos(E.usuario.uid, E.usuario.email, function (p) {
      E.puntos = p;
      $('saldoPuntos').textContent = p.saldo;
      $('misMovimientos').innerHTML = (p.movimientos || []).slice(0, 6).map(function (m) {
        return '<div class="item"><div class="datos"><h4>' + esc(m.motivo || 'Puntos') + '</h4>' +
          '<div class="sub">' + (m.vence ? 'vence ' + new Date(m.vence).toLocaleDateString('es-AR') : '') + '</div></div>' +
          '<div style="font-weight:700">' + (m.puntos > 0 ? '+' : '') + m.puntos + '</div></div>';
      }).join('') || '<div class="vacio">Todavia no tenes movimientos.</div>';
      pintarRecompensas();
    });
  }

  function abrirCuenta() {
    if (E.usuario) {
      modal('<h2>Mi cuenta</h2>' +
        '<p><b>' + esc(E.usuario.nombre || '') + '</b><br><span class="sub">' + esc(E.usuario.email) + '</span></p>' +
        '<p>Puntos vigentes: <b class="ok">' + (E.puntos ? E.puntos.saldo : 0) + '</b></p>' +
        '<div id="misPedidosBox"></div>' +
        '<button class="btn-carrito" id="cuSalir" style="width:100%;margin-top:10px">Cerrar sesion</button>' +
        '<button class="btn-carrito" id="cuCerrar" style="width:100%;margin-top:8px">Volver</button>');
      $('cuCerrar').addEventListener('click', cerrarModal);
      $('cuSalir').addEventListener('click', function () {
        Store.salir(function () { cerrarModal(); toast('Sesion cerrada'); });
      });
      Store.onMisPedidos(E.usuario.uid, function (ps) {
        var box = $('misPedidosBox');
        if (!box) return;
        box.innerHTML = '<h3 style="font-size:.95rem;margin:14px 0 6px">Mis pedidos</h3>' + ((ps || []).length
          ? ps.map(function (p) {
              return '<div class="item"><div class="datos"><h4>' + CFG.money(p.total) + '</h4>' +
                '<div class="sub">' + new Date(p.creadoEn).toLocaleString('es-AR') + ' · ' + esc(p.estado) + '</div></div></div>';
            }).join('')
          : '<div class="vacio">Todavia no hiciste pedidos.</div>');
      });
      window.Store.onMisCanjes(function (cs) {
        var box = $('misPedidosBox');
        if (!box || !cs || !cs.length) return;
        box.innerHTML += '<h3 style="font-size:.95rem;margin:14px 0 6px">Mis canjes</h3>' + cs.map(function (c) {
          return '<div class="item"><div class="datos"><h4>' + esc(c.rewardNombre) + ' (' + c.costo + ' pts)</h4>' +
            '<div class="sub">' + esc(c.status) + '</div></div></div>';
        }).join('');
      });
      return;
    }
    modal('<h2>Ingresar</h2>' +
      '<div class="campo"><label>Mail</label><input id="acMail" type="email" autocomplete="email"></div>' +
      '<div class="campo" id="acNombreCampo" style="display:none"><label>Nombre</label><input id="acNombre"></div>' +
      '<div class="campo"><label>Contrasena</label><input id="acPass" type="password" autocomplete="current-password"></div>' +
      '<button class="btn-principal" id="acOk">Entrar</button>' +
      '<button class="btn-carrito" id="acAlt" style="width:100%;margin-top:8px">No tengo cuenta: registrarme</button>' +
      '<button class="btn-carrito" id="acCerrar" style="width:100%;margin-top:8px">Cancelar</button>');

    var modoAlta = false;
    function pintarModo() {
      $('acOk').textContent = modoAlta ? 'Crear cuenta' : 'Entrar';
      $('acAlt').textContent = modoAlta ? 'Ya tengo cuenta: ingresar' : 'No tengo cuenta: registrarme';
      $('acNombreCampo').style.display = modoAlta ? '' : 'none';
    }
    $('acAlt').addEventListener('click', function () { modoAlta = !modoAlta; pintarModo(); });
    $('acCerrar').addEventListener('click', cerrarModal);
    $('acOk').addEventListener('click', function () {
      var mail = $('acMail').value.trim(), pass = $('acPass').value;
      if (!mail || !pass) { toast('Completa mail y contrasena'); return; }
      var fin = function (r) {
        if (r.error) { toast(r.error); return; }
        cerrarModal(); toast(modoAlta ? 'Cuenta creada' : 'Hola de nuevo');
      };
      if (modoAlta) Store.registrar(mail, pass, $('acNombre').value.trim(), fin);
      else Store.entrar(mail, pass, fin);
    });
  }

  // ---------- recompensas ---------------------------------------------------
  function pintarRecompensas() {
    var g = $('grillaRecompensas');
    var saldo = E.puntos ? E.puntos.saldo : 0;
    if (!E.recompensas.length) { g.innerHTML = '<div class="vacio" style="grid-column:1/-1">Sin recompensas por ahora.</div>'; return; }
    g.innerHTML = E.recompensas.map(function (r) {
      var alcanza = E.usuario && saldo >= Number(r.cost);
      var img = r.img || '';
      return '<article class="card"><div class="foto-wrap">' +
        '<div class="foto">' + (img ? '<img src="' + esc(img) + '" alt="' + esc(r.name) + '" loading="lazy">' : '🎁') + '</div>' +
        '</div><div class="cuerpo">' +
        '<h3>' + esc(r.name) + '</h3>' +
        (r.desc ? '<p class="desc">' + esc(r.desc) + '</p>' : '') +
        '<div class="pie"><span class="precio">' + Number(r.cost) + ' pts</span>' +
        '<button class="btn-add" ' + (alcanza ? '' : 'disabled') + ' data-canje="' + esc(r.id) + '">' +
        (E.usuario ? (alcanza ? 'Canjear' : 'Faltan puntos') : 'Ingresa para canjear') + '</button></div>' +
        '</div></article>';
    }).join('');
    Array.prototype.forEach.call(g.querySelectorAll('[data-canje]'), function (b) {
      b.addEventListener('click', function () {
        if (!E.usuario) { abrirCuenta(); return; }
        var r = E.recompensas.filter(function (x) { return x.id === b.getAttribute('data-canje'); })[0];
        Store.solicitarCanje(E.usuario.uid, r, function (res) {
          if (res.error) { toast(res.error); return; }
          toast('Canje solicitado: ' + r.name);
          refrescarPuntos();
        });
      });
    });
  }

  // ---------- arranque ------------------------------------------------------
  Store.init().then(function () {
    $('marcaNombre').textContent = CFG.marca.nombre;
    $('marcaLogo').textContent = String(CFG.marca.nombre || 'T').trim().charAt(0).toUpperCase() || 'T';
    document.title = CFG.marca.nombre;
    if (Store.modo === 'demo') $('bandaDemo').style.display = '';

    $('buscar').addEventListener('input', function () { E.busqueda = this.value; pintarProductos(); });
    $('btnCarrito').addEventListener('click', function () { abrirCarrito(true); });
    $('cerrarCarrito').addEventListener('click', function () { abrirCarrito(false); });
    $('velo').addEventListener('click', function () { abrirCarrito(false); cerrarModal(); });
    $('btnFinalizar').addEventListener('click', abrirCheckout);
    $('btnCuenta').addEventListener('click', abrirCuenta);

    Store.onCategorias(function (c) { E.categorias = c || []; pintarCategorias(); });
    Store.onProductos(function (p, err) {
      E.productos = p || [];
      if (err) toast('No se pudo leer el catalogo');
      pintarProductos();
    });
    Store.onRecompensas(function (r) { E.recompensas = r || []; pintarRecompensas(); });
    Store.onUsuario(function (u) { E.usuario = u; pintarCuenta(); });
    Store.onHero(function (h) { if (window.Hero) Hero.usar(h || []); });

    pintarCarrito();
  }).catch(function (e) {
    $('bandaDemo').style.display = '';
    $('bandaDemo').innerHTML = '<b>No se pudo cargar la tienda.</b> Revisá la configuración (js/env.js).';
    console.error(e);
  });
})();

/* ===== HERO CARRUSEL (estetica AIMARA) ===== */
(function () {
  function $(id) { return document.getElementById(id); }
  var sec = $('heroSection');
  if (!sec) return;
  var heroImages = (window.HERO_SLIDES && HERO_SLIDES.length) ? HERO_SLIDES.slice() : [];
  var currentSlide = 0, slideInterval = null;
  var slidesC = $('heroSlides'), dotsC = $('heroDots');

  function renderHeroCarousel() {
    if (!slidesC) return;
    slidesC.innerHTML = heroImages.map(function (img, idx) {
      return '<div class="hero-slide' + (idx === currentSlide ? ' active' : '') + '" style="background-image: url(\'' + img + '\');"></div>';
    }).join('');
    if (dotsC) {
      dotsC.innerHTML = heroImages.map(function (_, idx) {
        return '<div class="hero-dot' + (idx === currentSlide ? ' active' : '') + '" data-slide="' + idx + '"></div>';
      }).join('');
      Array.prototype.forEach.call(dotsC.children, function (dot) {
        dot.addEventListener('click', function (e) { goToSlide(parseInt(e.currentTarget.getAttribute('data-slide'), 10)); });
      });
    }
  }
  function goToSlide(index) {
    if (!heroImages.length) return;
    if (index < 0) index = heroImages.length - 1;
    if (index >= heroImages.length) index = 0;
    currentSlide = index;
    Array.prototype.forEach.call(document.querySelectorAll('.hero-slide'), function (s, i) { s.classList.toggle('active', i === currentSlide); });
    Array.prototype.forEach.call(document.querySelectorAll('.hero-dot'), function (d, i) { d.classList.toggle('active', i === currentSlide); });
    resetAutoSlide();
  }
  function nextSlide() { goToSlide(currentSlide + 1); }
  function prevSlide() { goToSlide(currentSlide - 1); }
  function startAutoSlide() { if (slideInterval) clearInterval(slideInterval); slideInterval = setInterval(nextSlide, 5000); }
  function resetAutoSlide() { if (slideInterval) { clearInterval(slideInterval); startAutoSlide(); } }
  function pauseAutoSlide() { if (slideInterval) clearInterval(slideInterval); slideInterval = null; }
  function resumeAutoSlide() { if (!slideInterval && heroImages.length > 1) startAutoSlide(); }

  // Reemplaza las imagenes del carrusel por las de la base (vienen como
  // array de strings data-URI o de {src:...}; acepta ambas).
  function usar(arr) {
    if (!arr || !arr.length) return;
    heroImages = arr.map(function (im) { return (im && im.src) ? im.src : im; });
    currentSlide = 0;
    renderHeroCarousel();
    resumeAutoSlide();
  }

  var p = $('heroPrev'), n = $('heroNext'), btn = $('heroShopBtn');
  if (p) p.addEventListener('click', function () { prevSlide(); resetAutoSlide(); });
  if (n) n.addEventListener('click', function () { nextSlide(); resetAutoSlide(); });
  sec.addEventListener('mouseenter', pauseAutoSlide);
  sec.addEventListener('mouseleave', resumeAutoSlide);
  if (btn) btn.addEventListener('click', function () {
    var g = $('grilla');
    if (g) g.scrollIntoView({ behavior: 'smooth' });
  });

  renderHeroCarousel();
  startAutoSlide();

  window.Hero = { usar: usar };
})();
