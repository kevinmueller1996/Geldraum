"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

const screens = [
  { title: "Heute", image: "/njora-heute.webp", description: "Kontostand, Monatsendprognose und Kontoverlauf" },
  { title: "Monatsplan", image: "/njora-monatsplan.webp", description: "Einkommen, monatlicher Spielraum und Fixkosten nach Kategorie" },
  { title: "Kredite", image: "/njora-kredite.webp", description: "Übersicht über offene Kredite und ihre Raten" },
  { title: "Ziele", image: "/njora-ziele.webp", description: "Sparziele und bisher angesparte Beträge" },
];

const count = screens.length;
function wrap(step: number) {
  return ((step % count) + count) % count;
}

export default function PreviewCarousel() {
  const [step, setStep] = useState(0);
  const [offset, setOffset] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; width: number; tapDirection: number } | null>(null);
  const active = wrap(step);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let accumulated = 0;
    let last = -Infinity;
    let advanced = false;
    function wheel(event: WheelEvent) {
      const horizontal = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (!horizontal || (!event.shiftKey && Math.abs(horizontal) <= Math.abs(event.deltaY))) return;
      event.preventDefault();
      if (event.timeStamp - last > 180) { accumulated = 0; advanced = false; }
      last = event.timeStamp;
      accumulated += horizontal * (event.deltaMode === 1 ? 16 : 1);
      if (!advanced && Math.abs(accumulated) >= 25) {
        const direction = Math.sign(accumulated);
        setStep(previous => previous + direction);
        advanced = true;
      }
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  function select(index: number) {
    setStep(previous => {
      const distance = wrap(index - previous);
      return previous + (distance > count / 2 ? distance - count : distance);
    });
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const front = event.currentTarget.querySelector('[aria-hidden="false"]')?.getBoundingClientRect();
    const tapDirection = front && event.clientX < front.left ? -1 : front && event.clientX > front.right ? 1 : 0;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
      width: event.currentTarget.clientWidth, tapDirection };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) >= Math.min(45, gesture.width * 0.12) && Math.abs(dx) > Math.abs(dy)) {
      setStep(previous => previous - Math.sign(dx));
    } else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && gesture.tapDirection) {
      setStep(previous => previous + gesture.tapDirection);
    }
    cancel();
  }

  function cancel() { drag.current = null; setOffset(0); }

  return <figure className="nj-stage" role="group" aria-roledescription="Karussell" aria-label="Einblicke in die iPhone-App"
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      setStep(previous => previous + (event.key === "ArrowLeft" ? -1 : 1));
    }}>
    <div className="nj-orbit" ref={viewport} data-dragging={offset !== 0}
      onPointerDown={start} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}
      onPointerMove={event => {
        const gesture = drag.current;
        if (!gesture || gesture.id !== event.pointerId) return;
        const distance = gesture.x - event.clientX;
        if (Math.abs(distance) > Math.abs(gesture.y - event.clientY)) {
          setOffset(Math.max(-1, Math.min(1, distance / (gesture.width * 0.5))));
        }
      }}>
      {screens.map((screen, index) => {
        const angle = (index - step - offset) * 360 / count;
        const radians = angle * Math.PI / 180;
        const style = { "--turn": angle + "deg", "--untilt": -angle + "deg",
          "--tilt": -25 * Math.sin(radians) + "deg" } as CSSProperties;
        return <div className="nj-phone" data-screen={index} key={screen.title} style={style} aria-hidden={index !== active}>
          <Image unoptimized loading={index === 0 ? "eager" : "lazy"} src={screen.image} width="354" height="770" draggable={false}
            alt={screen.description} fetchPriority={index === 0 ? "high" : "auto"} />
          <span className="nj-island" aria-hidden="true" />
        </div>;
      })}
    </div>
    <figcaption><span aria-live="polite" aria-atomic="true">{screens[active].title} · Beispieldaten</span>
      <span className="nj-screen-picker">{screens.map((screen, index) =>
        <button key={screen.title} type="button" aria-label={screen.title + " anzeigen"}
          aria-pressed={index === active} onClick={() => select(index)} />)}</span>
    </figcaption>
  </figure>;
}
