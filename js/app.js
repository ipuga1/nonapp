'use strict';
/* ════════════════════════════════════════════
   RAÍZ · JS UNIFICADO · BLOQUE 1
   Módulos 1 (Auth) + 2 (Shell + Home)
   ════════════════════════════════════════════ */

/* ── CAPA DE DATOS ── */
/* ════════════════════════════════════════════════════════
   CAPA DE DATOS — Firebase Firestore
   Arquitectura: caché en memoria (síncrona) + Firestore (asíncrona)
   Los módulos leen del caché; las escrituras van a Firestore
   y actualizan el caché simultáneamente.
   ════════════════════════════════════════════════════════ */

// Caché en memoria — permite que toda la app siga siendo síncrona
const _cache = {};

// Helper: guardar en Firestore de forma no bloqueante
// Devuelve true si el guardado llegó al servidor, false si falló (sin lanzar excepción)
async function _fsSet(path, data) {
  try {
    const fb = window._fb;
    if (!fb) return false; // Firebase aún no cargó
    const ref = fb.doc(fb.db, ...path.split('/'));
    await fb.setDoc(ref, data, { merge: false });
    return true;
  } catch(e) {
    console.warn('Firestore write error:', e.message);
    return false;
  }
}

// Helper: leer de Firestore
async function _fsGet(path) {
  try {
    const fb = window._fb;
    if (!fb) return null;
    const ref = fb.doc(fb.db, ...path.split('/'));
    const snap = await fb.getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch(e) {
    console.warn('Firestore read error:', e.message);
    return null;
  }
}

// Helper: eliminar un documento en Firestore
async function _fsDelete(path) {
  try {
    const fb = window._fb;
    if (!fb) return; // Firebase aún no cargó
    const ref = fb.doc(fb.db, ...path.split('/'));
    await fb.deleteDoc(ref);
  } catch(e) {
    console.warn('Firestore delete error:', e.message);
  }
}

// Cargar todos los datos del hogar en el caché (llamado tras login)
// Devuelve true si la carga fue exitosa, false si falló (sin lanzar excepción)
async function _cargarDatosFirestore(userId, cuidadoId, adminId) {
  try {
    const fb = window._fb;
    if (!fb) return false;

    // Cargar usuarios del hogar
    const usersSnap = await fb.getDocs(
      fb.query(fb.collection(fb.db, 'usuarios'),
               fb.where('adminId', '==', adminId))
    );
    const usuarios = [];
    usersSnap.forEach(d => usuarios.push(d.data()));
    // Incluir también el propio usuario si no está
    const propioSnap = await fb.getDoc(fb.doc(fb.db, 'usuarios', userId));
    if (propioSnap.exists() && !usuarios.find(u => u.id === userId)) {
      usuarios.push(propioSnap.data());
    }
    _cache['raiz_users'] = usuarios;

    // Cargar cuidados del hogar
    const cuidadosSnap = await fb.getDocs(
      fb.query(fb.collection(fb.db, 'cuidados'),
               fb.where('adminId', '==', adminId))
    );
    const cuidados = [];
    cuidadosSnap.forEach(d => cuidados.push(d.data()));
    _cache['raiz_cuidados'] = cuidados;

    // Cargar datos compartidos del hogar
    const compSnap = await fb.getDoc(fb.doc(fb.db, 'compartido', adminId));
    if (compSnap.exists()) {
      _cache['raiz_compartido_' + adminId] = compSnap.data();
    }

    console.log('✓ Datos cargados desde Firestore');
    return true;
  } catch(e) {
    console.warn('Error cargando datos:', e.message);
    return false;
  }
}

const DB = {
  // Caché: lectura síncrona del estado en memoria
  _get(k){ return _cache[k] ?? null; },
  _set(k, v){ _cache[k] = v; },

  /* Sesión — memoria + localStorage para persistencia entre recargas */
  getSesion(){
    if(_cache['raiz_sesion']) return _cache['raiz_sesion'];
    try{const s=localStorage.getItem('raiz_sesion');if(s){const p=JSON.parse(s);_cache['raiz_sesion']=p;return p;}}catch(e){}
    return null;
  },
  setSesion(s){
    _cache['raiz_sesion']=s;
    try{localStorage.setItem('raiz_sesion',JSON.stringify(s));}catch(e){}
  },
  clearSesion(){
    delete _cache['raiz_sesion'];
    try{localStorage.removeItem('raiz_sesion');}catch(e){}
  },

  /* Usuarios */
  getUsuarios(){ return this._get('raiz_users')||[]; },
  setUsuarios(u){
    this._set('raiz_users',u);
    u.forEach(usr=>{if(usr.id) _fsSet('usuarios/'+usr.id, usr);});
  },

  /* Invitaciones */
  getInvs(){ return this._get('raiz_invitaciones')||[]; },
  setInvs(invs){
    this._set('raiz_invitaciones',invs);
    const aid=this._adminId();
    if(aid) _fsSet('invitaciones_hogar/'+aid, {lista:invs, actualizado:new Date().toISOString()});
  },

  /* Cuidados individuales */
  getCuidados(){ return this._get('raiz_cuidados')||[]; },
  setCuidados(cs){
    this._set('raiz_cuidados',cs);
    cs.forEach(c=>{if(c.id) _fsSet('cuidados/'+c.id, c);});
  },
  getCuidado(){
    const s=this.getSesion(); if(!s) return null;
    return this.getCuidados().find(c=>c.id===s.cuidadoId)||null;
  },
  getCuidadoById(id){ return this.getCuidados().find(c=>c.id===id)||null; },
  saveCuidado(c){
    const cs=this.getCuidados();
    const i=cs.findIndex(x=>x.id===c.id);
    if(i>=0) cs[i]=c; else cs.push(c);
    this._set('raiz_cuidados',cs);
    if(c.id) _fsSet('cuidados/'+c.id, c);
  },
  getCuidadosAdmin(){
    const s=this.getSesion(); if(!s) return [];
    if(s.rol==='admin') return this.getCuidados().filter(c=>c.adminId===s.userId);
    const c=this.getCuidado(); return c?[c]:[];
  },

  /* Datos compartidos del hogar */
  _adminId(){
    const s=this.getSesion(); if(!s) return null;
    if(s.rol==='admin') return s.userId;
    const c=this.getCuidado(); return c?.adminId||null;
  },
  _keyC(){ const aid=this._adminId(); return aid?('raiz_compartido_'+aid):null; },
  getCompartido(){
    const k=this._keyC(); if(!k) return this._cVacio();
    return this._get(k)||this._cVacio();
  },
  saveCompartido(d){
    const k=this._keyC(); if(!k) return;
    this._set(k,d);
    const aid=this._adminId();
    if(aid) _fsSet('compartido/'+aid, d);
  },
  _cVacio(){
    return {
      alimentacion:{ plan:{}, compras:[], restricciones:[] },
      hogar:{ insumos:[], proveedores:[] },
      gastos:[], presupuesto:150000, presupuestoCats:{},
      equipo:[], eventos:[],
    };
  },

  /* Alias de conveniencia para M5 — Alimentación */
  getAlim(){
    const comp=this.getCompartido();
    if(!comp.alimentacion) comp.alimentacion={plan:{},compras:[],restricciones:[]};
    if(!comp.alimentacion.plan) comp.alimentacion.plan={};
    if(!Array.isArray(comp.alimentacion.restricciones)) comp.alimentacion.restricciones=[];
    if(!Array.isArray(comp.alimentacion.compras)) comp.alimentacion.compras=[];
    return comp.alimentacion;
  },
  saveAlim(alim){
    const comp=this.getCompartido();
    comp.alimentacion=alim;
    this.saveCompartido(comp);
  },

  /* Alias de conveniencia para M8 — Hogar */
  getHogar(){
    const comp=this.getCompartido();
    if(!comp.hogar) comp.hogar={insumos:[],proveedores:[]};
    if(!Array.isArray(comp.hogar.insumos)) comp.hogar.insumos=[];
    if(!Array.isArray(comp.hogar.proveedores)) comp.hogar.proveedores=[];
    return comp.hogar;
  },
  saveHogar(hogar){
    const comp=this.getCompartido();
    comp.hogar=hogar;
    this.saveCompartido(comp);
  },

  /* Alias de conveniencia para M6 — Equipo de cuidado */
  getEquipo(){
    const comp=this.getCompartido();
    if(!Array.isArray(comp.equipo)) comp.equipo=[];
    return comp.equipo;
  },
  saveEquipo(equipo){
    const comp=this.getCompartido();
    comp.equipo=equipo;
    this.saveCompartido(comp);
  },

  /* Alias de conveniencia para M7 — Agenda */
  getEventos(){
    const comp=this.getCompartido();
    if(!Array.isArray(comp.eventos)) comp.eventos=[];
    return comp.eventos;
  },
  saveEventos(eventos){
    const comp=this.getCompartido();
    comp.eventos=eventos;
    this.saveCompartido(comp);
  },
};

/* ── ROL MAPS ── */
const ROL_COLOR={admin:'#4A7C6F',familiar:'#3A6EA8',observador:'#6B5EA8',cuidadora:'#C47A2B'};
const ROL_LABEL={admin:'Administrador',familiar:'Familiar activo',observador:'Observador',cuidadora:'Cuidadora'};
const ROL_EMOJI={admin:'👩‍💼',familiar:'👨‍👩‍👧',observador:'👁',cuidadora:'👩‍⚕️'};
const ROL_DESC={
  admin:'Tienes acceso completo para gestionar el cuidado, invitar personas y configurar todo.',
  familiar:'Puedes ver la bitácora, los gastos y el estado de salud. No puedes registrar ni editar.',
  observador:'Ves el estado general y el resumen diario. Sin acceso a gastos ni historial completo.',
  cuidadora:'Puedes registrar la bitácora del turno y confirmar los medicamentos diarios.',
};

/* ── HASH ── */

/* ── HELPERS ── */
const $=id=>document.getElementById(id);
const _escapeMap={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
function escapeHtml(str){
  if(str===null||str===undefined) return '';
  return String(str).replace(/[&<>"']/g, ch=>_escapeMap[ch]);
}
let _guardarTs={};
function _bloqueadoPorDobleClick(key,ms=800){
  const now=Date.now();
  if(_guardarTs[key]&&now-_guardarTs[key]<ms) return true;
  _guardarTs[key]=now;
  return false;
}
function toast(msg,type='',dur=2800){
  const t=$('toast'); t.textContent=msg; t.className='toast show'+(type?' '+type:'');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),dur);
}
function showErr(id,msg){ const e=$(id); e.textContent=msg||e.textContent; e.classList.add('show'); }
function hideErr(id){ $(id)?.classList.remove('show'); }
function setLoading(sid,bid,v){ $(sid).style.display=v?'inline-block':'none'; $(bid).style.opacity=v?'.7':'1'; }
function initials(n){ if(!n)return'?'; return n.split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2); }
function hoy(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fechaHoy(){ return new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'}); }
function fmt(n){ return '$'+Number(n||0).toLocaleString('es-CL'); }

// Altura real de viewport visible (evita que la barra del navegador mobile
// tape el tabbar cuando 100vh/100dvh no se actualiza de forma confiable)
function _fixVh(){
  document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
}
_fixVh();
window.addEventListener('resize', _fixVh);
window.addEventListener('orientationchange', _fixVh);
window.visualViewport?.addEventListener('resize', _fixVh);

/* ── NAVEGACIÓN CENTRAL ── */
// Pantallas que requieren sesión activa
const SCREENS_AUTH = ['s-home-admin','s-home-familiar','s-home-observador','s-home-cuidadora',
  's-perfil','s-bita-list','s-bita-new','s-bita-detalle','s-resumen-ia',
  's-salud-hub','s-ocr-receta','s-ficha-editar','s-alim-hub',
  's-gastos','s-agenda','s-invitaciones','s-onb-am','s-onb-salud','s-activacion'];

function navTo(id){
  // Redirigir al splash si no hay sesión y la pantalla requiere auth
  if(SCREENS_AUTH.includes(id) && !DB.getSesion()){
    id='s-splash';
  }
  cerrarConfirm();
  // Salir de modo edición de bitácora si se navega a cualquier pantalla que no sea el formulario.
  // try/catch: navTo() se invoca durante el bootstrap inicial (IIFE init()), antes de que
  // "const ST" (declarado más abajo en el archivo) exista todavía.
  try{ if(id!=='s-bita-new') ST.bitacora.bitaEditandoId=null; }catch(e){}
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const sc=$(id);
  if(!sc){ console.warn('Pantalla no encontrada:',id); return; }
  sc.classList.add('active');
  sc.querySelector('.scroll')?.scrollTo(0,0);
  // Mostrar/ocultar sidebar según si hay sesión y no es pantalla de auth
  const sb=document.getElementById('sidebar');
  const sesionActiva=!!DB.getSesion();
  const esPantallaAuth=['s-splash','s-login','s-registro-tipo','s-registro-admin',
    's-ingresar-codigo','s-registro-invitado','s-bienvenida'].includes(id);
  // El sidebar en mobile NUNCA tiene display inline — lo controla el @media CSS
  // Solo ocultarlo explícitamente en pantallas de auth
  if(sb) sb.style.display=esPantallaAuth?'none':'';
  // Actualizar sidebar
  document.querySelectorAll('.sb-item').forEach(i=>i.classList.toggle('on',i.dataset.screen===id));
  // Hooks de inicialización por pantalla
  if(id==='s-perfil')    renderPerfil();
  if(id==='s-bita-new'){ setTimeout(initSelectorCuidado,0); setTimeout(initFormulario,0); }
  if(id==='s-bita-list') setTimeout(renderLista,0);
  if(id==='s-salud-hub'){
    ST.salud.tabActivo='meds'; // siempre entrar por medicamentos
    // Resetear visualmente los tabs
    setTimeout(()=>{
      const saludScreen=document.getElementById('s-salud-hub');
      if(saludScreen){
        saludScreen.querySelectorAll('.tab-hub .th').forEach((t,i)=>{
          t.classList.toggle('on',i===0);
        });
      }
      renderTab('meds');
    },0);
  }
  if(id==='s-alim-hub'){
    const tabAlim=ST.alimentacion.tab||'plan';
    setTimeout(()=>{
      const scrAlim=document.getElementById('s-alim-hub');
      if(scrAlim) scrAlim.querySelectorAll('.tab-hub .th').forEach((t,i)=>{
        t.classList.toggle('on',['plan','restricciones','diario','compras'][i]===tabAlim);
      });
      renderTabAlim(tabAlim);
    },0);
  }
  if(id==='s-ficha-editar') setTimeout(prellenarFicha,0);
  if(id==='s-ocr-receta')   setTimeout(resetOCR,0);
  if(id==='s-invitaciones') setTimeout(renderInvitaciones,0);
  if(id==='s-equipo-hub'){
    setTimeout(()=>{
      const scrEquipo=document.getElementById('s-equipo-hub');
      if(scrEquipo) scrEquipo.querySelectorAll('.tab-hub .th').forEach((t,i)=>t.classList.toggle('on',i===0));
      renderTabEquip('cuidadoras');
    },0);
  }
  if(id==='s-hogar-hub'){
    setTimeout(()=>{
      const scrHogar=document.getElementById('s-hogar-hub');
      if(scrHogar) scrHogar.querySelectorAll('.tab-hub .th').forEach((t,i)=>t.classList.toggle('on',i===0));
      renderTabHogar('insumos');
    },0);
  }
  if(id==='s-gastos'){
    setTimeout(()=>{
      const scrGastos=document.getElementById('s-gastos');
      if(scrGastos) scrGastos.querySelectorAll('.tab-hub .th').forEach((t,i)=>t.classList.toggle('on',i===0));
      renderTabGastos('registro');
    },0);
  }
  if(id==='s-informe-hub')  setTimeout(renderHub,0);
  if(id==='s-agenda')       setTimeout(renderAgenda,0);
  if(['s-home-admin','s-home-familiar','s-home-observador','s-home-cuidadora'].includes(id)){
    const rol=id.replace('s-home-','');
    renderHome(rol==='admin'?'admin':rol==='familiar'?'familiar':rol==='observador'?'observador':'cuidadora');
  }
}

function irAlHome(){
  const s=DB.getSesion(); if(!s) return navTo('s-splash');
  const m={admin:'s-home-admin',familiar:'s-home-familiar',observador:'s-home-observador',cuidadora:'s-home-cuidadora'};
  navTo(m[s.rol]||'s-home-admin');
}

/* ── DEMO DATA ── */

/* ════ AUTH — MÓDULO 1 ════ */

// Tipo de registro
let _tipoReg='admin';
function selTipoRegistro(tipo){
  _tipoReg=tipo;
  ['admin','invitado'].forEach(t=>{
    $('tipo-'+t)?.classList.toggle('sel',t===tipo);
    const c=$('tipo-chk-'+t);
    if(c){ c.classList.toggle('on',t===tipo); c.textContent=t===tipo?'✓':''; }
  });
}
function continuarRegistro(){
  if(_tipoReg==='admin') navTo('s-registro-admin');
  else navTo('s-ingresar-codigo');
}

// Login
function hacerLogin(){
  const email=$('login-email').value.trim().toLowerCase();
  const pass=$('login-pass').value;
  hideErr('login-email-err');
  $('login-general-err').style.display='none';
  if(!email||!email.includes('@')){ showErr('login-email-err','Email inválido'); return; }
  if(!pass){ toast('Ingresa tu contraseña','err'); return; }
  setLoading('login-spinner','login-btn-txt',true);

  const fb=window._fb;
  if(!fb){
    setLoading('login-spinner','login-btn-txt',false);
    toast('Conectando... intenta de nuevo en un momento','ok');
    return;
  }

  fb.signInWithEmailAndPassword(fb.auth, email, pass)
    .then(async (cred)=>{
      setLoading('login-spinner','login-btn-txt',false);
      const uid=cred.user.uid;
      const uData=await _fsGet('usuarios/'+uid);
      if(!uData){
        $('login-general-err').style.display='block';
        $('login-general-err').textContent='Perfil no encontrado. Contacta al administrador.';
        return;
      }
      const adminId=uData.adminId||uid;
      const cargaOk=await _cargarDatosFirestore(uid, uData.cuidadoId, adminId);
      DB.setSesion({userId:uid,nombre:uData.nombre,email:uData.email,rol:uData.rol,cuidadoId:uData.cuidadoId});
      if(!cargaOk){
        toast('⚠ No se pudo sincronizar con el servidor. Verifica tu conexión y reintenta desde el inicio si faltan datos.','err',6000);
      }
      // Mostrar feedback de éxito antes de navegar
      if($('login-ok')) $('login-ok').style.display='block';
      setTimeout(()=>{ mostrarBienvenida(uData); }, 800);
    })
    .catch((err)=>{
      setLoading('login-spinner','login-btn-txt',false);
      const msgs={'auth/invalid-credential':'Email o contraseña incorrectos','auth/wrong-password':'Email o contraseña incorrectos','auth/user-not-found':'Email o contraseña incorrectos','auth/too-many-requests':'Demasiados intentos. Espera unos minutos.'};
      const msg=msgs[err.code]||'Error al iniciar sesión. Intenta de nuevo.';
      $('login-general-err').style.display='block';
      $('login-general-err').textContent=msg;
    });
}


// Registro admin
function validarPass(){ const v=$('reg-pass').value; v&&v.length<6?showErr('reg-pass-err','Mínimo 6 caracteres'):hideErr('reg-pass-err'); }
function validarPass2(){ const p=$('reg-pass').value,p2=$('reg-pass2').value; p2&&p!==p2?showErr('reg-pass2-err','Las contraseñas no coinciden'):hideErr('reg-pass2-err'); }
function registrarAdmin(){
  const nombre=$('reg-nombre').value.trim();
  const email=$('reg-email').value.trim().toLowerCase();
  const pass=$('reg-pass').value;
  const pass2=$('reg-pass2').value;
  ['nombre','email','pass','pass2'].forEach(f=>hideErr('reg-'+f+'-err'));
  if(!nombre){ showErr('reg-nombre-err','Ingresa tu nombre'); return; }
  if(!email||!email.includes('@')){ showErr('reg-email-err','Email inválido'); return; }
  if(pass.length<6){ showErr('reg-pass-err','Mínimo 6 caracteres'); return; }
  if(pass!==pass2){ showErr('reg-pass2-err','Las contraseñas no coinciden'); return; }

  const fb=window._fb;
  if(!fb){ toast('Conectando... intenta en un momento','ok'); return; }

  setLoading('reg-spinner','reg-btn-txt',true);

  fb.createUserWithEmailAndPassword(fb.auth, email, pass)
    .then(async (cred)=>{
      setLoading('reg-spinner','reg-btn-txt',false);
      const uid=cred.user.uid;

      // Crear cuidado vacío
      const cid='c-'+uid+'-'+Date.now();
      const cuidado={id:cid,adminId:uid,creado:hoy(),
        am:{nombre:'',edad:0,fechaNacimiento:'',rut:'',relacion:'',condiciones:[],alergias:[],medico:'',restricciones:[]},
        meds:[],bitacoras:[],confirmaciones:{},informes:[]};

      // Crear usuario en Firestore
      const userData={id:uid,nombre,email,rol:'admin',cuidadoId:cid,adminId:uid,creado:hoy()};
      const ok1=await _fsSet('usuarios/'+uid, userData);
      const ok2=await _fsSet('cuidados/'+cid, cuidado);
      // Compartido vacío
      const comp={alimentacion:{plan:{},compras:[],restricciones:[]},
        hogar:{insumos:[],proveedores:[]},
        gastos:[],presupuesto:150000,presupuestoCats:{},equipo:[],eventos:[]};
      const ok3=await _fsSet('compartido/'+uid, comp);

      // Cargar en caché
      _cache['raiz_users']=[userData];
      _cache['raiz_cuidados']=[cuidado];
      _cache['raiz_compartido_'+uid]=comp;
      _cache['raiz_invitaciones']=[];
      DB.setSesion({userId:uid,nombre,email,rol:'admin',cuidadoId:cid});

      if(!(ok1&&ok2&&ok3)){
        toast('⚠ Tu cuenta se creó, pero no se pudo sincronizar con el servidor. Solo funcionará en este dispositivo hasta que reintentes.','err',6000);
      }

      // Actualizar onboarding con nombre
      const ns=$('onb-nombre-salud'); if(ns) ns.textContent=nombre.split(' ')[0];
      const sa=$('onb-am-saludo'); if(sa) sa.textContent='Hola, '+nombre.split(' ')[0]+' 👋';
      navTo('s-onb-am');
    })
    .catch((err)=>{
      setLoading('reg-spinner','reg-btn-txt',false);
      const msgs={'auth/email-already-in-use':'Este email ya tiene una cuenta','auth/weak-password':'La contraseña es muy débil'};
      showErr('reg-email-err', msgs[err.code]||'Error al crear cuenta. Intenta de nuevo.');
    });
}

// Código invitación
let _codigoActual='', _invActual=null;
function actualizarCodigo(val){
  const d=val.replace(/\D/g,'').slice(0,6);
  $('code-real').value=d; _codigoActual=d;
  for(let i=0;i<6;i++){ const el=$('cd'+i); if(el){ el.textContent=d[i]||'-'; el.classList.toggle('filled',!!d[i]); }}
  const btn=$('codigo-btn'); if(btn){ btn.disabled=d.length<6; btn.style.opacity=d.length<6?'.5':'1'; }
  $('code-preview').style.display='none'; hideErr('code-err');
  if(d.length===6) validarCodigo();
}
function validarCodigo(){
  const codigo=(_codigoActual||'').trim().replace(/\s/g,'');
  if(codigo.length!==6){ toast('El código tiene 6 dígitos','err'); return; }
  setLoading('codigo-spinner','codigo-btn-txt',true);

  // Buscar en caché primero, luego en Firestore
  const buscarInvitacion = async () => {
    // Primero intentar en caché local (por si ya se cargó)
    let inv = DB.getInvs().find(i=>i.codigo===codigo&&i.estado==='pendiente');

    // Si no está en caché, buscar en Firestore
    if(!inv){
      const fb=window._fb;
      if(fb){
        try{
          // Buscar el documento directamente por código como ID
          const invSnap=await _fsGet('codigos_inv/'+codigo);
          if(invSnap&&invSnap.estado==='pendiente') inv=invSnap;
        }catch(e){ console.warn('Firestore inv lookup:',e.message); }
      }
    }
    return inv;
  };

  buscarInvitacion().then(inv=>{
    setLoading('codigo-spinner','codigo-btn-txt',false);
    if(!inv){
      $('code-err').style.display='block';
      return;
    }
    // Verificar expiración
    if(inv.expira && inv.expira < hoy()){
      toast('Este código ha expirado','err'); return;
    }
    _invActual=inv;
    // Cargar datos básicos del hogar para mostrar el nombre del familiar
    _fsGet('cuidados/'+inv.cuidadoId).then(c=>{
      if(c && $('inv-bienvenida-nombre')) $('inv-bienvenida-nombre').textContent=c.am?.nombre||'la persona cuidada';
      if($('inv-bienvenida-rol')) $('inv-bienvenida-rol').textContent=ROL_LABEL[inv.rol]||inv.rol;
      navTo('s-registro-invitado');
    });
  });
}

// Registro invitado
function registrarInvitado(){
  const nombre=$('inv-nombre').value.trim();
  const pass=$('inv-pass').value;
  const pass2=$('inv-pass2').value;
  if(!nombre){ toast('Escribe tu nombre','err'); return; }
  if(pass.length<6){ toast('Mínimo 6 caracteres','err'); return; }
  if(pass!==pass2){ toast('Las contraseñas no coinciden','err'); return; }
  if(!_invActual){ toast('Código no validado','err'); return; }

  const fb=window._fb;
  if(!fb){ toast('Conectando...','ok'); return; }

  setLoading('inv-spinner','inv-btn-txt',true);

  fb.createUserWithEmailAndPassword(fb.auth, _invActual.email||`${Date.now()}@raiz-invitado.app`, pass)
    .then(async(cred)=>{
      setLoading('inv-spinner','inv-btn-txt',false);
      const uid=cred.user.uid;
      const adminId=_invActual.adminId;

      // Crear usuario en Firestore
      const userData={id:uid,nombre,email:_invActual.email||'',rol:_invActual.rol,
        cuidadoId:_invActual.cuidadoId,adminId,creado:hoy()};
      await _fsSet('usuarios/'+uid, userData);

      // Marcar invitación como usada
      const invs=DB.getInvs().map(i=>i.codigo===_invActual.codigo?{...i,estado:'usado',usadoPor:uid}:i);
      DB.setInvs(invs);
      // Invalidar también el código en Firestore para que no pueda reutilizarse desde otro dispositivo
      _fsSet('codigos_inv/'+_invActual.codigo, {..._invActual, estado:'usado', usadoPor:uid});

      // Cargar datos del hogar
      await _cargarDatosFirestore(uid, _invActual.cuidadoId, adminId);
      // Agregar el nuevo usuario al caché de usuarios
      const usuarios=DB.getUsuarios();
      if(!usuarios.find(u=>u.id===uid)) { usuarios.push(userData); _cache['raiz_users']=usuarios; }

      DB.setSesion({userId:uid,nombre,email:userData.email,rol:_invActual.rol,cuidadoId:_invActual.cuidadoId});
      mostrarBienvenida(userData);
    })
    .catch((err)=>{
      setLoading('inv-spinner','inv-btn-txt',false);
      const msgs={'auth/email-already-in-use':'Este email ya tiene cuenta — inicia sesión normalmente'};
      toast(msgs[err.code]||'Error al registrarse','err');
    });
}

// Bienvenida post-login
function mostrarBienvenida(u){
  const c=DB.getCuidados().find(x=>x.id===u.cuidadoId);
  $('bv-saludo').textContent='Hola, '+u.nombre.split(' ')[0]+' 👋';
  $('bv-sub').textContent=c?.am?.nombre?`Cuidado de ${c.am.nombre} · ${c.am.edad} años`:'Configura el primer cuidado';
  const b=$('bv-rol-badge'); const r=u.rol;
  b.className='rol-badge-pill rb-'+r;
  b.textContent=(ROL_EMOJI[r]||'👤')+' '+ROL_LABEL[r];
  $('bv-rol-desc').textContent=ROL_DESC[r]||'';
  if(c?.am?.nombre){ $('bv-am-nombre').textContent=c.am.nombre+' '+(c.am.apellido||''); $('bv-am-meta').textContent=(c.am.edad||'—')+' años · Cuidadora: '+(nombreCuidadoraPrincipal(c)||'Por configurar'); }
  $('bv-ia-txt').textContent=r==='admin'?`Registra la bitácora de hoy para que la IA tenga su primer dato.`:`Recibirás actualizaciones del cuidado de ${c?.am?.nombre||'la persona cuidada'}.`;
// El sidebar solo se muestra en desktop (≥768px via @media CSS)
  // No modificar el inline style — el CSS lo controla
  renderSidebar();
  navTo('s-bienvenida');
}

function cerrarSesion(){
  confirmar('¿Cerrar sesión?','Tus datos quedan guardados en la nube.',()=>{
    const fb=window._fb;
    if(fb) fb.signOut(fb.auth).catch(()=>{});
    DB.clearSesion();
    // Limpiar caché en memoria
    Object.keys(_cache).forEach(k=>{ if(k!=='raiz_sesion') delete _cache[k]; });
    const sb=document.getElementById('sidebar');
    if(sb) sb.style.display='none';
    navTo('s-splash');
    toast('Sesión cerrada','ok');
  });
}

/* ════ MÓDULO 2 — ONBOARDING CUIDADORAS ════ */
// Estado de la lista de cuidadoras del onboarding
let _onbCuidadoras = [''];

function onbRenderCuidadoras(){
  const lista = document.getElementById('onb-cuidadoras-lista');
  if(!lista) return;
  lista.innerHTML = _onbCuidadoras.map((nombre, i) => `
    <div class="onb-cui-row">
      <div class="onb-cui-num">${i+1}</div>
      <input class="fin" value="${nombre}"
        placeholder="${i===0?'Ej: Carmen Fuentes':'Ej: Rosa Medina'}"
        oninput="_onbCuidadoras[${i}]=this.value"
        style="flex:1;padding:11px 14px">
      ${_onbCuidadoras.length>1?`<button class="onb-cui-del" onclick="onbEliminarCuidadora(${i})" title="Eliminar">×</button>`:''}
    </div>`).join('');
}

function onbAgregarCuidadora(){
  _onbCuidadoras.push('');
  onbRenderCuidadoras();
  // Focus en el nuevo input
  setTimeout(()=>{
    const inputs=document.querySelectorAll('#onb-cuidadoras-lista input');
    inputs[inputs.length-1]?.focus();
  }, 50);
}

function onbEliminarCuidadora(idx){
  if(_onbCuidadoras.length<=1) return;
  _onbCuidadoras.splice(idx,1);
  onbRenderCuidadoras();
}

/* ════ HELPERS NUEVOS ════ */

/* Calcula edad en años desde una fecha de nacimiento YYYY-MM-DD */
function nombreCuidadoraPrincipal(c){
  const comp=DB.getCompartido();
  const principal=(comp?.equipo||[]).find(p=>p.categoria==='cuidadora'&&p.rol==='cuidadora_principal')
    ||(comp?.equipo||[]).find(p=>p.categoria==='cuidadora');
  return principal?.nombre||c?.cuidadora||'';
}
function calcularEdad(fnac){
  if(!fnac) return null;
  const nac=new Date(fnac+'T12:00');
  const hoyD=new Date();
  let edad=hoyD.getFullYear()-nac.getFullYear();
  const m=hoyD.getMonth()-nac.getMonth();
  if(m<0||(m===0&&hoyD.getDate()<nac.getDate())) edad--;
  return edad>=0&&edad<130?edad:null;
}

/* Formatea RUT chileno mientras escribe: 12345678 → 12.345.678-9 */
function formatearRut(input){
  if(!input) return;
  // Acepta tanto un input element como un string
  const rawVal = typeof input === 'string' ? input : (input.value||'');
  let v=rawVal.replace(/[^0-9kK]/g,'').toUpperCase();
  if(v.length<=1){ if(typeof input!=='string') input.value=v; return; }
  const dv=v.slice(-1);
  const cuerpo=v.slice(0,-1).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  const resultado=cuerpo+'-'+dv;
  if(typeof input!=='string') input.value=resultado;
  return resultado;
}

/* Eliminar un Cuidado del admin (no el activo) */
function eliminarCuidado(cid){
  const s=DB.getSesion(); if(!s||s.rol!=='admin') return;
  if(cid===s.cuidadoId){ toast('No puedes eliminar el cuidado activo','err'); return; }
  const c=DB.getCuidadoById(cid);
  const nombre=c?.am?.nombre||'esta persona';
  confirmar(
    `¿Eliminar el cuidado de ${nombre}?`,
    'Se eliminarán todos sus datos: bitácora, medicamentos e informes. Esta acción no se puede deshacer.',
    ()=>{
      const cuidados=DB.getCuidados().filter(x=>x.id!==cid);
      DB.setCuidados(cuidados);
      _fsDelete('cuidados/'+cid);
      toast(`✓ Cuidado de ${nombre} eliminado`,'ok');
      renderPerfil();
    }
  );
}

/* ════ MÓDULO 2 — ONBOARDING ════ */
function guardarOnbAM(){
  const nombre=$('onb-nombre').value.trim();
  if(!nombre){ toast('Escribe el nombre de la persona cuidada','err'); return; }
  const fnac=$('onb-fnac').value;
  const edad=calcularEdad(fnac);
  let c=DB.getCuidado();
  if(!c){
    // No existe un cuidado local (p.ej. nunca llegó a guardarse en Firestore
    // y se perdió al recargar la página) — crear uno vacío para no quedar
    // pegado en este paso sin ningún aviso.
    const s=DB.getSesion(); if(!s) return;
    c={ id: s.cuidadoId||('c-'+s.userId+'-'+Date.now()), adminId: s.userId, creado: hoy(),
      am:{nombre:'',edad:0,fechaNacimiento:'',rut:'',relacion:'',condiciones:[],alergias:[],medico:'',restricciones:[]},
      meds:[], bitacoras:[], confirmaciones:{}, informes:[] };
    if(!s.cuidadoId) DB.setSesion({...s, cuidadoId:c.id});
  }
  c.am={...c.am,
    nombre,
    fechaNacimiento: fnac||'',
    edad: edad||0,
    rut: $('onb-rut').value.trim(),
    relacion: $('onb-relacion').value,
  };
  DB.saveCuidado(c);
  const ns=$('onb-nombre-salud'); if(ns) ns.textContent=nombre;
  // Inicializar la lista de cuidadoras al entrar al paso 2
  onbRenderCuidadoras();
  navTo('s-onb-salud');
}
async function guardarOnbSalud(){
  const c=DB.getCuidado(); if(!c) return;
  c.am={...c.am,medico:$('onb-medico').value.trim(),condiciones:[...document.querySelectorAll('#s-onb-salud .chip.on')].map(ch=>ch.textContent.trim())};

  // Leer lista de cuidadoras (filtrar vacías)
  const cuidadoras=_onbCuidadoras.map(n=>n.trim()).filter(Boolean);
  if(!cuidadoras.length){ toast('Agrega al menos una cuidadora','err'); return; }

  // Guardar cuidadoras en el equipo compartido del hogar
  const comp=DB.getCompartido();
  if(!Array.isArray(comp.equipo)) comp.equipo=[];
  const hoyStr=hoy();
  cuidadoras.forEach((nombre,i)=>{
    if(!comp.equipo.find(p=>p.categoria==='cuidadora'&&p.nombre===nombre)){
      comp.equipo.push({
        id:'p-onb-'+Date.now()+'-'+i,
        categoria:'cuidadora', nombre, telefono:'',
        rol: i===0?'cuidadora_principal':'cuidadora_suplente',
        dias: i===0?['lunes','martes','miercoles','jueves','viernes']:['sabado','domingo'],
        horaIni:'08:00', horaFin:'18:00', notas:'', creadoEl:hoyStr,
      });
    }
  });
  DB.saveCompartido(comp);

  // No precargar medicamentos — el usuario los ingresará en el módulo de Salud
  // Persistir explícitamente todo en Firestore al terminar el onboarding
  const s=DB.getSesion();
  let syncOk=true;
  if(s){
    const ok1=await _fsSet('cuidados/'+c.id, c);
    const ok2=await _fsSet('compartido/'+s.userId, comp);
    syncOk=ok1&&ok2;
  }
  DB.saveCuidado(c);
  if(!syncOk){
    toast('⚠ Se guardó en este dispositivo, pero no se pudo sincronizar con el servidor. No estará disponible en otros dispositivos hasta que reintentes.','err',6000);
  }
  $('act-nombre').textContent=c.am.nombre||'la persona cuidada';
  $('act-meds').textContent=c.meds.length||0;
  $('act-cond').textContent=c.am.condiciones?.length||0;
  $('act-cuid').textContent=cuidadoras.length||1;
  navTo('s-activacion');
}

/* ════ MÓDULO 2 — HOME ════ */
function renderHome(rol){
  const s=DB.getSesion(); if(!s) return;
  const c=DB.getCuidado();
  // Guardia: si el cuidado no existe (datos corruptos o cuidadoId inválido),
  // intentar recuperar con el primer cuidado disponible del admin
  if(!c){
    const todos=DB.getCuidados();
    if(todos.length>0){
      // Actualizar la sesión con un cuidadoId válido
      DB.setSesion({...s, cuidadoId:todos[0].id});
      renderHome(rol); // re-intentar
      return;
    }
    // Sin cuidados — puede ser que Firestore esté vacío o no haya sincronizado aún
    const bodyId=`home-${rol==='admin'?'admin':rol==='familiar'?'fam':rol==='observador'?'obs':'cui'}-body`;
    const bodyEl=$(bodyId);
    if(bodyEl){
      if(rol==='admin'){
        bodyEl.innerHTML=`<div class="empty" style="padding:40px 18px">
          <div class="empty-ico">🌿</div>
          <div class="empty-title">Completa tu perfil</div>
          <div class="empty-txt">Para comenzar, completa los datos de la persona cuidada.<br>Tarda menos de 2 minutos.</div>
          <button class="btn btn-p" style="margin-top:20px" onclick="navTo('s-onb-am')">Agregar familiar →</button>
          <button class="btn btn-s" style="margin-top:8px" onclick="recargarDesdeFB()">↺ Reintentar sincronización</button>
        </div>`;
      } else {
        bodyEl.innerHTML=`<div class="empty" style="padding:40px 18px">
          <div class="empty-ico">⏳</div>
          <div class="empty-title">Cargando datos...</div>
          <div class="empty-txt">Sincronizando con el servidor.<br>Si esto persiste, pide al administrador que verifique la configuración.</div>
          <button class="btn btn-s" style="margin-top:20px" onclick="recargarDesdeFB()">↺ Reintentar</button>
        </div>`;
      }
    }
    return;
  }
  const am=c.am||{};
  const nombre=s.nombre.split(' ')[0];
  const fecha=fechaHoy();
  const bitaHoy=(c.bitacoras||[]).filter(b=>b.fecha===hoy()).slice(-1)[0];
  const meds=c.meds||[];
  const medsConf=c.confirmaciones||{};
  const medsHoy=meds.filter(m=>!medsConf[m.id+'_'+hoy()]);
  // Datos compartidos del hogar
  const comp=DB.getCompartido();
  const gastos=comp.gastos||[];
  const totalGastos=gastos.reduce((s,g)=>s+g.monto,0);
  // Todos los Cuidados del admin (para mostrar cards múltiples)
  const todosCuidados=rol==='admin'?DB.getCuidadosAdmin():[c];

  const setHdr=(base,color='var(--sage)')=>{
    for(const sfx of['-saludo','-fecha','-saludo-d','-fecha-d']){
      const el=$(base+sfx); if(!el) continue;
      if(sfx.includes('saludo')) el.textContent=`Hola, ${nombre} 👋`;
      else el.textContent=fecha;
    }
    const ava=$(base+'-ava'); if(ava){ ava.textContent=initials(s.nombre); ava.style.background=color; }
  };

  const sem=(vitales)=>{
    const s=(v,ok)=>`<div class="sem${ok?vitales[v]?' ok':' empty':' empty'}"><div class="sem-ico">${{p:'❤️',a:'🍽️',m:'💊',n:'😊'}[v]}</div><div class="sem-lbl">${{p:'Presión',a:'Almuerzo',m:'Meds',n:'Ánimo'}[v]}</div><div class="sem-val">${vitales[v]||'—'}</div></div>`;
    return`<div class="semaforo">${s('p',true)}${s('a',true)}<div class="sem${meds.length===0?' empty':medsHoy.length===0?' ok':' warn'}" style="cursor:pointer" onclick="navTo('s-salud-hub')"><div class="sem-ico">💊</div><div class="sem-lbl">Salud</div><div class="sem-val">${meds.length===0?'—':medsHoy.length===0?'✓ Todo':medsHoy.length+' pend.'}</div></div>${s('n',true)}</div>`;
  };

  const hero=`<div class="hero-card" onclick="navTo('s-perfil')">
    <div class="hc-name">${escapeHtml(am.nombre)||'la persona cuidada'} · ${am.edad||'—'} años</div>
    <div class="hc-meta">Cuidadora: ${escapeHtml(nombreCuidadoraPrincipal(c))||'Por configurar'} · turno activo</div>
    <div class="hc-pills">
      <div class="hc-pill"><div class="hc-dot" style="background:${bitaHoy?'#A8F0D8':'#FFD97D'}"></div>${bitaHoy?'Bitácora registrada':'Sin bitácora hoy'}</div>
      <div class="hc-pill"><div class="hc-dot" style="background:${medsHoy.length===0&&meds.length>0?'#A8F0D8':'#FFD97D'}"></div>${medsHoy.length===0&&meds.length>0?'Meds al día ✓':medsHoy.length+' meds pendientes'}</div>
    </div>
  </div>`;

  const dot=$('tab-meds-dot'); if(dot) dot.classList.toggle('show',medsHoy.length>0);

  if(rol==='admin'){
    setHdr('home-admin');
    renderSidebar();
    // Construir cards para cada Cuidado
    const GRADIENTS=['var(--sage-dk),var(--sage)','#1A5276,#2E86C1','#6C3483,#8E44AD','#7D6608,#D4AC0D'];
    let adminHtml='';
    todosCuidados.forEach((cx,idx)=>{
      const amx=cx.am||{};
      const bitax=(cx.bitacoras||[]).filter(b=>b.fecha===hoy()).slice(-1)[0];
      const medsx=cx.meds||[];
      const confx=cx.confirmaciones||{};
      const medsHoyx=medsx.filter(m=>!confx[m.id+'_'+hoy()]);
      const esActivo=cx.id===s.cuidadoId;
      const grad=GRADIENTS[idx%GRADIENTS.length];
      const cardStyle=esActivo?'':'opacity:.85;';

      adminHtml+=`
        <div style="${cardStyle}background:linear-gradient(135deg,${grad});border-radius:var(--r);padding:16px;margin:${idx===0?'14px':'4px'} 16px ${idx===todosCuidados.length-1?'0':'0'}px;cursor:pointer"
             onclick="selCuidadoYNav('${cx.id}')">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
            <div>
              <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:-.3px">${escapeHtml(amx.nombre)||'Sin nombre'} · ${calcularEdad(amx.fechaNacimiento)||amx.edad||'—'} años</div>
              <div style="font-size:12px;color:rgba(255,255,255,.72);margin-top:2px">${amx.relacion||'—'}</div>
              ${(amx.condiciones?.length)?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${amx.condiciones.map(c=>`<span style="background:rgba(255,255,255,.18);border-radius:20px;padding:2px 8px;font-size:10px;color:#fff;white-space:nowrap">${c}</span>`).join('')}</div>`:'<div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:4px">Sin condiciones registradas</div>'}
            </div>
            ${esActivo?'<span style="background:rgba(255,255,255,.25);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;color:#fff">Activo ✓</span>':'<span style="background:rgba(255,255,255,.15);border-radius:20px;padding:3px 10px;font-size:11px;color:rgba(255,255,255,.8)">Cambiar →</span>'}
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
            ${[['❤️','Presión',bitax?.presion||'—',null],[' 🍽️','Almuerzo',bitax?.almuerzo||'—',null],
               ['💊','Meds',medsx.length===0?'—':medsHoyx.length===0?'✓':medsHoyx.length+' pend.','s-salud-hub'],
               ['😊','Ánimo',bitax?.animo?.split(' ')[0]||'—',null]].map(([ico,lbl,val,dest])=>
              `<div style="background:rgba(255,255,255,.15);border-radius:8px;padding:8px 4px;text-align:center${dest&&esActivo?';cursor:pointer':''}"${dest&&esActivo?` onclick="event.stopPropagation();navTo('${dest}')"`:''}>
                <div style="font-size:16px">${ico}</div>
                <div style="font-size:9px;color:rgba(255,255,255,.7);margin-top:2px">${lbl}</div>
                <div style="font-size:12px;font-weight:700;color:#fff;margin-top:1px">${val}</div>
              </div>`).join('')}
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <div style="background:rgba(255,255,255,.18);border-radius:20px;padding:4px 10px;font-size:11px;color:#fff;display:flex;align-items:center;gap:4px">
              <div style="width:5px;height:5px;border-radius:50%;background:${bitax?'#A8F0D8':'#FFD97D'}"></div>
              ${bitax?'Bitácora hoy':'Sin bitácora'}
            </div>
            ${medsHoyx.length===0&&medsx.length>0?'<div style="background:rgba(255,255,255,.18);border-radius:20px;padding:4px 10px;font-size:11px;color:#fff;display:flex;align-items:center;gap:4px"><div style="width:5px;height:5px;border-radius:50%;background:#A8F0D8"></div>Meds al día ✓</div>':medsHoyx.length>0?`<div style="background:rgba(255,255,255,.18);border-radius:20px;padding:4px 10px;font-size:11px;color:#fff">${medsHoyx.length} meds pendientes</div>`:''}
          </div>
        </div>`;
    });

    // Botón agregar nuevo Cuidado
    adminHtml+=`
      <div style="margin:8px 16px 14px;border:1.5px dashed var(--sage-md);border-radius:var(--r);padding:14px;text-align:center;cursor:pointer;background:var(--sage-lt)" onclick="crearNuevoCuidado()">
        <span style="font-size:16px">＋</span>
        <span style="font-size:13px;font-weight:600;color:var(--sage);margin-left:6px">Agregar otro familiar cuidado</span>
      </div>`;

    // Acciones rápidas del Cuidado activo
    adminHtml+=`
      <div class="slbl">Acciones rápidas · ${escapeHtml(am.nombre)||'la persona cuidada'}</div>
      <div class="qa-grid">
        <div class="qa p" onclick="navTo('s-bita-new')"><div class="qa-ico">📋</div><div class="qa-lbl">Nueva bitácora</div><div class="qa-sub">${bitaHoy?'Registro adicional':'Registrar el día'}</div></div>
        <div class="qa" onclick="navTo('s-salud-hub')"><div class="qa-ico">💊</div><div class="qa-lbl">Salud</div><div class="qa-sub">${medsHoy.length>0?medsHoy.length+' pendientes hoy':'Todos confirmados ✓'}</div></div>
        <div class="qa a" onclick="navTo('s-gastos')"><div class="qa-ico">🧾</div><div class="qa-lbl">Gastos</div><div class="qa-sub">${fmt(totalGastos)} este mes</div></div>
        <div class="qa b" onclick="navTo('s-alim-hub')"><div class="qa-ico">🍽️</div><div class="qa-lbl">Alimentación</div><div class="qa-sub">Plan y lista de compras</div></div>
      </div>
      <div style="height:80px"></div>`;

    $('home-admin-body').innerHTML=adminHtml;

  } else if(rol==='familiar'){
    setHdr('home-fam','var(--blue)');
    renderSidebar();
    // Próximos eventos del familiar
    const eventosComp = DB.getCompartido().eventos||[];
    const hoyStr = hoy();
    const proximosEv = eventosComp
      .filter(e=>e.fecha>=hoyStr)
      .sort((a,b)=>a.fecha.localeCompare(b.fecha))
      .slice(0,3);
    const evHtml = proximosEv.length
      ? proximosEv.map(e=>`<div style="display:flex;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line)"><div style="width:36px;height:36px;border-radius:var(--rs);background:var(--sage-lt);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">📅</div><div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--ink)">${escapeHtml(e.titulo)||'Evento'}</div><div style="font-size:12px;color:var(--ink3)">${e.fecha===hoyStr?'Hoy':e.fecha} ${e.hora?'· '+e.hora:''}</div></div></div>`).join('')
      : `<div style="padding:14px 16px;font-size:13px;color:var(--ink3)">Sin eventos próximos</div>`;

    $('home-fam-body').innerHTML=hero+sem({p:bitaHoy?.presion,a:bitaHoy?.almuerzo,n:bitaHoy?.animo})+
      (bitaHoy?.resumen?`<div style="margin:0 16px 12px;background:var(--sage-lt);border:1px solid var(--sage-md);border-radius:var(--r);padding:14px"><div style="font-size:11px;font-weight:700;color:var(--sage);margin-bottom:6px">✦ Resumen IA del día</div><div style="font-size:14px;color:var(--ink);line-height:1.7">${escapeHtml(bitaHoy.resumen)}</div></div>`:'')+`
      <div class="slbl">Próximos eventos</div>
      <div style="margin:0 16px 14px;background:var(--white);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;cursor:pointer" onclick="navTo('s-agenda')">${evHtml}<div style="padding:10px 16px;font-size:12px;color:var(--sage);font-weight:600;text-align:center">Ver agenda completa →</div></div>
      <div class="slbl">Acciones rápidas</div>
      <div class="qa-grid">
        <div class="qa p" onclick="navTo('s-bita-new')"><div class="qa-ico">📋</div><div class="qa-lbl">Registrar turno</div><div class="qa-sub">Bitácora del día</div></div>
        <div class="qa" onclick="navTo('s-agenda')"><div class="qa-ico">📅</div><div class="qa-lbl">Agenda</div><div class="qa-sub">Citas y eventos</div></div>
        <div class="qa a" onclick="navTo('s-gastos')"><div class="qa-ico">🧾</div><div class="qa-lbl">Gastos</div><div class="qa-sub">Registrar gasto</div></div>
        <div class="qa b" onclick="navTo('s-alim-hub')"><div class="qa-ico">🍽️</div><div class="qa-lbl">Alimentación</div><div class="qa-sub">Plan y registro</div></div>
      </div>
      <div class="slbl">Gastos del mes</div>
      <div class="sum-card">
        <div class="sum-row"><div class="sum-ico" style="background:var(--sage-lt)">💰</div><div class="sum-lbl">Total registrado</div><span class="badge b-ok">${fmt(totalGastos)}</span></div>
        <div class="sum-row" style="border:none"><div class="sum-ico" style="background:var(--surf)">📊</div><div class="sum-lbl">Presupuesto mensual</div><span class="badge b-muted">${fmt(comp.presupuesto||150000)}</span></div>
      </div>
      <div class="ia" style="margin:0 16px 80px"><div class="ia-ico">✦</div><div>Solo puedes ver la información. El registro lo hace la administradora o la cuidadora.</div></div>`;

  } else if(rol==='observador'){
    setHdr('home-obs','var(--purple)');
    renderSidebar();
    $('home-obs-body').innerHTML=`
      <div style="background:linear-gradient(135deg,var(--sage-dk),var(--sage));padding:28px 18px 22px;text-align:center">
        <div style="font-size:48px;margin-bottom:10px">🌿</div>
        <div style="font-size:20px;font-weight:800;color:#fff;margin-bottom:6px">${escapeHtml(am.nombre)||'—'} · ${calcularEdad(am.fechaNacimiento)||am.edad||'—'} años</div>
        <div style="font-size:14px;color:rgba(255,255,255,.78)">${bitaHoy?`${escapeHtml(am.nombre)} estuvo bien hoy ✓`:'Sin registros hoy aún'}</div>
      </div>
      ${sem({p:bitaHoy?.presion,a:bitaHoy?.almuerzo,n:bitaHoy?.animo})}
      ${bitaHoy?.resumen?`<div style="margin:0 16px 16px;background:var(--sage-lt);border:1px solid var(--sage-md);border-radius:var(--r);padding:14px"><div style="font-size:11px;font-weight:700;color:var(--sage);margin-bottom:6px">✦ Resumen del día</div><div style="font-size:14px;color:var(--ink);line-height:1.7">${escapeHtml(bitaHoy.resumen)}</div></div>`:
      `<div class="empty" style="padding:28px"><div style="font-size:13px;color:var(--ink3)">Aún no hay registros del día de hoy.</div></div>`}
      <div class="ia" style="margin:0 16px 80px"><div class="ia-ico">✦</div><div>Como observador, ves el estado general del cuidado.</div></div>`;

  } else if(rol==='cuidadora'){
    setHdr('home-cui','var(--amber)');
    renderSidebar();
    const alim=DB.getAlim();
    const registroDiario=(alim.diario||{})[hoy()];
    const checks={
      bita:!!bitaHoy,
      meds:meds.length>0&&medsHoy.length===0,
      alim:!!(registroDiario?.desayuno||registroDiario?.almuerzo||registroDiario?.cena),
    };
    const done=Object.values(checks).filter(Boolean).length;
    const total=Object.keys(checks).length;
    $('home-cui-body').innerHTML=hero+`
      <div class="slbl">Tu turno de hoy</div>
      <div style="margin:0 16px 14px;background:var(--white);border:1px solid var(--line);border-radius:var(--r);overflow:hidden">
        <div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between">
          <div style="font-size:13px;font-weight:700;color:var(--ink)">Progreso del turno</div>
          <div style="font-size:13px;font-weight:800;color:var(--sage)">${done}/${total} completado</div>
        </div>
        <div style="height:5px;background:var(--line)"><div style="height:100%;background:var(--sage);width:${done*50}%;transition:width .5s"></div></div>
        <div class="chk-item" onclick="navTo('s-bita-new')">
          <div class="chkbox${checks.bita?' on':''}">${checks.bita?'✓':''}</div>
          <div class="chk-lbl${checks.bita?' done':''}">Registrar bitácora del turno</div>
          <div class="chk-tag">${checks.bita?'Hecho':'Pendiente'}</div>
        </div>
        <div class="chk-item" onclick="navTo('s-salud-hub')">
          <div class="chkbox${checks.meds?' on':''}">${checks.meds?'✓':''}</div>
          <div class="chk-lbl${checks.meds?' done':''}">Confirmar medicamentos del día</div>
          <div class="chk-tag">${checks.meds?'Hecho':medsHoy.length>0?medsHoy.length+' pendientes':'Sin meds'}</div>
        </div>
        <div class="chk-item" onclick="navTo('s-alim-hub')" style="border:none">
          <div class="chkbox${checks.alim?' on':''}">${checks.alim?'✓':''}</div>
          <div class="chk-lbl${checks.alim?' done':''}">Registrar alimentación del día</div>
          <div class="chk-tag">${checks.alim?'Hecho':'Pendiente'}</div>
        </div>
      </div>
      <div class="ia" style="margin:0 16px 80px"><div class="ia-ico">✦</div><div>Registra la bitácora y confirma los medicamentos para completar tu turno.</div></div>`;
  }
}

/* ════ NAVEGACIÓN POR ROL (fuente única: sidebar desktop y sheet "Más" mobile) ════ */
function _navItemsRol(s,c){
  const meds=c.meds||[];
  const medsHoy=meds.filter(m=>!(c.confirmaciones||{})[m.id+'_'+hoy()]);
  const navMap={
    admin:[
      {ico:'🏠',lbl:'Inicio',screen:'s-home-admin'},
      {ico:'📋',lbl:'Bitácora',screen:'s-bita-list'},
      {ico:'💊',lbl:'Salud',screen:'s-salud-hub',badge:medsHoy.length||0},
      {ico:'🍽️',lbl:'Alimentación',screen:'s-alim-hub'},
      {ico:'📅',lbl:'Agenda',screen:'s-agenda'},
      {ico:'🧾',lbl:'Gastos',screen:'s-gastos'},
      {ico:'👥',lbl:'Invitar personas',screen:'s-invitaciones'},
      {ico:'👥',lbl:'Equipo',screen:'s-equipo-hub'},
      {ico:'🏠',lbl:'Hogar e insumos',screen:'s-hogar-hub'},
      {ico:'📊',lbl:'Informe mensual',screen:'s-informe-hub'},
      {ico:'⚙️',lbl:'Perfil y ajustes',screen:'s-perfil'},
    ],
    familiar:[{ico:'🏠',lbl:'Inicio',screen:'s-home-familiar'},{ico:'📋',lbl:'Registrar',screen:'s-bita-new'},{ico:'📋',lbl:'Historial',screen:'s-bita-list'},{ico:'📅',lbl:'Agenda',screen:'s-agenda'},{ico:'🍽️',lbl:'Alimentación',screen:'s-alim-hub'},{ico:'🧾',lbl:'Gastos',screen:'s-gastos'},{ico:'📊',lbl:'Informe',screen:'s-informe-hub'},{ico:'⚙️',lbl:'Perfil',screen:'s-perfil'}],
    observador:[{ico:'🏠',lbl:'Inicio',screen:'s-home-observador'},{ico:'📋',lbl:'Historial',screen:'s-bita-list'},{ico:'📊',lbl:'Informe',screen:'s-informe-hub'},{ico:'⚙️',lbl:'Perfil',screen:'s-perfil'}],
    cuidadora:[{ico:'🏠',lbl:'Inicio',screen:'s-home-cuidadora'},{ico:'📋',lbl:'Registrar turno',screen:'s-bita-new'},{ico:'💊',lbl:'Salud',screen:'s-salud-hub',badge:medsHoy.length||0},{ico:'🍽️',lbl:'Alimentación',screen:'s-alim-hub'},{ico:'⚙️',lbl:'Perfil',screen:'s-perfil'}],
  };
  return navMap[s.rol]||navMap.familiar;
}

// Sheet mobile "Más" — lista completa de módulos según el rol (equivalente al sidebar de escritorio)
function abrirMas(){
  const s=DB.getSesion(); if(!s) return;
  const c=DB.getCuidado(); if(!c) return;
  const items=_navItemsRol(s,c);
  const actual=document.querySelector('.screen.active')?.id;
  $('mas-lista').innerHTML=items.map(it=>`
    <div class="sb-item${it.screen===actual?' on':''}" onclick="navTo('${it.screen}');cerrarSheet('ov-mas')">
      <div class="sb-item-ico">${it.ico}</div>${escapeHtml(it.lbl)}
      ${it.badge?`<span class="sb-item-badge">${it.badge}</span>`:''}
    </div>`).join('');
  $('ov-mas').classList.add('open');
}

/* ════ SIDEBAR ════ */
function renderSidebar(){
  const s=DB.getSesion(); if(!s) return;
  const c=DB.getCuidado(); if(!c) return;
  const ava=$('sb-ava'); if(ava){ ava.textContent=initials(s.nombre); ava.style.background=ROL_COLOR[s.rol]||'#888'; }
  $('sb-user-name').textContent=s.nombre.split(' ')[0];
  $('sb-user-rol').textContent=ROL_LABEL[s.rol]||s.rol;
  // Switcher
  const sw=$('sb-switcher'); if(sw) sw.style.display=s.rol==='admin'?'block':'none';
  $('sb-sw-ava').textContent=initials(c.am?.nombre||'M');
  $('sb-sw-name').textContent=`${c.am?.nombre||'—'} · ${calcularEdad(c.am?.fechaNacimiento)||c.am?.edad||'—'} años`;

  const items=_navItemsRol(s,c);
  $('sb-nav').innerHTML=items.map(it=>`
    <div class="sb-item" data-screen="${it.screen}" onclick="navTo('${it.screen}')">
      <div class="sb-item-ico">${it.ico}</div>${it.lbl}
      ${it.badge?`<span class="sb-item-badge">${it.badge}</span>`:''}
    </div>`).join('');
  // Marcar activo
  const sc=document.querySelector('.screen.active');
  if(sc) document.querySelectorAll('.sb-item').forEach(i=>i.classList.toggle('on',i.dataset.screen===sc.id));
}

/* ════ SWITCHER MULTI-CUIDADO ════ */
/* ════ MULTI-CUIDADO ════ */
function crearNuevoCuidado(){
  const s=DB.getSesion(); if(!s||s.rol!=='admin') return;
  // Crear un nuevo cuidado vacío y asociarlo al admin
  const cid='c-'+Date.now();
  // Solo datos individuales del nuevo Cuidado
  // Los datos compartidos (gastos, alimentación, hogar, equipo, agenda)
  // ya existen en raiz_compartido_{adminId} y se comparten automáticamente
  DB.saveCuidado({
    id:cid, adminId:s.userId, creado:hoy(),
    am:{nombre:'',edad:0,relacion:'',condiciones:[],alergias:[],medico:'',restricciones:[]},
    meds:[], bitacoras:[], confirmaciones:{}, informes:[],
  });
  // Cambiar la sesión al nuevo cuidado
  const u=DB.getUsuarios().find(x=>x.id===s.userId);
  if(u){ u.cuidadoId=cid; DB.setUsuarios(DB.getUsuarios().map(x=>x.id===s.userId?u:x)); }
  DB.setSesion({...s, cuidadoId:cid});
  // Resetear lista de cuidadoras para el onboarding del nuevo
  _onbCuidadoras=[''];
  // Ir al onboarding del nuevo familiar
  const el=$('onb-am-saludo'); if(el) el.textContent=`Agregar familiar 👋`;
  navTo('s-onb-am');
  toast('Nuevo cuidado — completa los datos','ok');
}

/* Cambiar cuidado activo y permanecer en home */
function selCuidadoYNav(cid){
  if(cid===DB.getSesion()?.cuidadoId) return; // ya es el activo
  selCuidado(cid);
}

function abrirSwitcher(){
  const s=DB.getSesion(); if(!s) return;
  const cuidados=DB.getCuidados().filter(c=>c.adminId===s.userId||c.id===s.cuidadoId);
  $('switcher-lista').innerHTML=cuidados.map(c=>`
    <div class="mc-item${c.id===s.cuidadoId?' active':''}" onclick="selCuidado('${c.id}')">
      <div class="mc-ava" style="background:var(--sage)">${escapeHtml(initials(c.am?.nombre||'?'))}</div>
      <div><div class="mc-name">${escapeHtml(c.am?.nombre)||'Sin nombre'}</div><div class="mc-meta">${c.am?.edad||'—'} años · ${escapeHtml(nombreCuidadoraPrincipal(c))||'Sin cuidadora'}</div></div>
      ${c.id===s.cuidadoId?'<div class="mc-check">✓</div>':''}
    </div>`).join('');
  $('ov-switcher').classList.add('open');
}
function selCuidado(cid){
  const s=DB.getSesion(); if(!s) return;
  const u=DB.getUsuarios().find(x=>x.id===s.userId); if(!u) return;
  u.cuidadoId=cid;
  DB.setUsuarios(DB.getUsuarios().map(x=>x.id===s.userId?u:x));
  DB.setSesion({...s,cuidadoId:cid});
  cerrarSheet('ov-switcher');
  irAlHome();
  const c=DB.getCuidados().find(x=>x.id===cid);
  toast('Cambiado a '+(c?.am?.nombre||'el cuidado'),'ok');
}

/* ════ PERFIL ════ */
function renderPerfil(){
  const s=DB.getSesion(); if(!s) return;
  const c=DB.getCuidado();
  const esAdmin = s.rol==='admin';
  // Mostrar u ocultar sección de config del AM según rol
  const amSection=document.getElementById('perfil-am-section');
  if(amSection) amSection.style.display = esAdmin ? 'block' : 'none';
  const presSection=document.getElementById('perfil-presupuesto-section');
  if(presSection) presSection.style.display = esAdmin ? 'block' : 'none';
  // Hero
  const hero=$('perfil-hero');
  if(hero) hero.innerHTML=`<div style="display:flex;align-items:center;gap:14px"><div style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff">${escapeHtml(initials(s.nombre))}</div><div><div style="font-size:18px;font-weight:800;color:#fff">${escapeHtml(s.nombre)}</div><div style="font-size:13px;color:rgba(255,255,255,.72);margin-top:2px">${escapeHtml(s.email)}</div><div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">${ROL_EMOJI[s.rol]||''} ${ROL_LABEL[s.rol]||s.rol}</div></div></div>`;
  // Sección AM solo para admin
  const amSec=$('perfil-am-section');
  if(amSec){
    amSec.style.display=s.rol==='admin'&&c?'block':'none';
    if(s.rol==='admin'&&c){
      $('pf-am-nombre').value=c.am?.nombre||'';
      $('pf-am-fnac').value=c.am?.fechaNacimiento||'';
      $('pf-am-rut').value=c.am?.rut||'';
      $('pf-am-relacion').value=c.am?.relacion||'Mamá';
      $('pf-cuidadora').value=c.cuidadora||'';
      $('pf-medico').value=c.am?.medico||'';
      const pfComp=DB.getCompartido(); $('pf-presupuesto').value=pfComp.presupuesto||150000;

      // Renderizar lista de todos los cuidados del admin
      const todosLosCuidados=DB.getCuidados().filter(x=>x.adminId===s.userId);
      const lista=$('pf-cuidados-lista');
      if(lista){
        lista.innerHTML=todosLosCuidados.map(cx=>{
          const esActivo=cx.id===s.cuidadoId;
          const nombre=cx.am?.nombre||'Sin nombre';
          const meta=`${calcularEdad(cx.am?.fechaNacimiento)||cx.am?.edad||'—'} años · ${escapeHtml(cx.am?.relacion)||'—'}`;
          const rut=cx.am?.rut?` · ${escapeHtml(cx.am.rut)}`:'';
          return `
            <div style="display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid var(--line);${esActivo?'background:var(--sage-lt)':''}">
              <div style="flex:1;display:flex;align-items:center;gap:12px;cursor:pointer" onclick="selCuidado('${cx.id}')">
                <div style="width:40px;height:40px;border-radius:50%;background:${esActivo?'var(--sage)':'var(--surf)'};border:2px solid ${esActivo?'var(--sage)':'var(--line)'};display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:${esActivo?'#fff':'var(--ink3)'};flex-shrink:0">${escapeHtml(initials(nombre))}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:14px;font-weight:700;color:var(--ink)">${escapeHtml(nombre)}</div>
                  <div style="font-size:12px;color:var(--ink3);margin-top:2px">${meta}${rut}</div>
                </div>
                ${esActivo?'<span class="badge b-ok">Activo ✓</span>':'<span style="font-size:12px;color:var(--sage);font-weight:600">Cambiar →</span>'}
              </div>
              ${!esActivo?`<button onclick="eliminarCuidado('${cx.id}')" style="width:30px;height:30px;border-radius:50%;background:var(--red-lt);border:1px solid var(--red);color:var(--red);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit" title="Eliminar">×</button>`:''}
            </div>`;
}).join('');
      }
    }
  }
}
function guardarPerfil(){
  const s=DB.getSesion(); if(!s) return;
  const c=DB.getCuidado();
  if(s.rol==='admin'&&c){
    const nombre=$('pf-am-nombre').value.trim();
    if(!nombre){ toast('El nombre no puede estar vacío','err'); return; }
    const fnac=$('pf-am-fnac').value;
    const edad=calcularEdad(fnac)||c.am?.edad||0;
    c.am={...c.am,
      nombre,
      fechaNacimiento: fnac||c.am?.fechaNacimiento||'',
      edad,
      rut: $('pf-am-rut').value.trim()||c.am?.rut||'',
      relacion: $('pf-am-relacion').value,
      medico: $('pf-medico').value.trim(),
    };
    c.cuidadora=$('pf-cuidadora').value.trim();
    const gpComp=DB.getCompartido(); gpComp.presupuesto=parseInt($('pf-presupuesto').value)||150000; DB.saveCompartido(gpComp);
    DB.saveCuidado(c);
    $('sb-sw-name').textContent=`${c.am.nombre} · ${edad} años`;
  }
  toast('✓ Perfil actualizado','ok');
}

/* ── SHEETS / CONFIRM ── */
function cerrarSheet(id){ $(id)?.classList.remove('open'); }
let _cb=null;
function confirmar(title,text,cb){ $('cb-title').textContent=title; $('cb-text').textContent=text; _cb=cb; $('confirm-ov').classList.add('open'); }
$('cb-ok').onclick=()=>{ $('confirm-ov').classList.remove('open'); if(_cb)_cb(); };
function cerrarConfirm(){ $('confirm-ov').classList.remove('open'); _cb=null; }
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    document.querySelectorAll('.overlay.open').forEach(ov=>ov.classList.remove('open'));
    cerrarConfirm();
  }
});
// Contener el foco (Tab/Shift+Tab) dentro del sheet abierto para que no escape al fondo
document.addEventListener('keydown',e=>{
  if(e.key!=='Tab') return;
  const ov=document.querySelector('.overlay.open'); if(!ov) return;
  const sheet=ov.querySelector('.sheet')||ov;
  const focusables=[...sheet.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(el=>el.offsetParent!==null);
  if(!focusables.length) return;
  const first=focusables[0], last=focusables[focusables.length-1];
  if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
});

/* ════ INIT ════ */
// Callback de Firebase cuando detecta sesión activa (al recargar la página)
window._raizOnAuth = async (firebaseUser) => {
  try {
    // Siempre cargar datos frescos de Firestore al detectar sesión de Firebase
    // (cubre: primer login en móvil, recargar página, cambio de dispositivo)
    const uData = await _fsGet('usuarios/' + firebaseUser.uid);
    if(!uData) return;
    const adminId = uData.adminId || firebaseUser.uid;

    // Cargar todos los datos del hogar desde Firestore al caché
    await _cargarDatosFirestore(firebaseUser.uid, uData.cuidadoId, adminId);
    DB.setSesion({userId:firebaseUser.uid, nombre:uData.nombre, email:uData.email, rol:uData.rol, cuidadoId:uData.cuidadoId});

    // Verificar que los datos llegaron correctamente
    const cuidados = DB.getCuidados();
    if(cuidados.length === 0 && uData.rol === 'admin'){
      // Firestore está vacío (o el cuidado nunca llegó a guardarse) — crear un
      // cuidado vacío local con el mismo id para que el onboarding tenga algo
      // que completar. Sin esto, guardarOnbAM() no encuentra ningún cuidado
      // y se queda pegado en el paso 1 sin ningún aviso.
      DB.saveCuidado({
        id: uData.cuidadoId, adminId: adminId, creado: hoy(),
        am:{nombre:'',edad:0,fechaNacimiento:'',rut:'',relacion:'',condiciones:[],alergias:[],medico:'',restricciones:[]},
        meds:[], bitacoras:[], confirmaciones:{}, informes:[],
      });
      const sbEl = document.getElementById('sidebar');
      if(sbEl) sbEl.style.display = '';
      renderSidebar();
      navTo('s-onb-am');
      toast('Completa el perfil de la persona cuidada para comenzar', 'ok');
      return;
    }
    mostrarBienvenida(uData);
  } catch(e) {
    console.warn('Error restaurando sesión:', e.message);
  }
};

(function init(){
  // Ocultar sidebar hasta que haya sesión autenticada
  const sb=document.getElementById('sidebar');
  if(sb) sb.style.display='none';

  // Si hay sesión en localStorage, cargar inmediatamente (antes de que Firebase responda)
  // Esto evita el parpadeo de la pantalla de login al recargar
  const s=DB.getSesion();
  if(s && s.userId){
    // Mostrar splash brevemente mientras se verifica con Firebase
    navTo('s-splash');
    // Firebase _raizOnAuth se encargará de ir al home una vez que verifique
  } else {
    navTo('s-splash');
  }
  // Exponer API pública
  window.RAIZ={DB,navTo,irAlHome,renderHome,renderSidebar,ROL_COLOR,ROL_LABEL,initials,hoy,fmt};
})();


/* ════════════════════════════════════════════
   ESTADO COMPARTIDO — Módulos 3/4/5
   Un solo objeto ST para los tres módulos
   ════════════════════════════════════════════ */
const ST = {
  // M3 Bitácora
  bitacora: {
    bitaCuidadoId: null,
    filtro: 'todos',
    bitacoraActual: null,
    bitaEditandoId: null,
    form: {
      quien:'Cuidadora', presion:'', temp:'', sato:'',
      desayuno:'', almuerzo:'', cena:'',
      bano:false, hidra:false, activ:false, visita:false,
      animo:'',
    },
  },
  // M4 Salud
  salud: {
    tabActivo: 'meds',
    medEditando: null,
    medEditandoId: null,
    docFiltro: 'todos',
    ocrMeds: [],
  },
  // M5 Alimentación
  alimentacion: {
    tab: 'plan',
    porciones: {},
    vasosAgua: 0,
  },
  // M9 Gastos
  gastos: {
    mesVista: (()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })(),
    gastoEditandoId: null,
  },
  // M6 Equipo
  equipo: {
    tabEquip: 'cuidadoras',
    diasSeleccionados: new Set(['lunes','martes','miercoles','jueves','viernes']),
    editDiasSeleccionados: new Set(),
  },
  // M8 Hogar
  hogar: {
    tabHogar: 'insumos',
    filtroInsumo: 'todos',
    editInsumoId: null,
    editProvId: null,
  },
  // M7 Agenda
  agenda: {
    anioActual: new Date().getFullYear(),
    mesActual: new Date().getMonth(),
    diaSeleccionado: null,
    eventoEditandoId: null,
    tipoActual: 'cita_medica',
    eventoCuidadoId: null,
  },
  // M10 Informe IA
  informe: {
    informeActual: null,
    mesGenerando: null,
    version: 'familiar',
  },
};

