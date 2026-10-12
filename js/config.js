/* ==========================================================================
   config.js — configuracion de la tienda (sin build, sin framework)
   Lee window.__ENV (generado por generar_env.py a partir de .env).
   Si no hay Firebase configurado, la app corre en MODO_DEMO con datos de
   ejemplo: alcanza para desarrollar y probar la UI antes de crear el proyecto.
   ========================================================================== */
(function () {
  'use strict';

  var ENV = (typeof window !== 'undefined' && window.__ENV) ? window.__ENV : {};

  var firebase = {
    apiKey: ENV.FIREBASE_API_KEY || '',
    authDomain: ENV.FIREBASE_AUTH_DOMAIN || '',
    databaseURL: ENV.FIREBASE_DATABASE_URL || '',
    projectId: ENV.FIREBASE_PROJECT_ID || '',
    storageBucket: ENV.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: ENV.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: ENV.FIREBASE_APP_ID || ''
  };

  // Consideramos "configurado" si estan los 3 datos imprescindibles.
  var configurado = !!(firebase.apiKey && firebase.databaseURL && firebase.projectId);

  // Modo REST: usar la Realtime Database por HTTP puro (sin SDK ni Auth),
  // namespaceando todo bajo un nodo (ej. /vibe). Sirve para reusar una base
  // que ya existe cuando no se puede/quiere montar Firebase Auth.
  var rest = {
    base: ENV.REST_BASE || '',
    adminPass: ENV.REST_ADMIN_PASS || 'vibe'
  };
  rest.mode = rest.base ? 'rest' : '';

  var CFG = {
    firebase: firebase,
    rest: rest,
    configurado: configurado,
    marca: {
      nombre: ENV.TIENDA_NOMBRE || 'VIBE',
      whatsapp: ENV.TIENDA_WHATSAPP || '',
      moneda: ENV.TIENDA_MONEDA || 'ARS'
    },
    // Reglas de negocio (se pueden pisar desde /settings en Firebase)
    negocio: {
      diasVencimientoPuntos: 180,   // 6 meses, como pide la spec
      envioGratisDesde: 0,          // 0 = sin promo
      requiereAprobacionCanje: true // canje solicitado por el cliente y aprobado por el admin
    },
    demo: {
      // Clave de administrador SOLO para el modo de ejemplo (no existe en produccion:
      // en Firebase el admin se decide por el nodo /admins/{uid}).
      adminPass: 'vibe',
      categories: [
        { id: 'c1', name: 'Categoria A', slug: 'cat-a', order: 1 },
        { id: 'c2', name: 'Categoria B', slug: 'cat-b', order: 2 }
      ],
      products: [
        { id: 'd1', name: 'Producto de ejemplo 1', desc: 'Descripcion de ejemplo.', price: 15000, cat: 'c1', img: '', stock: 10, active: true, pts: 15 },
        { id: 'd2', name: 'Producto de ejemplo 2', desc: 'Descripcion de ejemplo.', price: 8900, cat: 'c1', img: '', stock: 4, active: true, pts: 8 },
        { id: 'd3', name: 'Producto de ejemplo 3', desc: 'Descripcion de ejemplo.', price: 24500, cat: 'c2', img: '', stock: 0, active: true, pts: 24 }
      ],
      rewards: [
        { id: 'r1', name: 'Recompensa de ejemplo', desc: 'Canje simple.', cost: 100, stock: 5, active: true, img: '' }
      ]
    }
  };

  // --- helpers compartidos -------------------------------------------------
  CFG.money = function (n) {
    var v = Math.round(Number(n) || 0);
    return '$' + v.toLocaleString('es-AR');
  };

  CFG.CATEGORIA_COLOR = function () { return '#0E2A47'; };

  window.CFG = CFG;
})();
