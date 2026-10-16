/**
 * Entry point for `designsystem.html` — the design-system reference page.
 *
 * Static like the About page: no synth runtime (checked by
 * scripts/check-about-bundle.cjs). It builds a table of contents from the
 * page's own headings, copies a swatch value on click, and lets the
 * disclosure-caret demo toggle.
 */

import './designsystem.css';
import '../ui/cursors.css';

const toc = document.getElementById('ds-toc')!;
const heads = Array.from(document.querySelectorAll<HTMLElement>('#intro > h1, #ds-main section:not(#intro) > h2, #ds-main section > h3[id]'));
const links = new Map<string, HTMLAnchorElement>();
for (const h of heads) {
  const id = h.id || h.closest('section')!.id;
  const a = document.createElement('a');
  a.href = `#${id}`;
  a.textContent = h.tagName === 'H1' ? 'Overview' : (h.textContent ?? '');
  if (h.tagName === 'H3') a.className = 'sub';
  toc.appendChild(a);
  links.set(id, a);
}

const spy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target as HTMLElement;
    const id = el.id || el.closest('section')!.id;
    links.forEach((a) => a.classList.remove('on'));
    links.get(id)?.classList.add('on');
  }
}, { rootMargin: '-10% 0px -80% 0px' });
heads.forEach((h) => spy.observe(h));

document.querySelectorAll<HTMLButtonElement>('.ds-sw').forEach((b) => {
  b.addEventListener('click', () => {
    const v = b.dataset.v ?? '';
    void navigator.clipboard?.writeText(v).then(() => {
      b.classList.add('copied');
      window.setTimeout(() => b.classList.remove('copied'), 900);
    }).catch(() => { /* clipboard blocked: nothing to do */ });
  });
});

document.querySelectorAll<HTMLButtonElement>('.ds-caret[data-toggle]').forEach((b) => {
  b.addEventListener('click', () => {
    b.setAttribute('aria-expanded', String(b.getAttribute('aria-expanded') !== 'true'));
  });
});

// Spring demo: integrate the same second-order system the app uses (src/ui/motion.ts).
function runSpring(el: HTMLElement, omega: number, zeta: number): void {
  let x = 0, v = 0, last = performance.now();
  const target = 106;
  const tick = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (let i = 0; i < 8; i++) {
      const h = dt / 8;
      v += (-omega * omega * (x - target) - 2 * zeta * omega * v) * h;
      x += v * h;
    }
    el.style.transform = `translateX(${x}px)`;
    if (Math.abs(x - target) > 0.2 || Math.abs(v) > 2) requestAnimationFrame(tick);
    else el.style.transform = `translateX(${target}px)`;
  };
  el.style.transform = 'translateX(0)';
  requestAnimationFrame(tick);
}
const playSprings = (): void => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll<HTMLElement>('.ds-spring i').forEach((dot) => {
    if (reduce) { dot.style.transform = 'translateX(106px)'; return; }
    runSpring(dot, Number(dot.dataset.w), Number(dot.dataset.z));
  });
};
const playBtn = document.getElementById('ds-spring-play');
playBtn?.addEventListener('click', playSprings);
playBtn?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playSprings(); } });