/* ════════════════════════════════════════════
   FUNCIONES AUXILIARES COMPARTIDAS
   ════════════════════════════════════════════ */
function horaActual(){
  return new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});
}
function fechaCorta(fechaStr){
  if(!fechaStr) return '—';
  const d=new Date(fechaStr+'T12:00');
  return d.toLocaleDateString('es-CL',{day:'numeric',month:'short'});
}
function esHoy(f){ return f===hoy(); }
function esEstaSemana(f){
  const d=new Date(); const ini=new Date(d); ini.setDate(d.getDate()-d.getDay());
  return new Date(f+'T12:00')>=ini;
}
function esEsteMes(f){ return f?.startsWith(hoy().slice(0,7)); }

/* Selector de Cuidado en bitácora */
function initSelectorCuidado(){
  const todos=DB.getCuidadosAdmin();
  const sel=document.getElementById('bita-selector-cuidado');
  const chips=document.getElementById('bita-cuidado-chips');
  if(!sel||!chips) return;
  const s=DB.getSesion();
  if(!ST.bitacora.bitaCuidadoId) ST.bitacora.bitaCuidadoId=s?.cuidadoId||todos[0]?.id;
  if(todos.length<=1){ sel.style.display='none'; return; }
  sel.style.display='block';
  chips.innerHTML=todos.map(cx=>{
    const on=cx.id===ST.bitacora.bitaCuidadoId;
    return `<button onclick="selCuidadoBita('${cx.id}')"
      style="padding:8px 16px;border-radius:20px;font-size:13px;font-weight:${on?700:500};
      border:2px solid ${on?'var(--sage)':'var(--line)'};
      background:${on?'var(--sage-lt)':'var(--surf)'};
      color:${on?'var(--sage)':'var(--ink3)'};cursor:pointer;font-family:inherit;margin:0 6px 6px 0">
      ${escapeHtml(cx.am?.nombre)||'Sin nombre'}
    </button>`;
  }).join('');
}
function selCuidadoBita(cid){
  ST.bitacora.bitaCuidadoId=cid;
  initSelectorCuidado();
}

/* ════════════════════════════════════════════
   MÓDULO 3 — BITÁCORA
   ════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   MÓDULO 3 · BITÁCORA — JAVASCRIPT COMPLETO
   ════════════════════════════════════════════════════════════ */

/* ── CAPA DE DATOS (mismo patrón que M1 y M2) ── */

/* ── ESTADO LOCAL ── */


/* ── HELPERS ── */



function fechaLarga(fecha){
  const d = fecha ? new Date(fecha+'T12:00') : new Date();
  return d.toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'});
}
/* ── NAVEGACIÓN ── */


/* ── SIDEBAR ── */

/* ════ LISTA DE BITÁCORAS ════ */
function setFiltro(filtro, btn){
  ST.bitacora.filtro=filtro;
  document.querySelectorAll('.fpill').forEach(p=>p.classList.remove('on'));
  btn.classList.add('on');
  renderLista();
}

