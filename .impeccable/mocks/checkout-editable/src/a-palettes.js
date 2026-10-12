const PALS=[
 ['Yoyos','#8C552D','#F7EFE6','#D5A16C','#1F1B19'],
 ['Bosque','#2F6B4F','#F1F6F2','#8FCBA8','#181E1B'],
 ['Petróleo','#13646B','#EEF6F6','#84CBD0','#161E1F'],
 ['Océano','#1F5A8C','#EFF4FA','#8EBDE6','#171C22'],
 ['Ciruela','#6B3A7D','#F6F1F8','#C9A2D8','#1E1921'],
 ['Frambuesa','#A8305F','#FBF0F4','#EE9BBB','#221A1D'],
 ['Terracota','#A4452A','#FBF2EE','#EDA38A','#221B19'],
 ['Mostaza','#7E5C00','#FAF5E6','#E3C063','#201E17'],
 ['Grafito','#333238','#F4F4F5','#C9C7CF','#1C1C1E'],
];
const SEL='Bosque';
const pal=p=>`<div class="pal ${p[0]===SEL?'on':''}"><div class="chip"><i style="background:${p[1]}"></i><i style="background:${p[2]}"></i><i style="background:${p[4]}"><b style="background:${p[3]}"></b></i></div><span>${p[0]}${p[5]?' <em>· Yoyos</em>':''}</span>${p[0]===SEL?`<u>${ic('check','s14')}</u>`:''}</div>`;
const sel=PALS.find(p=>p[0]===SEL);
document.getElementById('app').innerHTML = yoyosSide() + `<div class="main">
<div class="crumb">Lima Studio ${ic('right','s14')}<b>Apariencia del checkout</b></div>
<div class="ph"><div><div class="h1">Apariencia del checkout</div><p class="muted" style="margin-top:4px">Tu logo y tus colores en la página donde tus clientes revisan y pagan su pedido.</p></div>
 <div class="acts"><div class="row"><span class="pill warn"><span class="dot"></span>Cambios sin guardar</span><span class="btn ghost">Descartar</span><span class="btn pri">Guardar cambios</span></div>
 <span class="cap">Se aplicará a todos tus enlaces de checkout, incluidos los ya compartidos.</span></div></div>
<div class="work">
 <div class="canvas" style="${DARK?'background:#E9E4DC':''}">
  <div class="tb">${previewTag()}<span style="flex:1"></span>
   <span class="seg"><span class="on">Revisión</span><span>Pago</span></span>
   <span class="seg"><span class="on">${ic('phone','s14')}Celular</span><span>${ic('monitor','s14')}Escritorio</span></span>
   <span class="seg"><span class="${DARK?'':'on'}">${ic('sun','s14')}Claro</span><span class="${DARK?'on':''}">${ic('moon','s14')}Oscuro</span></span></div>
  <div class="stage">${phoneFrame(buyerCheckout({dark:DARK}),{h:640,dark:DARK})}</div>
 </div>
 <aside class="insp">
  <div class="sec"><div class="h2">Logo</div>
   <div class="logo-drop" style="margin-top:10px"><span class="logo-tile" style="width:52px;height:52px">${LOGO(34)}</span><div style="flex:1;min-width:0"><b style="font-weight:500">lima-logo.png</b><p class="cap">PNG · hasta 10 MB</p></div><span class="btn out sm">${ic('upload','s14')}Cambiar</span></div></div>
  <div class="sec"><div class="h2">Color de marca</div><p class="cap">Botones, enlaces y selecciones del checkout.</p>
   <div class="colorbtn ${DIALOG?'focus':''}"><span class="one" style="background:${DARK?sel[3]:sel[1]}"></span><div style="flex:1;min-width:0"><b style="font-weight:600">${sel[0]}</b><p class="cap">${DARK?'Tono para modo oscuro':'Tono para modo claro'}</p></div><span style="display:flex;align-items:center;gap:4px;font-weight:500">Cambiar${ic('right','s16')}</span></div></div>
  <div class="sec"><div class="h2" style="margin-bottom:8px">Fondo</div>
   <div class="seg bgseg"><span>Blanco</span><span>Neutro</span><span class="on">${ic('check','s14')}De marca</span></div>
   <p class="cap" style="margin-top:8px">${DARK?'En modo oscuro se usa el tono oscuro de Bosque.':'Usa el fondo suave de Bosque. En modo oscuro cambia solo.'}</p></div>
  <div class="sec" style="border:0;padding-top:14px"><span class="btn ghost" style="padding:0;height:auto">${ic('reset','s16')}Restablecer apariencia</span></div>
 </aside>
</div></div>`+(DIALOG?DIALOG_HTML():'');

function DIALOG_HTML(){
 const card=p=>`<div class="dpal ${p[0]===SEL?'on':''}">${p[0]===SEL?`<u>${ic('check','s14')}</u>`:''}<div class="blk" style="background:${DARK?p[3]:p[1]}"></div><div class="dn"><b>${p[0]}</b>${p[0]==='Yoyos'?'<em>Predeterminado</em>':''}</div></div>`;
 return `<div class="scrim"></div><div class="dlg" role="dialog" aria-label="Color de marca">
  <div class="dh"><div><div class="h2" style="font-size:18px">Elige el color de tu marca</div><p class="muted" style="margin-top:2px">${DARK?"Ves los tonos para modo oscuro. En modo claro se usa su versión clara.":"Ves los tonos para modo claro. En modo oscuro se usa su versión oscura."}</p></div><span class="x">${ic('x')}</span></div>
  <div class="dgrid">${PALS.map(card).join('')}</div>
  <div class="df"><span style="flex:1"></span><span class="cap" style="margin-right:6px">Se verá en la vista previa. Se publica al guardar.</span><span class="btn out">Cancelar</span><span class="btn pri">Usar Bosque</span></div>
 </div>`;
}
