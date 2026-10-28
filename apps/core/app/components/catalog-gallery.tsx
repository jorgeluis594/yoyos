import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Dialog } from "radix-ui";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { CatalogProductImage } from "@core/app/components/catalog-sections";

/** The lightbox draws its own fixed colors, so its contrast never depends on the store theme; a unit test checks them against the catalog floor. */
export const lightboxColors = { scrim: "#0A0A0B", text: "#FFFFFF", control: "#F4F4F5", controlText: "#111113", focus: "#FFFFFF" } as const;

/** A vertical drag longer than this closes the lightbox. */
const closeDragDistance = 80;
const bodyFont = { fontFamily: "var(--store-font-body, inherit)" };

/** The slide a scrolling track shows: the track is as wide as one slide. */
function shownSlide(track: HTMLElement, count: number) {
  if (track.clientWidth <= 0) return null;
  return Math.max(0, Math.min(count - 1, Math.round(track.scrollLeft / track.clientWidth)));
}

function scrollToSlide(track: HTMLElement | null, index: number) {
  if (track && track.clientWidth > 0) track.scrollLeft = index * track.clientWidth;
}

/** The product page photos: the primary large and, with two or more photos, a swipeable track and a thumbnail row. Any photo opens the lightbox on it. */
export function CatalogGallery({ name, photoUrls }: Readonly<{ name: string; photoUrls: readonly string[] }>) {
  const count = photoUrls.length;
  const [shown, setShown] = useState(0);
  const [lightboxAt, setLightboxAt] = useState<number | null>(null);
  const [primarySettled, setPrimarySettled] = useState(false);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const settle = useCallback(() => setPrimarySettled(true), []);

  if (count === 0) return <CatalogProductImage name={name} url={null} part="catalog-product-photo" />;

  const open = (index: number, from: HTMLElement) => { opener.current = from; setLightboxAt(index); };
  const close = (lastShown: number) => {
    setLightboxAt(null);
    setShown(lastShown);
    // The track unmounts nothing, so it can follow the photo the buyer browsed to.
    scrollToSlide(track.current, lastShown);
  };
  const label = (index: number) => `Ver foto ${index + 1} de ${count}`;

  return <div className="flex min-w-0 flex-col gap-3">
    {count === 1
      ? <div data-store-part="catalog-gallery-large">
        <button type="button" aria-label={`Ver foto de ${name}`} onClick={(event) => open(0, event.currentTarget)}
          className="block w-full cursor-zoom-in rounded-[var(--radius-card)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">
          <CatalogProductImage name={name} url={photoUrls[0]} part="catalog-product-photo" priority />
        </button>
      </div>
      : <div ref={track} data-store-part="catalog-gallery-track" className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none]"
        style={{ touchAction: "pan-x" }}
        onScroll={(event) => { const index = shownSlide(event.currentTarget, count); if (index !== null) setShown(index); }}>
        {photoUrls.map((url, index) => {
          const isShown = index === shown;
          return <div key={url + index} data-store-part="catalog-gallery-large" className="w-full shrink-0 snap-center" aria-hidden={isShown ? undefined : true}>
            <button type="button" aria-label={label(index)} tabIndex={isShown ? 0 : -1} onClick={(event) => open(index, event.currentTarget)}
              className="block w-full cursor-zoom-in rounded-[var(--radius-card)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">
              <CatalogProductImage name={name} url={url} part="catalog-product-photo" priority={index === 0} onSettled={index === 0 ? settle : undefined} />
            </button>
          </div>;
        })}
      </div>}
    {count > 1 && <ul className="flex flex-wrap gap-2" aria-label="Fotos del producto">
      {photoUrls.map((url, index) => <li key={url + index}>
        <button type="button" data-store-part="catalog-gallery-thumbnail" aria-label={label(index)} aria-current={index === shown ? "true" : undefined}
          onClick={(event) => open(index, event.currentTarget)}
          className="block size-16 cursor-zoom-in overflow-hidden rounded-[var(--radius-card)] border bg-muted outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring sm:size-20">
          {/* Thumbnails share the originals' URLs, so they wait for the primary to load or fail. */}
          <img src={primarySettled ? url : undefined} alt="" decoding="async" className="size-full object-cover" />
        </button>
      </li>)}
    </ul>}
    <div ref={setHost} data-store-part="catalog-lightbox-host" />
    {lightboxAt !== null && <CatalogLightbox name={name} photoUrls={photoUrls} start={lightboxAt} container={host}
      onClose={close} onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }} />}
  </div>;
}