function renderLista(){
  const sesion=DB.getSesion(); if(!sesion) return;
  const _cid=DB.getSesion()?.cuidadoId;
  const cuidado=DB.getCuidadoById(_cid)||DB.getCuidado(); if(!cuidado) return;
  const puedeEscribir=['admin','familiar','cuidadora'].includes(sesion.rol);
  const esObservador=sesion.rol==='observador';
  const am=cuidado.am||{};

  // Sub-titulo con nombre del AM
  const sub=`${am.nombre||'la persona cuidada'} · historial completo`;
  if($('bita-list-sub')) $('bita-list-sub').textContent=sub;
  if($('bita-list-sub-d')) $('bita-list-sub-d').textContent=sub;

  // Botón de nuevo registro (Admin, Familiar y Cuidadora pueden registrar)
  const btnHTML=puedeEscribir
    ? `<button class="hdr-action" onclick="navTo('s-bita-new')">+ Nuevo</button>`
    : '';
  if($('bita-list-hdr-action')) $('bita-list-hdr-action').innerHTML=btnHTML;
  if($('bita-list-hdr-action-d')) $('bita-list-hdr-action-d').innerHTML=puedeEscribir
    ? `<button style="background:var(--sage);color:#fff;border:none;border-radius:var(--rs);padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit" onclick="navTo('s-bita-new')">+ Nuevo registro</button>`
    : '';

  // FAB
  const fab=$('bita-fab');
  if(fab) fab.style.display=puedeEscribir?'flex':'none';

  // Aviso de solo lectura (únicamente observador es de solo lectura)
  const notice=$('bita-obs-notice');
  if(notice){
    notice.style.display=esObservador?'block':'none';
    const txt=$('bita-obs-txt');
    if(txt) txt.textContent='Como observador solo ves el resumen del día. Para el historial completo, el administrador debe cambiar tu rol.';
  }

  // Filtrar bitácoras
  let bitacoras=[...(cuidado.bitacoras||[])].reverse();
  if(ST.bitacora.filtro==='hoy')    bitacoras=bitacoras.filter(b=>esHoy(b.fecha));
  if(ST.bitacora.filtro==='semana') bitacoras=bitacoras.filter(b=>esEstaSemana(b.fecha));
  if(ST.bitacora.filtro==='mes')    bitacoras=bitacoras.filter(b=>esEsteMes(b.fecha));

  // Observador: solo ve registros con resumen
  if(esObservador) bitacoras=bitacoras.filter(b=>b.resumen);

  const body=$('bita-list-body');
  if(!bitacoras.length){
    body.innerHTML=`
      <div class="empty">
        <div class="empty-ico">📋</div>
        <div class="empty-title">${ST.bitacora.filtro==='hoy'?'Sin registros hoy':'Sin registros'}</div>
        <div class="empty-txt">${puedeEscribir
          ? 'Toca ＋ para registrar el día de '+( am.nombre||'la persona cuidada')+'.'
          : 'El administrador o la cuidadora aún no han registrado nada.'}</div>
      </div>`;
    return;
  }

  // Agrupar por fecha
  const grupos={};
  bitacoras.forEach(b=>{
    if(!grupos[b.fecha]) grupos[b.fecha]=[];
    grupos[b.fecha].push(b);
  });

  let html='';
  Object.entries(grupos).forEach(([fecha,items])=>{
    const esH=esHoy(fecha);
    html+=`<div class="fecha-grupo-lbl${esH?' hoy':''}">${esH?'HOY · ':''}${fechaLarga(fecha).toUpperCase()}</div>`;

    items.forEach(b=>{
      const badges=[];
      if(b.presion) badges.push(`<span class="badge b-ok">❤️ ${b.presion}</span>`);
      if(b.temp)    badges.push(`<span class="badge b-ok">🌡️ ${b.temp}°C</span>`);
      if(b.almuerzo&&b.almuerzo!=='Nada') badges.push(`<span class="badge ${b.almuerzo==='Todo'?'b-ok':'b-warn'}">🍽️ ${b.almuerzo}</span>`);
      else if(b.almuerzo==='Nada') badges.push(`<span class="badge b-err">🍽️ No comió</span>`);
      if(b.bano)  badges.push(`<span class="badge b-ok">🚽 ✓</span>`);
      if(b.animo) badges.push(`<span class="badge b-info">${b.animo}</span>`);

      html+=`
        <div class="bita-card" onclick="verDetalle('${b.id}')">
          <div class="bita-header">
            <div>
              <div class="bita-hora">${b.hora||'—'} · ${b.quien||'—'}</div>
            </div>
            ${puedeEscribir
              ? `<button class="bita-del" onclick="event.stopPropagation();eliminarBitacora('${b.id}')">Eliminar</button>`
              : ''}
          </div>
          ${badges.length?`<div class="bita-badges">${badges.join('')}</div>`:''}
          ${b.nota?`<div class="bita-nota">${escapeHtml(b.nota)}</div>`:''}
          ${b.resumen?`
            <div class="bita-resumen">
              <span>✦</span>
              <span>${escapeHtml(b.resumen)}</span>
            </div>`:''}
        </div>`;
    });
  });
  body.innerHTML=html;
}

/* ════ VER DETALLE ════ */
function verDetalle(id){
  const cuidado=DB.getCuidado(); if(!cuidado) return;
  const sesion=DB.getSesion(); if(!sesion) return;
  const b=cuidado.bitacoras.find(x=>x.id===id);
  if(!b){ toast('Registro no encontrado','err'); return; }
  ST.bitacora.bitacoraActual=b;

  // Títulos
  const titulo=`Registro · ${fechaCorta(b.fecha)}`;
  const sub=`${b.hora||'—'} · Registrado por ${b.quien||'—'}`;
  if($('detalle-titulo')) $('detalle-titulo').textContent=titulo;
  if($('detalle-titulo-d')) $('detalle-titulo-d').textContent=titulo;
  if($('detalle-sub')) $('detalle-sub').textContent=sub;
  if($('detalle-sub-d')) $('detalle-sub-d').textContent=sub;

  // Acciones en header
  const puedeEliminar=['admin','familiar'].includes(sesion.rol);
  const puedeEditar=['admin','cuidadora'].includes(sesion.rol);
  if($('detalle-acciones-hdr')){
    $('detalle-acciones-hdr').innerHTML=
      (puedeEditar?`<button style="font-size:11px;color:var(--sage);background:var(--sage-lt);border:1px solid var(--sage-md);border-radius:6px;padding:4px 10px;cursor:pointer;font-family:inherit;margin-right:6px" onclick="editarBitacora('${b.id}')">Editar</button>`:'')+
      (puedeEliminar?`<button style="font-size:11px;color:var(--red);background:var(--red-lt);border:1px solid #F0B0AE;border-radius:6px;padding:4px 10px;cursor:pointer;font-family:inherit" onclick="eliminarBitacora('${b.id}')">Eliminar</button>`:'');
  }

  // Contenido del detalle
  const secciones=[
    {
      titulo:'Signos vitales',
      filas:[
        ['❤️ Presión arterial', b.presion||'—', b.presion?'b-ok':'b-muted'],
        ['🌡️ Temperatura',      b.temp?b.temp+'°C':'—', b.temp?'b-ok':'b-muted'],
        ['🫁 Saturación O₂',    b.sato?b.sato+'%':'—', b.sato?'b-ok':'b-muted'],
      ]
    },
    {
      titulo:'Alimentación',
      filas:[
        ['☀️ Desayuno',b.desayuno||'—', b.desayuno==='Todo'?'b-ok':b.desayuno==='Nada'?'b-err':'b-warn'],
        ['🌤 Almuerzo', b.almuerzo||'—', b.almuerzo==='Todo'?'b-ok':b.almuerzo==='Nada'?'b-err':'b-warn'],
        ['🌙 Cena',     b.cena||'—',    b.cena==='Todo'?'b-ok':b.cena==='Nada'?'b-err':b.cena?'b-warn':'b-muted'],
      ]
    },
    {
      titulo:'Controles del día',
      filas:[
        ['🚽 Baño',          b.bano?'Sí ✓':'No registrado',   b.bano?'b-ok':'b-muted'],
        ['💧 Hidratación',   b.hidra?'Buena (~1.5L)':'No registrada', b.hidra?'b-ok':'b-muted'],
        ['🏃 Actividad',     b.activ?'Realizada ✓':'No registrada', b.activ?'b-ok':'b-muted'],
        ['👥 Visita',        b.visita?'Recibió visita':'No registrada', b.visita?'b-info':'b-muted'],
      ]
    },
    {
      titulo:'Estado de ánimo',
      filas:[
        ['😊 Ánimo', b.animo||'—', b.animo?'b-ok':'b-muted'],
      ]
    },
  ];

  let html=secciones.map(sec=>`
    <div class="det-section">
      <div class="det-sec-title">${sec.titulo}</div>
      ${sec.filas.map(([k,v,cls])=>`
        <div class="det-row">
          <div class="det-key">${k}</div>
          <span class="badge ${cls}">${v}</span>
        </div>`).join('')}
    </div>`).join('');

  // Nota libre
  if(b.nota){
    html+=`
      <div class="det-section">
        <div class="det-sec-title">Nota del día</div>
        <div style="font-size:13px;color:var(--ink2);line-height:1.6;padding-top:4px">${escapeHtml(b.nota)}</div>
      </div>`;
  }

  // Resumen IA
  if(b.resumen){
    html+=`
      <div style="margin:0;padding:0">
        <div class="resumen-ia-box" style="margin:0;border-radius:0">
          <div class="ria-header"><span>✦</span> Resumen IA</div>
          <div class="ria-text">${escapeHtml(b.resumen)}</div>
          <div class="ria-actions">
            <button class="ria-btn ria-btn-wa" onclick="enviarWhatsAppResumen('${b.id}')">💬 WhatsApp</button>
            <button class="ria-btn ria-btn-copy" onclick="copiarResumenDetalle('${b.id}')">📋 Copiar</button>
          </div>
        </div>
      </div>`;
  }

  $('detalle-body').innerHTML=html;

  navTo('s-bita-detalle');
}

/* ════ ELIMINAR BITÁCORA ════ */
function eliminarBitacora(id){
  confirmar(
    '¿Eliminar este registro?',
    'El registro se eliminará permanentemente del historial.',
    ()=>{
      const cuidado=DB.getCuidado(); if(!cuidado) return;
      cuidado.bitacoras=cuidado.bitacoras.filter(b=>b.id!==id);
      DB.saveCuidado(cuidado);
      toast('Registro eliminado','ok');
      navTo('s-bita-list');
    }
  );
}

/* ════ FORMULARIO DE NUEVO REGISTRO ════ */
function initFormulario(){
  const sesion=DB.getSesion(); if(!sesion) return;
  const cuidado=DB.getCuidado();

  const editId=ST.bitacora.bitaEditandoId;
  const b=editId ? (cuidado?.bitacoras||[]).find(x=>x.id===editId) : null;
  if(editId && !b) ST.bitacora.bitaEditandoId=null; // registro ya no existe, salir de modo edición

  // Fechas y hora (al editar, se muestra la fecha/hora original del registro)
  const fechaStr=b?fechaLarga(b.fecha):fechaLarga();
  const horaStr=b?b.hora:horaActual();
  if($('new-hora-display')) $('new-hora-display').textContent=horaStr;
  if($('new-fecha-display')) $('new-fecha-display').textContent=fechaStr;
  if($('new-fecha-display-d')) $('new-fecha-display-d').textContent=fechaStr;
  if($('new-titulo'))   $('new-titulo').textContent=b?'Editar registro':'Nuevo registro';
  if($('new-titulo-d')) $('new-titulo-d').textContent=b?'Editar registro':'Nuevo registro';

  // Estado del formulario: datos del registro si se edita, o valores por defecto si es nuevo
  ST.bitacora.form=b ? {
    quien: b.quien||'Cuidadora',
    presion: b.presion||'', temp: b.temp||'', sato: b.sato||'',
    desayuno: b.desayuno||'', almuerzo: b.almuerzo||'', cena: b.cena||'',
    bano: !!b.bano, hidra: !!b.hidra, activ: !!b.activ, visita: !!b.visita,
    animo: b.animo||'Muy bien 😊', nota: b.nota||'',
  } : {
    quien: sesion.rol==='cuidadora'?'Cuidadora':sesion.rol==='admin'?'Administradora':'Familiar',
    presion:'', temp:'', sato:'',
    desayuno:'Todo', almuerzo:'Todo', cena:'',
    bano:false, hidra:false, activ:false, visita:false,
    animo:'Muy bien 😊', nota:'',
  };
  const f=ST.bitacora.form;

  // Inputs de texto
  if($('v-presion')) $('v-presion').value=f.presion;
  if($('v-temp'))    $('v-temp').value=f.temp;
  if($('v-sato'))    $('v-sato').value=f.sato;
  if($('nota-libre')) $('nota-libre').value=f.nota;
  ['v-presion','v-temp','v-sato'].forEach(id=>$(id)?.classList.remove('warn','ok'));
  ['presion-msg','temp-msg','sato-msg'].forEach(id=>{ const el=$(id); if(el) el.style.display='none'; });

  // Checkboxes
  ['bano','hidra','activ','visita'].forEach(k=>{
    const cb=$('cb-'+k), cl=$('cl-'+k);
    if(cb){ cb.classList.toggle('on',f[k]); cb.textContent=f[k]?'✓':''; }
    if(cl){ cl.classList.toggle('done',f[k]); }
  });

  // Porciones (desayuno/almuerzo/cena) — el valor real está en el onclick, no en el texto del botón
  ['desayuno','almuerzo','cena'].forEach(c=>{
    const btns=$('pbs-'+c)?.querySelectorAll('.pb');
    btns?.forEach(bt=>{
      bt.classList.remove('todo','mitad','nada');
      const val=bt.getAttribute('onclick')?.match(/selPorcion\('[^']+','([^']+)'/)?.[1];
      if(val && val===f[c]) bt.classList.add(val==='Todo'?'todo':val==='Mitad'?'mitad':'nada');
    });
  });

  // Ánimo
  $('animo-btns')?.querySelectorAll('.ab').forEach(bt=>{
    bt.classList.toggle('on', bt.textContent===f.animo || (!f.animo && bt.textContent==='Muy bien 😊'));
  });

  // Quien registra
  $('quien-btns')?.querySelectorAll('.qb').forEach(bt=>{
    bt.classList.toggle('on', bt.textContent.includes(f.quien));
  });

  // Botón guardar
  const btn=$('btn-guardar');
  if(btn) btn.textContent=b?'Guardar cambios ✓':'Guardar registro ✓';
}

// Abre el formulario en modo edición, precargado con un registro existente
function editarBitacora(id){
  const sesion=DB.getSesion(); if(!sesion) return;
  if(!['admin','cuidadora'].includes(sesion.rol)){ toast('No tienes permiso para editar','err'); return; }
  ST.bitacora.bitaEditandoId=id;
  navTo('s-bita-new');
}

/* Selectors del formulario */
function selQuien(val, btn){
  ST.bitacora.form.quien=val;
  $('quien-btns')?.querySelectorAll('.qb').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}

function selPorcion(comida, val, btn){
  ST.bitacora.form[comida]=val;
  const cls=val==='Todo'?'todo':val==='Mitad'?'mitad':'nada';
  $('pbs-'+comida)?.querySelectorAll('.pb').forEach(b=>b.classList.remove('todo','mitad','nada'));
  btn.classList.add(cls);
}

function togChk(k){
  ST.bitacora.form[k]=!ST.bitacora.form[k];
  const cb=$('cb-'+k), cl=$('cl-'+k);
  if(cb){ cb.classList.toggle('on',ST.bitacora.form[k]); cb.textContent=ST.bitacora.form[k]?'✓':''; }
  if(cl){ cl.classList.toggle('done',ST.bitacora.form[k]); }
}

function selAnimo(val, btn){
  ST.bitacora.form.animo=val;
  $('animo-btns')?.querySelectorAll('.ab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}

/* ════ VALIDACIONES DE SIGNOS VITALES ════ */
function validarPresion(inp){
  const v=inp.value.trim();
  if(!v){ inp.classList.remove('warn','ok'); $('presion-msg').style.display='none'; return; }
  // Acepta formatos: 120/80, 120-80
  const ok=/^\d{2,3}[\/\-]\d{2,3}$/.test(v);
  inp.classList.toggle('warn',!ok);
  inp.classList.toggle('ok',ok);
  $('presion-msg').style.display=!ok?'block':'none';
  ST.bitacora.form.presion=v;
}

function validarTemp(inp){
  const v=parseFloat(inp.value);
  if(!inp.value){ inp.classList.remove('warn','ok'); $('temp-msg').style.display='none'; return; }
  const ok=v>=34 && v<=42;
  inp.classList.toggle('warn',!ok);
  inp.classList.toggle('ok',ok);
  const msg=$('temp-warn-txt');
  if(msg){
    if(v<35) msg.textContent='⚠ Temperatura muy baja — verificar con termómetro';
    else if(v>38) msg.textContent='⚠ Temperatura elevada — posible fiebre';
    else msg.textContent='⚠ Rango esperado: 34–42°C';
  }
  $('temp-msg').style.display=!ok?'block':'none';
  ST.bitacora.form.temp=inp.value;
}

function validarSato(inp){
  const v=parseInt(inp.value);
  if(!inp.value){ inp.classList.remove('warn','ok'); $('sato-msg').style.display='none'; return; }
  const ok=v>=70 && v<=100;
  inp.classList.toggle('warn',!ok);
  inp.classList.toggle('ok',ok);
  const msg=$('sato-warn-txt');
  if(msg){
    if(v<90) msg.textContent='⚠ Saturación baja — evaluar urgencia';
    else msg.textContent='⚠ Rango esperado: 70–100%';
  }
  $('sato-msg').style.display=!ok?'block':'none';
  ST.bitacora.form.sato=inp.value;
}

/* ════ GUARDAR BITÁCORA ════ */
function guardarBitacora(){
  const sesion=DB.getSesion(); if(!sesion) return;
  const cuidado=DB.getCuidado(); if(!cuidado) return;
  const editId=ST.bitacora.bitaEditandoId;
  const puedeEscribir = editId
    ? ['admin','cuidadora'].includes(sesion.rol)
    : ['admin','familiar','cuidadora'].includes(sesion.rol);
  if(!puedeEscribir){ toast(editId?'No tienes permiso para editar':'No tienes permiso para registrar','err'); return; }

  // Leer valores actuales del formulario
  const presion=$('v-presion').value.trim();
  const temp=$('v-temp').value.trim();
  const sato=$('v-sato').value.trim();
  const nota=$('nota-libre').value.trim();

  // Animación de carga
  const btn=$('btn-guardar');
  btn.textContent=editId?'Guardando cambios...':'Guardando...';
  btn.disabled=true;

  setTimeout(()=>{
    const am=cuidado.am||{};
    const original = editId ? (cuidado.bitacoras||[]).find(x=>x.id===editId) : null;

    const registro={
      id:    original?.id || ('b-'+Date.now()),
      fecha: original?.fecha || hoy(),
      hora:  original?.hora  || horaActual(),
      quien: ST.bitacora.form.quien,
      presion,
      temp,
      sato,
      desayuno: ST.bitacora.form.desayuno,
      almuerzo: ST.bitacora.form.almuerzo,
      cena:     ST.bitacora.form.cena,
      bano:     ST.bitacora.form.bano,
      hidra:    ST.bitacora.form.hidra,
      activ:    ST.bitacora.form.activ,
      visita:   ST.bitacora.form.visita,
      animo:    ST.bitacora.form.animo,
      nota,
    };

    // ── GENERACIÓN DEL RESUMEN IA ──
    // Simula lo que haría Claude API en producción.
    // Construye una frase natural con todos los datos.
    registro.resumen = generarResumenIA(registro, am.nombre||'la persona cuidada');

    if(!Array.isArray(cuidado.bitacoras)) cuidado.bitacoras=[];
    if(original){
      const idx=cuidado.bitacoras.findIndex(x=>x.id===editId);
      if(idx>=0) cuidado.bitacoras[idx]=registro;
    } else {
      cuidado.bitacoras.push(registro);
    }
    DB.saveCuidado(cuidado);

    btn.disabled=false;
    ST.bitacora.bitaEditandoId=null;

    if(original){
      btn.textContent='Guardar cambios ✓';
      toast('✓ Registro actualizado','ok');
      verDetalle(registro.id);
    } else {
      btn.textContent='Guardar registro ✓';
      toast('✓ Registro guardado','ok');
      mostrarResumenIA(registro);
    }
  }, 600);
}

/* ── GENERADOR DE RESUMEN IA ── */
function generarResumenIA(b, nombre){
  // Estado general
  const animoMap={'Muy bien 😊':'estuvo muy bien','Bien 🙂':'estuvo bien','Regular 😐':'estuvo regular','Mal 😔':'estuvo mal'};
  const estadoBase=animoMap[b.animo]||'estuvo bien';

  // Signos vitales
  const vitales=[];
  if(b.presion) vitales.push(`presión ${b.presion} mmHg`);
  if(b.temp){
    const t=parseFloat(b.temp);
    if(t>=38) vitales.push(`temperatura elevada de ${b.temp}°C`);
    else vitales.push(`temperatura ${b.temp}°C`);
  }
  if(b.sato){
    const s=parseInt(b.sato);
    if(s<92) vitales.push(`saturación baja de ${b.sato}%`);
    else vitales.push(`saturación ${b.sato}%`);
  }

  // Alimentación
  const alimentacion=[];
  if(b.desayuno==='Todo') alimentacion.push('desayunó completo');
  else if(b.desayuno==='Mitad') alimentacion.push('desayunó la mitad');
  else if(b.desayuno==='Nada') alimentacion.push('no desayunó');
  if(b.almuerzo==='Todo') alimentacion.push('almorzó todo');
  else if(b.almuerzo==='Mitad') alimentacion.push('almorzó la mitad');
  else if(b.almuerzo==='Nada') alimentacion.push('no almorzó');
  if(b.cena==='Todo') alimentacion.push('cenó completo');
  else if(b.cena==='Mitad') alimentacion.push('cenó la mitad');
  else if(b.cena==='Nada') alimentacion.push('no cenó');

  // Controles
  const controles=[];
  if(b.bano) controles.push('fue al baño');
  if(b.hidra) controles.push('buena hidratación');
  if(b.activ) controles.push('realizó actividad física');
  if(b.visita) controles.push('recibió visita');

  // Construir el texto
  let resumen=`${nombre} ${estadoBase} hoy.`;

  if(vitales.length){
    resumen+=` Signos vitales: ${vitales.join(', ')}.`;
  }

  if(alimentacion.length){
    resumen+=` Alimentación: ${alimentacion.join(', ')}.`;
  }

  if(controles.length){
    resumen+=` ${controles.map(c=>c.charAt(0).toUpperCase()+c.slice(1)).join(', ')}.`;
  }

  // Alertas automáticas
  const alertas=[];
  if(b.temp && parseFloat(b.temp)>=38) alertas.push('⚠ Temperatura elevada — consultar con el médico.');
  if(b.sato && parseInt(b.sato)<92)    alertas.push('⚠ Saturación baja — evaluar urgencia.');
  if(b.almuerzo==='Nada' && b.desayuno==='Nada') alertas.push('⚠ No comió durante el día — monitorear.');

  if(alertas.length) resumen+=' '+alertas.join(' ');

  // Nota del cuidador
  if(b.nota) resumen+=` Nota de la cuidadora: "${b.nota}"`;

  return resumen;
}

/* ════ PANTALLA DE RESUMEN IA ════ */
function mostrarResumenIA(b){
  const fecha=fechaLarga(b.fecha);
  if($('resumen-hora-display')) $('resumen-hora-display').textContent=b.hora;
  if($('resumen-fecha-display')) $('resumen-fecha-display').textContent=fecha;
  if($('resumen-fecha-display-d')) $('resumen-fecha-display-d').textContent=fecha;

  // Texto del resumen
  if($('ria-texto')) $('ria-texto').textContent=b.resumen||'—';

  // Tabla de datos registrados
  const filas=[
    {ico:'❤️',bg:'var(--red-lt)',lbl:'Presión arterial',val:b.presion||'—',cls:b.presion?'b-ok':'b-muted'},
    {ico:'🌡️',bg:'var(--amber-lt)',lbl:'Temperatura',val:b.temp?b.temp+'°C':'—',cls:b.temp?'b-ok':'b-muted'},
    {ico:'🫁',bg:'var(--blue-lt)',lbl:'Saturación O₂',val:b.sato?b.sato+'%':'—',cls:b.sato?'b-ok':'b-muted'},
    {ico:'🍽️',bg:'var(--sage-lt)',lbl:'Almuerzo',val:b.almuerzo||'—',cls:b.almuerzo==='Todo'?'b-ok':b.almuerzo==='Nada'?'b-err':'b-warn'},
    {ico:'🚽',bg:'var(--surf)',lbl:'Baño',val:b.bano?'Sí ✓':'No',cls:b.bano?'b-ok':'b-muted'},
    {ico:'😊',bg:'var(--sage-lt)',lbl:'Ánimo',val:b.animo||'—',cls:'b-ok'},
  ];

  if($('resumen-datos-tabla')){
    $('resumen-datos-tabla').innerHTML=filas.map((r,i,a)=>`
      <div class="reg-row" style="${i===a.length-1?'border:none':''}">
        <div class="reg-ico" style="background:${r.bg}">${r.ico}</div>
        <div class="reg-lbl">${r.lbl}</div>
        <span class="badge ${r.cls}">${r.val}</span>
      </div>`).join('');
  }

  // Guardar referencia para compartir
  ST.bitacora.bitacoraActual=b;
  navTo('s-resumen-ia');
}

/* ── COMPARTIR ── */
function textoWA(b){
  return `🌿 *Raíz · Resumen del día*\n\n${b.resumen||'—'}\n\n_Enviado desde Raíz_`;
}

function enviarWhatsApp(){
  if(!ST.bitacora.bitacoraActual){ toast('Sin datos para compartir','err'); return; }
  window.open('https://wa.me/?text='+encodeURIComponent(textoWA(ST.bitacora.bitacoraActual)),'_blank');
  toast('Abriendo WhatsApp...','ok');
}

function copiarResumen(){
  if(!ST.bitacora.bitacoraActual){ return; }
  copiarTexto(textoWA(ST.bitacora.bitacoraActual));
}

function enviarWhatsAppResumen(id){
  const b=DB.getCuidado()?.bitacoras?.find(x=>x.id===id);
  if(!b) return;
  window.open('https://wa.me/?text='+encodeURIComponent(textoWA(b)),'_blank');
}

function copiarResumenDetalle(id){
  const b=DB.getCuidado()?.bitacoras?.find(x=>x.id===id);
  if(!b) return;
  copiarTexto(textoWA(b));
}

function copiarTexto(txt){
  if(navigator.clipboard){
    navigator.clipboard.writeText(txt).then(()=>toast('✓ Texto copiado','ok'));
  } else {
    const ta=document.createElement('textarea');
    ta.value=txt; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast('✓ Texto copiado','ok');
  }
}

/* ── CONFIRM ── */

$('cb-ok').onclick=()=>{ $('confirm-ov').classList.remove('open'); if(_cb)_cb(); };

/* ════════════════════════════════════════════
   MÓDULO 4 — SALUD
   ════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   MÓDULO 4 · SALUD — JAVASCRIPT COMPLETO
   ════════════════════════════════════════════════════════════ */

/* ── CAPA DE DATOS ── */

/* ── ESTADO LOCAL ── */


/* ── HELPERS ── */



/* ── NAVEGACIÓN ── */


/* ── SIDEBAR ── */

/* ════ HUB DE SALUD — TABS ════ */
function setTab(tab, btnEl){
  ST.salud.tabActivo=tab;
  document.querySelectorAll('.th').forEach(t=>t.classList.remove('on'));
  if(btnEl) btnEl.classList.add('on');
  renderTab(tab);
}

function fabAction(){
  const sesion=DB.getSesion(); if(!sesion) return;
  const puedeEditar=['admin','cuidadora'].includes(sesion.rol);
  if(!puedeEditar) return;
  if(ST.salud.tabActivo==='meds')    abrirSheetMed();
  if(ST.salud.tabActivo==='docs')    abrirSheetDoc();
  if(ST.salud.tabActivo==='ficha' && sesion.rol==='admin')   navTo('s-ficha-editar');
}

function renderTab(tab){
  const sesion=DB.getSesion(); if(!sesion) return;
  const cuidado=DB.getCuidado(); if(!cuidado) return;
  const am=cuidado.am||{};
  const puedeEditar=['admin','cuidadora'].includes(sesion.rol);
  const esAdmin=sesion.rol==='admin';
  const fab=$('salud-fab');
  const edadDisplay=calcularEdad(am.fechaNacimiento)||am.edad||'—'; const sub=`${am.nombre||'la persona cuidada'} · ${edadDisplay} años`;
  if($('salud-sub')) $('salud-sub').textContent=sub;
  if($('salud-sub-d')) $('salud-sub-d').textContent=sub;

  if(tab==='meds'){
    if(fab) fab.style.display=puedeEditar?'flex':'none';
    renderMeds(cuidado, puedeEditar, esAdmin);
    // Sin botones en el header — los botones de agregar van dentro del contenido
    if($('salud-hdr-action')) $('salud-hdr-action').innerHTML='';
    if($('salud-hdr-action-d')) $('salud-hdr-action-d').innerHTML='';

  } else if(tab==='ficha'){
    if(fab) fab.style.display=esAdmin?'flex':'none';
    renderFicha(cuidado, esAdmin);
    if($('salud-hdr-action')) $('salud-hdr-action').innerHTML=esAdmin?`<button class="hdr-action" onclick="navTo('s-ficha-editar')">Editar</button>`:'';
    if($('salud-hdr-action-d')) $('salud-hdr-action-d').innerHTML=esAdmin
      ? `<button style="background:var(--sage);color:#fff;border:none;border-radius:var(--rs);padding:10px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit" onclick="navTo('s-ficha-editar')">Editar ficha</button>` : '';

  } else if(tab==='docs'){
    if(fab) fab.style.display=puedeEditar?'flex':'none';
    renderDocs(cuidado, puedeEditar);
    if($('salud-hdr-action')) $('salud-hdr-action').innerHTML=puedeEditar?`<button class="hdr-action" onclick="abrirSheetDoc()">+ Agregar</button>`:'';
    if($('salud-hdr-action-d')) $('salud-hdr-action-d').innerHTML=puedeEditar
      ? `<button style="background:var(--sage);color:#fff;border:none;border-radius:var(--rs);padding:10px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit" onclick="abrirSheetDoc()">+ Agregar documento</button>` : '';

  } else if(tab==='historial'){
    if(fab) fab.style.display='none';
    renderHistorial(cuidado);
    if($('salud-hdr-action')) $('salud-hdr-action').innerHTML='';
    if($('salud-hdr-action-d')) $('salud-hdr-action-d').innerHTML='';
  }
}

/* ════ TAB MEDICAMENTOS ════ */
function renderMeds(cuidado, puedeEditar, esAdmin){
  const content=$('salud-content');
  const meds=cuidado.meds||[];
  const confs=cuidado.confirmaciones||{};
  const hoyStr=hoy();

  // Progress del día
  const confirmedHoy=meds.filter(m=>confs[m.id+'_'+hoyStr]);
  const pct=meds.length?Math.round(confirmedHoy.length/meds.length*100):0;
  const dot=$('tab-meds-dot');
  if(dot) dot.classList.toggle('show', confirmedHoy.length<meds.length && meds.length>0);

  // Agrupar por turno
  // Agrupar meds: los que tienen horarios calculados van en "Tratamiento activo"
  // los legacy (solo freq) van en su turno tradicional
  const conHorario=meds.filter(m=>m.horarios?.length>0);
  const sinHorario=meds.filter(m=>!m.horarios?.length);
  const turnos={};
  if(conHorario.length) turnos['💊 Tratamiento activo']=conHorario;
  if(sinHorario.length){
    const legacy={
      '☀️ Mañana':[],
      '🌤 Mediodía':[],
      '🌙 Noche':[],
      '🔄 Otros':[]
    };
    sinHorario.forEach(m=>{
      if(m.freq?.includes('Mañana')&&!m.freq?.toLowerCase().includes('noche')) legacy['☀️ Mañana'].push(m);
      else if(m.freq?.includes('Mediodía')) legacy['🌤 Mediodía'].push(m);
      else if(m.freq?.toLowerCase().includes('noche')) legacy['🌙 Noche'].push(m);
      else legacy['🔄 Otros'].push(m);
    });
    Object.entries(legacy).forEach(([k,v])=>{ if(v.length) turnos[k]=v; });
  }

  const stockBajos=meds.filter(m=>m.stock<=5 && m.stock>0);
  const sinStock=meds.filter(m=>m.stock===0);

  let html='';

  // Progress
  if(meds.length){
    html+=`
      <div class="meds-progress">
        <div class="mp-top">
          <div class="mp-label">Adherencia de hoy</div>
          <div class="mp-count" id="mp-count">${confirmedHoy.length}/${meds.length} confirmados</div>
        </div>
        <div class="mp-track"><div class="mp-fill" id="mp-fill" style="width:${pct}%"></div></div>
      </div>`;
  }

  // Alertas de stock
  if(sinStock.length){
    html+=`<div class="stock-alert"><div class="sa-ico">🚫</div><div class="sa-txt"><div class="sa-title">Sin stock · ${escapeHtml(sinStock.map(m=>m.nombre).join(', '))}</div><div class="sa-sub">Comprar urgente para no interrumpir el tratamiento</div></div></div>`;
  }
  if(stockBajos.length){
    html+=`<div class="stock-alert" style="background:var(--amber-lt)"><div class="sa-ico">⚠️</div><div class="sa-txt"><div class="sa-title" style="color:var(--amber-dk)">Stock bajo · ${escapeHtml(stockBajos.map(m=>`${m.nombre} (${m.stock} ud.)`).join(', '))}</div><div class="sa-sub">Reponer esta semana para no cortar el tratamiento</div></div></div>`;
  }

  // Lista por turno
  Object.entries(turnos).forEach(([turno,lista])=>{
    if(!lista.length) return;
    html+=`<div class="turno-label">${turno}</div>`;
    html+=`<div style="background:var(--white);border-bottom:1px solid var(--line)">`;
    lista.forEach((m,i)=>{
      const conf=confs[m.id+'_'+hoyStr];
      const stockLow=m.stock>0&&m.stock<=5;
      const noStock=m.stock===0;
      // Stock real (retrocompat)
      const stockReal=m.stockActual!==undefined?m.stockActual:(m.stock||0);
      const stockRealLow=stockReal>0&&stockReal<=5;
      const noStockReal=stockReal===0;
      const icoClassR=noStockReal?'sin-stock':stockRealLow?'stock-low':'normal';

      // Horarios del día
      const hors=m.horarios||[];
      const prox=hors.length?proximaToma(hors):null;
      const horariosHtml=hors.length
        ? hors.map(h=>`<span style="background:var(--sage-lt);color:var(--sage);padding:1px 6px;border-radius:12px;font-size:11px;font-weight:600;margin-right:4px">${h}</span>`).join('')
        : `<span style="color:var(--ink3);font-size:12px">${m.freq||'—'}</span>`;

      html+=`
        <div class="med-card" style="${i===lista.length-1?'border-bottom:none':''}">
          <div class="med-ico ${icoClassR}">💊</div>
          <div class="med-info" style="flex:1;min-width:0">
            <div class="med-nombre">${escapeHtml(m.nombre)} <span style="font-weight:400;color:var(--ink3)">${escapeHtml(m.dosis)}</span></div>
            <div class="med-meta" style="margin-top:3px">${horariosHtml}</div>
            ${prox?`<div style="font-size:11px;color:var(--sage);margin-top:2px;font-weight:600">⏰ Próxima: ${prox}</div>`:''}
            <div class="med-meta" style="margin-top:3px">
              ${noStockReal?'<span style="color:var(--red);font-weight:600">Sin stock</span>':
                stockRealLow?`<span style="color:var(--amber-dk);font-weight:600">⚠ Stock bajo: ${stockReal} ud.</span>`:
                `<span style="color:var(--ink3)">Stock: ${stockReal} ud.</span>`}
              ${m.periocidad?`<span style="color:var(--ink3)"> · ${m.periocidad} días</span>`:''}
            </div>
          </div>
          <div class="med-actions">
            ${puedeEditar?`<button class="med-chk-btn${conf?' confirmado':''}" onclick="confMed('${m.id}',this)">${conf?'✓':''}</button>`:''}
            ${esAdmin?`<button class="med-del-btn" onclick="editarMed('${m.id}')" title="Editar">✏️</button>
                       <button class="med-del-btn" onclick="editarStock('${m.id}')" title="Gestionar stock">📦</button>
                       <button class="med-del-btn" onclick="eliminarMed('${m.id}')" title="Eliminar">🗑</button>`:''}
          </div>
        </div>`;
    });
    html+='</div>';
  });

  if(!meds.length){
    html=`<div class="empty"><div class="empty-ico">💊</div><div class="empty-title">Sin medicamentos</div><div class="empty-txt">${puedeEditar?'Agrega medicamentos manualmente o carga una foto de receta.':'El administrador aún no ha cargado los medicamentos.'}</div></div>`;
  }

  if(puedeEditar){
    html+=`
      <div style="display:flex;gap:10px;padding:14px 18px 0">
        <button onclick="navTo('s-ocr-receta')"
          style="flex:1;padding:12px;background:var(--surf);color:var(--sage);border:1.5px solid var(--sage-md);border-radius:var(--rs);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px">
          📷 Cargar receta IA
        </button>
        <button onclick="abrirSheetMed()"
          style="flex:1;padding:12px;background:var(--sage);color:#fff;border:none;border-radius:var(--rs);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px">
          ＋ Agregar manual
        </button>
      </div>`;
  }
  html+=`<div style="height:80px"></div>`;
  content.innerHTML=html;
}

/* Confirmar medicamento */
function confMed(medId, btn){
  const cuidado=DB.getCuidado(); if(!cuidado) return;
  if(!cuidado.confirmaciones) cuidado.confirmaciones={};
  const key=medId+'_'+hoy();
  const yaConfirmado=!!cuidado.confirmaciones[key];

  const med=cuidado.meds.find(m=>m.id===medId);

  if(yaConfirmado){
    // Desconfirmar — devolver 1 unidad al stock
    delete cuidado.confirmaciones[key];
    if(med && med.stockActual!==undefined){
      med.stockActual=Math.min(med.stockInicial||9999, (med.stockActual||0)+1);
      med.stock=med.stockActual;
    }
    DB.saveCuidado(cuidado);
    if(btn){ btn.classList.remove('confirmado'); btn.textContent=''; }
    toast('Confirmación eliminada','ok');
  } else {
    // Confirmar — descontar 1 unidad del stock
    cuidado.confirmaciones[key]=true;
    if(med && med.stockActual!==undefined){
      med.stockActual=Math.max(0,(med.stockActual||0)-1);
      med.stock=med.stockActual;
    }
    DB.saveCuidado(cuidado);
    if(btn){ btn.classList.add('confirmado'); btn.textContent='✓'; }
    toast('✓ Medicamento confirmado','ok');
  }

  // Actualizar dot del tab
  const meds=cuidado.meds||[];
  const pendientes=meds.filter(m=>!cuidado.confirmaciones[m.id+'_'+hoy()]);
  const dot=$('tab-meds-dot');
  if(dot) dot.classList.toggle('show', pendientes.length>0);
  // Actualizar barra de progreso
  const confirmedHoy=meds.filter(m=>!!cuidado.confirmaciones[m.id+'_'+hoy()]);
  const pct=meds.length?Math.round(confirmedHoy.length/meds.length*100):0;
  const fill=$('mp-fill'); if(fill) fill.style.width=pct+'%';
  const count=$('mp-count'); if(count) count.textContent=`${confirmedHoy.length}/${meds.length} confirmados`;
  renderSidebar();
}

/* Eliminar medicamento */
function eliminarMed(medId){
  confirmar('¿Eliminar este medicamento?','Se eliminará de la lista y del checklist diario.',()=>{
    const c=DB.getCuidado(); if(!c) return;
    c.meds=c.meds.filter(m=>m.id!==medId);
    DB.saveCuidado(c);
    toast('Medicamento eliminado','ok');
    renderTab('meds');
  });
}

/* Editar stock */
function editarStock(medId){
  const c=DB.getCuidado(); if(!c) return;
  const med=c.meds.find(m=>m.id===medId); if(!med) return;
  ST.salud.medEditandoId=medId;

  // Retrocompatibilidad: inicializar campos nuevos si no existen
  if(med.stockActual===undefined) med.stockActual=med.stock||0;
  if(!med.reposiciones) med.reposiciones=[];
  if(med.stockInicial===undefined) med.stockInicial=med.stock||0;

  const stockAct=med.stockActual;
  const totalComprado=(med.reposiciones||[]).reduce((s,r)=>s+(r.cantidad||0),0);
  const consumidos=Math.max(0,totalComprado-stockAct);

  $('stock-med-nombre').textContent=med.nombre+' · '+med.dosis;
  $('stock-valor').value=0;
  if($('stock-fecha')) $('stock-fecha').value=hoy();
  if($('stock-nota'))  $('stock-nota').value='';

  const disp=$('stock-actual-display');
  if(disp){ disp.textContent=stockAct; disp.style.color=stockAct<=5?'var(--red)':stockAct<=10?'var(--amber)':'var(--sage)'; }
  const cons=$('stock-consumido-display');
  if(cons) cons.textContent=consumidos>0?`${consumidos} unidades consumidas desde el inicio`:'';

  const hist=$('stock-historial');
  if(hist && (med.reposiciones||[]).length){
    hist.innerHTML='<div style="font-weight:700;margin-bottom:6px;color:var(--ink);font-size:13px">Historial de compras</div>'+
      (med.reposiciones||[]).slice().reverse().slice(0,5).map(r=>
        `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);font-size:12px">
          <span>+${r.cantidad} ud.${r.nota?' · '+escapeHtml(r.nota):''}</span>
          <span style="color:var(--ink3)">${r.fecha||''}</span>
        </div>`).join('');
  } else if(hist) hist.innerHTML='';

  $('ov-edit-stock').classList.add('open');
}

/* ── M8: Ajustar stock de insumo del hogar ── */
function ajustarStockInsumo(id, delta){
  const comp=DB.getCompartido();
  const ins=(comp.hogar?.insumos||[]).find(i=>i.id===id);
  if(!ins) return;
  ins.stock=Math.max(0, (ins.stock||0)+delta);
  ins.cantidad=ins.stock;
  DB.saveCompartido(comp);
  renderTabHogar('insumos');
}

function ajustarStock(delta){
  const inp=$('stock-valor');
  inp.value=Math.max(0,parseInt(inp.value||0)+delta);
}

function guardarReposicion(){
  const c=DB.getCuidado(); if(!c) return;
  const med=c.meds.find(m=>m.id===ST.salud.medEditandoId); if(!med) return;
  const cantComprada=parseInt($('stock-valor').value)||0;
  if(cantComprada<=0){ toast('Ingresa la cantidad comprada','err'); return; }
  if(_bloqueadoPorDobleClick('reposicion')) return;

  // Inicializar campos si es medicamento antiguo (retrocompatibilidad)
  if(med.stockActual===undefined) med.stockActual=med.stock||0;
  if(!med.reposiciones) med.reposiciones=[];
  if(med.stockInicial===undefined) med.stockInicial=med.stock||0;

  // Registrar la reposición
  const repo={
    id:'r-'+Date.now(),
    cantidad:cantComprada,
    fecha:$('stock-fecha').value||hoy(),
    nota:$('stock-nota').value.trim(),
  };
  med.reposiciones.push(repo);
  med.stockActual=(med.stockActual||0)+cantComprada;
  med.stock=med.stockActual;

  DB.saveCuidado(c);
  cerrarSheet('ov-edit-stock');
  toast(`✓ +${cantComprada} unidades registradas`,'ok');
  renderTab('meds');
}

/* Agregar medicamento manual */
function abrirSheetMed(){
  ST.salud.medEditando=null;
  if($('sh-med-titulo')) $('sh-med-titulo').textContent='Agregar medicamento';
  ['am-nombre','am-dosis','am-medico','am-notas'].forEach(id=>{ if($(id)){ $(id).value=''; $(id).classList.remove('error'); } });
  if($('am-periocidad'))     $('am-periocidad').value='7';
  if($('am-frecuencia-hrs')) $('am-frecuencia-hrs').value='8';
  if($('am-hora-inicio'))    $('am-hora-inicio').value='08:00';
  if($('am-stock'))          $('am-stock').value='30';
  actualizarPreviewHorarios();
  $('ov-add-med').classList.add('open');
  setTimeout(()=>{ if($('am-nombre')) $('am-nombre').focus(); },200);
}

function actualizarPreviewHorarios(){
  const hrs=parseInt($('am-frecuencia-hrs')?.value)||8;
  const horaIni=$('am-hora-inicio')?.value||'08:00';
  const prev=$('am-horarios-preview');
  if(!prev) return;
  if(hrs===0){
    prev.textContent='Solo cuando sea necesario (sin horario fijo)';
    return;
  }
  const horarios=calcularHorarios(horaIni,hrs);
  prev.innerHTML='<span style="font-weight:600;color:var(--sage)">Tomas del día: </span>'+
    horarios.map(h=>`<span style="background:var(--sage-lt);color:var(--sage);padding:2px 8px;border-radius:20px;font-weight:600;margin:2px;display:inline-block">${h}</span>`).join('')+
    `<div style="font-size:11px;color:var(--ink3);margin-top:6px">${horarios.length} toma${horarios.length!==1?'s':''} por día</div>`;
}

function editarMed(medId){
  const c=DB.getCuidado(); if(!c) return;
  const med=c.meds.find(m=>m.id===medId); if(!med) return;
  ST.salud.medEditando=medId;
  if($('sh-med-titulo')) $('sh-med-titulo').textContent='Editar medicamento';
  if($('am-nombre'))         $('am-nombre').value=med.nombre||'';
  if($('am-dosis'))          $('am-dosis').value=med.dosis||'';
  if($('am-medico'))         $('am-medico').value=med.indicadoPor||'';
  if($('am-notas'))          $('am-notas').value=med.notas||'';
  if($('am-periocidad'))     $('am-periocidad').value=med.periocidad||7;
  if($('am-frecuencia-hrs')) $('am-frecuencia-hrs').value=med.frecuenciaHrs||8;
  if($('am-hora-inicio'))    $('am-hora-inicio').value=med.horaInicio||'08:00';
  if($('am-stock'))          $('am-stock').value=med.stockInicial||med.stock||30;
  actualizarPreviewHorarios();
  $('ov-add-med').classList.add('open');
}

function guardarMedManual(){
  const nombre=$('am-nombre').value.trim();
  if(!nombre){
    toast('Ingresa el nombre del medicamento','err');
    $('am-nombre').classList.add('error');
    $('am-nombre').focus();
    return;
  }
  $('am-nombre').classList.remove('error');
  if(_bloqueadoPorDobleClick('medManual')) return;
  const c=DB.getCuidado(); if(!c) return;
  if(!Array.isArray(c.meds)) c.meds=[];

  const frecuenciaHrs=parseInt($('am-frecuencia-hrs').value)||8;
  const horaInicio=$('am-hora-inicio').value||'08:00';
  const periocidad=parseInt($('am-periocidad').value)||7;
  const stockInicial=parseInt($('am-stock').value)||30;
  const horarios=frecuenciaHrs>0 ? calcularHorarios(horaInicio,frecuenciaHrs) : [];

  const nuevo={
    id:'m-'+Date.now(),
    nombre,
    dosis:$('am-dosis').value.trim(),
    indicadoPor:$('am-medico').value.trim(),
    notas:$('am-notas').value.trim(),
    agregadoEl:hoy(),
    // Horario calculado
    periocidad,
    frecuenciaHrs,
    horaInicio,
    horarios,
    // Stock real
    stockInicial,
    stockActual:stockInicial,
    reposiciones:[{id:'r-'+Date.now(),cantidad:stockInicial,fecha:hoy(),nota:'Stock inicial'}],
    // Retrocompatibilidad
    stock:stockInicial,
    freq:horarios.length ? horarios.join(', ') : 'Solo si necesita',
  };

  if(ST.salud.medEditando){
    // Editar medicamento existente
    const idx=c.meds.findIndex(m=>m.id===ST.salud.medEditando);
    if(idx>=0){
      nuevo.id=ST.salud.medEditando;
      // Conservar consumos y reposiciones previos
      nuevo.reposiciones=c.meds[idx].reposiciones||nuevo.reposiciones;
      nuevo.stockActual=c.meds[idx].stockActual!==undefined ? c.meds[idx].stockActual : stockInicial;
      c.meds[idx]=nuevo;
    }
    toast('✓ Medicamento actualizado','ok');
  } else {
    c.meds.push(nuevo);
    toast('✓ Medicamento agregado','ok');
  }

  ST.salud.medEditando=null;
  DB.saveCuidado(c);
  cerrarSheet('ov-add-med');
  renderTab('meds');
}

/* ════ OCR DE RECETA ════ */
async function procesarRecetaOCR(input){
  const file=input.files[0]; if(!file) return;
  if(!file.type.startsWith('image/') && file.type!=='application/pdf'){
    toast('Solo se admiten imágenes (JPG, PNG)','err'); return;
  }

  $('ocr-zona').style.display='none';
  $('ocr-info').style.display='none';
  $('ocr-spinner').style.display='flex';
  $('ocr-resultado').style.display='none';

  // Preview de imagen
  const readerPrev = new FileReader();
  readerPrev.onload = e => {
    if(file.type.startsWith('image/')){
      $('ocr-img').src=e.target.result;
      $('ocr-preview').style.display='flex';
    } else {
      $('ocr-preview').innerHTML=`<div style="font-size:13px;color:var(--ink3)">📄 ${file.name}</div>`;
      $('ocr-preview').style.display='flex';
    }
  };
  readerPrev.readAsDataURL(file);

  // Leer imagen como base64 para enviar a Claude Vision
  const reader = new FileReader();
  reader.onload = async (e) => {
    const b64 = e.target.result.split(',')[1]; // quitar "data:image/jpeg;base64,"
    const mediaType = file.type.startsWith('image/') ? file.type : 'image/jpeg';

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
              { type: 'text', text: 'Esta es una receta médica. Extrae SOLO los medicamentos que aparecen. Responde ÚNICAMENTE con un JSON válido, sin texto adicional, con este formato exacto: [{"nombre":"NombreMed","dosis":"Xmg","freq":"Mañana · 8:00"}]. Si no hay medicamentos claros, responde con []. La frecuencia debe ser en formato "Mañana · 8:00", "Mediodía · 14:00", "Noche · 21:00" o similar.' }
            ]
          }]
        })
      });

      if(!resp.ok) throw new Error('API error '+resp.status);
      const data = await resp.json();
      const texto = data.content?.find(b=>b.type==='text')?.text || '[]';

      let meds = [];
      try {
        const clean = texto.replace(/```json|```/g,'').trim();
        meds = JSON.parse(clean);
      } catch(e2) {
        // Si el JSON falla, intentar extraer con regex básico
        const matches = texto.matchAll(/"nombre"\s*:\s*"([^"]+)"/g);
        meds = [...matches].map(m => ({nombre:m[1], dosis:'ver receta', freq:'Mañana · 8:00'}));
      }

      $('ocr-spinner').style.display='none';
      if(!meds.length){
        toast('No se detectaron medicamentos. Intenta con una foto más nítida.','err');
        $('ocr-zona').style.display='block';
        return;
      }
      // Pasar a mostrarResultadoOCR con los datos reales
      mostrarResultadoOCR(meds);

    } catch(err) {
      console.warn('OCR error:', err.message);
      $('ocr-spinner').style.display='none';
      // Fallback: mostrar aviso y pedir datos manuales
      toast('No se pudo leer la receta automáticamente. Ingresa el medicamento manualmente.','err');
      $('ocr-zona').style.display='block';
      $('ocr-info').style.display='block';
    }
  };
  reader.readAsDataURL(file);
}

