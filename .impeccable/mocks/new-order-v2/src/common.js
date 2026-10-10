const ic = (d, s = 20, c = "currentColor") => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  back: ic('<path d="m15 18-6-6 6-6"/>', 24),
  close: ic('<path d="M18 6 6 18M6 6l12 12"/>', 24),
  shirt: ic('<path d="M20.4 6.6 16 4a4 4 0 0 1-8 0L3.6 6.6a1 1 0 0 0-.5 1.2l1.1 3.3a1 1 0 0 0 1.2.6L7 11.2V20a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-8.8l1.6.5a1 1 0 0 0 1.2-.6l1.1-3.3a1 1 0 0 0-.5-1.2Z"/>', 22, "#B6ACA1"),
  jacket: ic('<path d="M8 3h8l4 5v13h-5v-6H9v6H4V8z"/><path d="M12 3v12"/>', 22, "#B6ACA1"),
  cap: ic('<path d="M3 15a9 9 0 0 1 18 0z"/><path d="M3 15h13l5 2"/>', 22, "#B6ACA1"),
  camera: ic('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>', 22),
  image: ic('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>', 22),
  check: ic('<path d="M20 6 9 17l-5-5"/>', 16),
  clock: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 16),
  plus: ic('<path d="M12 5v14M5 12h14"/>', 20),
  chev: ic('<path d="m9 18 6-6-6-6"/>', 18, "#B6ACA1"),
  chevd: ic('<path d="m6 9 6 6 6-6"/>', 18, "#B6ACA1"),
  user: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', 20, "#B6ACA1"),
  search: ic('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', 20, "#B6ACA1"),
  truck: ic('<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>', 20, "#B6ACA1"),
  more: ic('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>', 20, "#B6ACA1"),
  receipt: ic('<path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2z"/><path d="M8 9h8M8 13h6"/>', 18),
  trash: ic('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>', 18, "#B6ACA1"),
  home: ic('<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>', 24),
  box: ic('<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>', 24),
  bag: ic('<path d="M6 7h12l1 14H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>', 22),
  gear: ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', 24),
};
const status = `<div class="status"><span>7:00</span><span>▾ ▴ ▮</span></div>`;
const tabs = `<div class="tabs"><div class="tab"><div class="pill">${I.home}</div></div><div class="tab"><div class="pill">${I.box}</div></div><div class="tab on"><div class="pill">${I.bag}</div>Pedidos</div><div class="tab"><div class="pill">${I.gear}</div></div></div>`;
const ITEMS = [
  { n: "Polo 1", v: "Talla M · Negro", sku: "JSSJSKSJ", q: 4, p: 95, t: "380.00", i: "shirt" },
  { n: "Casaca denim", v: "Talla L · Azul", sku: "CSD-L-AZ", q: 1, p: 120, t: "120.00", i: "jacket" },
  { n: "Gorra trucker", v: "Única · Beige", sku: "GTR-BG", q: 2, p: 25, t: "50.00", i: "cap" },
];
const S = (n) => "S/ " + Number(n).toFixed(2);
document.querySelectorAll("[data-status]").forEach(e => e.outerHTML = status);
document.querySelectorAll("[data-tabs]").forEach(e => e.outerHTML = tabs);
document.querySelectorAll("[data-i]").forEach(e => e.innerHTML = I[e.dataset.i]);