const controlStyle = { backgroundColor: lightboxColors.control, color: lightboxColors.controlText } as const;
const controlClass = "absolute z-10 flex size-11 items-center justify-center rounded-full shadow-lg outline-offset-2 focus-visible:outline-2";

/** The full-screen viewer of the product photos, built on the Radix Dialog primitives and portaled inside the store theme like the cart sheet. */
function CatalogLightbox({ name, photoUrls, start, container, onClose, onCloseAutoFocus }: Readonly<{
  name: string; photoUrls: readonly string[]; start: number; container: HTMLElement | null;
  onClose: (lastShown: number) => void; onCloseAutoFocus: (event: Event) => void;
}>) {
  const count = photoUrls.length;
  const [current, setCurrent] = useState(start);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  // Opens on the chosen photo before the first paint.
  useLayoutEffect(() => scrollToSlide(track.current, start), [start]);

  const goTo = (index: number) => {
    const next = Math.max(0, Math.min(count - 1, index));
    setCurrent(next);
    scrollToSlide(track.current, next);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (count < 2) return;
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(current + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); goTo(current - 1); }
  };
  const finishDrag = (event: PointerEvent, cancelled: boolean) => {
    const from = drag.current;
    drag.current = null;
    if (cancelled || !from) return;
    const down = event.clientY - from.y;
    // A mostly horizontal move is a swipe between photos, never a close.
    if (down > closeDragDistance && down > Math.abs(event.clientX - from.x)) onClose(current);
  };

  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(current); }}>
    <Dialog.Portal container={container}>
      <Dialog.Content data-store-part="catalog-lightbox" aria-describedby={undefined} onKeyDown={onKeyDown} onCloseAutoFocus={onCloseAutoFocus}
        className="fixed top-0 left-0 z-50 outline-none" style={{ width: "100dvw", height: "100dvh", backgroundColor: lightboxColors.scrim, color: lightboxColors.text, overscrollBehavior: "contain", ...bodyFont }}>
        <Dialog.Title className="sr-only">{`Fotos de ${name}`}</Dialog.Title>
        <div ref={track} data-store-part="catalog-lightbox-track" className={count > 1 ? "flex size-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]" : "flex size-full overflow-hidden"}
          style={{ touchAction: count > 1 ? "pan-x" : "none", overscrollBehavior: "contain" }}
          onScroll={(event) => { const index = shownSlide(event.currentTarget, count); if (index !== null) setCurrent(index); }}
          onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY }; }}
          onPointerUp={(event) => finishDrag(event, false)} onPointerCancel={(event) => finishDrag(event, true)}>
          {photoUrls.map((url, index) => <LightboxSlide key={url + index} url={url} name={name} eager={index === start} onScrimClick={() => onClose(current)} />)}
        </div>
        <Dialog.Close aria-label="Cerrar" className={`${controlClass} top-4 right-4`} style={{ ...controlStyle, outlineColor: lightboxColors.focus }}><X aria-hidden="true" /></Dialog.Close>
        {count > 1 && <>
          <button type="button" aria-label="Foto anterior" disabled={current === 0} onClick={() => goTo(current - 1)}
            className={`${controlClass} top-1/2 left-4 -translate-y-1/2 disabled:invisible`} style={{ ...controlStyle, outlineColor: lightboxColors.focus }}><ChevronLeft aria-hidden="true" /></button>
          <button type="button" aria-label="Foto siguiente" disabled={current === count - 1} onClick={() => goTo(current + 1)}
            className={`${controlClass} top-1/2 right-4 -translate-y-1/2 disabled:invisible`} style={{ ...controlStyle, outlineColor: lightboxColors.focus }}><ChevronRight aria-hidden="true" /></button>
          <p role="status" aria-live="polite" className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-sm tabular-nums"
            style={{ backgroundColor: lightboxColors.scrim, color: lightboxColors.text }}>{`${current + 1} de ${count}`}</p>
        </>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** One photo of the lightbox, fitted inside the viewport; a click on the space around it closes, a click on the photo does not. */
function LightboxSlide({ url, name, eager, onScrimClick }: Readonly<{ url: string; name: string; eager: boolean; onScrimClick: () => void }>) {
  const [failed, setFailed] = useState(false);
  return <div data-store-part="catalog-lightbox-slide" className="flex size-full shrink-0 snap-center items-center justify-center" onClick={(event) => { if (event.target === event.currentTarget) onScrimClick(); }}>
    {failed
      ? <span aria-hidden="true" className="text-6xl font-semibold">{name.trim().charAt(0).toUpperCase()}</span>
      : <img src={url} alt="" loading={eager ? "eager" : "lazy"} className="max-h-full max-w-full object-contain" draggable={false} onError={() => setFailed(true)} />}
  </div>;
}