function mostrarResultadoOCR(medsDetectados){
  const c=DB.getCuidado();
  const medsExistentes=c?.meds||[];

  // Marcar cuáles son nuevos vs ya existentes
  const detectados=(medsDetectados||[]).map(m=>({
    ...m,
    nuevo:!medsExistentes.find(x=>x.nombre.toLowerCase()===m.nombre.toLowerCase())
  }));

  ST.salud.ocrMeds=detectados.map((m,i)=>({...m,id:'ocr-'+i,seleccionado:m.nuevo}));

  const lista=$('ocr-meds-lista');
  lista.innerHTML=`
    <div class="ocr-result-hdr"><span>✦</span>IA detectó ${detectados.length} medicamento${detectados.length>1?'s':''} — confirma cuáles agregar</div>
    ${ST.salud.ocrMeds.map((m,i)=>`
      <div class="ocr-med-row" onclick="toggleOcrMed(${i})">
        <div class="ocr-med-chk${m.seleccionado?' on':''}" id="ocr-chk-${i}">${m.seleccionado?'✓':''}</div>
        <div style="flex:1">
          <div class="ocr-med-nombre">${escapeHtml(m.nombre)}</div>
          <div class="ocr-med-info">${escapeHtml(m.dosis)} · ${escapeHtml(m.freq)}${!m.nuevo?' · <span style="color:var(--amber)">Ya en tu lista</span>':''}</div>
        </div>
        <span class="badge ${m.nuevo?'b-ok':'b-warn'}">${m.nuevo?'Nuevo':'Existente'}</span>
      </div>`).join('')}`;

  $('ocr-resultado').style.display='block';
}

function toggleOcrMed(i){
  ST.salud.ocrMeds[i].seleccionado=!ST.salud.ocrMeds[i].seleccionado;
  const chk=$('ocr-chk-'+i);
  const s=ST.salud.ocrMeds[i].seleccionado;
  chk.classList.toggle('on',s);
  chk.textContent=s?'✓':'';
}

function agregarMedsOCR(){
  const seleccionados=ST.salud.ocrMeds.filter(m=>m.seleccionado);
  if(!seleccionados.length){ toast('Selecciona al menos un medicamento','err'); return; }
  const c=DB.getCuidado(); if(!c) return;
  if(!Array.isArray(c.meds)) c.meds=[];
  seleccionados.forEach(m=>{
    if(!c.meds.find(x=>x.nombre.toLowerCase()===m.nombre.toLowerCase())){
      c.meds.push({id:'m-ocr-'+Date.now()+'-'+Math.random().toString(36).slice(2), nombre:m.nombre, dosis:m.dosis, freq:m.freq, stock:30, origen:'ocr', agregadoEl:hoy()});
    }
  });
  DB.saveCuidado(c);
  toast(`✓ ${seleccionados.length} medicamento${seleccionados.length>1?'s':''} agregado${seleccionados.length>1?'s':''}`, 'ok');
  resetOCR();
  setTimeout(()=>{ navTo('s-salud-hub'); ST.salud.tabActivo='meds'; renderTab('meds'); }, 600);
}

function resetOCR(){
  $('ocr-zona').style.display='block';
  $('ocr-info').style.display='block';
  $('ocr-preview').style.display='none';
  const img=$('ocr-img'); if(img){ img.src=''; } $('ocr-preview').style.display='none';
  $('ocr-spinner').style.display='none';
  $('ocr-resultado').style.display='none';
  $('ocr-file-input').value='';
  ST.salud.ocrMeds=[];
}

/* ════ TAB FICHA CLÍNICA ════ */
function renderFicha(cuidado, esAdmin){
  const am=cuidado.am||{};
  const content=$('salud-content');

  const condTag=(c)=>{
    // Asignar categoría según la condición
    const graves=['Demencia','Parkinson','Post-ACV','Insuficiencia cardíaca','EPOC'];
    const cls=graves.includes(c)?'cc-grave':'cc-cronica';
    return `<span class="condicion-chip ${cls}">${c}</span>`;
  };

  let html=`
    <!-- Datos generales -->
    <div class="ficha-section">
      <div class="fs-title">Datos generales</div>
      <div class="fs-valor">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
          <div style="width:48px;height:48px;border-radius:50%;background:var(--sage);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#fff;flex-shrink:0">${escapeHtml(initials(am.nombre||'?'))}</div>
          <div>
            <div style="font-size:16px;font-weight:800;color:var(--ink)">${escapeHtml(am.nombre)||'—'} ${escapeHtml(am.apellido)}</div>
            <div style="font-size:13px;color:var(--ink3)">${am.edad||'—'} años · ${am.relacion||'—'}</div>
          </div>
        </div>
        ${am.sangre?`<div style="font-size:13px;color:var(--ink3);margin-top:4px">Grupo sanguíneo: <strong>${am.sangre}</strong></div>`:''}
      </div>
    </div>

    <!-- Médico -->
    <div class="ficha-section">
      <div class="fs-title">Equipo médico</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">👨‍⚕️</span>
          <div>
            <div style="font-size:12px;color:var(--ink3)">Médico de cabecera</div>
            <div style="font-size:14px;font-weight:600;color:var(--ink)">${escapeHtml(am.medico)||'Sin especificar'}</div>
          </div>
        </div>
        ${am.especialistas?`<div style="font-size:13px;color:var(--ink3)">${escapeHtml(am.especialistas)}</div>`:''}
      </div>
    </div>

    <!-- Condiciones -->
    <div class="ficha-section">
      <div class="fs-title">Condiciones crónicas</div>
      ${am.condiciones?.length
        ? `<div>${am.condiciones.map(condTag).join('')}</div>`
        : `<div class="fs-vacío">Sin condiciones registradas</div>`}
    </div>

    <!-- Alergias -->
    <div class="ficha-section">
      <div class="fs-title">⚠️ Alergias</div>
      ${(am.alergias?.length||0)>0
        ? `<div>${(Array.isArray(am.alergias)?am.alergias:[am.alergias]).map(a=>`<span class="chip danger" style="cursor:default;margin:2px">${escapeHtml(a)}</span>`).join('')}</div>`
        : `<div class="fs-vacío">Sin alergias registradas</div>`}
    </div>

    <!-- Restricciones -->
    <div class="ficha-section">
      <div class="fs-title">Restricciones</div>
      ${(am.restricciones?.length||0)>0
        ? `<div style="display:flex;flex-direction:column;gap:0">
             ${(Array.isArray(am.restricciones)?am.restricciones:[am.restricciones]).map(r=>`
               <div class="restriccion-row">
                 <div class="rr-ico">🚫</div>
                 <div class="rr-txt">${escapeHtml(r)}</div>
               </div>`).join('')}
           </div>`
        : `<div class="fs-vacío">Sin restricciones registradas</div>`}
    </div>

    <!-- Notas médicas -->
    ${am.notasMedicas?`
    <div class="ficha-section">
      <div class="fs-title">Notas médicas</div>
      <div class="fs-valor" style="font-size:13px;line-height:1.6">${am.notasMedicas}</div>
    </div>`:''}

    <div class="ia" style="margin:14px 16px">
      <div class="ia-ico">✦</div>
      <div>Esta ficha es visible para toda la cuidadora y los especialistas con acceso. La IA usa las condiciones para contextualizar las alertas de signos vitales.</div>
    </div>
    <div style="height:80px"></div>`;

  content.innerHTML=html;
}

/* Guardar ficha editada */
function guardarFicha(){
  const c=DB.getCuidado(); if(!c) return;
  if(!c.am) c.am={};
  c.am.medico=$('ficha-medico').value.trim();
  c.am.especialistas=$('ficha-especialistas').value.trim();
  c.am.condiciones=[...document.querySelectorAll('#ficha-condiciones-chips .chip.on')].map(ch=>ch.textContent.trim());
  c.am.alergias=$('ficha-alergias').value.trim().split(',').map(s=>s.trim()).filter(Boolean);
  c.am.restricciones=$('ficha-restricciones').value.trim().split(',').map(s=>s.trim()).filter(Boolean);
  c.am.sangre=$('ficha-sangre').value;
  c.am.notasMedicas=$('ficha-notas').value.trim();
  DB.saveCuidado(c);
  toast('✓ Ficha clínica actualizada','ok');
  // Actualizar sidebar switcher
  const sbSwName=$('sb-sw-name');
  if(sbSwName) sbSwName.textContent=`${c.am?.nombre||'—'} · ${calcularEdad(c.am?.fechaNacimiento)||c.am?.edad||'—'} años`;
  // Re-renderizar el home en segundo plano para que las condiciones
  // aparezcan actualizadas cuando el usuario vuelva
  const s=DB.getSesion();
  if(s){
    const homeId=`s-home-${s.rol}`;
    const homeEl=document.getElementById(homeId);
    if(homeEl){
      // Actualizar el home silenciosamente sin navegar
      const rol=s.rol;
      try{ renderHome(rol); }catch(e){}
    }
  }
  // Volver a salud — tab ficha
  navTo('s-salud-hub');
  // Dar un tick para que navTo termine antes de setTab
  setTimeout(()=> setTab('ficha', document.querySelector('#s-salud-hub .tab-hub .th:nth-child(2)')), 50);
}

/* Pre-rellenar formulario de ficha */
function prellenarFicha(){
  const c=DB.getCuidado(); if(!c) return;
  const am=c.am||{};
  if($('ficha-medico'))       $('ficha-medico').value=am.medico||'';
  if($('ficha-especialistas'))$('ficha-especialistas').value=am.especialistas||'';
  if($('ficha-alergias'))     $('ficha-alergias').value=Array.isArray(am.alergias)?am.alergias.join(', '):(am.alergias||'');
  if($('ficha-restricciones'))$('ficha-restricciones').value=Array.isArray(am.restricciones)?am.restricciones.join(', '):(am.restricciones||'');
  if($('ficha-sangre'))       $('ficha-sangre').value=am.sangre||'';
  if($('ficha-notas'))        $('ficha-notas').value=am.notasMedicas||'';
  // Marcar condiciones
  const condiciones=am.condiciones||[];
  document.querySelectorAll('#ficha-condiciones-chips .chip').forEach(ch=>{
    ch.classList.toggle('on', condiciones.includes(ch.textContent.trim()));
  });
}

