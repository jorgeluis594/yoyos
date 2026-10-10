import fs from 'node:fs';
const P={search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',printer:'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',scan:'<path d="M17 12v4a1 1 0 0 1-1 1h-4"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M17 8V7"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M7 17h.01"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="5" height="5" rx="1"/>',sort:'<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',chev:'<path d="m9 18 6-6-6-6"/>',shirt:'<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',gem:'<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',bag:'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',image:'<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',more:'<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',grid:'<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',list:'<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',home:'<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',pkg:'<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 8.7 5 8.7-5"/>',cog:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',check:'<path d="M20 6 9 17l-5-5"/>',alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',ban:'<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',store:'<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>',qr:'<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>'};
const I=(n,c='i')=>`<svg class="${c}" viewBox="0 0 24 24">${P[n]}</svg>`;
// Sample products (design examples only)
const D=[
 {n:'Polo oversize algodón',v:4,sku:null,p:'39.90',from:true,s:32,ic:'shirt',bg:'#3a3f47',fg:'#c9d2dc'},
 {n:'Zapatillas urbanas blancas',v:6,sku:null,p:'149.00',from:true,s:3,ic:'bag',bg:'#e9e4da',fg:'#8a8073'},
 {n:'Collar de acero dorado',v:1,sku:'COL-018',p:'25.00',from:false,s:0,ic:'gem',bg:'#4a3a22',fg:'#e6c16a'},
 {n:'Jean mom fit celeste',v:5,sku:null,p:'89.90',from:true,s:18,ic:'shirt',bg:'#33475e',fg:'#a4cae8'},
 {n:'Cartera bandolera negra',v:1,sku:'CAR-221',p:'69.00',from:false,s:7,ic:'bag',bg:'#2b2a2c',fg:'#8f8890'},
 {n:'Set de aretes perla',v:1,sku:null,p:'15.00',from:false,s:41,ic:'gem',bg:'#ede6dc',fg:'#a39586',nophoto:true},
 {n:'Casaca denim clásica',v:3,sku:null,p:'129.00',from:true,s:0,ic:'shirt',bg:'#2e3d52',fg:'#8fb0d0'},
 {n:'Vestido midi satinado',v:4,sku:null,p:'99.00',from:true,s:12,ic:'shirt',bg:'#4b2f3a',fg:'#e2a9b8'},
];
const price=d=>`${d.from?'<span class="from">desde </span>':''}S/&nbsp;${d.p}`;
const sub=d=>d.v>1?`${d.v} variantes`:d.sku?`SKU ${d.sku}`:'Sin SKU';
const thumb=(d,sz)=>d.nophoto?`<div class="thumb" style="width:${sz}px;height:${sz}px;background:var(--secondary);border:1px dashed var(--border)"><svg viewBox="0 0 24 24" style="stroke:var(--muted-fg);width:45%;height:45%">${P.image}</svg></div>`:`<div class="thumb" style="width:${sz}px;height:${sz}px;background:linear-gradient(150deg,${d.bg},color-mix(in oklab,${d.bg} 70%,#000))"><svg viewBox="0 0 24 24" style="stroke:${d.fg}">${P[d.ic]}</svg></div>`;
const stockBadge=d=>d.s===0?`<span class="badge b-out">${I('ban')}Agotado</span>`:d.s<=5?`<span class="badge b-low">${I('alert')}Quedan ${d.s}</span>`:`<span class="badge b-ok">${d.s} en stock</span>`;
const status=`<div class="status"><span>12:13</span><div class="r"><svg class="i" style="width:15px;height:15px" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M12 20h.01"/></svg><span class="bat"></span></div></div>`;
const tabs=`<nav class="tabs"><div class="tab"><div class="ind">${I('home')}</div>Inicio</div><div class="tab on"><div class="ind">${I('pkg')}</div>Productos</div><div class="tab"><div class="ind">${I('bag')}</div>Pedidos</div><div class="tab"><div class="ind">${I('cog')}</div>Configuración</div></nav><div class="navbar"><i></i></div>`;
const page=(css,body)=>`<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="stylesheet" href="shared.css"><style>${css}</style></head><body>${status}<main class="main">${body}</main>${tabs}</body></html>`;

// A — Lista Shopify: thumbnail rows, stock line in text, price right
const A=page(`.hd{padding:8px 16px 0;display:flex;flex-direction:column;gap:12px}
.tb-actions{display:flex;align-items:center;gap:4px}
.toolbar{display:flex;align-items:center;justify-content:space-between;padding:4px 16px 8px}
.list{margin:0 16px;background:var(--card);border-radius:12px;border:1px solid #333034}
.row{display:flex;gap:12px;align-items:center;padding:10px 12px;min-height:72px;border-bottom:1px solid #353236}
.row:last-child{border-bottom:0}
.txt{flex:1;min-width:0}.nm{font-size:16px;line-height:22px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ln{font-size:14px;line-height:20px;color:var(--muted-fg)}.ln .out{color:var(--error);font-weight:500}.ln .low{color:var(--warning);font-weight:500}
.pr{text-align:right;font-size:15px;font-weight:600;white-space:nowrap}.pr .from{display:block;font-size:12px;font-weight:400;color:var(--muted-fg);line-height:14px}
.sortb{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:500;color:var(--fg);height:36px;padding:0 4px}.sortb svg{width:16px;height:16px}`,
`<div class="hd"><div class="company">${I('store')}Yoyos Demo</div>
<div class="titlebar"><h1>Productos</h1><div class="tb-actions"><div class="icon-btn">${I('printer')}</div><div class="pill-action">${I('plus')}Nuevo</div></div></div>
<div class="search">${I('search')}<span>Nombre o SKU</span><div class="scan">${I('scan')}</div></div>
<div class="chips"><div class="chip on">${I('check')}Todos</div><div class="chip">Con stock</div><div class="chip">Stock bajo</div><div class="chip">Agotados</div></div></div>
<div class="toolbar"><span class="meta">48 productos</span><span class="sortb">${I('sort')}Recientes</span></div>
<div class="list">${D.slice(0,7).map(d=>`<div class="row">${thumb(d,48)}<div class="txt"><div class="nm">${d.n}</div><div class="ln">${d.s===0?'<span class="out">Agotado</span>':d.s<=5?`<span class="low">${d.s} en stock</span>`:`${d.s} en stock`}${d.v>1?` · ${d.v} variantes`:d.sku?` · ${d.sku}`:''}</div></div><div class="pr">${d.from?'<span class="from">desde</span>':''}S/&nbsp;${d.p}</div></div>`).join('')}</div>`);

// B — Inventario: no thumbs, segmented counts, stock badges, per-row label print
const B=page(`.hd{padding:8px 16px 0;display:flex;flex-direction:column;gap:12px}
.seg{display:flex;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:3px;gap:3px}
.seg div{flex:1;height:42px;border-radius:9px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:12px;color:var(--muted-fg);font-weight:500;line-height:14px}
.seg b{font-size:16px;line-height:20px;color:var(--fg);font-weight:700}
.seg .on{background:var(--accent);color:var(--accent-fg)}.seg .on b{color:var(--accent-fg)}
.seg .w b{color:var(--warning)}.seg .e b{color:var(--error)}
.sec{padding:16px 16px 6px;display:flex;justify-content:space-between;align-items:center}
.row{display:flex;align-items:center;gap:8px;padding:10px 4px 10px 16px;min-height:72px;border-bottom:1px solid #2f2d30}
.txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.l1{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.nm{font-size:16px;line-height:22px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pr{font-size:16px;font-weight:700;white-space:nowrap}.pr .from{font-size:12px;font-weight:400;color:var(--muted-fg)}
.l2{display:flex;justify-content:space-between;align-items:center;gap:8px}.l2 .meta{font-size:14px}
.pbtn{width:44px;height:48px;display:grid;place-items:center;color:var(--muted-fg);border-left:1px solid #2f2d30;margin-left:4px}`,
`<div class="hd"><div class="company">${I('store')}Yoyos Demo</div>
<div class="titlebar"><h1>Productos</h1><div style="display:flex;gap:4px;align-items:center"><div class="icon-btn">${I('more')}</div><div class="pill-action">${I('plus')}Nuevo</div></div></div>
<div class="search">${I('search')}<span>Nombre o SKU</span><div class="scan">${I('scan')}</div></div>
<div class="seg"><div class="on"><b>48</b>Todos</div><div class="w"><b>5</b>Stock bajo</div><div class="e"><b>3</b>Agotados</div></div></div>
<div class="sec"><span class="meta">Ordenado por nombre</span><span class="meta" style="display:flex;gap:6px;align-items:center;color:var(--fg);font-weight:500">${I('sort')}Ordenar</span></div>
${[...D].sort((a,b)=>a.n.localeCompare(b.n)).slice(0,7).map(d=>`<div class="row"><div class="txt"><div class="l1"><span class="nm">${d.n}</span><span class="pr">${d.from?'<span class="from">desde </span>':''}S/&nbsp;${d.p}</span></div><div class="l2"><span class="meta">${sub(d)}</span>${stockBadge(d)}</div></div><div class="pbtn">${I('qr')}</div></div>`).join('')}`);

// C — Catálogo visual: grid of photo cards for live selling, extended FAB
const C=page(`.hd{padding:8px 16px 0;display:flex;flex-direction:column;gap:12px}
.view{display:flex;background:var(--card);border:1px solid var(--border);border-radius:24px;padding:3px}
.view div{width:42px;height:40px;border-radius:20px;display:grid;place-items:center;color:var(--muted-fg)}.view .on{background:var(--accent);color:var(--accent-fg)}
.chips{flex-wrap:nowrap;overflow:hidden;margin-right:-16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px 16px 120px}
.card{display:flex;flex-direction:column;gap:8px}
.ph{aspect-ratio:1/1;border-radius:12px;position:relative;display:grid;place-items:center;overflow:hidden}
.ph svg{width:44%;height:44%;fill:none;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.ph .badge{position:absolute;left:8px;top:8px}
.ph.out::after{content:"";position:absolute;inset:0;background:rgba(28,27,29,.45)}
.ph.out .badge{z-index:1}
.nm{font-size:14px;line-height:20px;font-weight:500;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pr{font-size:16px;font-weight:700;line-height:20px}.pr .from{font-size:12px;font-weight:400;color:var(--muted-fg)}
.cm{font-size:13px;color:var(--muted-fg);line-height:16px}
.fab{position:absolute;right:16px;bottom:16px;height:56px;padding:0 20px 0 16px;border-radius:16px;background:var(--primary);color:var(--primary-fg);display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;box-shadow:0 6px 18px rgba(0,0,0,.45)}
.fab svg.i{width:22px;height:22px;stroke-width:2}`,
`<div class="hd"><div class="company">${I('store')}Yoyos Demo</div>
<div class="titlebar"><h1>Productos</h1><div style="display:flex;gap:4px;align-items:center"><div class="view"><div>${I('list')}</div><div class="on">${I('grid')}</div></div><div class="icon-btn">${I('more')}</div></div></div>
<div class="search">${I('search')}<span>Nombre o SKU</span><div class="scan">${I('scan')}</div></div>
<div class="chips"><div class="chip on">${I('check')}Todos <span class="n">48</span></div><div class="chip">Con stock <span class="n">40</span></div><div class="chip">Stock bajo <span class="n">5</span></div><div class="chip">Agotados <span class="n">3</span></div></div></div>
<div class="grid">${D.slice(0,6).map(d=>`<div class="card"><div class="ph${d.s===0?' out':''}" style="${d.nophoto?'background:var(--secondary);border:1px dashed var(--border)':`background:linear-gradient(150deg,${d.bg},color-mix(in oklab,${d.bg} 70%,#000))`}">${d.s===0||d.s<=5?stockBadge(d):''}<svg viewBox="0 0 24 24" style="stroke:${d.nophoto?'var(--muted-fg)':d.fg}">${P[d.nophoto?'image':d.ic]}</svg></div><div><div class="nm">${d.n}</div><div class="pr">${d.from?'<span class="from">desde </span>':''}S/&nbsp;${d.p}</div><div class="cm">${d.s>5?`${d.s} en stock · `:''}${sub(d)}</div></div></div>`).join('')}</div>
<div class="fab">${I('plus')}Agregar producto</div>`);
fs.writeFileSync('option-a.html',A);fs.writeFileSync('option-b.html',B);fs.writeFileSync('option-c.html',C);