/* ════ TAB DOCUMENTOS ════ */
function renderDocs(cuidado, puedeEditar){
  const docs=cuidado.documentos||[];
  const content=$('salud-content');
  const filtro=ST.salud.docFiltro;

  const tipoIco={receta:'📋',examen:'🔬',imagen:'🩻',informe:'📄',certificado:'📜',otro:'📁'};
  const tipoColor={receta:'var(--sage-lt)',examen:'var(--blue-lt)',imagen:'var(--purple-lt)',informe:'var(--amber-lt)',certificado:'var(--surf)',otro:'var(--surf)'};

  const filtrados=filtro==='todos'?docs:docs.filter(d=>d.tipo===filtro);
  const sorted=[...filtrados].sort((a,b)=>b.fecha?.localeCompare(a.fecha||'')||0);

  let html=`
    <div class="doc-filtros">
      <div class="dfpill${filtro==='todos'?' on':''}" onclick="setDocFiltro('todos',this)">Todos</div>
      <div class="dfpill${filtro==='receta'?' on':''}" onclick="setDocFiltro('receta',this)">📋 Recetas</div>
      <div class="dfpill${filtro==='examen'?' on':''}" onclick="setDocFiltro('examen',this)">🔬 Exámenes</div>
      <div class="dfpill${filtro==='imagen'?' on':''}" onclick="setDocFiltro('imagen',this)">🩻 Imágenes</div>
      <div class="dfpill${filtro==='informe'?' on':''}" onclick="setDocFiltro('informe',this)">📄 Informes</div>
    </div>`;

  if(!sorted.length){
    html+=`<div class="empty"><div class="empty-ico">📄</div><div class="empty-title">Sin documentos</div><div class="empty-txt">${puedeEditar?'Agrega recetas, exámenes e informes médicos.':'Aún no hay documentos médicos registrados.'}</div></div>`;
  } else {
    html+=`<div style="background:var(--white)">`;
    sorted.forEach(d=>{
      html+=`
        <div class="doc-card">
          <div class="doc-ico" style="background:${tipoColor[d.tipo]||'var(--surf)'}">${tipoIco[d.tipo]||'📁'}</div>
          <div style="flex:1;min-width:0">
            <div class="doc-nombre">${escapeHtml(d.nombre)||'Documento sin nombre'}</div>
            <div class="doc-meta">${d.medico?escapeHtml(d.medico)+' · ':''} ${fechaCorta(d.fecha)}</div>
            ${d.notas?`<div style="font-size:11px;color:var(--ink3);margin-top:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${escapeHtml(d.notas)}</div>`:''}
          </div>
          <span class="badge b-muted doc-tipo">${d.tipo||'otro'}</span>
          ${puedeEditar?`<button class="doc-del" onclick="eliminarDoc('${d.id}')">Eliminar</button>`:''}
        </div>`;
    });
    html+=`</div>`;
  }
  html+=`<div style="height:80px"></div>`;
  content.innerHTML=html;
}

function setDocFiltro(filtro, btn){
  ST.salud.docFiltro=filtro;
  document.querySelectorAll('.dfpill').forEach(p=>p.classList.remove('on'));
  if(btn) btn.classList.add('on');
  const c=DB.getCuidado();
  const sesion=DB.getSesion();
  renderDocs(c,['admin','cuidadora'].includes(sesion?.rol));
}

function abrirSheetDoc(){
  $('doc-nombre').value=''; $('doc-medico').value=''; $('doc-notas').value='';
  $('doc-fecha').value=hoy();
  $('ov-add-doc').classList.add('open');
}

function guardarDocumento(){
  const nombre=$('doc-nombre').value.trim();
  if(!nombre){ toast('Escribe un nombre para el documento','err'); return; }
  if(_bloqueadoPorDobleClick('documento')) return;
  const c=DB.getCuidado(); if(!c) return;
  if(!Array.isArray(c.documentos)) c.documentos=[];
  c.documentos.push({
    id:'doc-'+Date.now(),
    tipo:$('doc-tipo').value,
    nombre,
    medico:$('doc-medico').value.trim(),
    fecha:$('doc-fecha').value||hoy(),
    notas:$('doc-notas').value.trim(),
    creadoEl:hoy(),
  });
  DB.saveCuidado(c);
  cerrarSheet('ov-add-doc');
  toast('✓ Documento guardado','ok');
  renderTab('docs');
}

function eliminarDoc(id){
  confirmar('¿Eliminar este documento?','Se eliminará del historial.',()=>{
    const c=DB.getCuidado(); if(!c) return;
    c.documentos=(c.documentos||[]).filter(d=>d.id!==id);
    DB.saveCuidado(c);
    toast('Documento eliminado');
    renderTab('docs');
  });
}

/* ════ TAB HISTORIAL CLÍNICO ════ */
function renderHistorial(cuidado){
  const content=$('salud-content');
  const bitacoras=[...(cuidado.bitacoras||[])].reverse();
  const docs=[...(cuidado.documentos||[])].sort((a,b)=>b.fecha?.localeCompare(a.fecha||'')||0);
  const meds=[...(cuidado.meds||[])];

  // Construir timeline combinando eventos de distintas fuentes
  const eventos=[];

  // Registros de bitácora que tienen novedad (visita, nota)
  bitacoras.forEach(b=>{
    if(b.visita||b.nota){
      eventos.push({ fecha:b.fecha, hora:b.hora, tipo:'bitacora', titulo:b.visita?'Visita registrada':'Nota en bitácora', desc:b.nota||'Visita médica o familiar', color:var_color('sage') });
    }
    // Alertas de temperatura
    if(b.temp && parseFloat(b.temp)>=38){
      eventos.push({ fecha:b.fecha, hora:b.hora, tipo:'alerta', titulo:`Temperatura elevada: ${b.temp}°C`, desc:'Registrado en bitácora', color:var_color('red') });
    }
  });

  // Documentos
  docs.forEach(d=>{
    const tipos={receta:'Receta médica cargada',examen:'Examen de laboratorio',imagen:'Imagen diagnóstica',informe:'Informe médico'};
    eventos.push({ fecha:d.fecha, hora:'', tipo:'documento', titulo:tipos[d.tipo]||'Documento médico', desc:`${d.nombre}${d.medico?' · '+d.medico:''}`, color:var_color('blue') });
  });

  // Medicamentos agregados
  meds.forEach(m=>{
    if(m.agregadoEl){
      eventos.push({ fecha:m.agregadoEl, hora:'', tipo:'med', titulo:`Medicamento incorporado: ${m.nombre} ${m.dosis}`, desc:`${m.freq||'—'}${m.indicadoPor?' · '+m.indicadoPor:''}`, color:var_color('purple') });
    }
  });

  // Ordenar por fecha desc
  eventos.sort((a,b)=>b.fecha?.localeCompare(a.fecha||'')||0);

  const tipoLabel={bitacora:'Bitácora',alerta:'Alerta',documento:'Documento',med:'Medicamento'};
  const tipoBadge={bitacora:'b-ok',alerta:'b-err',documento:'b-info',med:'b-purple'};

  let html='';
  if(!eventos.length){
    html=`<div class="empty"><div class="empty-ico">📅</div><div class="empty-title">Sin historial aún</div><div class="empty-txt">Los eventos del cuidado aparecerán aquí a medida que registres bitácoras, documentos y medicamentos.</div></div>`;
  } else {
    html=`<div style="background:var(--white);padding:14px 0">`;
    eventos.forEach((ev,i,arr)=>{
      const esFinal=i===arr.length-1;
      html+=`
        <div class="hist-item">
          <div class="hist-timeline">
            <div class="hist-dot" style="color:${ev.color}"></div>
            ${!esFinal?'<div class="hist-line"></div>':''}
          </div>
          <div class="hist-fecha">${fechaCorta(ev.fecha)}<br>${ev.hora||''}</div>
          <div class="hist-content">
            <div class="hist-titulo">${escapeHtml(ev.titulo)}</div>
            ${ev.desc?`<div class="hist-desc">${escapeHtml(ev.desc)}</div>`:''}
            <span class="hist-tipo badge ${tipoBadge[ev.tipo]||'b-muted'}">${tipoLabel[ev.tipo]||ev.tipo}</span>
          </div>
        </div>`;
    });
    html+=`</div>`;
  }
  html+=`<div style="height:80px"></div>`;
  content.innerHTML=html;
}

function var_color(name){
  const map={sage:'#4A7C6F',red:'#C0453A',blue:'#3A6EA8',amber:'#C47A2B',purple:'#6B5EA8'};
  return map[name]||'#888';
}

/* ════ EDITAR FICHA — INIT ════ */
// Hook al navegar a la pantalla de editar ficha
const _navOrig=navTo;
window.navTo=function(id){
  _navOrig(id);
  if(id==='s-ficha-editar') prellenarFicha();
};

/* ── SHEETS Y CONFIRM ── */

$('cb-ok').onclick=()=>{ $('confirm-ov').classList.remove('open'); if(_cb)_cb(); };

/* ════════════════════════════════════════════
   MÓDULO 5 — ALIMENTACIÓN
   ════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   MÓDULO 5 · ALIMENTACIÓN — JAVASCRIPT
   ════════════════════════════════════════════════════════════ */

/* ── CAPA DE DATOS ── */

/* ── ESTADO LOCAL ── */


/* ── DÍAS DE LA SEMANA ── */
const DIAS=['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
const DIA_LABEL={ lunes:'Lunes',martes:'Martes',miercoles:'Miércoles',jueves:'Jueves',viernes:'Viernes',sabado:'Sábado',domingo:'Domingo' };
const DIA_ICO={ lunes:'☀️',martes:'🌤',miercoles:'⛅',jueves:'🌤',viernes:'🌞',sabado:'🏖️',domingo:'🌿' };
const MOMENTO_LABEL={ desayuno:'Desayuno',almuerzo:'Almuerzo',once:'Once',cena:'Cena' };
const MOMENTO_ICO={ desayuno:'☀️',almuerzo:'🌤',once:'🫖',cena:'🌙' };
const CAT_ICO={ verduras:'🥦',frutas:'🍎',proteina:'🍗',lacteo:'🥛',cereal:'🌾',insumo:'🧴',bebida:'💧',otro:'📦' };
const CAT_LABEL={ verduras:'Verduras',frutas:'Frutas',proteina:'Proteína',lacteo:'Lácteos',cereal:'Cereales',insumo:'Insumos',bebida:'Bebidas',otro:'Otro' };

/* ── HELPERS ── */

function diaHoy(){ return DIAS[new Date().getDay()===0?6:new Date().getDay()-1]; }

/* ── NAVEGACIÓN ── */

/* ── SIDEBAR ── */

/* ════ HUB — TABS ════ */
function setTabAlim(tab,btn){
  ST.alimentacion.tab=tab;
  document.querySelectorAll('.th').forEach(t=>t.classList.remove('on'));
  if(btn) btn.classList.add('on');
  else document.querySelectorAll('.th').forEach((t,i)=>{ if(['plan','restricciones','diario','compras'][i]===tab) t.classList.add('on'); });
  renderTabAlim(tab);
}

function fabActionAlim(){
  const s=DB.getSesion(); if(!s) return;
  const puede=['admin','familiar','cuidadora'].includes(s.rol);
  if(!puede) return;
  if(ST.alimentacion.tab==='plan')         abrirSeleccionarDia();
  if(ST.alimentacion.tab==='restricciones') abrirSheetRestriccion();
  if(ST.alimentacion.tab==='compras')       abrirSheetCompra();
}

function renderTabAlim(tab){
  const s=DB.getSesion(); if(!s) return;
  const c=DB.getCuidado(); if(!c) return;
  const puede=['admin','familiar','cuidadora'].includes(s.rol);
  const esAdmin=['admin','familiar'].includes(s.rol);
  const fab=$('alim-fab');
  const alim=DB.getAlim();
  const am=c.am||{};
  const sub=`${am.nombre||'la persona cuidada'}`;
  if($('alim-sub')) $('alim-sub').textContent=sub;
  if($('alim-sub-d')) $('alim-sub-d').textContent=sub;

  // Acciones de header
  const setAcciones=(html,htmlD)=>{
    if($('alim-hdr-action')) $('alim-hdr-action').innerHTML=html;
    if($('alim-hdr-action-d')) $('alim-hdr-action-d').innerHTML=htmlD;
  };

  if(tab==='plan'){
    if(fab) fab.style.display=puede?'flex':'none';
    setAcciones(
      puede?`<button class="hdr-action" onclick="abrirSeleccionarDia()">+ Agregar</button>`:'',
      puede?`<button style="background:var(--sage);color:#fff;border:none;border-radius:var(--rs);padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit" onclick="abrirSeleccionarDia()">+ Agregar comida</button>`:''
    );
    renderPlanSemanal(alim, puede, c);

  } else if(tab==='restricciones'){
    if(fab) fab.style.display=esAdmin?'flex':'none';
    setAcciones(
      esAdmin?`<button class="hdr-action" onclick="abrirSheetRestriccion()">+ Agregar</button>`:'',
      esAdmin?`<button style="background:var(--sage);color:#fff;border:none;border-radius:var(--rs);padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit" onclick="abrirSheetRestriccion()">+ Nueva restricción</button>`:''
    );
    renderRestricciones(alim, am, esAdmin);

  } else if(tab==='diario'){
    if(fab) fab.style.display='none';
    setAcciones('','');
    renderDiario(c, puede);

  } else if(tab==='compras'){
    if(fab) fab.style.display=puede?'flex':'none';
    setAcciones(
      puede?`<button class="hdr-action" onclick="abrirSheetCompra()">+ Agregar</button>`:'',
      puede?`<button style="background:var(--sage);color:#fff;border:none;border-radius:var(--rs);padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit" onclick="abrirSheetCompra()">+ Agregar</button>`:''
    );
    renderCompras(alim, puede);
  }
}

/* ════ TAB 1: PLAN SEMANAL ════ */
function renderPlanSemanal(alim, puede, cuidado){
  const content=$('alim-content');
  const am=cuidado?.am||{};

  // Hero de restricciones graves (alergias + restricciones médicas)
  const alergias=Array.isArray(am.alergias)?am.alergias:(am.alergias?[am.alergias]:[]);
  const restricciones=Array.isArray(am.restricciones)?am.restricciones:(am.restricciones?[am.restricciones]:[]);
  const graves=[...alergias,...restricciones].filter(Boolean);

  // Porciones del día de hoy desde bitácora
  const bitaHoy=(cuidado.bitacoras||[]).filter(b=>b.fecha===hoy()).slice(-1)[0];
  const porcionHoy={ desayuno:bitaHoy?.desayuno||'', almuerzo:bitaHoy?.almuerzo||'', cena:bitaHoy?.cena||'' };

  let html='';

  // Alerta de restricciones
  if(graves.length){
    html+=`
      <div class="rest-hero">
        <div class="rh-ico">⚠️</div>
        <div>
          <div class="rh-title">Atención · Restricciones activas</div>
          <div class="rh-pills">${graves.map(r=>`<span class="chip danger" style="cursor:default;padding:4px 10px;font-size:11px">${r}</span>`).join('')}</div>
        </div>
      </div>`;
  }

  // Días de la semana expandibles
  const hoyDia=diaHoy();
  DIAS.forEach(dia=>{
    const comidas=alim.plan[dia]||[];
    const esHoyDia=dia===hoyDia;
    const resumen=comidas.length?`${comidas.length} comida${comidas.length>1?'s':''}`:'Sin planificar';

    html+=`
      <div class="dia-card">
        <div class="dia-header" onclick="toggleDia('${dia}')">
          <div style="font-size:18px;flex-shrink:0;margin-right:4px">${DIA_ICO[dia]}</div>
          <div class="dia-nombre">${DIA_LABEL[dia]}${esHoyDia?` <span class="badge b-ok" style="font-size:10px;margin-left:4px">HOY</span>`:''}</div>
          <div class="dia-resumen">${resumen}</div>
          <div class="dia-arrow${esHoyDia?' open':''}" id="arrow-${dia}">›</div>
        </div>
        <div class="dia-body${esHoyDia?' open':''}" id="body-${dia}">`;

    if(comidas.length){
      const momentos=['desayuno','almuerzo','once','cena'];
      momentos.forEach(momento=>{
        const comidasMomento=comidas.filter(c=>c.momento===momento);
        comidasMomento.forEach((c)=>{
          // Porción registrada en la bitácora de hoy
          const porcion=esHoyDia&&['desayuno','almuerzo','cena'].includes(momento)?porcionHoy[momento]:'';
          const porcionCls=porcion==='Todo'?'cp-todo':porcion==='Mitad'?'cp-mitad':porcion==='Nada'?'cp-nada':'';
          html+=`
            <div class="comida-row">
              <div class="comida-momento">${MOMENTO_ICO[momento]} ${MOMENTO_LABEL[momento]}</div>
              <div class="comida-desc">${escapeHtml(c.desc)}${c.notas?` <span style="font-size:11px;color:var(--ink3)">· ${escapeHtml(c.notas)}</span>`:''}
              </div>
              ${porcion?`<span class="comida-porcion ${porcionCls}">${porcion}</span>`:''}
              ${puede?`<button class="comida-del" onclick="eliminarComida('${dia}','${c.id}')">🗑</button>`:''}
            </div>`;
        });
      });
    } else {
      html+=`<div style="padding:14px 18px 14px 30px;font-size:13px;color:var(--ink3)">Sin comidas planificadas para ${DIA_LABEL[dia].toLowerCase()}.</div>`;
    }

    if(puede){
      html+=`<div class="add-comida-row" onclick="abrirAddComida('${dia}')"><span>＋</span> Agregar comida para ${DIA_LABEL[dia].toLowerCase()}</div>`;
    }
    html+=`</div></div>`;
  });

  if(puede){
    html+=`<div class="ia" style="margin:14px 16px 80px"><div class="ia-ico">✦</div><div>El plan semanal es una referencia para la cuidadora. Las porciones reales del día se registran en "Registro del día" o en la bitácora.</div></div>`;
  } else {
    html+=`<div style="height:80px"></div>`;
  }
  content.innerHTML=html;
}

function toggleDia(dia){
  const body=$('body-'+dia), arrow=$('arrow-'+dia);
  if(!body||!arrow) return;
  const abierto=body.classList.toggle('open');
  arrow.classList.toggle('open',abierto);
}

/* Agregar comida al plan */
function abrirSeleccionarDia(){
  const lista=$('dia-selector-lista');
  lista.innerHTML=DIAS.map(d=>`
    <div onclick="selDiaYAbrirComida('${d}')" style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line);cursor:pointer">
      <span style="font-size:20px">${DIA_ICO[d]}</span>
      <span style="font-size:14px;font-weight:600;color:var(--ink)">${DIA_LABEL[d]}</span>
      ${d===diaHoy()?`<span class="badge b-ok" style="margin-left:auto">Hoy</span>`:''}
    </div>`).join('');
  $('ov-sel-dia').classList.add('open');
}

function selDiaYAbrirComida(dia){
  cerrarSheet('ov-sel-dia');
  abrirAddComida(dia);
}

function abrirAddComida(dia){
  ST.agenda.diaSeleccionado=dia;
  $('sh-comida-titulo').textContent=`Agregar comida · ${DIA_LABEL[dia]}`;
  $('comida-desc').value=''; $('comida-notas').value='';
  $('comida-momento').value='desayuno';
  $('ov-add-comida').classList.add('open');
  setTimeout(()=>$('comida-desc').focus(),300);
}

function guardarComida(){
  const desc=$('comida-desc').value.trim();
  if(!desc){ toast('Escribe una descripción de la comida','err'); return; }
  if(_bloqueadoPorDobleClick('comida')) return;
  const alim=DB.getAlim(); if(!alim) return;
  const dia=ST.agenda.diaSeleccionado||hoy();
  if(!alim.diario) alim.diario={};
  if(!alim.diario[dia]) alim.diario[dia]=[];
  if(!Array.isArray(alim.plan[dia])) alim.plan[dia]=[];
  const momentoVal = $('comida-momento').value||'desayuno';
  const entrada = { id:'c-'+Date.now(), desc, momento:momentoVal, notas:$('comida-notas').value.trim() };
  alim.plan[dia].push(entrada);
  alim.diario[dia].push(entrada);
  DB.saveAlim(alim);
  cerrarSheet('ov-add-comida');
  const diaLabel = DIA_LABEL[dia] ? DIA_LABEL[dia].toLowerCase() : dia;
  toast(`✓ Comida agregada al plan del ${diaLabel}`, 'ok');
  // Expandir el día y re-renderizar
  setTimeout(()=>{ renderTabAlim('plan'); setTimeout(()=>{ const b=$('body-'+dia); if(b&&!b.classList.contains('open')) toggleDia(dia); },50); },100);
}

function eliminarComida(dia,id){
  confirmar('¿Eliminar esta comida?','Se eliminará del plan semanal.',()=>{
    const alim=DB.getAlim(); if(!alim) return;
    if(Array.isArray(alim.plan[dia])) alim.plan[dia]=alim.plan[dia].filter(c=>c.id!==id);
    DB.saveAlim(alim);
    toast('Comida eliminada');
    renderTabAlim('plan');
  });
}

/* ════ TAB 2: RESTRICCIONES ════ */
function renderRestricciones(alim, am, esAdmin){
  const content=$('alim-content');
  // Combinar restricciones del perfil AM con las específicas del módulo
  const alergias=Array.isArray(am.alergias)?am.alergias:(am.alergias?[am.alergias]:[]);
  const restrAM=Array.isArray(am.restricciones)?am.restricciones:(am.restricciones?[am.restricciones]:[]);
  const restrModulo=alim.restricciones||[];

  const tipoConf={
    alergia:   {ico:'⚠️',cls:'b-err',label:'Alergia',color:'var(--red)'},
    intolerancia:{ico:'🔶',cls:'b-warn',label:'Intolerancia',color:'var(--amber)'},
    medica:    {ico:'🏥',cls:'b-info',label:'Médica',color:'var(--blue)'},
    preferencia:{ico:'💚',cls:'b-ok',label:'Preferencia',color:'var(--sage)'},
  };

  let html='';

  // Alergias del perfil AM (siempre visibles)
  if(alergias.length||restrAM.length){
    html+=`
      <div class="rest-grupo">
        <div class="rg-header">
          <div class="rg-ico">⚠️</div>
          <div class="rg-title">Alertas del perfil médico</div>
          <span class="badge b-err">${alergias.length+restrAM.length}</span>
        </div>`;
    alergias.forEach(a=>{
      html+=`<div class="rest-item"><div class="ri-dot" style="background:var(--red)"></div><span class="ri-tipo badge b-err">Alergia</span><div><div class="ri-txt">${escapeHtml(a)}</div><div class="ri-razon">Registrado en ficha clínica</div></div></div>`;
    });
    restrAM.forEach(r=>{
      html+=`<div class="rest-item"><div class="ri-dot" style="background:var(--amber)"></div><span class="ri-tipo badge b-warn">Restricción</span><div><div class="ri-txt">${escapeHtml(r)}</div><div class="ri-razon">Registrado en ficha clínica</div></div></div>`;
    });
    html+=`</div>`;
  }

  // Restricciones específicas del módulo de alimentación
  if(restrModulo.length){
    // Agrupar por tipo
    const porTipo={};
    restrModulo.forEach(r=>{ if(!porTipo[r.tipo]) porTipo[r.tipo]=[]; porTipo[r.tipo].push(r); });
    Object.entries(porTipo).forEach(([tipo,items])=>{
      const conf=tipoConf[tipo]||tipoConf.preferencia;
      html+=`
        <div class="rest-grupo">
          <div class="rg-header">
            <div class="rg-ico">${conf.ico}</div>
            <div class="rg-title">${conf.label}${items.length>1?'s':''}</div>
            <span class="badge ${conf.cls}">${items.length}</span>
          </div>`;
      items.forEach(r=>{
        html+=`
          <div class="rest-item">
            <div class="ri-dot" style="background:${conf.color}"></div>
            <span class="ri-tipo badge ${conf.cls}">${conf.label}</span>
            <div style="flex:1">
              <div class="ri-txt">${escapeHtml(r.desc)}</div>
              ${r.razon?`<div class="ri-razon">${escapeHtml(r.razon)}</div>`:''}
            </div>
            ${esAdmin?`<button class="ri-del" onclick="eliminarRestriccion('${r.id}')">Eliminar</button>`:''}
          </div>`;
      });
      html+=`</div>`;
    });
  }

  if(!alergias.length&&!restrAM.length&&!restrModulo.length){
    html=`<div class="empty"><div class="empty-ico">🚫</div><div class="empty-title">Sin restricciones registradas</div><div class="empty-txt">${esAdmin?'Agrega alergias, intolerancias y restricciones médicas para que la cuidadora las tenga siempre visible.':'El administrador aún no ha registrado restricciones alimentarias.'}</div></div>`;
  }

  html+=`<div class="ia" style="margin:14px 16px 80px"><div class="ia-ico">✦</div><div>Las restricciones del perfil médico se sincronizan automáticamente desde la ficha clínica. Las alergias graves aparecen siempre en rojo al inicio del plan semanal.</div></div>`;
  content.innerHTML=html;
}

function abrirSheetRestriccion(){
  $('rest-desc').value=''; $('rest-razon').value='';
  $('rest-tipo').value='alergia';
  $('ov-add-rest').classList.add('open');
  setTimeout(()=>$('rest-desc').focus(),300);
}

function guardarRestriccion(){
  const desc=$('rest-desc').value.trim();
  if(!desc){ toast('Describe el alimento o ingrediente','err'); return; }
  if(_bloqueadoPorDobleClick('restriccion')) return;
  const alim=DB.getAlim(); if(!alim) return;
  alim.restricciones.push({
    id:'r-'+Date.now(),
    tipo:$('rest-tipo').value,
    desc,
    razon:$('rest-razon').value.trim(),
  });
  DB.saveAlim(alim);
  cerrarSheet('ov-add-rest');
  toast('✓ Restricción registrada','ok');
  renderTabAlim('restricciones');
}

function eliminarRestriccion(id){
  confirmar('¿Eliminar esta restricción?','Se eliminará de la lista de restricciones alimentarias.',()=>{
    const alim=DB.getAlim(); if(!alim) return;
    alim.restricciones=alim.restricciones.filter(r=>r.id!==id);
    DB.saveAlim(alim);
    toast('Restricción eliminada');
    renderTabAlim('restricciones');
  });
}

/* ════ TAB 3: REGISTRO DIARIO ════ */
function renderDiario(cuidado, puede){
  const content=$('alim-content');
  const bitaHoy=(cuidado.bitacoras||[]).filter(b=>b.fecha===hoy()).slice(-1)[0];
  // Leer porciones guardadas (de bitácora o del estado local)
  if(bitaHoy){
    ST.alimentacion.porciones.desayuno=bitaHoy.desayuno||ST.alimentacion.porciones.desayuno;
    ST.alimentacion.porciones.almuerzo=bitaHoy.almuerzo||ST.alimentacion.porciones.almuerzo;
    ST.alimentacion.porciones.cena=bitaHoy.cena||ST.alimentacion.porciones.cena;
    if(bitaHoy.vasosAgua!==undefined) ST.alimentacion.vasosAgua=bitaHoy.vasosAgua||0;
  }

  const porcionBtns=(comida)=>{
    const v=ST.alimentacion.porciones[comida];
    return `
      <div class="pc-btns">
        <button class="pcb${v==='Todo'?' todo':''}" onclick="selPorcionAlim('${comida}','Todo',this)">Todo ✓</button>
        <button class="pcb${v==='Mitad'?' mitad':''}" onclick="selPorcionAlim('${comida}','Mitad',this)">La mitad</button>
        <button class="pcb${v==='Nada'?' nada':''}" onclick="selPorcionAlim('${comida}','Nada',this)">No comió</button>
      </div>`;
  };

  // Plan del día de hoy como referencia
  const alim=DB.getAlim();
  const planHoy=alim?.plan[diaHoy()]||[];
  const planRef=(momento)=>{ const c=planHoy.filter(x=>x.momento===momento); return c.length?c.map(x=>x.desc).join(', '):'Sin planificar'; };

  // Progress de comidas
  const completas=Object.values(ST.alimentacion.porciones).filter(v=>v&&v!=='Nada').length;
  const total=3;
  const pct=Math.round(completas/total*100);

  // Vasitos de agua
  const vasosHtml=Array.from({length:8},(_,i)=>`<div class="vaso${i<ST.alimentacion.vasosAgua?' on':''}" onclick="togVaso(${i})" title="${(i+1)*0.25}L">💧</div>`).join('');

  let html=`
    <div style="padding:12px 18px;border-bottom:1px solid var(--line);background:var(--white)">
      <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:6px">Registro de hoy · ${new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'})}</div>
      <div class="cp-track"><div class="cp-fill" style="width:${pct}%"></div></div>
      <div style="font-size:11px;color:var(--ink3);margin-top:4px">${completas}/${total} comidas registradas</div>
    </div>`;

  if(!puede){
    html+=`<div style="margin:14px 16px;background:var(--blue-lt);border:1px solid #B5CAEA;border-radius:var(--rs);padding:10px 14px;font-size:12px;color:var(--blue)">👁 Vista de solo lectura — el registro lo hace la administradora o la cuidadora.</div>`;
  }

  // Desayuno
  html+=`
    <div class="porcion-card">
      <div class="pc-header">
        <div class="pc-ico">☀️</div>
        <div>
          <div class="pc-titulo">Desayuno</div>
          <div class="pc-plan">Plan: ${planRef('desayuno')}</div>
        </div>
        ${ST.alimentacion.porciones.desayuno?`<span class="badge ${ST.alimentacion.porciones.desayuno==='Todo'?'b-ok':ST.alimentacion.porciones.desayuno==='Nada'?'b-err':'b-warn'}" style="margin-left:auto">${ST.alimentacion.porciones.desayuno}</span>`:''}
      </div>
      ${puede?porcionBtns('desayuno'):`<div style="font-size:13px;color:var(--ink3)">${ST.alimentacion.porciones.desayuno||'No registrado'}</div>`}
    </div>`;

  // Almuerzo
  html+=`
    <div class="porcion-card">
      <div class="pc-header">
        <div class="pc-ico">🌤</div>
        <div>
          <div class="pc-titulo">Almuerzo</div>
          <div class="pc-plan">Plan: ${planRef('almuerzo')}</div>
        </div>
        ${ST.alimentacion.porciones.almuerzo?`<span class="badge ${ST.alimentacion.porciones.almuerzo==='Todo'?'b-ok':ST.alimentacion.porciones.almuerzo==='Nada'?'b-err':'b-warn'}" style="margin-left:auto">${ST.alimentacion.porciones.almuerzo}</span>`:''}
      </div>
      ${puede?porcionBtns('almuerzo'):`<div style="font-size:13px;color:var(--ink3)">${ST.alimentacion.porciones.almuerzo||'No registrado'}</div>`}
    </div>`;

  // Cena
  html+=`
    <div class="porcion-card">
      <div class="pc-header">
        <div class="pc-ico">🌙</div>
        <div>
          <div class="pc-titulo">Cena</div>
          <div class="pc-plan">Plan: ${planRef('cena')}</div>
        </div>
        ${ST.alimentacion.porciones.cena?`<span class="badge ${ST.alimentacion.porciones.cena==='Todo'?'b-ok':ST.alimentacion.porciones.cena==='Nada'?'b-err':'b-warn'}" style="margin-left:auto">${ST.alimentacion.porciones.cena}</span>`:''}
      </div>
      ${puede?porcionBtns('cena'):`<div style="font-size:13px;color:var(--ink3)">${ST.alimentacion.porciones.cena||'No registrado'}</div>`}
    </div>`;

  // Hidratación
  html+=`
    <div class="hidra-card">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--ink)">💧 Hidratación</div>
          <div style="font-size:12px;color:var(--ink3)">Meta: 6 vasos / 1.5L diarios</div>
        </div>
        <span class="badge ${ST.alimentacion.vasosAgua>=6?'b-ok':ST.alimentacion.vasosAgua>=3?'b-warn':'b-muted'}">${ST.alimentacion.vasosAgua} vasos · ${(ST.alimentacion.vasosAgua*0.25).toFixed(2)}L</span>
      </div>
      ${puede?`
        <div class="vaso-row">${vasosHtml}</div>
        <div class="hidra-meta">Toca cada vaso para registrar (cada uno = 250ml)</div>`
      :`<div class="vaso-row">${vasosHtml}</div>`}
    </div>`;

  if(puede){
    html+=`
      <div style="padding:14px 18px">
        <button class="btn btn-p" onclick="guardarRegistroDiario()">Guardar registro de hoy ✓</button>
        <div class="ia" style="margin-top:10px"><div class="ia-ico">✦</div><div>Este registro se sincroniza con la bitácora del día. Si ya existe una entrada de hoy, se actualiza con estas porciones.</div></div>
      </div>`;
  }
  html+=`<div style="height:80px"></div>`;
  content.innerHTML=html;
}

function selPorcionAlim(comida, val, btn){
  ST.alimentacion.porciones[comida]=val;
  const cls=val==='Todo'?'todo':val==='Mitad'?'mitad':'nada';
  btn.closest('.pc-btns')?.querySelectorAll('.pcb').forEach(b=>b.classList.remove('todo','mitad','nada'));
  btn.classList.add(cls);
  // Actualizar badge en el header
  // re-render header badge inline
  const icoPc=btn.closest('.porcion-card')?.querySelector('.pc-header');
  if(icoPc){
    let badge=icoPc.querySelector('.badge');
    if(!badge){ badge=document.createElement('span'); badge.style.marginLeft='auto'; icoPc.appendChild(badge); }
    badge.className=`badge ${val==='Todo'?'b-ok':val==='Nada'?'b-err':'b-warn'}`;
    badge.textContent=val;
  }
}

function togVaso(i){
  // Si el vaso ya está activo y es el último activo, desactivar; si no, activar hasta ese índice
  ST.alimentacion.vasosAgua = (i < ST.alimentacion.vasosAgua) ? i : i+1;
  // Re-render solo la parte de vasitos
  const row=document.querySelector('.vaso-row');
  if(row){
    row.innerHTML=Array.from({length:8},(_,j)=>`<div class="vaso${j<ST.alimentacion.vasosAgua?' on':''}" onclick="togVaso(${j})" title="${(j+1)*0.25}L">💧</div>`).join('');
  }
  // Actualizar el badge
  const badge=document.querySelector('.hidra-card .badge');
  if(badge){
    badge.className=`badge ${ST.alimentacion.vasosAgua>=6?'b-ok':ST.alimentacion.vasosAgua>=3?'b-warn':'b-muted'}`;
    badge.textContent=`${ST.alimentacion.vasosAgua} vasos · ${(ST.alimentacion.vasosAgua*0.25).toFixed(2)}L`;
  }
  const meta=document.querySelector('.hidra-meta');
  if(meta) meta.textContent='Toca cada vaso para registrar (cada uno = 250ml)';
}

function guardarRegistroDiario(){
  const c=DB.getCuidado(); if(!c) return;
  if(!Array.isArray(c.bitacoras)) c.bitacoras=[];

  // Buscar bitácora de hoy
  const idx=c.bitacoras.findLastIndex(b=>b.fecha===hoy());
  if(idx>=0){
    // Actualizar la existente
    c.bitacoras[idx].desayuno=ST.alimentacion.porciones.desayuno;
    c.bitacoras[idx].almuerzo=ST.alimentacion.porciones.almuerzo;
    c.bitacoras[idx].cena=ST.alimentacion.porciones.cena;
    c.bitacoras[idx].vasosAgua=ST.alimentacion.vasosAgua;
  } else {
    // Crear registro mínimo de alimentación
    c.bitacoras.push({
      id:'b-alim-'+Date.now(),
      fecha:hoy(),
      hora:new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'}),
      quien:'Alimentación',
      desayuno:ST.alimentacion.porciones.desayuno,
      almuerzo:ST.alimentacion.porciones.almuerzo,
      cena:ST.alimentacion.porciones.cena,
      vasosAgua:ST.alimentacion.vasosAgua,
      bano:false,hidra:ST.alimentacion.vasosAgua>=6,activ:false,visita:false,
      animo:'',nota:'',
      resumen:`Porciones del día: desayuno ${ST.alimentacion.porciones.desayuno||'no registrado'}, almuerzo ${ST.alimentacion.porciones.almuerzo||'no registrado'}, cena ${ST.alimentacion.porciones.cena||'no registrado'}. Hidratación: ${ST.alimentacion.vasosAgua} vasos.`,
    });
  }
  DB.saveCuidado(c);
  toast('✓ Registro guardado y sincronizado con bitácora','ok');
}

/* ════ TAB 4: LISTA DE COMPRAS ════ */
function renderCompras(alim, puede){
  const content=$('alim-content');
  const compras=alim.compras||[];
  const pendientes=compras.filter(c=>!c.completada);
  const completadas=compras.filter(c=>c.completada);
  const pct=compras.length?Math.round(completadas.length/compras.length*100):0;

  let html='';

  if(compras.length){
    html+=`
      <div class="compras-prog">
        <div class="cp-top"><div class="cp-lbl">Progreso de compras</div><div class="cp-cnt">${completadas.length}/${compras.length}</div></div>
        <div class="cp-track"><div class="cp-fill" style="width:${pct}%"></div></div>
      </div>`;
  }

  // Acciones de limpieza
  if(puede && completadas.length){
    html+=`<div style="padding:10px 18px;display:flex;gap:10px;border-bottom:1px solid var(--line)">
      <button onclick="limpiarCompletadas()" style="font-size:12px;color:var(--red);background:var(--red-lt);border:1px solid #F0B0AE;border-radius:6px;padding:6px 12px;cursor:pointer;font-family:inherit">Limpiar completadas (${completadas.length})</button>
      ${puede?`<button onclick="generarListaIA()" style="font-size:12px;color:var(--sage);background:var(--sage-lt);border:1px solid var(--sage-md);border-radius:6px;padding:6px 12px;cursor:pointer;font-family:inherit">✦ Sugerir con IA</button>`:''}
    </div>`;
  }

  if(!compras.length){
    html=`<div class="empty"><div class="empty-ico">🛒</div><div class="empty-title">Lista de compras vacía</div><div class="empty-txt">${puede?'Agrega los productos que necesitas comprar para el cuidado de la persona cuidada.':'El administrador aún no ha creado la lista de compras.'}</div></div>`;
    if(puede){
      html+=`<div style="padding:0 18px 16px;display:flex;gap:10px">
        <button class="btn btn-p" onclick="generarListaIA()">✦ Sugerir con IA</button>
      </div>`;
    }
    html+=`<div style="height:60px"></div>`;
    content.innerHTML=html;
    return;
  }

  // Agrupar por categoría
  const porCat={};
  pendientes.forEach(c=>{ if(!porCat[c.cat]) porCat[c.cat]=[]; porCat[c.cat].push(c); });

  if(Object.keys(porCat).length){
    Object.entries(porCat).forEach(([cat,items])=>{
      html+=`
        <div class="compra-grupo">
          <div class="cg-header">
            <div class="cg-ico">${CAT_ICO[cat]||'📦'}</div>
            <div class="cg-nombre">${CAT_LABEL[cat]||cat}</div>
            <div class="cg-count">${items.length} ítem${items.length>1?'s':''}</div>
          </div>`;
      items.forEach(item=>{
        html+=`
          <div class="compra-item" onclick="toggleCompra('${item.id}')">
            <div class="ci-chk"></div>
            <div class="ci-nombre">${escapeHtml(item.nombre)}</div>
            ${item.cantidad?`<div class="ci-cantidad">${escapeHtml(item.cantidad)}</div>`:''}
            ${puede?`<button class="ci-del" onclick="event.stopPropagation();eliminarCompra('${item.id}')">🗑</button>`:''}
          </div>`;
      });
      html+=`</div>`;
    });
  }

  // Completadas al fondo
  if(completadas.length){
    html+=`<div class="cg-header" style="background:var(--surf);opacity:.6"><div class="cg-ico">✓</div><div class="cg-nombre">Completados</div><div class="cg-count">${completadas.length}</div></div>`;
    completadas.forEach(item=>{
      html+=`
        <div class="compra-item" onclick="toggleCompra('${item.id}')" style="opacity:.6">
          <div class="ci-chk on">✓</div>
          <div class="ci-nombre done">${escapeHtml(item.nombre)}</div>
          ${item.cantidad?`<div class="ci-cantidad">${escapeHtml(item.cantidad)}</div>`:''}
          ${puede?`<button class="ci-del" onclick="event.stopPropagation();eliminarCompra('${item.id}')">🗑</button>`:''}
        </div>`;
    });
  }

  if(puede){
    html+=`<div class="ia" style="margin:14px 16px 80px"><div class="ia-ico">✦</div><div>Toca "Sugerir con IA" para que la IA genere la lista basada en el plan semanal y las restricciones de ${escapeHtml(DB.getCuidado()?.am?.nombre)||'la persona cuidada'}.</div></div>`;
  } else {
    html+=`<div style="height:80px"></div>`;
  }
  content.innerHTML=html;
}

/* Selector de categoría para compras */
let _catCompraActual='verduras';
function selCatCompra(btn){
  _catCompraActual=btn.dataset.cat;
  document.querySelectorAll('#cat-grid-compra .cat-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}

function abrirSheetCompra(){
  $('compra-nombre').value=''; $('compra-cantidad').value='';
  _catCompraActual='verduras';
  document.querySelectorAll('#cat-grid-compra .cat-btn').forEach((b,i)=>b.classList.toggle('on',i===0));
  $('ov-add-compra').classList.add('open');
  setTimeout(()=>$('compra-nombre').focus(),300);
}

function guardarCompra(){
  const nombre=$('compra-nombre').value.trim();
  if(!nombre){ toast('Escribe el nombre del producto','err'); return; }
  if(_bloqueadoPorDobleClick('compra')) return;
  const alim=DB.getAlim(); if(!alim) return;
  alim.compras.push({
    id:'cp-'+Date.now(),
    cat:_catCompraActual,
    nombre,
    cantidad:$('compra-cantidad').value.trim(),
    completada:false,
    agregadoEl:hoy(),
  });
  DB.saveAlim(alim);
  cerrarSheet('ov-add-compra');
  toast('✓ Agregado a la lista','ok');
  renderTabAlim('compras');
}

function toggleCompra(id){
  const alim=DB.getAlim(); if(!alim) return;
  const item=alim.compras.find(c=>c.id===id); if(!item) return;
  item.completada=!item.completada;
  DB.saveAlim(alim);
  renderTabAlim('compras');
  if(item.completada) toast('✓ Marcado como comprado','ok');
}

function eliminarCompra(id){
  confirmar('¿Eliminar este ítem?','Se eliminará de la lista de compras.',()=>{
    const alim=DB.getAlim(); if(!alim) return;
    alim.compras=alim.compras.filter(c=>c.id!==id);
    DB.saveAlim(alim);
    toast('Ítem eliminado');
    renderTabAlim('compras');
  });
}

function limpiarCompletadas(){
  confirmar('¿Limpiar ítems completados?','Se eliminarán todos los ítems marcados como comprados.',()=>{
    const alim=DB.getAlim(); if(!alim) return;
    alim.compras=alim.compras.filter(c=>!c.completada);
    DB.saveAlim(alim);
    toast('Lista actualizada','ok');
    renderTabAlim('compras');
  });
}

function generarListaIA(){
  // Simula IA que sugiere productos basada en el plan y restricciones
  const c=DB.getCuidado(); if(!c) return;
  const alim=DB.getAlim(); if(!alim) return;
  const am=c.am||{};

  // Productos base según condiciones del AM
  const sugerencias=[
    {cat:'verduras',nombre:'Zapallo italiano',cantidad:'1 kg'},
    {cat:'verduras',nombre:'Zanahoria',cantidad:'500g'},
    {cat:'proteina',nombre:'Pechuga de pollo',cantidad:'500g'},
    {cat:'lacteo',nombre:'Leche descremada',cantidad:'1L'},
    {cat:'cereal',nombre:'Avena',cantidad:'1 paquete'},
    {cat:'frutas',nombre:'Manzana',cantidad:'4 unidades'},
    {cat:'bebida',nombre:'Agua mineral',cantidad:'6 botellas'},
    {cat:'insumo',nombre:'Aceite de oliva',cantidad:'1 botella'},
  ];

  // Filtrar según restricciones del AM
  const restr=(am.restricciones||[]).map(r=>r.toLowerCase());
  const filtradas=sugerencias.filter(s=>{
    if(restr.some(r=>r.includes('sal')&&s.nombre.toLowerCase().includes('sal'))) return false;
    return true;
  });

  let agregados=0;
  filtradas.forEach(s=>{
    if(!alim.compras.find(c=>c.nombre.toLowerCase()===s.nombre.toLowerCase())){
      alim.compras.push({id:'cp-ia-'+Date.now()+'-'+Math.random().toString(36).slice(2),...s,completada:false,origen:'ia',agregadoEl:hoy()});
      agregados++;
    }
  });
  DB.saveAlim(alim);
  toast(`✦ IA agregó ${agregados} productos sugeridos`,'ok',3000);
  renderTabAlim('compras');
}

/* ── SHEETS Y CONFIRM ── */

$('cb-ok').onclick=()=>{ $('confirm-ov').classList.remove('open'); if(_cb)_cb(); };

/* ════════════════════════════════════════
   MÓDULO 6 — EQUIPO DE CUIDADO
   ════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   MÓDULO 6 · EQUIPO DE CUIDADO — JAVASCRIPT
   ════════════════════════════════════════════════════════════ */

/* ── CAPA DE DATOS ── */

/* ── CONSTANTES ── */

const DIAS_FULL=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

const TIPO_ICO={
  medico:'🩺',enfermera:'💉',kinesiologo:'🏃',
  nutricionista:'🥗',psicologo:'🧠',terapeuta:'🤝',otro:'👤',
  cuidadora_principal:'👩',cuidadora_suplente:'👩',acompanante:'🤝',
};
const TIPO_LABEL={
  medico:'Médico',enfermera:'Enfermera / TENS',kinesiologo:'Kinesiólogo/a',
  nutricionista:'Nutricionista',psicologo:'Psicólogo/a',terapeuta:'Terapeuta ocupacional',otro:'Especialista',
  cuidadora_principal:'Cuidadora principal',cuidadora_suplente:'Cuidadora suplente',acompanante:'Acompañante',
};
const FREQ_LABEL={semanal:'Semanal',quincenal:'Quincenal',mensual:'Mensual',segun_necesidad:'Según necesidad'};

// Colores para distinguir cuidadoras en el calendario
const PALETA=[
  {bg:'var(--sage-lt)',border:'var(--sage-md)',color:'var(--sage-dk)',ava:'#4A7C6F'},
  {bg:'var(--blue-lt)',border:'#B5CAEA',color:'var(--blue)',ava:'#3A6EA8'},
  {bg:'var(--purple-lt)',border:'#C5BAE8',color:'var(--purple)',ava:'#6B5EA8'},
  {bg:'var(--amber-lt)',border:'#E8C88A',color:'var(--amber)',ava:'#C47A2B'},
  {bg:'var(--teal-lt)',border:'#A0D8D9',color:'var(--teal)',ava:'#0D7377'},
];

/* ── ESTADO ── */

/* ── HELPERS ── */

function paleta(idx){ return PALETA[idx % PALETA.length]; }

/* ── NAVEGACIÓN ── */

/* ── SIDEBAR ── */

/* ════ HUB — TABS ════ */
function setTabEquip(tab,btn){
  ST.equipo.tabEquip=tab; ST.alimentacion.tab=tab;
  document.querySelectorAll('.th').forEach(t=>t.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderTabEquip(tab);
}







function renderTabEquip(tab){
  const s=DB.getSesion(); if(!s) return;
  const c=DB.getCuidado(); if(!c) return;
  const comp=DB.getCompartido();
  const am=c.am||{};
  const esAdmin=s.rol==='admin';
  const fab=$('equipo-fab');
  const sub=`${am.nombre||'la persona cuidada'} · ${comp.equipo?.length||0} personas en el equipo`;
  if($('equipo-sub')) $('equipo-sub').textContent=sub;
  if($('equipo-sub-d')) $('equipo-sub-d').textContent=sub;

  const setAcciones=(html,htmlD)=>{
    if($('equipo-hdr-action'))   $('equipo-hdr-action').innerHTML=html;
    if($('equipo-hdr-action-d')) $('equipo-hdr-action-d').innerHTML=htmlD;
  };
  const deskBtn=(label,fn)=>`<button style="background:var(--sage);color:#fff;border:none;border-radius:var(--rs);padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit" onclick="${fn}">${label}</button>`;

  if(tab==='cuidadoras'){
    if(fab) fab.style.display=esAdmin?'flex':'none';
    setAcciones(
      esAdmin?`<button class="hdr-action" onclick="abrirSheetCuidadora()">+ Agregar</button>`:'',
      esAdmin?deskBtn('+ Agregar cuidadora','abrirSheetCuidadora()'):''
    );
    renderCuidadoras(c,esAdmin);

  } else if(tab==='especialistas'){
    if(fab) fab.style.display=esAdmin?'flex':'none';
    setAcciones(
      esAdmin?`<button class="hdr-action" onclick="abrirSheetEspecialista()">+ Agregar</button>`:'',
      esAdmin?deskBtn('+ Agregar especialista','abrirSheetEspecialista()'):''
    );
    renderEspecialistas(esAdmin);

  } else if(tab==='turnos'){
    if(fab) fab.style.display='none';
    setAcciones('','');
    renderCalendario();
  }
}

/* ════ TAB CUIDADORAS ════ */
function renderCuidadoras(c, esAdmin){
  const content=$('equipo-content');
  const comp=DB.getCompartido();
  const cuidadoras=(comp.equipo||[]).filter(p=>p.categoria==='cuidadora');
  const usuarios=DB.getUsuarios();

  if(!cuidadoras.length){
    content.innerHTML=`
      <div class="empty">
        <div class="empty-ico">🧑‍⚕️</div>
        <div class="empty-title">Sin cuidadoras registradas</div>
        <div class="empty-txt">${esAdmin?'Agrega las cuidadoras del equipo con sus turnos y datos de contacto.':'El administrador aún no ha registrado el equipo de cuidadoras.'}</div>
      </div>
      <div class="ia" style="margin:0 16px 20px">
        <div class="ia-ico">📱</div>
        <div>Para que la cuidadora use la app, genera un código de invitación desde <span style="color:var(--sage);font-weight:600;cursor:pointer" onclick="navTo('s-invitaciones')">Invitar personas →</span>. Aquí registras sus datos y turnos.</div>
      </div>`;
    return;
  }

  // Cruzar con usuarios app
  const enApp=new Set(usuarios.filter(u=>u.rol==='cuidadora').map(u=>u.nombre.toLowerCase()));

  let html='';
  cuidadoras.forEach((p,idx)=>{
    const pal=paleta(idx);
    const tieneApp=enApp.has(p.nombre?.toLowerCase());
    const dias=p.dias||[];
    const horaIni=p.horaIni||'08:00';
    const horaFin=p.horaFin||'18:00';

    // Última bitácora de esta cuidadora
    const bitacoras=(c.bitacoras||[]).filter(b=>b.quien&&b.quien.toLowerCase().includes(p.nombre?.split(' ')[0]?.toLowerCase()||'xx'));
    const ultimaBita=bitacoras.slice(-1)[0];

    html+=`
      <div class="persona-card">
        <div class="pc-top">
          <div class="pc-avatar" style="background:${pal.ava}">${escapeHtml(initials(p.nombre))}</div>
          <div style="flex:1">
            <div class="pc-nombre">${escapeHtml(p.nombre)||'Sin nombre'}</div>
            <div class="pc-rol">${TIPO_LABEL[p.rol]||'Cuidadora'}</div>
          </div>
          ${tieneApp?`<span class="en-app">✓ En app</span>`:''}
        </div>

        <div class="pc-meta">
          ${p.telefono?`<span class="pc-tag">📞 ${escapeHtml(p.telefono)}</span>`:''}
          ${p.notas?`<span class="pc-tag" style="color:var(--ink3)">${escapeHtml(p.notas)}</span>`:''}
          ${ultimaBita?`<span class="pc-tag" style="background:var(--sage-lt);color:var(--sage)">Último registro: ${ultimaBita.fecha}</span>`:''}
        </div>

        <div style="font-size:11px;font-weight:600;color:var(--ink3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Turno · ${horaIni} – ${horaFin}</div>
        <div class="turno-semana">
          ${DIAS.map(d=>{
            const trabaja=dias.includes(d);
            return `<div class="dia-turno${trabaja?' trabaja':' libre'}">
              <span class="dt-label">${d}</span>
              ${trabaja?`<span class="dt-horario">${horaIni.slice(0,5)}</span>`:''}
            </div>`;
          }).join('')}
        </div>

        ${esAdmin?`
          <div class="pc-actions">
            <button class="btn btn-s" style="width:auto;flex:1;padding:10px" onclick="editarCuidadora('${p.id}')">✏ Editar turno</button>
            <button class="btn btn-danger" style="width:auto;flex:1;padding:10px" onclick="eliminarPersona('${p.id}')">Eliminar</button>
          </div>`:''}
      </div>`;
  });

  html+=`
    <div class="ia" style="margin:14px 16px 80px">
      <div class="ia-ico">✦</div>
      <div>El ícono "En app" aparece cuando la cuidadora tiene acceso activo a Raíz. Para invitarla, genera un código desde <span style="color:var(--sage);font-weight:600;cursor:pointer" onclick="navTo('s-invitaciones')">Invitar personas →</span>.</div>
    </div>`;
  content.innerHTML=html;
}

/* ════ TAB ESPECIALISTAS ════ */
function renderEspecialistas(esAdmin){
  const content=$('equipo-content');
  const comp=DB.getCompartido();
  const especialistas=(comp.equipo||[]).filter(p=>p.categoria==='especialista');
  const coloresTipo={
    medico:'#4A7C6F',enfermera:'#C47A2B',kinesiologo:'#3A6EA8',
    nutricionista:'#2E7D4F',psicologo:'#6B5EA8',terapeuta:'#0D7377',otro:'#6B7370',
  };

  if(!especialistas.length){
    content.innerHTML=`
      <div class="empty">
        <div class="empty-ico">👨‍⚕️</div>
        <div class="empty-title">Sin especialistas registrados</div>
        <div class="empty-txt">${esAdmin?'Agrega médicos, kinesiólogos, enfermeras y otros especialistas del equipo médico.':'El administrador aún no ha registrado especialistas.'}</div>
      </div>`;
    return;
  }

  // Agrupar por tipo
  const porTipo={};
  especialistas.forEach(e=>{ if(!porTipo[e.tipo]) porTipo[e.tipo]=[]; porTipo[e.tipo].push(e); });

  let html='';
  Object.entries(porTipo).forEach(([tipo,lista])=>{
    const color=coloresTipo[tipo]||'#6B7370';
    html+=`<div class="slbl">${TIPO_ICO[tipo]||'👤'} ${TIPO_LABEL[tipo]||tipo}</div>`;
    html+=`<div style="background:var(--white);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">`;
    lista.forEach((e,i)=>{
      html+=`
        <div class="esp-card" style="${i===lista.length-1?'border:none':''}">
          <div class="esp-avatar" style="background:${color}20;border:1px solid ${color}40">
            <span style="font-size:22px">${TIPO_ICO[e.tipo]||'👤'}</span>
          </div>
          <div style="flex:1;min-width:0">
            <div class="esp-nombre">${escapeHtml(e.nombre)||'Sin nombre'}</div>
            <div class="esp-especialidad">${escapeHtml(e.especializacion)||TIPO_LABEL[e.tipo]||'Especialista'}</div>
            <div class="esp-meta" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:5px">
              ${e.centro?`<span style="color:var(--ink3)">🏥 ${escapeHtml(e.centro)}</span>`:''}
              ${e.telefono?`<span style="color:var(--ink3)">📞 ${escapeHtml(e.telefono)}</span>`:''}
              ${e.frecuencia?`<span class="badge b-info">${FREQ_LABEL[e.frecuencia]||e.frecuencia}</span>`:''}
            </div>
          </div>
          <div class="esp-right">
            ${esAdmin?`<button class="esp-del" onclick="eliminarPersona('${e.id}')">Eliminar</button>`:''}
          </div>
        </div>`;
    });
    html+=`</div>`;
  });

  html+=`<div style="height:80px"></div>`;
  content.innerHTML=html;
}

/* ════ TAB CALENDARIO DE TURNOS ════ */
function renderCalendario(){
  const content=$('equipo-content');
  const comp=DB.getCompartido();
  const cuidadoras=(comp.equipo||[]).filter(p=>p.categoria==='cuidadora');

  if(!cuidadoras.length){
    content.innerHTML=`
      <div class="empty">
        <div class="empty-ico">📅</div>
        <div class="empty-title">Sin turnos configurados</div>
        <div class="empty-txt">Agrega cuidadoras con sus días de turno para ver el calendario semanal aquí.</div>
      </div>`;
    return;
  }

  // Calcular los días de la semana actual
  const ahora=new Date();
  const diaActual=ahora.getDay()===0?6:ahora.getDay()-1; // 0=Lu
  const inicioSemana=new Date(ahora);
  inicioSemana.setDate(ahora.getDate()-diaActual);

  const diasSemana=DIAS.map((_,i)=>{
    const d=new Date(inicioSemana);
    d.setDate(inicioSemana.getDate()+i);
    return { num:d.getDate(), dia:DIAS[i], esHoy:i===diaActual, idx:i };
  });

  let html=`
    <div class="leyenda">
      ${cuidadoras.map((cu,i)=>{
        const p=paleta(i);
        return `<div class="ley-item"><div class="ley-dot" style="background:${p.ava}"></div>${escapeHtml(cu.nombre?.split(' ')[0])||'?'}</div>`;
      }).join('')}
    </div>`;

  // Header del calendario
  html+=`<div class="cal-semana">
    <div class="cal-header"><span style="font-size:10px;color:var(--ink3)">Persona</span></div>
    ${diasSemana.map(d=>`
      <div class="cal-header">
        <div class="ch-dia">${d.dia}</div>
        <div class="${d.esHoy?'ch-num hoy':'ch-num'}">${d.num}</div>
      </div>`).join('')}
  </div>`;

  // Filas de cuidadoras
  cuidadoras.forEach((cu,i)=>{
    const pal=paleta(i);
    const dias=cu.dias||[];
    html+=`
      <div class="cal-row">
        <div class="cal-persona-lbl">
          <div class="cpl-avatar" style="background:${pal.ava}">${escapeHtml(initials(cu.nombre))}</div>
        </div>
        ${diasSemana.map(d=>{
          const trabaja=dias.includes(d.dia);
          return `<div class="cal-celda">
            ${trabaja
              ? `<div class="turno-block" style="background:${pal.bg};border:1px solid ${pal.border};color:${pal.color}">${cu.horaIni||'08:00'}</div>`
              : `<div class="cal-libre"></div>`
            }
          </div>`;
        }).join('')}
      </div>`;
  });

  // Resumen del día de hoy
  const cuidadorasHoy=cuidadoras.filter(cu=>(cu.dias||[]).includes(DIAS[diaActual]));
  html+=`
    <div style="padding:14px 18px;border-top:1px solid var(--line)">
      <div style="font-size:12px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Hoy en turno</div>
      ${cuidadorasHoy.length
        ? cuidadorasHoy.map((cu,i)=>`
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
              <div style="width:32px;height:32px;border-radius:50%;background:${paleta(i).ava};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff">${escapeHtml(initials(cu.nombre))}</div>
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--ink)">${escapeHtml(cu.nombre)}</div>
                <div style="font-size:12px;color:var(--ink3)">${cu.horaIni||'08:00'} – ${cu.horaFin||'18:00'} · ${TIPO_LABEL[cu.rol]||'Cuidadora'}</div>
              </div>
              ${cu.telefono?`<a href="tel:${escapeHtml(cu.telefono)}" style="margin-left:auto;font-size:12px;color:var(--sage);font-weight:600;text-decoration:none">📞 Llamar</a>`:''}
            </div>`).join('')
        : '<div style="font-size:13px;color:var(--amber)">⚠ Ninguna cuidadora asignada para hoy</div>'
      }
    </div>`;

  html+=`<div style="height:80px"></div>`;
  content.innerHTML=html;
}

/* ════ AGREGAR / EDITAR CUIDADORA ════ */
function renderDiasBtns(containerId, seleccionados){
  const wrap=$(containerId);
  if(!wrap) return;
  wrap.innerHTML=DIAS.map(d=>{
    const sel=seleccionados.has(d);
    return `<button data-dia="${d}" onclick="toggleDiaEquip(this,'${containerId}')"
      style="flex:1;padding:8px 2px;border-radius:6px;font-size:12px;font-weight:700;border:2px solid ${sel?'var(--sage)':'var(--line)'};background:${sel?'var(--sage-lt)':'var(--surf)'};color:${sel?'var(--sage)':'var(--ink3)'};cursor:pointer;font-family:inherit">${d}</button>`;
  }).join('');
}









function toggleDiaEquip(btn, containerId){
  const dia=btn.dataset.dia;
  const set=containerId==='c-dias-btns'?ST.equipo.diasSeleccionados:ST.equipo.editDiasSeleccionados;
  if(set.has(dia)){
    set.delete(dia);
    btn.style.borderColor='var(--line)';
    btn.style.background='var(--surf)';
    btn.style.color='var(--ink3)';
  } else {
    set.add(dia);
    btn.style.borderColor='var(--sage)';
    btn.style.background='var(--sage-lt)';
    btn.style.color='var(--sage)';
  }
}
function abrirSheetCuidadora(){
  $('c-nombre').value=''; $('c-telefono').value=''; $('c-notas').value='';
  $('c-rol').value='cuidadora_principal';
  $('c-hora-ini').value='08:00'; $('c-hora-fin').value='18:00';
  ST.equipo.diasSeleccionados=new Set(['lunes','martes','miercoles','jueves','viernes']);
  renderDiasBtns('c-dias-btns',ST.equipo.diasSeleccionados);
  $('ov-add-cuidadora').classList.add('open');
  setTimeout(()=>$('c-nombre').focus(),300);
}

function guardarCuidadora(){
  const nombre=$('c-nombre').value.trim();
  if(!nombre){ toast('Ingresa el nombre de la cuidadora','err'); return; }
  if(_bloqueadoPorDobleClick('cuidadora')) return;
  const equipo=DB.getEquipo();
  equipo.push({
    id:'p-'+Date.now(), categoria:'cuidadora',
    nombre, telefono:$('c-telefono').value.trim(),
    rol:$('c-rol').value,
    dias:[...ST.equipo.diasSeleccionados],
    horaIni:$('c-hora-ini').value,
    horaFin:$('c-hora-fin').value,
    notas:$('c-notas').value.trim(),
    creadoEl:hoy(),
  });
  DB.saveEquipo(equipo);
  cerrarSheet('ov-add-cuidadora');
  toast('✓ Cuidadora agregada','ok');
  renderTabEquip('cuidadoras');
}

function editarCuidadora(id){
  const equipo=DB.getEquipo();
  const p=equipo.find(x=>x.id===id); if(!p) return;
  $('edit-c-id').value=id;
  $('edit-c-nombre').value=p.nombre||'';
  $('edit-c-telefono').value=p.telefono||'';
  $('edit-c-rol').value=p.rol||'cuidadora_principal';
  $('edit-c-hora-ini').value=p.horaIni||'08:00';
  $('edit-c-hora-fin').value=p.horaFin||'18:00';
  $('edit-c-notas').value=p.notas||'';
  ST.equipo.editDiasSeleccionados=new Set(p.dias||[]);
  renderDiasBtns('edit-c-dias-btns',ST.equipo.editDiasSeleccionados);
  $('ov-edit-cuidadora').classList.add('open');
}

function actualizarCuidadora(){
  const id=$('edit-c-id').value;
  const nombre=$('edit-c-nombre').value.trim();
  if(!nombre){ toast('El nombre no puede estar vacío','err'); return; }
  const equipo=DB.getEquipo();
  const idx=equipo.findIndex(p=>p.id===id); if(idx<0) return;
  equipo[idx]={
    ...equipo[idx],
    nombre, telefono:$('edit-c-telefono').value.trim(),
    rol:$('edit-c-rol').value,
    dias:[...ST.equipo.editDiasSeleccionados],
    horaIni:$('edit-c-hora-ini').value,
    horaFin:$('edit-c-hora-fin').value,
    notas:$('edit-c-notas').value.trim(),
  };
  DB.saveEquipo(equipo);
  cerrarSheet('ov-edit-cuidadora');
  toast('✓ Datos actualizados','ok');
  renderTabEquip('cuidadoras');
}

/* ════ AGREGAR ESPECIALISTA ════ */
function abrirSheetEspecialista(){
  ['esp-nombre','esp-especializacion','esp-telefono','esp-centro'].forEach(id=>$(id).value='');
  $('esp-tipo').value='medico'; $('esp-frecuencia').value='mensual';
  $('ov-add-esp').classList.add('open');
  setTimeout(()=>$('esp-nombre').focus(),300);
}

function guardarEspecialista(){
  const nombre=$('esp-nombre').value.trim();
  if(!nombre){ toast('Ingresa el nombre del especialista','err'); return; }
  if(_bloqueadoPorDobleClick('especialista')) return;
  const equipo=DB.getEquipo();
  equipo.push({
    id:'e-'+Date.now(), categoria:'especialista',
    tipo:$('esp-tipo').value, nombre,
    especializacion:$('esp-especializacion').value.trim(),
    telefono:$('esp-telefono').value.trim(),
    centro:$('esp-centro').value.trim(),
    frecuencia:$('esp-frecuencia').value,
    creadoEl:hoy(),
  });
  DB.saveEquipo(equipo);
  cerrarSheet('ov-add-esp');
  toast('✓ Especialista agregado','ok');
  renderTabEquip('especialistas');
}

/* ════ ELIMINAR ════ */
function eliminarPersona(id){
  const persona=DB.getEquipo().find(p=>p.id===id);
  const nombre=persona?.nombre||'esta persona';
  confirmar(`¿Eliminar a ${nombre}?`,'Se eliminará del equipo de cuidado. Esta acción no se puede deshacer.',()=>{
    const equipo=DB.getEquipo().filter(p=>p.id!==id);
    DB.saveEquipo(equipo);
    toast('Persona eliminada del equipo','ok');
    renderTabEquip(ST.equipo.tabEquip);
  });
}

/* ── SHEETS / CONFIRM ── */

$('cb-ok').onclick=()=>{ $('confirm-ov').classList.remove('open'); if(_cb)_cb(); };

/* ════════════════════════════════════════
   MÓDULO 7 — AGENDA
   ════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   MÓDULO 7 · AGENDA — JAVASCRIPT
   ════════════════════════════════════════════════════════════ */

/* ── CAPA DE DATOS ── */

/* ── TIPOS DE EVENTOS ── */
const TIPOS = {
  cita_medica: { label:'Cita médica',   ico:'🩺', color:'#3A6EA8', bg:'#E8EFF8', border:'#B5CAEA' },
  control:     { label:'Control/examen',ico:'🩻', color:'#2E7D4F', bg:'#E4F4EC', border:'#A0CFAF' },
  kinesiologia:{ label:'Kinesiología',  ico:'🏃', color:'#C47A2B', bg:'#FAF0E2', border:'#E8C88A' },
  medicamento: { label:'Medicamento',   ico:'💊', color:'#4A7C6F', bg:'#E8F0EE', border:'#C2D8D2' },
  cumpleanos:  { label:'Cumpleaños',    ico:'🎂', color:'#6B5EA8', bg:'#EEEAF8', border:'#C5BAE8' },
  otro:        { label:'Otro',          ico:'📌', color:'#6B7370', bg:'#F7F9F8', border:'#E4E8E7' },
};

/* ── ESTADO ── */

/* ── HELPERS ── */

function padZ(n){ return String(n).padStart(2,'0'); }
function ymd(a,m,d){ return `${a}-${padZ(m+1)}-${padZ(d)}`; }

const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MESES_CORTO=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const DIAS_SEMANA=['Lu','Ma','Mi','Ju','Vi','Sa','Do'];


function diasHasta(dateStr){
  const hoyD=new Date(); hoyD.setHours(0,0,0,0);
  const ev=new Date(dateStr+'T00:00:00');
  return Math.round((ev-hoyD)/(1000*60*60*24));
}


/* ── NAVEGACIÓN ── */

/* ── SIDEBAR ── */

/* ════ AGENDA PRINCIPAL ════ */
function renderAgenda(){
  const s=DB.getSesion(); if(!s) return;
  const c=DB.getCuidado(); if(!c) return;
  const puedeEditar=['admin','familiar','cuidadora'].includes(s.rol);
  const am=c.am||{};

  // Por defecto, seleccionar el día de hoy si no hay ninguno elegido aún
  if(!ST.agenda.diaSeleccionado) ST.agenda.diaSeleccionado=hoy();

  // Sub-título
  const sub=`${am.nombre||'la persona cuidada'} · agenda de citas`;
  if($('agenda-sub')) $('agenda-sub').textContent=sub;
  if($('agenda-sub-d')) $('agenda-sub-d').textContent=sub;

  // Botón de acción
  const btnHtml=puedeEditar?`<button class="hdr-action" onclick="abrirSheetEvento()">+ Nuevo</button>`:'';
  const btnHtmlD=puedeEditar?`<button style="background:var(--sage);color:#fff;border:none;border-radius:var(--rs);padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit" onclick="abrirSheetEvento()">+ Nuevo evento</button>`:'';
  if($('agenda-hdr-action')) $('agenda-hdr-action').innerHTML=btnHtml;
  if($('agenda-hdr-action-d')) $('agenda-hdr-action-d').innerHTML=btnHtmlD;

  // FAB
  const fab=$('agenda-fab');
  if(fab) fab.style.display=puedeEditar?'flex':'none';

  renderCalendarioAgenda();
  renderDiaSeleccionado(puedeEditar);
  renderAlertas();
}

/* ── CALENDARIO MENSUAL ── */
function renderCalendarioAgenda(){
  const eventos=DB.getEventos();
  const {anioActual:a, mesActual:m}=ST.agenda;

  // Label del mes
  $('cal-mes-label').textContent=`${MESES[m]} ${a}`;

  // Calcular días del mes
  const primerDia=new Date(a,m,1).getDay(); // 0=Dom
  const ajuste=primerDia===0?6:primerDia-1; // convertir a Lu=0
  const diasEnMes=new Date(a,m+1,0).getDate();
  const diasMesAnterior=new Date(a,m,0).getDate();

  // Mapear eventos por fecha para los dots
  const eventosPorFecha={};
  eventos.forEach(ev=>{
    if(!ev.fecha) return;
    const [ea,em,ed]=ev.fecha.split('-').map(Number);
    if(ea===a && em===m+1){
      if(!eventosPorFecha[ed]) eventosPorFecha[ed]=[];
      eventosPorFecha[ed].push(ev);
    }
  });

  const hoyStr=hoy();
  let html='';
  // Cabecera días semana
  DIAS_SEMANA.forEach(d=>{ html+=`<div class="cal-dow">${d}</div>`; });

  // Días mes anterior
  for(let i=ajuste-1;i>=0;i--){
    const d=diasMesAnterior-i;
    html+=`<div class="cal-day otro-mes"><div class="cal-day-num">${d}</div></div>`;
  }
  // Días del mes
  for(let d=1;d<=diasEnMes;d++){
    const dateStr=ymd(a,m,d);
    const esHoy=dateStr===hoyStr;
    const esSel=dateStr===ST.agenda.diaSeleccionado;
    const evDia=eventosPorFecha[d]||[];
    const dotsHtml=evDia.slice(0,3).map(ev=>{
      const tipo=TIPOS[ev.tipo]||TIPOS.otro;
      return `<div class="cal-dot" style="background:${tipo.color}"></div>`;
    }).join('');
    html+=`
      <div class="cal-day${esHoy?' hoy':''}${esSel&&!esHoy?' seleccionado':''}${evDia.length?' tiene-eventos':''}"
           onclick="selDia('${dateStr}')">
        <div class="cal-day-num">${d}</div>
        ${dotsHtml?`<div class="cal-dots">${dotsHtml}</div>`:''}
      </div>`;
  }
  // Relleno final
  const total=ajuste+diasEnMes;
  const fila=Math.ceil(total/7)*7;
  for(let i=1;i<=fila-total;i++){
    html+=`<div class="cal-day otro-mes"><div class="cal-day-num">${i}</div></div>`;
  }
  $('cal-grid').innerHTML=html;
}

function cambiarMes(delta){
  ST.agenda.mesActual+=delta;
  if(ST.agenda.mesActual<0){ ST.agenda.mesActual=11; ST.agenda.anioActual--; }
  if(ST.agenda.mesActual>11){ ST.agenda.mesActual=0; ST.agenda.anioActual++; }
  renderCalendarioAgenda();
  renderDiaSeleccionado(['admin','cuidadora'].includes(DB.getSesion()?.rol));
}

function selDia(dateStr){
  ST.agenda.diaSeleccionado=dateStr;
  renderCalendarioAgenda();
  renderDiaSeleccionado(['admin','cuidadora'].includes(DB.getSesion()?.rol));
}

/* ── EVENTOS DEL DÍA SELECCIONADO ── */
function renderDiaSeleccionado(puedeEditar){
  const eventos=DB.getEventos();
  const dateStr=ST.agenda.diaSeleccionado;
  const [,m,d]=dateStr.split('-').map(Number);
  const dowIdx=new Date(dateStr+'T12:00').getDay();
  const dow=dowIdx===0?'Domingo':DIAS_FULL[dowIdx-1];
  const labelDia=`${dow}, ${d} de ${MESES[m-1]}`;
  const esHoy=dateStr===hoy();

  // Header del día
  $('dia-sel-txt').textContent=esHoy?`Hoy · ${labelDia}`:labelDia;
  const btnAdd=$('dia-sel-btn');
  if(btnAdd) btnAdd.style.display=puedeEditar?'block':'none';

  // Eventos de este día
  const evDia=eventos.filter(ev=>ev.fecha===dateStr).sort((a,b)=>(a.hora||'').localeCompare(b.hora||''));
  const body=$('eventos-body');

  if(!evDia.length){
    body.innerHTML=`
      <div style="padding:20px 18px;text-align:center">
        <div style="font-size:13px;color:var(--ink3)">Sin eventos para este día.</div>
        ${puedeEditar?`<div style="margin-top:10px"><button onclick="abrirSheetEvento()" style="font-size:13px;color:var(--sage);font-weight:600;background:none;border:none;cursor:pointer;font-family:inherit">+ Agregar evento para este día</button></div>`:''}
      </div>`;

    // Mostrar próximos 7 días
    const proximos=eventos.filter(ev=>{
      const df=diasHasta(ev.fecha);
      return df>0 && df<=30;
    }).sort((a,b)=>a.fecha.localeCompare(b.fecha)).slice(0,5);

    if(proximos.length){
      body.innerHTML+=`<div class="slbl">Próximos 30 días</div>`;
      proximos.forEach(ev=>{ body.innerHTML+=renderEventoCard(ev); });
    }
    return;
  }

  body.innerHTML=evDia.map(ev=>renderEventoCard(ev)).join('');
}

function renderEventoCard(ev){
  const t=TIPOS[ev.tipo]||TIPOS.otro;
  const [,m,d]=ev.fecha.split('-').map(Number);
  const diasD=diasHasta(ev.fecha);
  let diasLabel='';
  if(diasD===0) diasLabel='<span class="badge b-info">Hoy</span>';
  else if(diasD===1) diasLabel='<span class="badge b-warn">Mañana</span>';
  else if(diasD>1 && diasD<=7) diasLabel=`<span class="badge b-warn">En ${diasD} días</span>`;
  else if(diasD<0) diasLabel=`<span class="badge b-muted">Hace ${Math.abs(diasD)} días</span>`;

  return `
    <div class="evento-card" onclick="editarEvento('${ev.id}')" style="cursor:pointer">
      <div class="ev-color" style="background:${t.color}"></div>
      <div class="ev-fecha">
        <div class="ev-dia-num">${d}</div>
        <div class="ev-dia-txt">${MESES_CORTO[m-1]}</div>
      </div>
      <div class="ev-body">
        <div class="ev-titulo">${t.ico} ${escapeHtml(ev.titulo)||'Evento'}</div>
        <div class="ev-meta">
          ${ev.hora?`<span>🕐 ${ev.hora}</span>`:''}
          ${ev.lugar?`<span>📍 ${escapeHtml(ev.lugar)}</span>`:''}
          ${ev.acompanante?`<span>👤 ${escapeHtml(ev.acompanante)}</span>`:''}
          ${(()=>{ const todosC=DB.getCuidadosAdmin(); if(todosC.length<=1) return ''; const nombreC=ev.cuidadoId?(DB.getCuidadoById(ev.cuidadoId)?.am?.nombre||''):'Todos'; return nombreC?`<span style="color:var(--sage);font-weight:600">🏷 ${escapeHtml(nombreC)}</span>`:''; })()}
        </div>
        ${ev.notas?`<div style="font-size:12px;color:var(--ink3);margin-top:4px;font-style:italic">${escapeHtml(ev.notas)}</div>`:''}
      </div>
      <div class="ev-right">
        ${ev.hora?`<div class="ev-hora">${ev.hora}</div>`:''}
        ${diasLabel}
        <span class="badge" style="background:${t.bg};color:${t.color};border:1px solid ${t.border}">${t.label}</span>
      </div>
    </div>`;
}

/* ── ALERTAS DE PRÓXIMAS CITAS ── */
function renderAlertas(){
  const eventos=DB.getEventos();
  const alertas=eventos.filter(ev=>{
    const d=diasHasta(ev.fecha);
    return d>0 && d<=(parseInt(ev.alerta)||1);
  });

  const wrap=$('alertas-wrap');
  if(!alertas.length){ wrap.innerHTML=''; return; }

  const icons={1:'⚠️',2:'📢',3:'🔔'};
  wrap.innerHTML=alertas.map(ev=>{
    const d=diasHasta(ev.fecha);
    const t=TIPOS[ev.tipo]||TIPOS.otro;
    return `
      <div class="alerta-prox">
        <div class="ap-ico">${icons[Math.min(d,3)]||'⏰'}</div>
        <div>
          <div class="ap-title">Próxima cita · ${d===1?'mañana':'en '+d+' días'}</div>
          <div class="ap-desc">${t.ico} ${escapeHtml(ev.titulo)}${ev.hora?' a las '+ev.hora:''}${ev.lugar?' · '+escapeHtml(ev.lugar):''}</div>
        </div>
      </div>`;
  }).join('');
}

/* ════ SHEET AGREGAR / EDITAR EVENTO ════ */
/* Selector de Cuidado en el sheet de evento — ¿para quién es? */
function initSelectorCuidadoEvento(eventoCuidadoId){
  const todos=DB.getCuidadosAdmin();
  const wrap=$('ev-selector-cuidado');
  const chips=$('ev-cuidado-chips');
  if(!wrap||!chips) return;
  // Mostrar siempre el selector, incluso con un solo Cuidado —
  // así el usuario ve y controla explícitamente a quién aplica el evento
  wrap.style.display='block';
  ST.agenda.eventoCuidadoId = eventoCuidadoId!==undefined ? eventoCuidadoId : null;
  renderChipsCuidadoEvento(todos, chips);
}

function renderChipsCuidadoEvento(todos, chips){
  const opciones=[{id:null, nombre:'Todos'}, ...todos.map(c=>({id:c.id, nombre:c.am?.nombre||'Sin nombre'}))];
  chips.innerHTML=opciones.map(op=>{
    const on=ST.agenda.eventoCuidadoId===op.id;
    return `<button onclick="selCuidadoEvento(${op.id?`'${op.id}'`:'null'})"
      style="padding:8px 16px;border-radius:20px;font-size:13px;font-weight:${on?700:500};
      border:2px solid ${on?'var(--sage)':'var(--line)'};
      background:${on?'var(--sage-lt)':'var(--surf)'};
      color:${on?'var(--sage)':'var(--ink3)'};cursor:pointer;font-family:inherit;margin:0 6px 6px 0">
      ${escapeHtml(op.nombre)}
    </button>`;
  }).join('');
}

function selCuidadoEvento(cid){
  ST.agenda.eventoCuidadoId=cid;
  const todos=DB.getCuidadosAdmin();
  const chips=$('ev-cuidado-chips');
  if(chips) renderChipsCuidadoEvento(todos, chips);
}

function abrirSheetEvento(){
  // Prellenar con la fecha seleccionada
  ST.agenda.eventoEditandoId=null;
  $('sh-evento-titulo').textContent='Nuevo evento';
  $('ev-titulo').value='';
  $('ev-fecha').value=ST.agenda.diaSeleccionado||hoy();
  $('ev-hora').value='10:00';
  $('ev-lugar').value=''; $('ev-acompanante').value=''; $('ev-notas').value='';
  $('ev-alerta').value='1';
  $('btn-eliminar-evento').style.display='none';
  // Reset tipo
  ST.agenda.tipoActual='cita_medica';
  document.querySelectorAll('.tipo-btn').forEach(b=>{ b.classList.toggle('on',b.dataset.tipo==='cita_medica'); });
  actualizarEstilosTipo();
  initSelectorCuidadoEvento(null);
  $('ov-evento').classList.add('open');
  setTimeout(()=>$('ev-titulo').focus(),300);
}

function editarEvento(id){
  const ev=DB.getEventos().find(e=>e.id===id); if(!ev) return;
  ST.agenda.eventoEditandoId=id;
  $('sh-evento-titulo').textContent='Editar evento';
  $('ev-titulo').value=ev.titulo||'';
  $('ev-fecha').value=ev.fecha||hoy();
  $('ev-hora').value=ev.hora||'10:00';
  $('ev-lugar').value=ev.lugar||'';
  $('ev-acompanante').value=ev.acompanante||'';
  $('ev-notas').value=ev.notas||'';
  $('ev-alerta').value=ev.alerta||'1';
  $('btn-eliminar-evento').style.display='block';
  ST.agenda.tipoActual=ev.tipo||'cita_medica';
  document.querySelectorAll('.tipo-btn').forEach(b=>{ b.classList.toggle('on',b.dataset.tipo===ST.agenda.tipoActual); });
  actualizarEstilosTipo();
  initSelectorCuidadoEvento(ev.cuidadoId!==undefined ? ev.cuidadoId : null);
  $('ov-evento').classList.add('open');
}

function selTipo(btn){
  ST.agenda.tipoActual=btn.dataset.tipo;
  document.querySelectorAll('.tipo-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  actualizarEstilosTipo();
}

function actualizarEstilosTipo(){
  const t=TIPOS[ST.agenda.tipoActual]||TIPOS.otro;
  document.querySelectorAll('.tipo-btn').forEach(b=>{
    if(b.classList.contains('on')){
      b.style.borderColor=t.color;
      b.style.background=t.bg;
      b.querySelector('.tipo-lbl').style.color=t.color;
    } else {
      b.style.borderColor='';b.style.background='';
      b.querySelector('.tipo-lbl').style.color='';
    }
  });
}

function guardarEvento(){
  const titulo=$('ev-titulo').value.trim();
  if(!titulo){ toast('Escribe un título para el evento','err'); return; }
  const fecha=$('ev-fecha').value;
  if(!fecha){ toast('Selecciona una fecha','err'); return; }
  if(_bloqueadoPorDobleClick('evento')) return;

  const eventos=DB.getEventos();
  if(ST.agenda.eventoEditandoId){
    const idx=eventos.findIndex(e=>e.id===ST.agenda.eventoEditandoId);
    if(idx>=0){
      eventos[idx]={...eventos[idx],
        tipo:ST.agenda.tipoActual, titulo, fecha,
        hora:$('ev-hora').value,
        lugar:$('ev-lugar').value.trim(),
        acompanante:$('ev-acompanante').value.trim(),
        notas:$('ev-notas').value.trim(),
        alerta:$('ev-alerta').value,
        cuidadoId: ST.agenda.eventoCuidadoId!==undefined ? ST.agenda.eventoCuidadoId : null,
      };
    }
    toast('✓ Evento actualizado','ok');
  } else {
    eventos.push({
      id:'ev-'+Date.now(),
      tipo:ST.agenda.tipoActual, titulo, fecha,
      hora:$('ev-hora').value,
      lugar:$('ev-lugar').value.trim(),
      acompanante:$('ev-acompanante').value.trim(),
      notas:$('ev-notas').value.trim(),
      alerta:$('ev-alerta').value,
      cuidadoId: ST.agenda.eventoCuidadoId!==undefined ? ST.agenda.eventoCuidadoId : null,
      creadoEl:hoy(),
    });
    toast('✓ Evento guardado','ok');
  }

  DB.saveEventos(eventos);
  cerrarSheet('ov-evento');
  // Navegar al mes del evento
  const [a,m]=fecha.split('-').map(Number);
  ST.agenda.anioActual=a; ST.agenda.mesActual=m-1; ST.agenda.diaSeleccionado=fecha;
  renderCalendarioAgenda();
  renderDiaSeleccionado(['admin','cuidadora'].includes(DB.getSesion()?.rol));
  renderAlertas();
}

function eliminarEventoActual(){
  if(!ST.agenda.eventoEditandoId) return;
  confirmar('¿Eliminar este evento?','Se eliminará del calendario permanentemente.',()=>{
    const eventos=DB.getEventos().filter(e=>e.id!==ST.agenda.eventoEditandoId);
    DB.saveEventos(eventos);
    cerrarSheet('ov-evento');
    toast('Evento eliminado');
    renderCalendarioAgenda();
    renderDiaSeleccionado(['admin','cuidadora'].includes(DB.getSesion()?.rol));
    renderAlertas();
  });
}

/* ── SHEETS / CONFIRM ── */

$('cb-ok').onclick=()=>{ $('confirm-ov').classList.remove('open'); if(_cb)_cb(); };

/* ════ QA ════ */

/* ════ INIT ════ */


/* ════════════════════════════════════════
   MÓDULO 8 — HOGAR E INSUMOS
   ════════════════════════════════════════ */


/* ── DATOS ── */

/* ── CATÁLOGOS ── */
const CAT_INSUMO = {
  higiene:      {ico:'🧴',color:'#3A6EA8',bg:'#E8EFF8',label:'Higiene'},
  incontinencia:{ico:'🩱',color:'#C47A2B',bg:'#FAF0E2',label:'Incontinencia'},
  movilidad:    {ico:'♿',color:'#4A7C6F',bg:'#E8F0EE',label:'Movilidad'},
  alimentacion: {ico:'🥄',color:'#2E7D4F',bg:'#E4F4EC',label:'Alimentación'},
  limpieza:     {ico:'🧹',color:'#6B5EA8',bg:'#EEEAF8',label:'Limpieza'},
  ropa:         {ico:'👕',color:'#0D7377',bg:'#E0F4F4',label:'Ropa / cama'},
  medico:       {ico:'🩺',color:'#C0453A',bg:'#FAEAEA',label:'Médico'},
  otro:         {ico:'📦',color:'#6B7370',bg:'#F7F9F8',label:'Otro'},
};
const CAT_PROV = {
  farmacia:        {ico:'💊',color:'#4A7C6F',bg:'#E8F0EE',label:'Farmacia'},
  medico_domicilio:{ico:'🩺',color:'#3A6EA8',bg:'#E8EFF8',label:'Médico a domicilio'},
  kinesiologia:    {ico:'🏃',color:'#C47A2B',bg:'#FAF0E2',label:'Kinesiología'},
  enfermeria:      {ico:'💉',color:'#C0453A',bg:'#FAEAEA',label:'Enfermería'},
  nutricion:       {ico:'🥗',color:'#2E7D4F',bg:'#E4F4EC',label:'Nutrición'},
  transporte:      {ico:'🚗',color:'#6B5EA8',bg:'#EEEAF8',label:'Transporte'},
  supermercado:    {ico:'🛒',color:'#C47A2B',bg:'#FAF0E2',label:'Supermercado'},
  tecnico:         {ico:'🔧',color:'#6B7370',bg:'#F7F9F8',label:'Servicio técnico'},
  otro:            {ico:'📋',color:'#6B7370',bg:'#F7F9F8',label:'Otro'},
};

/* ── ESTADO ── */

/* ── HELPERS ── */

/* ── NAVEGACIÓN ── */

/* ── SIDEBAR ── */

/* ════ TABS ════ */
function setTabHogar(tab,btn){
  ST.hogar.tabHogar=tab; ST.alimentacion.tab=tab;
  document.querySelectorAll('.th').forEach(t=>t.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderTabHogar(tab);
}







function renderTabHogar(tab){
  const s=DB.getSesion(); if(!s) return;
  const c=DB.getCuidado(); if(!c) return;
  const puedeEditar=['admin','familiar','cuidadora'].includes(s.rol);
  const esAdmin=s.rol==='admin';
  const fab=$('hogar-fab');
  const am=c.am||{};
  const hogar=DB.getHogar();
  const sub=`${am.nombre||'la persona cuidada'} · hogar`;
  if($('hogar-sub')) $('hogar-sub').textContent=sub;
  if($('hogar-sub-d')) $('hogar-sub-d').textContent=sub;

  const deskBtn=(label,fn)=>`<button style="background:var(--sage);color:#fff;border:none;border-radius:var(--rs);padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit" onclick="${fn}">${label}</button>`;

  if(tab==='insumos'){
    if(fab) fab.style.display=puedeEditar?'flex':'none';
    if($('hogar-hdr-action')) $('hogar-hdr-action').innerHTML=puedeEditar?`<button class="hdr-action" onclick="abrirSheetInsumo()">+ Agregar</button>`:'';
    if($('hogar-hdr-action-d')) $('hogar-hdr-action-d').innerHTML=puedeEditar?deskBtn('+ Agregar insumo','abrirSheetInsumo()'):'';
    renderInsumos(hogar, puedeEditar, esAdmin);
  } else {
    if(fab) fab.style.display=esAdmin?'flex':'none';
    if($('hogar-hdr-action')) $('hogar-hdr-action').innerHTML=esAdmin?`<button class="hdr-action" onclick="abrirSheetProveedor()">+ Agregar</button>`:'';
    if($('hogar-hdr-action-d')) $('hogar-hdr-action-d').innerHTML=esAdmin?deskBtn('+ Agregar proveedor','abrirSheetProveedor()'):'';
    renderProveedores(hogar, esAdmin);
  }
}

/* ════ TAB INSUMOS ════ */
function renderInsumos(hogar, puedeEditar, esAdmin){
  const content=$('hogar-content');
  const insumos=hogar.insumos||[];
  const filtro=ST.hogar.filtroInsumo;
  const stockBajos=insumos.filter(i=>i.stock<=i.stockMin);
  const sinStock=insumos.filter(i=>i.stock===0);

  let html='';

  // Alerta de stock crítico
  if(sinStock.length){
    html+=`<div class="alerta-banner"><div class="ab-ico">🚫</div><div><div class="ab-title">Sin stock · ${sinStock.map(i=>i.nombre).join(', ')}</div><div class="ab-desc">Reponer urgente para no interrumpir el cuidado</div></div></div>`;
  } else if(stockBajos.length){
    html+=`<div class="alerta-banner" style="background:var(--amber-lt)"><div class="ab-ico">⚠️</div><div><div class="ab-title" style="color:var(--amber-dk)">Stock bajo · ${stockBajos.map(i=>i.nombre).join(', ')}</div><div class="ab-desc">Reponer esta semana</div></div></div>`;
  }

  // Filtros por categoría
  const cats=['todos',...new Set(insumos.map(i=>i.cat))];
  html+=`<div class="filtros-bar">
    ${cats.map(c=>`<div class="fpill${filtro===c?' on':''}" onclick="setFiltroInsumo('${c}',this)">${c==='todos'?'Todos':(CAT_INSUMO[c]?.ico+' '+(CAT_INSUMO[c]?.label||c))}</div>`).join('')}
  </div>`;

  // Lista de insumos
  const filtrados=filtro==='todos'?insumos:insumos.filter(i=>i.cat===filtro);
  if(!filtrados.length){
    html+=`<div class="empty"><div class="empty-ico">📦</div><div class="empty-title">Sin insumos${filtro!=='todos'?' en esta categoría':''}</div><div class="empty-txt">${puedeEditar?'Agrega los insumos del cuidado para mantener el stock actualizado.':'El administrador aún no ha registrado insumos.'}</div></div>`;
  } else {
    html+=`<div style="background:var(--white)">`;
    filtrados.forEach((ins,i)=>{
      const catConf=CAT_INSUMO[ins.cat]||CAT_INSUMO.otro;
      const pct=ins.stockMin>0?Math.min(100,Math.round(ins.stock/ins.stockMin*100)):100;
      const colorBar=ins.stock===0?'var(--red)':ins.stock<=ins.stockMin?'var(--amber)':'var(--sage)';
      html+=`
        <div class="insumo-card" style="${i===filtrados.length-1?'border:none':''}">
          <div class="insumo-ico" style="background:${catConf.bg}">
            ${catConf.ico}
          </div>
          <div style="flex:1;min-width:0">
            <div class="insumo-nombre">${escapeHtml(ins.nombre)}</div>
            <div class="insumo-meta">${catConf.label} · mín. ${ins.stockMin} ${ins.unidad||'ud.'}</div>
            <div class="stock-level" style="width:80%;max-width:120px">
              <div class="sl-fill" style="width:${pct}%;background:${colorBar}"></div>
            </div>
          </div>
          <div class="insumo-stock-wrap">
            ${puedeEditar?`<button class="stock-adj" onclick="ajustarStockInsumo('${ins.id}',-1)">−</button>`:''}
            <div class="insumo-stock-n" style="color:${ins.stock===0?'var(--red)':ins.stock<=ins.stockMin?'var(--amber)':'var(--ink)'}">
              ${ins.stock}<span style="font-size:11px;font-weight:400;color:var(--ink3);margin-left:2px">${ins.unidad||'ud.'}</span>
            </div>
            ${puedeEditar?`<button class="stock-adj plus" onclick="ajustarStockInsumo('${ins.id}',1)">＋</button>`:''}
            ${esAdmin?`<button class="insumo-del" onclick="editarInsumo('${ins.id}')">✏</button>`:''}
          </div>
        </div>`;
    });
    html+=`</div>`;
  }

  html+=`<div class="ia" style="margin:14px 16px 80px"><div class="ia-ico">✦</div><div>Los insumos con stock bajo o sin stock aparecen con alerta automática. La cuidadora puede actualizar el stock directamente sin necesidad de que el Admin esté presente.</div></div>`;
  content.innerHTML=html;
}

function setFiltroInsumo(cat,btn){
  ST.hogar.filtroInsumo=cat;
  document.querySelectorAll('.filtros-bar .fpill').forEach(p=>p.classList.remove('on'));
  btn.classList.add('on');
  const hogar=DB.getHogar();
  renderInsumos(hogar,['admin','familiar','cuidadora'].includes(DB.getSesion()?.rol),DB.getSesion()?.rol==='admin');
}










/* ════ SHEET INSUMO ════ */
let _catInsumoActual='higiene';
function selCatInsumo(btn){
  _catInsumoActual=btn.dataset.cat;
  document.querySelectorAll('#cat-grid-insumo .cat-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}

function abrirSheetInsumo(){
  ST.hogar.editInsumoId=null;
  $('sh-insumo-titulo').textContent='Agregar insumo';
  $('ins-nombre').value=''; $('ins-stock').value='0'; $('ins-min').value='5'; $('ins-notas').value='';
  $('ins-unidad').value='unidades';
  _catInsumoActual='higiene';
  document.querySelectorAll('#cat-grid-insumo .cat-btn').forEach((b,i)=>b.classList.toggle('on',i===0));
  $('btn-del-insumo').style.display='none';
  $('ov-insumo').classList.add('open');
  setTimeout(()=>$('ins-nombre').focus(),300);
}

function editarInsumo(id){
  const hogar=DB.getHogar(); if(!hogar) return;
  const ins=hogar.insumos.find(i=>i.id===id); if(!ins) return;
  ST.hogar.editInsumoId=id;
  $('sh-insumo-titulo').textContent='Editar insumo';
  $('ins-nombre').value=ins.nombre||'';
  $('ins-stock').value=ins.stock||0;
  $('ins-min').value=ins.stockMin||5;
  $('ins-unidad').value=ins.unidad||'unidades';
  $('ins-notas').value=ins.notas||'';
  _catInsumoActual=ins.cat||'otro';
  document.querySelectorAll('#cat-grid-insumo .cat-btn').forEach(b=>{ b.classList.toggle('on',b.dataset.cat===_catInsumoActual); });
  $('btn-del-insumo').style.display='block';
  $('ov-insumo').classList.add('open');
}

function guardarInsumo(){
  const nombre=$('ins-nombre').value.trim();
  if(!nombre){ toast('Escribe el nombre del insumo','err'); return; }
  if(_bloqueadoPorDobleClick('insumo')) return;
  const hogar=DB.getHogar(); if(!hogar) return;
  const data={
    cat:_catInsumoActual||_catActualHogar||'general',
    nombre,
    stock:parseInt($('ins-stock').value)||0,
    cantidad:parseInt($('ins-stock').value)||0,
    minimo:parseInt($('ins-min').value)||5,
    stockMin:parseInt($('ins-min').value)||5,
    unidad:$('ins-unidad').value,
    notas:$('ins-notas').value.trim(),
  };
  if(ST.hogar.editInsumoId){
    const idx=hogar.insumos.findIndex(i=>i.id===ST.hogar.editInsumoId);
    if(idx>=0) hogar.insumos[idx]={...hogar.insumos[idx],...data};
    toast('✓ Insumo actualizado','ok');
  } else {
    hogar.insumos.push({id:'ins-'+Date.now(),...data,creadoEl:hoy()});
    toast('✓ Insumo agregado','ok');
  }
  DB.saveHogar(hogar);
  cerrarSheet('ov-insumo');
  renderTabHogar('insumos');
}

function eliminarInsumoActual(){
  if(!ST.hogar.editInsumoId) return;
  confirmar('¿Eliminar este insumo?','Se eliminará del registro de stock.',()=>{
    const hogar=DB.getHogar(); if(!hogar) return;
    hogar.insumos=hogar.insumos.filter(i=>i.id!==ST.hogar.editInsumoId);
    DB.saveHogar(hogar);
    cerrarSheet('ov-insumo');
    toast('Insumo eliminado');
    renderTabHogar('insumos');
  });
}

/* ════ TAB PROVEEDORES ════ */
function renderProveedores(hogar, esAdmin){
  const content=$('hogar-content');
  const proveedores=hogar.proveedores||[];

  if(!proveedores.length){
    content.innerHTML=`
      <div class="empty">
        <div class="empty-ico">📋</div>
        <div class="empty-title">Sin proveedores registrados</div>
        <div class="empty-txt">${esAdmin?'Agrega farmacias, servicios a domicilio, transporte y otros contactos útiles del cuidado.':'El administrador aún no ha registrado proveedores.'}</div>
      </div>`;
    return;
  }

  // Agrupar por categoría
  const porCat={};
  proveedores.forEach(p=>{ if(!porCat[p.cat]) porCat[p.cat]=[]; porCat[p.cat].push(p); });

  let html='';
  Object.entries(porCat).forEach(([cat,lista])=>{
    const conf=CAT_PROV[cat]||CAT_PROV.otro;
    html+=`<div class="slbl">${conf.ico} ${conf.label}</div>`;
    html+=`<div style="background:var(--white);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">`;
    lista.forEach((p,i)=>{
      html+=`
        <div class="proveedor-card" style="${i===lista.length-1?'border:none':''}">
          <div class="prov-ico" style="background:${conf.bg};border:1px solid ${conf.color}30">
            ${conf.ico}
          </div>
          <div style="flex:1;min-width:0">
            <div class="prov-nombre">${escapeHtml(p.nombre)||'Sin nombre'}</div>
            <div class="prov-tipo">${conf.label}</div>
            ${p.horario?`<div style="font-size:11px;color:var(--ink3);margin-top:2px">🕐 ${escapeHtml(p.horario)}</div>`:''}
            ${p.direccion?`<div style="font-size:11px;color:var(--ink3);margin-top:2px">📍 ${escapeHtml(p.direccion)}</div>`:''}
            ${p.notas?`<div style="font-size:11px;color:var(--ink3);margin-top:2px;font-style:italic">${escapeHtml(p.notas)}</div>`:''}
          </div>
          <div class="prov-right">
            ${p.telefono?`<a href="tel:${escapeHtml(p.telefono)}" class="prov-call">📞 Llamar</a>`:''}
            ${esAdmin?`<button class="prov-del" onclick="editarProveedor('${p.id}')">✏ Editar</button>`:''}
          </div>
        </div>`;
    });
    html+=`</div>`;
  });

  html+=`<div class="ia" style="margin:14px 16px 80px"><div class="ia-ico">✦</div><div>El botón "Llamar" abre el teléfono directamente. Útil para que Carmen llame a la farmacia o al médico a domicilio en caso de urgencia.</div></div>`;
  content.innerHTML=html;
}

/* ════ SHEET PROVEEDOR ════ */
let _catProvActual='farmacia';
function selCatProv(btn){
  _catProvActual=btn.dataset.cat;
  document.querySelectorAll('#cat-grid-prov .cat-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}

function abrirSheetProveedor(){
  ST.hogar.editProvId=null;
  $('sh-prov-titulo').textContent='Agregar proveedor / servicio';
  ['prov-nombre','prov-telefono','prov-direccion','prov-horario','prov-notas'].forEach(id=>$(id).value='');
  _catProvActual='farmacia';
  document.querySelectorAll('#cat-grid-prov .cat-btn').forEach((b,i)=>b.classList.toggle('on',i===0));
  $('btn-del-prov').style.display='none';
  $('ov-proveedor').classList.add('open');
  setTimeout(()=>$('prov-nombre').focus(),300);
}

function editarProveedor(id){
  const hogar=DB.getHogar(); if(!hogar) return;
  const p=hogar.proveedores.find(x=>x.id===id); if(!p) return;
  ST.hogar.editProvId=id;
  $('sh-prov-titulo').textContent='Editar proveedor';
  $('prov-nombre').value=p.nombre||'';
  $('prov-telefono').value=p.telefono||'';
  $('prov-direccion').value=p.direccion||'';
  $('prov-horario').value=p.horario||'';
  $('prov-notas').value=p.notas||'';
  _catProvActual=p.cat||'otro';
  document.querySelectorAll('#cat-grid-prov .cat-btn').forEach(b=>{ b.classList.toggle('on',b.dataset.cat===_catProvActual); });
  $('btn-del-prov').style.display='block';
  $('ov-proveedor').classList.add('open');
}

function guardarProveedor(){
  const nombre=$('prov-nombre').value.trim();
  if(!nombre){ toast('Escribe el nombre del proveedor','err'); return; }
  if(_bloqueadoPorDobleClick('proveedor')) return;
  const hogar=DB.getHogar(); if(!hogar) return;
  const data={
    cat:_catProvActual,
    nombre,
    telefono:$('prov-telefono').value.trim(),
    direccion:$('prov-direccion').value.trim(),
    horario:$('prov-horario').value.trim(),
    notas:$('prov-notas').value.trim(),
  };
  if(ST.hogar.editProvId){
    const idx=hogar.proveedores.findIndex(p=>p.id===ST.hogar.editProvId);
    if(idx>=0) hogar.proveedores[idx]={...hogar.proveedores[idx],...data};
    toast('✓ Proveedor actualizado','ok');
  } else {
    hogar.proveedores.push({id:'prov-'+Date.now(),...data,creadoEl:hoy()});
    toast('✓ Proveedor agregado','ok');
  }
  DB.saveHogar(hogar);
  cerrarSheet('ov-proveedor');
  renderTabHogar('proveedores');
}

function eliminarProvActual(){
  if(!ST.hogar.editProvId) return;
  confirmar('¿Eliminar este proveedor?','Se eliminará del directorio.',()=>{
    const hogar=DB.getHogar(); if(!hogar) return;
    hogar.proveedores=hogar.proveedores.filter(p=>p.id!==ST.hogar.editProvId);
    DB.saveHogar(hogar);
    cerrarSheet('ov-proveedor');
    toast('Proveedor eliminado');
    renderTabHogar('proveedores');
  });
}

/* ── SHEETS / CONFIRM ── */

$('cb-ok').onclick=()=>{ $('confirm-ov').classList.remove('open'); if(_cb)_cb(); };

/* ════ QA ════ */

/* ════ INIT ════ */


/* ════════════════════════════════════════
   MÓDULO 9 — GASTOS Y FINANZAS
   ════════════════════════════════════════ */


/* ── DATOS ── */

/* ── CATÁLOGO DE CATEGORÍAS ── */
const CATS = {
  medicamentos:{ ico:'💊', color:'#4A7C6F', bg:'#E8F0EE', label:'Medicamentos' },
  alimentacion:{ ico:'🛒', color:'#3A6EA8', bg:'#E8EFF8', label:'Alimentación' },
  insumos:     { ico:'🧴', color:'#6B5EA8', bg:'#EEEAF8', label:'Insumos' },
  hogar:       { ico:'🏠', color:'#C47A2B', bg:'#FAF0E2', label:'Hogar' },
  traslado:    { ico:'🚗', color:'#0D7377', bg:'#E0F4F4', label:'Traslado' },
  medico:      { ico:'🏥', color:'#C0453A', bg:'#FAEAEA', label:'Médico' },
  cuidadora:   { ico:'👩‍⚕️', color:'#2E7D4F', bg:'#E4F4EC', label:'Cuidadora' },
  otro:        { ico:'📦', color:'#6B7370', bg:'#F7F9F8', label:'Otro' },
};

/* ── ESTADO ── */

/* ── HELPERS ── */
function mesLabel(ym){
  const [y,m]=ym.split('-').map(Number);
  const meses=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${meses[m-1]} ${y}`;
}

/* ── MESES DISPONIBLES ── */
function mesesDisponibles(gastos){
  const set=new Set(gastos.map(g=>g.fecha?.slice(0,7)).filter(Boolean));
  const hoyYM=hoy().slice(0,7);
  set.add(hoyYM);
  return [...set].sort().reverse().slice(0,6);
}

/* ── NAVEGACIÓN ── */

/* ── SIDEBAR ── */

/* ════ TABS ════ */
function setTabGastos(tab,btn){
  ST.alimentacion.tab=tab;
  document.querySelectorAll('.th').forEach(t=>t.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderTabGastos(tab);
}

function renderTabGastos(tab){
  const s=DB.getSesion(); if(!s) return;
  const c=DB.getCuidado(); if(!c) return;
  const comp=DB.getCompartido();
  const puedeRegistrar=['admin','familiar','cuidadora'].includes(s.rol);
  const esAdmin=s.rol==='admin';
  const esFamiliar=s.rol==='familiar';
  const fab=$('gastos-fab');
  const gastos=comp.gastos||[];
  const am=c.am||{};
  const presupuesto=comp.presupuesto||150000;

  if($('gastos-sub')) $('gastos-sub').textContent=`${am.nombre||'la persona cuidada'} · ${mesLabel(ST.gastos.mesVista)}`;
  if($('gastos-sub-d')) $('gastos-sub-d').textContent=`${am.nombre||'la persona cuidada'} · ${mesLabel(ST.gastos.mesVista)}`;

  const deskBtn=(label,fn)=>`<button style="background:var(--sage);color:#fff;border:none;border-radius:var(--rs);padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit" onclick="${fn}">${label}</button>`;

  if(tab==='registro'){
    if(fab) fab.style.display=puedeRegistrar?'flex':'none';
    if($('gastos-hdr-action')) $('gastos-hdr-action').innerHTML=puedeRegistrar?`<button class="hdr-action" onclick="abrirSheetGasto()">+ Agregar</button>`:'';
    if($('gastos-hdr-action-d')) $('gastos-hdr-action-d').innerHTML=puedeRegistrar?deskBtn('+ Registrar gasto','abrirSheetGasto()'):'';
    renderRegistro(gastos, presupuesto, puedeRegistrar, esAdmin);

  } else if(tab==='presupuesto'){
    if(fab) fab.style.display='none';
    if($('gastos-hdr-action')) $('gastos-hdr-action').innerHTML=esAdmin?`<button class="hdr-action" onclick="abrirEditarPresupuesto()">Editar</button>`:'';
    if($('gastos-hdr-action-d')) $('gastos-hdr-action-d').innerHTML=esAdmin?deskBtn('Editar presupuesto','abrirEditarPresupuesto()'):'';
    renderPresupuesto(gastos, presupuesto, esAdmin);

  } else if(tab==='rendicion'){
    if(fab) fab.style.display='none';
    if($('gastos-hdr-action')) $('gastos-hdr-action').innerHTML='';
    if($('gastos-hdr-action-d')) $('gastos-hdr-action-d').innerHTML='';
    renderRendicion(gastos, presupuesto, esFamiliar, esAdmin);
  }
}

/* ════ TAB REGISTRO ════ */
function renderRegistro(gastos, presupuesto, puedeRegistrar, esAdmin){
  const content=$('gastos-content');
  const meses=mesesDisponibles(gastos);
  const gastosMes=gastos.filter(g=>g.fecha?.startsWith(ST.gastos.mesVista));
  const total=gastosMes.reduce((s,g)=>s+g.monto,0);
  const pct=Math.min(100,Math.round(total/presupuesto*100));
  const resta=presupuesto-total;

  let html=`
    <!-- Barra de presupuesto -->
    <div class="budget-card">
      <div class="bc-row">
        <div>
          <div class="bc-label">Gastado en ${mesLabel(ST.gastos.mesVista)}</div>
          <div class="bc-monto">${fmt(total)}</div>
        </div>
        <button class="bc-edit" onclick="${esAdmin?'abrirEditarPresupuesto()':''}">
          Presupuesto: ${fmt(presupuesto)}${esAdmin?' ✏':''}
        </button>
      </div>
      <div class="bc-track">
        <div class="bc-fill${pct>=100?' over':pct>=80?' warn':''}" style="width:${pct}%"></div>
      </div>
      <div class="bc-meta">
        <span>${pct}% del presupuesto</span>
        <span>${resta>=0?fmt(resta)+' disponible':fmt(Math.abs(resta))+' sobre el límite'}</span>
      </div>
    </div>

    <!-- Selector de mes -->
    <div class="mes-selector">
      ${meses.map(m=>`<div class="mes-pill${m===ST.gastos.mesVista?' on':''}" onclick="selMes('${m}')">${mesLabel(m)}</div>`).join('')}
    </div>`;

  // Gastos agrupados por fecha
  const sorted=[...gastosMes].sort((a,b)=>b.fecha.localeCompare(a.fecha));
  if(!sorted.length){
    html+=`<div class="empty"><div class="empty-ico">🧾</div><div class="empty-title">Sin gastos en ${mesLabel(ST.gastos.mesVista)}</div><div class="empty-txt">${puedeRegistrar?'Toca ＋ para registrar el primer gasto del mes.':'El administrador aún no ha registrado gastos este mes.'}</div></div>`;
  } else {
    // Desglose rápido por categoría
    const porCat={};
    gastosMes.forEach(g=>{ if(!porCat[g.cat]) porCat[g.cat]=0; porCat[g.cat]+=g.monto; });
    const topCats=Object.entries(porCat).sort((a,b)=>b[1]-a[1]).slice(0,4);
    html+=`
      <div class="slbl">Desglose del mes</div>
      <div style="background:var(--white);border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:4px">
        ${topCats.map(([cat,monto])=>{
          const conf=CATS[cat]||CATS.otro;
          const pctCat=total>0?Math.round(monto/total*100):0;
          return `<div class="cat-desglose">
            <div class="cd-ico">${conf.ico}</div>
            <div class="cd-nombre">${conf.label}</div>
            <div class="cd-track"><div class="cd-fill" style="width:${pctCat}%;background:${conf.color}"></div></div>
            <div class="cd-monto">${fmt(monto)}</div>
            <div class="cd-pct">${pctCat}%</div>
          </div>`;
        }).join('')}
      </div>`;

    // Lista de gastos
    html+=`<div class="slbl">Todos los gastos</div>`;
    let fechaActual='';
    sorted.forEach(g=>{
      const conf=CATS[g.cat]||CATS.otro;
      if(g.fecha!==fechaActual){
        fechaActual=g.fecha;
        const d=new Date(g.fecha+'T12:00');
        const esHoy=g.fecha===hoy();
        html+=`<div class="fecha-sep">${esHoy?'Hoy · ':''} ${d.toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'}).toUpperCase()}</div>`;
      }
      const aprobBadge=g.aprobacion==='aprobado'?`<span class="badge b-ok" style="font-size:10px">✓ Aprobado</span>`:
                        g.aprobacion==='pendiente'?`<span class="badge b-warn" style="font-size:10px">Pendiente</span>`:
                        g.aprobacion==='rechazado'?`<span class="badge b-err" style="font-size:10px">Rechazado</span>`:'';
      html+=`
        <div class="gasto-row" onclick="editarGasto('${g.id}')" style="cursor:pointer">
          <div class="gasto-ico" style="background:${conf.bg}">${conf.ico}</div>
          <div style="flex:1;min-width:0">
            <div class="gasto-desc">${escapeHtml(g.desc)||'Sin descripción'}</div>
            <div class="gasto-meta">${conf.label}${g.boleta?' · 📎 Boleta':''}</div>
            ${aprobBadge?`<div style="margin-top:4px">${aprobBadge}</div>`:''}
          </div>
          <div class="gasto-monto">${fmt(g.monto)}</div>
          ${esAdmin?`<button class="gasto-del" onclick="event.stopPropagation();eliminarGasto('${g.id}')">🗑</button>`:''}
        </div>`;
    });
  }
  html+=`<div style="height:80px"></div>`;
  content.innerHTML=html;
}

function selMes(ym){
  ST.gastos.mesVista=ym;
  renderTabGastos('registro');
}

/* ════ TAB PRESUPUESTO ════ */
function renderPresupuesto(gastos, presupuesto, esAdmin){
  const content=$('gastos-content');
  const comp=DB.getCompartido();
  const gastosMes=gastos.filter(g=>g.fecha?.startsWith(ST.gastos.mesVista));
  const totalReal=gastosMes.reduce((s,g)=>s+g.monto,0);
  const presupuestoCats=comp.presupuestoCats||{};

  // Calcular real por categoría
  const realPorCat={};
  gastosMes.forEach(g=>{ if(!realPorCat[g.cat]) realPorCat[g.cat]=0; realPorCat[g.cat]+=g.monto; });

  const pct=Math.min(100,Math.round(totalReal/presupuesto*100));

  let html=`
    <div class="budget-card">
      <div class="bc-row">
        <div>
          <div class="bc-label">Total gastado vs presupuesto</div>
          <div class="bc-monto">${fmt(totalReal)}</div>
        </div>
        <span style="font-size:22px;font-weight:900;color:rgba(255,255,255,.8)">${pct}%</span>
      </div>
      <div class="bc-track"><div class="bc-fill${pct>=100?' over':pct>=80?' warn':''}" style="width:${pct}%"></div></div>
      <div class="bc-meta"><span>Meta: ${fmt(presupuesto)} · ${mesLabel(ST.gastos.mesVista)}</span><span>${fmt(presupuesto-totalReal)} disponible</span></div>
    </div>`;

  html+=`<div class="slbl">Presupuesto por categoría${esAdmin?' (editable)':''}</div>`;
  html+=`<div style="background:var(--white);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">`;

  Object.entries(CATS).forEach(([cat,conf])=>{
    const budgetCat=presupuestoCats[cat]||0;
    const realCat=realPorCat[cat]||0;
    const pctCat=budgetCat>0?Math.min(100,Math.round(realCat/budgetCat*100)):0;
    const colorBar=realCat>budgetCat&&budgetCat>0?'var(--red)':realCat>budgetCat*0.8&&budgetCat>0?'var(--amber)':conf.color;

    html+=`
      <div class="presu-row">
        <div class="pr-ico">${conf.ico}</div>
        <div style="flex:1;min-width:0">
          <div class="pr-nombre">${conf.label}</div>
          <div class="pr-real">Real: ${fmt(realCat)}${budgetCat?` · ${pctCat}% del plan`:''}</div>
          ${budgetCat>0?`<div style="height:4px;background:var(--line);border-radius:2px;margin-top:5px;width:80%;max-width:120px;overflow:hidden"><div style="height:100%;width:${pctCat}%;background:${colorBar};border-radius:2px;transition:width .4s"></div></div>`:''}
        </div>
        ${esAdmin?`
          <div style="display:flex;align-items:center;gap:4px">
            <span style="font-size:13px;color:var(--ink3)">$</span>
            <input type="number" inputmode="numeric" placeholder="0"
              value="${budgetCat||''}"
              class="pr-input"
              onchange="guardarPresupuestoCat('${cat}',this.value)"
              style="width:90px">
          </div>`:`<div style="font-size:13px;font-weight:700;color:var(--ink)">${budgetCat?fmt(budgetCat):'—'}</div>`}
      </div>`;
  });

  html+=`</div>`;
  html+=`<div class="ia" style="margin:14px 16px 80px"><div class="ia-ico">✦</div><div>Define cuánto planeas gastar por categoría. La barra cambia a amarillo al 80% y rojo al superar el límite. Los familiares pueden ver el desglose real vs planificado.</div></div>`;
  content.innerHTML=html;
}

/* ════ TAB RENDICIÓN ════ */
function renderRendicion(gastos, presupuesto, esFamiliar, esAdmin){
  const content=$('gastos-content');
  const gastosMes=gastos.filter(g=>g.fecha?.startsWith(ST.gastos.mesVista));
  const total=gastosMes.reduce((s,g)=>s+g.monto,0);
  const pendientes=gastosMes.filter(g=>g.aprobacion==='pendiente');
  const aprobados=gastosMes.filter(g=>g.aprobacion==='aprobado');

  // Resumen por categoría
  const porCat={};
  gastosMes.forEach(g=>{ if(!porCat[g.cat]) porCat[g.cat]=0; porCat[g.cat]+=g.monto; });

  const resumenTexto=`Rendición de gastos · ${mesLabel(ST.gastos.mesVista)}\n\nTotal gastado: ${fmt(total)} de ${fmt(presupuesto)} presupuestados.\n\nPor categoría:\n`+
    Object.entries(porCat).map(([c,m])=>`· ${CATS[c]?.label||c}: ${fmt(m)}`).join('\n')+
    `\n\nTotal: ${fmt(total)} · ${Math.round(total/presupuesto*100)}% del presupuesto.`;

  let html=`
    <div class="rendicion-box">
      <div class="rb-titulo">📊 Resumen de ${mesLabel(ST.gastos.mesVista)}</div>
      ${Object.entries(porCat).map(([cat,monto])=>{
        const conf=CATS[cat]||CATS.otro;
        return `<div class="rb-fila"><span class="rb-key">${conf.ico} ${conf.label}</span><span class="rb-val">${fmt(monto)}</span></div>`;
      }).join('')}
      <div class="rb-fila" style="font-size:14px;margin-top:4px">
        <span class="rb-key">TOTAL DEL MES</span>
        <span class="rb-val" style="color:var(--sage-dk)">${fmt(total)}</span>
      </div>
      <div class="rb-fila" style="border:none;padding-top:6px">
        <span class="rb-key" style="font-weight:400;font-size:12px">Presupuesto: ${fmt(presupuesto)}</span>
        <span style="font-size:12px;color:${total<=presupuesto?'var(--sage)':'var(--red)'};font-weight:600">${total<=presupuesto?'✓ Dentro del presupuesto':'⚠ Sobre el presupuesto'}</span>
      </div>
    </div>

    <!-- Botones de compartir -->
    <div style="display:flex;gap:10px;padding:0 16px 14px">
      <button onclick="enviarRendicionWA('${encodeURIComponent(resumenTexto)}')" style="flex:1;padding:12px;background:var(--sage);color:#fff;border:none;border-radius:var(--rs);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">💬 WhatsApp</button>
      <button onclick="copiarRendicion()" style="flex:1;padding:12px;background:var(--white);color:var(--sage);border:1.5px solid var(--sage-md);border-radius:var(--rs);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">📋 Copiar</button>
    </div>`;

  // Gastos pendientes de aprobación (familiar puede aprobar)
  if(pendientes.length){
    html+=`<div class="slbl">Pendientes de aprobación (${pendientes.length})</div>`;
    pendientes.forEach(g=>{
      const conf=CATS[g.cat]||CATS.otro;
      html+=`
        <div class="aprobacion-card">
          <div class="ac-header">
            <span style="font-size:16px">${conf.ico}</span>
            <div class="ac-gasto-desc">${escapeHtml(g.desc)}</div>
            <div class="ac-monto">${fmt(g.monto)}</div>
          </div>
          <div style="font-size:11px;color:var(--ink3);padding:6px 14px;border-bottom:1px solid var(--line)">${conf.label}${g.nota?' · '+escapeHtml(g.nota):''} · ${g.fecha||'—'}</div>
          ${esFamiliar||esAdmin?`
          <div class="ac-btns">
            <button class="ac-btn ac-aprobar" onclick="aprobarGasto('${g.id}',true)">✓ Aprobar</button>
            <button class="ac-btn ac-rechazar" onclick="aprobarGasto('${g.id}',false)">✗ Rechazar</button>
          </div>`:`<div style="padding:10px 14px;font-size:12px;color:var(--ink3)">Esperando aprobación del familiar</div>`}
        </div>`;
    });
  }

  if(aprobados.length){
    html+=`<div class="slbl">Gastos aprobados este mes (${aprobados.length})</div>`;
    html+=`<div style="background:var(--white);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">`;
    aprobados.forEach(g=>{
      const conf=CATS[g.cat]||CATS.otro;
      html+=`<div class="gasto-row" style="cursor:default">
        <div class="gasto-ico" style="background:${conf.bg}">${conf.ico}</div>
        <div style="flex:1"><div class="gasto-desc">${escapeHtml(g.desc)}</div><div class="gasto-meta">${conf.label} · ${g.fecha||'—'}</div></div>
        <div class="gasto-monto">${fmt(g.monto)}</div>
        <span class="badge b-ok">✓</span>
      </div>`;
    });
    html+=`</div>`;
  }

  if(!gastosMes.length){
    html+=`<div class="empty"><div class="empty-ico">📋</div><div class="empty-title">Sin gastos en ${mesLabel(ST.gastos.mesVista)}</div><div class="empty-txt">La rendición estará disponible cuando se registren gastos.</div></div>`;
  }

  // Variable global para copiar
  window._resumenRendicion=resumenTexto;
  html+=`<div style="height:80px"></div>`;
  content.innerHTML=html;
}

/* ════ SHEET GASTO ════ */
let _catActual='medicamentos';
function selCat(btn){
  _catActual=btn.dataset.cat;
  document.querySelectorAll('#cat-grid-gasto .cat-btn').forEach(b=>{
    const conf=CATS[b.dataset.cat]||CATS.otro;
    const on=b.dataset.cat===_catActual;
    b.classList.toggle('on',on);
    b.style.borderColor=on?conf.color:'';
    b.style.background=on?conf.bg:'';
    b.querySelector('.cat-lbl').style.color=on?conf.color:'';
  });
}

function abrirSheetGasto(){
  ST.gastos.gastoEditandoId=null;
  $('sh-gasto-titulo').textContent='Registrar gasto';
  $('g-monto').value=''; $('g-desc').value='';
  $('g-fecha').value=hoy(); $('g-aprobacion').value='no';
  limpiarBoleta(); // Reset imagen de boleta
  _catActual='medicamentos';
  document.querySelectorAll('#cat-grid-gasto .cat-btn').forEach((b,i)=>{ b.classList.toggle('on',i===0); b.style.borderColor=''; b.style.background=''; });
  selCat(document.querySelector('#cat-grid-gasto .cat-btn'));
  $('btn-del-gasto').style.display='none';
  $('ov-gasto').classList.add('open');
  setTimeout(()=>$('g-monto').focus(),300);
}

function editarGasto(id){
  const comp=DB.getCompartido();
  const g=(comp.gastos||[]).find(x=>x.id===id); if(!g) return;
  ST.gastos.gastoEditandoId=id;
  $('sh-gasto-titulo').textContent='Editar gasto';
  $('g-monto').value=g.monto||0;
  $('g-desc').value=g.desc||'';
  $('g-fecha').value=g.fecha||hoy();
  $('g-aprobacion').value=g.aprobacion||'no';
  cargarBoletaExistente(g.boleta||null); // Mostrar boleta si existe
  _catActual=g.cat||'otro';
  document.querySelectorAll('#cat-grid-gasto .cat-btn').forEach(b=>{ b.classList.remove('on'); b.style.borderColor=''; b.style.background=''; });
  const catBtn=document.querySelector(`#cat-grid-gasto [data-cat="${_catActual}"]`)||document.querySelector('#cat-grid-gasto .cat-btn');
  if(catBtn) selCat(catBtn);
  $('btn-del-gasto').style.display='block';
  $('ov-gasto').classList.add('open');
}

function guardarGasto(){
  const monto=parseInt($('g-monto').value);
  if(!monto||monto<=0){ toast('Ingresa un monto válido','err'); return; }
  const desc=$('g-desc').value.trim();
  if(!desc){ toast('Escribe una descripción','err'); return; }
  if(_bloqueadoPorDobleClick('gasto')) return;
  const c=DB.getCuidado(); if(!c) return;
  const comp=DB.getCompartido();
  if(!Array.isArray(comp.gastos)) comp.gastos=[];
  const data={
    cat:_catActual, desc, monto,
    fecha:$('g-fecha').value||hoy(),
    boleta: _boletaDataUrl||null,
    aprobacion:$('g-aprobacion').value,
    emoji:CATS[_catActual]?.ico||'📦',
  };
  if(ST.gastos.gastoEditandoId){
    const idx=comp.gastos.findIndex(g=>g.id===ST.gastos.gastoEditandoId);
    if(idx>=0) comp.gastos[idx]={...comp.gastos[idx],...data};
    toast('✓ Gasto actualizado','ok');
  } else {
    comp.gastos.push({id:'g-'+Date.now(),...data});
    toast('✓ Gasto registrado','ok');
  }
  DB.saveCompartido(comp);
  cerrarSheet('ov-gasto');
  renderTabGastos('registro');
}

function eliminarGasto(id){
  confirmar('¿Eliminar este gasto?','Se eliminará del registro permanentemente.',()=>{
    const compE=DB.getCompartido();
    compE.gastos=(compE.gastos||[]).filter(g=>g.id!==id);
    DB.saveCompartido(compE); toast('Gasto eliminado'); renderTabGastos('registro');
  });
}

function eliminarGastoActual(){
  if(!ST.gastos.gastoEditandoId) return;
  cerrarSheet('ov-gasto');
  eliminarGasto(ST.gastos.gastoEditandoId);
}

/* ════ APROBACIÓN ════ */
function aprobarGasto(id,aprueba){
  const comp=DB.getCompartido();
  const g=(comp.gastos||[]).find(x=>x.id===id); if(!g) return;
  g.aprobacion=aprueba?'aprobado':'rechazado';
  DB.saveCompartido(comp);
  toast(aprueba?'✓ Gasto aprobado':'Gasto rechazado', aprueba?'ok':'err');
  renderTabGastos('rendicion');
}

/* ════ PRESUPUESTO ════ */
function abrirEditarPresupuesto(){
  $('pres-total').value=DB.getCuidado()?.presupuesto||150000;
  $('ov-presupuesto').classList.add('open');
  setTimeout(()=>$('pres-total').focus(),300);
}
function guardarPresupuesto(){
  const v=parseInt($('pres-total').value);
  if(!v||v<=0){ toast('Ingresa un monto válido','err'); return; }
  const comp=DB.getCompartido();
  comp.presupuesto=v;
  DB.saveCompartido(comp);
  cerrarSheet('ov-presupuesto');
  toast('✓ Presupuesto actualizado','ok');
  renderTabGastos(ST.alimentacion.tab);
}
function guardarPresupuestoCat(cat,val){
  const comp=DB.getCompartido();
  if(!comp.presupuestoCats) comp.presupuestoCats={};
  comp.presupuestoCats[cat]=parseInt(val)||0;
  DB.saveCompartido(comp);
}

/* ════ COMPARTIR RENDICIÓN ════ */
function enviarRendicionWA(txt){ window.open('https://wa.me/?text='+txt,'_blank'); }
function copiarRendicion(){
  const txt=window._resumenRendicion||'';
  if(navigator.clipboard){
    navigator.clipboard.writeText(txt).then(()=>toast('✓ Texto copiado','ok'));
  } else {
    const ta=document.createElement('textarea');
    ta.value=txt; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast('✓ Texto copiado','ok');
  }
}

/* ── SHEETS / CONFIRM ── */

$('cb-ok').onclick=()=>{ $('confirm-ov').classList.remove('open'); if(_cb)_cb(); };

/* ════ QA ════ */

/* ════ INIT ════ */


/* ════════════════════════════════════════
   MÓDULO 10 — INFORME MENSUAL IA
   ════════════════════════════════════════ */


/* ── DATOS ── */

/* ── ESTADO ── */

/* ── HELPERS ── */

const MESES_CAP=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];





function mesActual(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

/* ── NAVEGACIÓN ── */

/* ── SIDEBAR ── */

/* ════ HUB DE INFORMES ════ */
function renderHub(){
  const s=DB.getSesion(); if(!s) return;
  const c=DB.getCuidado(); if(!c) return;
  const am=c.am||{};
  const informes=(c.informes||[]).sort((a,b)=>b.mes.localeCompare(a.mes));
  const puedeGenerar=['admin','familiar'].includes(s.rol);
  const mesHoy=mesActual();
  const informeEstesMes=informes.find(i=>i.mes===mesHoy);

  // Recopilar estadísticas del mes para las pills del hero
  const bitMes=(c.bitacoras||[]).filter(b=>b.fecha?.startsWith(mesHoy));
  const comp10=DB.getCompartido();
  const gastosMes=(comp10.gastos||[]).filter(g=>g.fecha?.startsWith(mesHoy));
  const totalGastos=gastosMes.reduce((s,g)=>s+g.monto,0);
  const meds=c.meds||[];
  const diasConRegistro=new Set(bitMes.map(b=>b.fecha)).size;

  const body=$('inf-hub-body');
  let html=`
    <div class="gen-hero">
      <div class="gh-label">${escapeHtml(am.nombre)||'la persona cuidada'} · ${mesLabel(mesHoy)}</div>
      <div class="gh-title">Informe mensual con IA</div>
      <div class="gh-pills">
        <div class="gh-pill"><div class="gh-dot" style="background:#A8F0D8"></div>${diasConRegistro} días en bitácora</div>
        <div class="gh-pill"><div class="gh-dot" style="background:#A8F0D8"></div>${meds.length} medicamentos</div>
        <div class="gh-pill"><div class="gh-dot" style="background:#A8F0D8"></div>${fmt(totalGastos)} gastados</div>
      </div>
      ${puedeGenerar?`<button class="gh-btn" onclick="iniciarGeneracion()">
        ${informeEstesMes?'✦ Regenerar informe del mes':'✦ Generar informe de '+mesLabel(mesHoy)}
      </button>`:`<div style="font-size:13px;color:rgba(255,255,255,.7)">El administrador genera el informe cada mes.</div>`}
    </div>`;

  if(informes.length){
    html+=`<div class="slbl">Informes anteriores</div>`;
    informes.forEach(inf=>{
      html+=`
        <div class="informe-card" onclick="verInforme('${inf.id}')">
          <div class="ic-ico">📊</div>
          <div style="flex:1">
            <div class="ic-mes">${mesLabel(inf.mes)}</div>
            <div class="ic-meta">${inf.diasRegistro||0} días · ${inf.numMeds||0} meds · Generado el ${inf.generadoEl||'—'}</div>
            <div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap">
              ${inf.enviado?`<span class="badge b-ok">✓ Enviado</span>`:''}
              ${inf.archivado?`<span class="badge b-muted">Archivado</span>`:''}
            </div>
          </div>
          <div class="ic-right">
            <span class="badge b-info">Ver →</span>
            ${puedeGenerar?`<button class="ic-del" onclick="event.stopPropagation();eliminarInforme('${inf.id}')">Eliminar</button>`:''}
          </div>
        </div>`;
    });
  } else {
    html+=`
      <div class="empty">
        <div class="empty-ico">📊</div>
        <div class="empty-title">Sin informes generados</div>
        <div class="empty-txt">${puedeGenerar?'Genera el primer informe del mes. La IA analiza todos los datos del cuidado automáticamente.':'El administrador aún no ha generado ningún informe.'}</div>
      </div>`;
  }
  html+=`
    <div class="ia" style="margin:14px 16px 80px">
      <div class="ia-ico">✦</div>
      <div>El informe mensual reúne bitácoras, medicamentos, gastos, eventos y alimentación en un documento completo. Viene en versión familiar (lenguaje simple) y versión clínica (para el médico).</div>
    </div>`;
  body.innerHTML=html;
}

/* ════ GENERACIÓN DEL INFORME ════ */
function iniciarGeneracion(){
  ST.informe.mesGenerando=mesActual();
  navTo('s-generando');

  const pasos=['gp-0','gp-1','gp-2','gp-3','gp-4'];
  const duraciones=[800,700,700,600,900]; // ms por paso
  let actual=0, acum=0;

  function avanzar(){
    if(actual>0) $('gp-'+(actual-1))?.classList.replace('activo','listo');
    if(actual<pasos.length){
      $('gp-'+actual)?.classList.add('activo');
      actual++;
      acum+=duraciones[actual-1];
      const pct=Math.round(acum/duraciones.reduce((a,b)=>a+b,0)*100);
      $('gen-fill').style.width=pct+'%';
      $('gen-pct').textContent=pct+'%';
      setTimeout(avanzar, duraciones[actual-1]);
    } else {
      // Completado
      $('gen-fill').style.width='100%';
      $('gen-pct').textContent='100%';
      setTimeout(()=>{
        const informe=generarInformeIA();
        mostrarInforme(informe);
      }, 500);
    }
  }
  // Reset pasos
  pasos.forEach(id=>{ const el=$(id); if(el){ el.classList.remove('activo','listo'); }});
  $('gen-fill').style.width='0%';
  $('gen-pct').textContent='0%';
  setTimeout(avanzar, 300);
}

/* ════ GENERADOR DE INFORME IA ════ */
function generarInformeIA(){
  // Cálculo 100% local basado en reglas fijas — no realiza ninguna llamada a un modelo de IA/LLM real.
  const c=DB.getCuidado();
  const am=c?.am||{};
  const mes=ST.informe.mesGenerando||mesActual();
  const [anio,mesNum]=mes.split('-').map(Number);

  // Datos del mes
  const bitMes=(c?.bitacoras||[]).filter(b=>b.fecha?.startsWith(mes));
  const gastosMes=(c?.gastos||[]).filter(g=>g.fecha?.startsWith(mes));
  const eventosMes=(c?.eventos||[]).filter(e=>e.fecha?.startsWith(mes));
  const meds=c?.meds||[];
  const equipo=(c?.equipo||[]).filter(p=>p.categoria==='cuidadora');
  const presupuesto=c?.presupuesto||150000;
  const totalGastos=gastosMes.reduce((s,g)=>s+g.monto,0);

  // Calcular métricas
  const diasRegistro=new Set(bitMes.map(b=>b.fecha)).size;
  const totalDiasMes=new Date(anio,mesNum,0).getDate();

  // Promedio de presión (de los que tienen datos)
  const presiones=bitMes.filter(b=>b.presion&&/\d+\/\d+/.test(b.presion)).map(b=>{
    const [s]=b.presion.split('/').map(Number); return s;
  });
  const presionProm=presiones.length?Math.round(presiones.reduce((a,b)=>a+b,0)/presiones.length):null;

  // Adherencia alimentación
  const bitConAlmuerzo=bitMes.filter(b=>b.almuerzo==='Todo').length;
  const pctComio=diasRegistro>0?Math.round(bitConAlmuerzo/diasRegistro*100):0;

  // Ánimo predominante
  const animoCounts={};
  bitMes.forEach(b=>{ if(b.animo) animoCounts[b.animo]=(animoCounts[b.animo]||0)+1; });
  const animoPred=Object.entries(animoCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'No registrado';

  // Gastos por categoría
  const porCat={};
  gastosMes.forEach(g=>{ if(!porCat[g.cat]) porCat[g.cat]=0; porCat[g.cat]+=g.monto; });

  // Notas relevantes de la bitácora
  const notasRelevantes=bitMes.filter(b=>b.nota&&b.nota.length>15).slice(-3).map(b=>b.nota);

  // Construir el informe
  const informe = {
    id: 'inf-'+Date.now(),
    mes,
    generadoEl: new Date().toLocaleDateString('es-CL'),
    am: { ...am },
    diasRegistro,
    totalDiasMes,
    numMeds: meds.length,
    presionProm,
    pctComio,
    animoPred,
    totalGastos,
    presupuesto,
    porCat,
    eventosMes: eventosMes.map(e=>({titulo:e.titulo,fecha:e.fecha,tipo:e.tipo})),
    equipo: equipo.map(p=>p.nombre),
    notasRelevantes,
    archivado: false,
    enviado: false,

    // Textos generados por IA
    resumenFamiliar: generarResumenFamiliar(am, diasRegistro, totalDiasMes, presionProm, pctComio, animoPred, totalGastos, presupuesto, eventosMes, meds),
    resumenClinico: generarResumenClinico(am, bitMes, meds, presionProm, pctComio, eventosMes),
    sugerenciasIA: generarSugerencias(presionProm, pctComio, totalGastos, presupuesto),
  };

  // Guardar en el cuidado
  if(!Array.isArray(c.informes)) c.informes=[];
  // Reemplazar si ya existe del mismo mes
  const idx=c.informes.findIndex(i=>i.mes===mes);
  if(idx>=0) c.informes[idx]=informe; else c.informes.push(informe);
  DB.saveCuidado(c);

  return informe;
}

function generarResumenFamiliar(am, diasR, diasT, presion, pctComio, animo, gastos, pres, eventos, meds){
  const nombre=am.nombre||'la persona cuidada';
  const mes=MESES[new Date().getMonth()];
  let txt=`Durante ${mes}, ${nombre} estuvo bajo cuidado durante ${diasR} de ${diasT} días del mes.\n\n`;

  txt+=`**Estado general:** ${animo.includes('bien')||animo.includes('Muy')?`${nombre} mostró un estado de ánimo positivo durante la mayor parte del mes.`:`Hubo días con ánimo variable — ${animo.toLowerCase()} fue lo más frecuente registrado.`}\n\n`;

  if(presion) txt+=`**Signos vitales:** La presión arterial promedio fue ${presion} mmHg. ${presion>140?'Se recomienda monitorear de cerca con el médico tratante.':presion<90?'Los valores estuvieron algo bajos — revisarlo con el médico.':'Los valores estuvieron dentro del rango esperado para su condición.'}\n\n`;

  txt+=`**Alimentación:** ${pctComio}% de los días registrados comió el almuerzo completo. ${pctComio>=80?'Buen apetito durante el mes.':pctComio>=50?'Apetito variable — algunos días comió menos de lo esperado.':'El apetito estuvo bajo varios días. Se recomienda revisarlo con el médico.'}\n\n`;

  if(eventos.length) txt+=`**Citas del mes:** Tuvo ${eventos.length} evento${eventos.length>1?'s':''} médico${eventos.length>1?'s':''}${eventos.length>0?': '+eventos.slice(0,2).map(e=>e.titulo).join(', ')+'.':''}\n\n`;

  txt+=`**Medicamentos:** Tiene ${meds.length} medicamento${meds.length>1?'s':''} en tratamiento activo.\n\n`;

  txt+=`**Gastos del mes:** Se gastaron ${_fmt(gastos)} de un presupuesto de ${_fmt(pres)}. ${gastos<=pres?'El cuidado estuvo dentro del presupuesto.':'El gasto superó el presupuesto — revisar con la familia.'}`;

  return txt;
}

function generarResumenClinico(am, bitMes, meds, presionProm, pctComio, eventos){
  const nombre=am.nombre||'Paciente';
  const edad=am.edad||'—';
  const conds=(am.condiciones||[]).join(', ')||'No especificadas';
  let txt=`INFORME CLÍNICO MENSUAL\n`;
  txt+=`Paciente: ${nombre}, ${edad} años\n`;
  txt+=`Diagnósticos: ${conds}\n`;
  txt+=`Médico de cabecera: ${am.medico||'No especificado'}\n`;
  txt+=`─────────────────────────────────\n\n`;

  txt+=`ADHERENCIA TERAPÉUTICA\n`;
  txt+=`Medicamentos activos: ${meds.length}\n`;
  meds.forEach(m=>{ txt+=`  · ${m.nombre} ${m.dosis} — ${m.freq}\n`; });
  txt+=`\n`;

  txt+=`SIGNOS VITALES (registros del período)\n`;
  const presiones=bitMes.filter(b=>b.presion).map(b=>b.presion);
  if(presiones.length) txt+=`Presión arterial: ${presiones.join(', ')}\nPromedio sistólico: ${presionProm||'—'} mmHg\n`;
  const temps=bitMes.filter(b=>b.temp).map(b=>b.temp+'°C');
  if(temps.length) txt+=`Temperatura: ${temps.join(', ')}\n`;
  const satos=bitMes.filter(b=>b.sato).map(b=>b.sato+'%');
  if(satos.length) txt+=`SpO₂: ${satos.join(', ')}\n`;
  txt+=`\n`;

  txt+=`ESTADO NUTRICIONAL\n`;
  txt+=`Días con almuerzo completo: ${Math.round(pctComio/100*bitMes.length)} de ${bitMes.length} registros (${pctComio}%)\n`;
  if(am.restricciones?.length) txt+=`Restricciones vigentes: ${(Array.isArray(am.restricciones)?am.restricciones:[am.restricciones]).join(', ')}\n`;
  txt+=`\n`;

  txt+=`EVENTOS CLÍNICOS DEL PERÍODO\n`;
  if(eventos.length) eventos.forEach(e=>{ txt+=`  · ${e.fecha||'—'} — ${e.titulo}\n`; });
  else txt+=`Sin eventos registrados en el período.\n`;
  txt+=`\n`;

  txt+=`ALERTAS Y OBSERVACIONES\n`;
  if(presionProm&&presionProm>140) txt+=`⚠ Hipertensión: presión promedio ${presionProm} mmHg — requiere evaluación.\n`;
  if(pctComio<50) txt+=`⚠ Ingesta alimentaria reducida (<50% días). Evaluar causa.\n`;
  const stockBajos=(meds||[]).filter(m=>m.stock<=5);
  if(stockBajos.length) txt+=`⚠ Stock bajo: ${stockBajos.map(m=>m.nombre).join(', ')}. Renovar receta.\n`;
  if(!presionProm&&!pctComio) txt+=`Sin alertas registradas en el período.\n`;

  return txt;
}

function generarSugerencias(presion, pctComio, gastos, pres){
  const sugs=[];
  if(presion&&presion>140) sugs.push({ico:'❤️',txt:`Presión promedio alta (${presion} mmHg). Considerar ajuste de dosis con el cardiólogo.`});
  if(pctComio<60) sugs.push({ico:'🍽️',txt:`El apetito estuvo bajo este mes (${pctComio}% de días con almuerzo completo). Revisar con nutricionista.`});
  if(gastos>pres) sugs.push({ico:'🧾',txt:`El gasto superó el presupuesto en ${_fmt(gastos-pres)}. Revisar categorías con la familia.`});
  if(sugs.length===0) sugs.push({ico:'✓',txt:`El mes transcurrió dentro de los parámetros esperados. Mantener la rutina actual.`});
  sugs.push({ico:'📅',txt:`Programar el control médico mensual para ${MESES_CAP[(new Date().getMonth()+1)%12]}.`});
  return sugs;
}

function _fmt(n){ return '$'+Number(n||0).toLocaleString('es-CL'); }

/* ════ VER INFORME ════ */
function mostrarInforme(informe){
  ST.informe.informeActual=informe;
  ST.informe.version='familiar';

  // Header
  const am=informe.am||{};
  $('inf-det-titulo').textContent=`Informe de ${mesLabel(informe.mes)}`;
  $('inf-det-sub').textContent=`${am.nombre||'—'} · ${am.edad||'—'} años`;
  $('inf-det-pills').innerHTML=[
    `<span class="ih-pill">${informe.diasRegistro} días registrados</span>`,
    `<span class="ih-pill">${informe.numMeds} medicamentos</span>`,
    `<span class="ih-pill">${_fmt(informe.totalGastos)} gastados</span>`,
  ].join('');

  // Actualizar selector de versión
  $('vtab-familiar').classList.add('on');
  $('vtab-clinico').classList.remove('on');

  navTo('s-informe-detalle');
  renderContenidoInforme('familiar');
}

function verInforme(id){
  const c=DB.getCuidado(); if(!c) return;
  const inf=(c.informes||[]).find(i=>i.id===id); if(!inf) return;
  mostrarInforme(inf);
}

function selVersion(v){
  ST.informe.version=v;
  $('vtab-familiar').classList.toggle('on',v==='familiar');
  $('vtab-clinico').classList.toggle('on',v==='clinico');
  renderContenidoInforme(v);
}

function renderContenidoInforme(version){
  const inf=ST.informe.informeActual; if(!inf) return;
  const body=$('inf-det-body');

  if(version==='familiar'){
    // Renderizar el texto familiar con formato markdown básico
    const texto=inf.resumenFamiliar||'Sin contenido';
    const html=texto.split('\n\n').map(parrafo=>{
      if(!parrafo.trim()) return '';
      if(parrafo.startsWith('**')&&parrafo.includes(':**')){
        const titulo=parrafo.match(/\*\*([^*]+)\*\*/)?.[1]||'';
        const contenido=parrafo.replace(/^\*\*[^*]+\*\*\s*/,'');
        return `<div class="inf-seccion"><div class="is-titulo">${seccionIco(titulo)} ${titulo}</div><div class="is-texto">${contenido}</div></div>`;
      }
      return `<div class="inf-seccion"><div class="is-texto">${parrafo}</div></div>`;
    }).join('');

    // Métricas visuales
    const metricas=`
      <div class="inf-seccion">
        <div class="is-titulo">📊 Métricas del mes</div>
        <div class="metricas-grid">
          <div class="metrica${inf.diasRegistro>=15?' ok':' warn'}">
            <div class="metrica-n">${inf.diasRegistro}</div>
            <div class="metrica-l">Días en bitácora</div>
          </div>
          <div class="metrica${inf.pctComio>=70?' ok':inf.pctComio>=40?' warn':''}">
            <div class="metrica-n">${inf.pctComio}%</div>
            <div class="metrica-l">Comió completo</div>
          </div>
          <div class="metrica${inf.presionProm&&inf.presionProm<=140?' ok':inf.presionProm?' warn':''}">
            <div class="metrica-n">${inf.presionProm||'—'}</div>
            <div class="metrica-l">Presión promedio</div>
          </div>
          <div class="metrica">
            <div class="metrica-n">${inf.eventosMes?.length||0}</div>
            <div class="metrica-l">Citas médicas</div>
          </div>
          <div class="metrica${inf.totalGastos<=inf.presupuesto?' ok':' warn'}">
            <div class="metrica-n">${Math.round(inf.totalGastos/inf.presupuesto*100)}%</div>
            <div class="metrica-l">Del presupuesto</div>
          </div>
          <div class="metrica ok">
            <div class="metrica-n">${inf.numMeds}</div>
            <div class="metrica-l">Medicamentos</div>
          </div>
        </div>
      </div>`;

    // Sugerencias IA
    const sugs=inf.sugerenciasIA||[];
    const sugsHtml=sugs.length?`
      <div class="inf-seccion" style="background:var(--sage-lt);border:1px solid var(--sage-md);border-radius:var(--rs);margin:0 14px 14px">
        <div class="is-titulo">✦ Sugerencias de seguimiento</div>
        ${sugs.map(s=>`<div class="inf-item"><div class="inf-dot" style="background:var(--sage)"></div><span>${s.ico} ${s.txt}</span></div>`).join('')}
      </div>`:'';

    // Notas de bitácora
    const notasHtml=inf.notasRelevantes?.length?`
      <div class="inf-seccion">
        <div class="is-titulo">📋 Notas destacadas de la bitácora</div>
        ${inf.notasRelevantes.map(n=>`<div class="inf-item"><div class="inf-dot" style="background:var(--blue)"></div><span>${n}</span></div>`).join('')}
      </div>`:'';

    body.innerHTML=metricas+html+sugsHtml+notasHtml+`<div style="height:20px"></div>`;

  } else {
    // Versión clínica
    const texto=inf.resumenClinico||'Sin contenido';
    body.innerHTML=`
      <div class="inf-seccion">
        <div style="background:var(--blue-lt);border:1px solid #B5CAEA;border-radius:var(--rs);padding:10px 14px;margin-bottom:12px;font-size:12px;color:var(--blue)">
          🩺 <strong>Versión clínica</strong> — Formato estructurado para compartir con médicos o especialistas.
        </div>
        <pre class="is-texto clinico" style="white-space:pre-wrap;word-wrap:break-word">${texto}</pre>
      </div>
      <div style="height:20px"></div>`;
  }
}

function seccionIco(titulo){
  const map={'Estado general':'😊','Signos vitales':'❤️','Alimentación':'🍽️','Citas del mes':'📅','Medicamentos':'💊','Gastos del mes':'🧾'};
  return map[titulo]||'•';
}

/* ════ ACCIONES DEL INFORME ════ */
function compartirInformeWA(){
  const inf=ST.informe.informeActual; if(!inf) return;
  const am=inf.am||{};
  const texto=`🌿 *Informe Mensual · ${mesLabel(inf.mes)}*\n*${am.nombre||'la persona cuidada'} · ${am.edad||'—'} años*\n\n${inf.resumenFamiliar?.replace(/\*\*/g,'')||'—'}\n\n_Generado por Raíz_`;
  window.open('https://wa.me/?text='+encodeURIComponent(texto),'_blank');
  // Marcar como enviado
  marcarInformeEnviado(inf.id);
  toast('Abriendo WhatsApp...','ok');
}

function copiarInforme(){
  const inf=ST.informe.informeActual; if(!inf) return;
  const am=inf.am||{};
  const texto=ST.informe.version==='familiar'
    ? `Informe Mensual · ${mesLabel(inf.mes)}\n${am.nombre||'—'} · ${am.edad||'—'} años\n\n${inf.resumenFamiliar?.replace(/\*\*/g,'')||'—'}`
    : inf.resumenClinico||'—';
  if(navigator.clipboard){
    navigator.clipboard.writeText(texto).then(()=>toast('✓ Informe copiado','ok'));
  } else {
    const ta=document.createElement('textarea');
    ta.value=texto; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast('✓ Informe copiado','ok');
  }
}

function archivarInforme(){
  const inf=ST.informe.informeActual; if(!inf) return;
  confirmar('¿Archivar este informe?','Quedará marcado como archivado en el historial.',()=>{
    const c=DB.getCuidado(); if(!c) return;
    const i=(c.informes||[]).find(x=>x.id===inf.id);
    if(i){ i.archivado=true; DB.saveCuidado(c); }
    toast('✓ Informe archivado','ok');
    navTo('s-informe-hub');
  });
}

function marcarInformeEnviado(id){
  const c=DB.getCuidado(); if(!c) return;
  const inf=(c.informes||[]).find(i=>i.id===id);
  if(inf){ inf.enviado=true; DB.saveCuidado(c); }
}

function eliminarInforme(id){
  confirmar('¿Eliminar este informe?','Se eliminará del historial permanentemente.',()=>{
    const c=DB.getCuidado(); if(!c) return;
    c.informes=(c.informes||[]).filter(i=>i.id!==id);
    DB.saveCuidado(c);
    toast('Informe eliminado');
    renderHub();
  });
}

/* ── CONFIRM ── */

$('cb-ok').onclick=()=>{ $('confirm-ov').classList.remove('open'); if(_cb)_cb(); };

/* ════ QA ════ */

/* ════ INIT ════ */


/* ════════════════════════════════════════════
   MÓDULO — INVITACIONES Y ACCESOS
   Permite al admin invitar familiares, cuidadoras
   y observadores mediante código de 6 dígitos.
   ════════════════════════════════════════════ */

let _invCodigoActual = null; // Código generado en el sheet

/* Generar código aleatorio de 6 dígitos */
function generarCodigo6(){
  return String(Math.floor(100000 + Math.random() * 900000));
}

/* Abrir el sheet de nueva invitación */
function abrirSheetInvitacion(){
  const s = DB.getSesion(); if(!s || s.rol !== 'admin') return;
  _invCodigoActual = null;

  // Reset formulario
  $('inv-nombre-input').value = '';
  $('inv-email-input').value = '';
  $('inv-rol-select').value = 'familiar';
  $('inv-codigo-preview').style.display = 'none';
  $('inv-btns-crear').style.display = 'flex';
  $('inv-btns-listo').style.display = 'none';
  $('sh-inv-titulo').textContent = 'Invitar persona';

  // Rellenar selector de Cuidado
  const cuidados = DB.getCuidadosAdmin();
  const sel = $('inv-cuidado-select');
  const wrap = $('inv-selector-cuidado');
  if(cuidados.length <= 1){
    wrap.style.display = 'none';
  } else {
    wrap.style.display = 'block';
    sel.innerHTML = cuidados.map(c =>
      `<option value="${c.id}">${escapeHtml(c.am?.nombre)||'Sin nombre'}</option>`
    ).join('');
  }

  $('ov-invitacion').classList.add('open');
  setTimeout(() => $('inv-nombre-input').focus(), 300);
}

/* Crear la invitación y mostrar el código */
function crearInvitacion(){
  const s = DB.getSesion(); if(!s || s.rol !== 'admin') return;
  const nombre = $('inv-nombre-input').value.trim();
  const email  = $('inv-email-input').value.trim().toLowerCase();
  const rol    = $('inv-rol-select').value;

  if(!nombre){ toast('Escribe el nombre de la persona','err'); return; }
  if(email && !email.includes('@')){ toast('Email inválido','err'); return; }

  // Determinar cuidadoId
  const cuidados = DB.getCuidadosAdmin();
  const cuidadoId = cuidados.length > 1
    ? $('inv-cuidado-select').value
    : (cuidados[0]?.id || s.cuidadoId);

  // Generar código único
  let codigo;
  const invs = DB.getInvs();
  do { codigo = generarCodigo6(); }
  while (invs.some(i => i.codigo === codigo));

  // Calcular expiración (7 días)
  const expira = new Date();
  expira.setDate(expira.getDate() + 7);

  const nuevaInv = {
    id: 'inv-' + Date.now(),
    codigo,
    rol,
    nombreInv: nombre,
    email: email || null,
    adminId: s.userId,
    cuidadoId,
    estado: 'pendiente',
    creado: hoy(),
    expira: expira.getFullYear()+'-'+String(expira.getMonth()+1).padStart(2,'0')+'-'+String(expira.getDate()).padStart(2,'0'),
  };

  DB.setInvs([...invs, nuevaInv]);
  // Guardar código en Firestore para que sea validable desde cualquier dispositivo
  _fsSet('codigos_inv/'+codigo, nuevaInv);
  _invCodigoActual = codigo;

  // Mostrar el código generado
  $('inv-codigo-numero').textContent = codigo;
  $('inv-codigo-preview').style.display = 'block';
  $('inv-btns-crear').style.display = 'none';
  $('inv-btns-listo').style.display = 'block';
  $('sh-inv-titulo').textContent = '✓ Invitación creada';

  toast('✓ Código generado — compártelo', 'ok');
}

/* Copiar el código al portapapeles */
function copiarCodigoInv(){
  if(!_invCodigoActual) return;
  const c = DB.getCuidado();
  const nombre = c?.am?.nombre || 'la persona cuidada';
  const texto = `Te invito a usar Raíz para coordinar el cuidado de ${nombre}.\n\nCódigo de acceso: ${_invCodigoActual}\n\nDescarga la app en raiz.app e ingresa este código para unirte.`;
  navigator.clipboard.writeText(texto).then(() => toast('✓ Código copiado','ok'));
}

/* Compartir por WhatsApp */
function compartirCodigoInv(){
  if(!_invCodigoActual) return;
  const c = DB.getCuidado();
  const nombre = c?.am?.nombre || 'la persona cuidada';
  const texto = encodeURIComponent(
    `Te invito a usar Raíz para coordinar el cuidado de ${nombre}.\n\nCódigo de acceso: *${_invCodigoActual}*\n\nDescarga la app en raiz.app e ingresa este código.`
  );
  window.open(`https://wa.me/?text=${texto}`, '_blank');
}

/* Renderizar el módulo completo */
function renderInvitaciones(){
  const s = DB.getSesion(); if(!s) return;
  const esAdmin = s.rol === 'admin';
  const invs = DB.getInvs().filter(i => i.adminId === s.userId);
  const usuarios = DB.getUsuarios();
  const cuidados = DB.getCuidadosAdmin();

  // Actualizar sub-título
  const c = DB.getCuidado();
  const sub = `${c?.am?.nombre||'la persona cuidada'} · ${esAdmin?'administra accesos':'acceso compartido'}`;
  if($('inv-sub')) $('inv-sub').textContent = sub;
  if($('inv-sub-d')) $('inv-sub-d').textContent = sub;

  // Mostrar/ocultar botón de invitar
  if($('inv-hdr-btn')) $('inv-hdr-btn').style.display = esAdmin ? 'block' : 'none';

  // ── Lista de personas con acceso activo ──────────────
  const accesos = usuarios.filter(u =>
    u.id !== s.userId &&
    (u.adminId === s.userId || u.cuidadoId === s.cuidadoId)
  );

  const listaAccesos = $('inv-accesos-lista');
  if(listaAccesos){
    if(!accesos.length){
      listaAccesos.innerHTML = `
        <div class="empty" style="padding:24px 18px">
          <div style="font-size:32px;margin-bottom:8px">👥</div>
          <div style="font-size:13px;color:var(--ink3)">Aún no has invitado a nadie.<br>Usa el botón "+ Invitar" para compartir el acceso.</div>
        </div>`;
    } else {
      listaAccesos.innerHTML = accesos.map(u => {
        const cuidadoU = cuidados.find(c => c.id === u.cuidadoId);
        return `
        <div style="display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid var(--line)">
          <div style="width:40px;height:40px;border-radius:50%;background:${ROL_COLOR[u.rol]||'var(--sage)'};
            display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">
            ${ROL_EMOJI[u.rol]||'👤'}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700;color:var(--ink)">${escapeHtml(u.nombre)}</div>
            <div style="font-size:12px;color:var(--ink3);margin-top:2px">${ROL_LABEL[u.rol]||u.rol}</div>
            ${cuidadoU && cuidados.length>1 ? `<div style="font-size:11px;color:var(--sage);margin-top:2px">🏷 ${escapeHtml(cuidadoU.am?.nombre)||'—'}</div>` : ''}
          </div>
          ${esAdmin ? `<button onclick="revocarAcceso('${u.id}')"
            style="padding:6px 12px;border-radius:var(--rs);background:var(--red-lt);
            border:1px solid var(--red);color:var(--red);font-size:12px;cursor:pointer;font-family:inherit">
            Revocar
          </button>` : ''}
        </div>`;
      }).join('');
    }
  }

  // ── Invitaciones pendientes ──────────────────────────
  const pendientes = invs.filter(i => i.estado === 'pendiente');
  const label = $('inv-pendientes-label');
  const listaPend = $('inv-pendientes-lista');

  if(label) label.style.display = pendientes.length ? 'block' : 'none';
  if(listaPend){
    listaPend.innerHTML = pendientes.map(inv => {
      const cuidadoInv = cuidados.find(c => c.id === inv.cuidadoId);
      const diasRestantes = Math.max(0, Math.ceil(
        (new Date(inv.expira+'T12:00') - new Date()) / (1000*60*60*24)
      ));
      return `
      <div style="display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid var(--line);background:var(--sage-lt)">
        <div style="width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,.08);
          display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
          ⏳
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:var(--ink)">${escapeHtml(inv.nombreInv)}</div>
          <div style="font-size:12px;color:var(--ink3);margin-top:2px">
            ${ROL_LABEL[inv.rol]||inv.rol} · Código:
            <span style="font-family:monospace;font-weight:800;letter-spacing:2px;color:var(--sage)">${inv.codigo}</span>
          </div>
          <div style="font-size:11px;color:${diasRestantes<=1?'var(--red)':'var(--ink3)'};margin-top:2px">
            ${diasRestantes > 0 ? `Expira en ${diasRestantes} día${diasRestantes!==1?'s':''}` : '⚠ Expirado'}
          </div>
          ${cuidadoInv && cuidados.length>1 ? `<div style="font-size:11px;color:var(--sage);margin-top:2px">🏷 ${escapeHtml(cuidadoInv.am?.nombre)||'—'}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <button onclick="reenviarInvitacion('${inv.codigo}')"
            style="padding:5px 10px;border-radius:var(--rs);background:var(--surf);
            border:1.5px solid var(--sage-md);color:var(--sage);font-size:11px;cursor:pointer;font-family:inherit;white-space:nowrap">
            Reenviar
          </button>
          ${esAdmin ? `<button onclick="cancelarInvitacion('${inv.id}')"
            style="padding:5px 10px;border-radius:var(--rs);background:var(--red-lt);
            border:1px solid var(--red);color:var(--red);font-size:11px;cursor:pointer;font-family:inherit">
            Cancelar
          </button>` : ''}
        </div>
      </div>`;
    }).join('');
  }
}

/* Revocar acceso a un usuario */
function revocarAcceso(uid){
  const s = DB.getSesion(); if(!s || s.rol !== 'admin') return;
  const u = DB.getUsuarios().find(x => x.id === uid);
  if(!u) return;
  confirmar(
    `¿Revocar acceso a ${u.nombre}?`,
    'Esta persona ya no podrá ver ni interactuar con el cuidado.',
    () => {
      // Marcar usuario como revocado (no eliminar para preservar historial)
      const usuarios = DB.getUsuarios().map(x =>
        x.id === uid ? {...x, revocado: true, rol: 'revocado'} : x
      );
      DB.setUsuarios(usuarios);
      toast(`✓ Acceso de ${u.nombre} revocado`, 'ok');
      renderInvitaciones();
    }
  );
}

/* Cancelar una invitación pendiente */
function cancelarInvitacion(invId){
  const s = DB.getSesion(); if(!s || s.rol !== 'admin') return;
  const invs = DB.getInvs();
  const inv = invs.find(i => i.id === invId);
  if(!inv) return;
  confirmar(
    `¿Cancelar la invitación de ${inv.nombreInv}?`,
    `El código ${inv.codigo} quedará inválido.`,
    () => {
      DB.setInvs(invs.map(i => i.id === invId ? {...i, estado: 'cancelada'} : i));
      toast('Invitación cancelada', 'ok');
      renderInvitaciones();
    }
  );
}

/* Reenviar / compartir el código de una invitación existente */
function reenviarInvitacion(codigo){
  _invCodigoActual = codigo;
  const inv = DB.getInvs().find(i=>i.codigo===codigo);
  const nombre = inv?.nombreInv || 'ahí';
  const c = DB.getCuidado();
  const nombreAM = c?.am?.nombre || 'la persona cuidada';
  const texto = encodeURIComponent(
    `Hola ${nombre}, te invito a usar Raíz para coordinar el cuidado de ${nombreAM}.\n\nTu código de acceso es: *${codigo}*\n\nDescarga la app en raiz.app e ingresa este código.`
  );
  window.open(`https://wa.me/?text=${texto}`, '_blank');
}


/* Reset de datos demo — para cuando localStorage tiene datos corruptos o de versión anterior */

/* ══ Módulo Medicamentos — Horarios y Stock ══ */

function calcularHorarios(horaInicio, frecuenciaHrs) {
  // Convierte hora inicio + frecuencia en array de horas del día
  if(!horaInicio || !frecuenciaHrs || frecuenciaHrs <= 0) return [horaInicio||'08:00'];
  const [h, m] = horaInicio.split(':').map(Number);
  const inicioMins = h * 60 + (m || 0);
  const horarios = [];
  let cursor = inicioMins;
  const minutosEnDia = 24 * 60;
  const maxTomas = Math.floor(minutosEnDia / (frecuenciaHrs * 60));
  for (let i = 0; i < maxTomas; i++) {
    const totalMins = cursor % minutosEnDia;
    const hh = String(Math.floor(totalMins / 60)).padStart(2, '0');
    const mm = String(totalMins % 60).padStart(2, '0');
    horarios.push(`${hh}:${mm}`);
    cursor += frecuenciaHrs * 60;
  }
  return horarios;
}

function proximaToma(horarios) {
  // Retorna la próxima hora de toma relativa a ahora
  if (!horarios || !horarios.length) return null;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  for (const h of horarios) {
    const [hh, mm] = h.split(':').map(Number);
    const tomaMin = hh * 60 + mm;
    if (tomaMin > nowMins) return h;
  }
  return horarios[0]; // mañana a la primera hora
}

/* ── Módulo Gastos — boleta fotográfica ── */
let _boletaDataUrl = null; // base64 de la imagen de boleta actual

function previewBoleta(input){
  const file = input.files[0];
  if(!file) return;
  if(file.size > 10 * 1024 * 1024){ toast('La imagen supera 10MB','err'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    // Comprimir imagen antes de guardar (para no superar límite de Firestore ~900KB)
    const imgEl = new Image();
    imgEl.onload = () => {
      const MAX = 900; // px máximo lado más largo
      let w = imgEl.width, h = imgEl.height;
      if(w > MAX || h > MAX){
        const ratio = Math.min(MAX/w, MAX/h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl, 0, 0, w, h);
      _boletaDataUrl = canvas.toDataURL('image/jpeg', 0.75); // ~150-300KB
      const domImg = document.getElementById('g-boleta-img');
      const preview = document.getElementById('g-boleta-preview');
      const placeholder = document.getElementById('g-boleta-placeholder');
      const area = document.getElementById('g-boleta-area');
      if(domImg) domImg.src = _boletaDataUrl;
      if(preview) preview.style.display = 'block';
      if(placeholder) placeholder.style.display = 'none';
      if(area) area.style.borderColor = 'var(--sage)';
    };
    imgEl.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function limpiarBoleta(){
  _boletaDataUrl = null;
  const input = document.getElementById('g-boleta-input');
  const img = document.getElementById('g-boleta-img');
  const preview = document.getElementById('g-boleta-preview');
  const placeholder = document.getElementById('g-boleta-placeholder');
  const area = document.getElementById('g-boleta-area');
  if(input) input.value = '';
  if(img) img.src = '';
  if(preview) preview.style.display = 'none';
  if(placeholder) placeholder.style.display = 'block';
  if(area) area.style.borderColor = '';
}

function cargarBoletaExistente(dataUrl){
  if(!dataUrl){ limpiarBoleta(); return; }
  _boletaDataUrl = dataUrl;
  const img = document.getElementById('g-boleta-img');
  const preview = document.getElementById('g-boleta-preview');
  const placeholder = document.getElementById('g-boleta-placeholder');
  const area = document.getElementById('g-boleta-area');
  if(img) img.src = dataUrl;
  if(preview) preview.style.display = 'block';
  if(placeholder) placeholder.style.display = 'none';
  if(area) area.style.borderColor = 'var(--sage)';
}


/* ── Recarga manual desde Firestore ── */
async function recargarDesdeFB(){
  const s = DB.getSesion();
  if(!s){ navTo('s-splash'); return; }
  toast('Sincronizando...', 'ok');
  try {
    const uData = await _fsGet('usuarios/' + s.userId);
    if(!uData){
      toast('No se encontraron datos en el servidor. ¿Completaste el registro?', 'err');
      return;
    }
    const adminId = uData.adminId || s.userId;
    await _cargarDatosFirestore(s.userId, uData.cuidadoId, adminId);
    DB.setSesion({...s, cuidadoId: uData.cuidadoId});
    // Verificar si ahora hay datos
    const cuidados = DB.getCuidados();
    if(cuidados.length === 0){
      toast('Firestore no tiene datos aún. Completa el onboarding.', 'err');
      if(s.rol === 'admin') navTo('s-onb-am');
      return;
    }
    toast('✓ Datos sincronizados', 'ok');
    irAlHome();
  } catch(e) {
    console.error('recargarDesdeFB:', e);
    toast('Error de conexión. Verifica tu internet.', 'err');
  }
}

function fabActionEquip(){
  const s=DB.getSesion(); if(!s) return;
  if(!['admin','cuidadora'].includes(s.rol)) return;
  // Abrir sheet según el tab activo en Equipo
  if(ST.equipo.tabEquip==='cuidadoras') abrirSheetCuidadora();
  else if(ST.equipo.tabEquip==='especialistas') abrirSheetEspecialista();
}
function fabActionHogar(){
  const s=DB.getSesion(); if(!s) return;
  // El permiso debe coincidir con el que muestra/oculta el FAB en renderTabHogar:
  // insumos = admin/familiar/cuidadora, proveedores = solo admin
  if(ST.hogar.tabHogar==='insumos'){
    if(['admin','familiar','cuidadora'].includes(s.rol)) abrirSheetInsumo();
  } else if(ST.hogar.tabHogar==='proveedores'){
    if(s.rol==='admin') abrirSheetProveedor();
  }
}
function fabActionGastos(){
  const s=DB.getSesion(); if(!s) return;
  if(!['admin','familiar','cuidadora'].includes(s.rol)) return;
  abrirSheetGasto();
}
