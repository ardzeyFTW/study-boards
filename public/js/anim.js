/**
 * anim.js — UI Animation Primitives & Ripple Feedback
 * Standalone Public Quiz Platform
 */

export const prefersReducedMotion = () =>
    !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * Attaches material ripple effect to clickable elements.
 */
export function attachRippleEffect(element) {
    if (!element || prefersReducedMotion()) return;

    element.addEventListener('pointerdown', (e) => {
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2;
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;

        const ripple = document.createElement('span');
        ripple.className = 'ui-ripple';
        ripple.style.width = `${size}px`;
        ripple.style.height = `${size}px`;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        element.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    });
}

/**
 * Animated number count up / down.
 */
export function animateNumber(element, from, to, duration = 600, formatter = n => String(n)) {
    if (!element) return;
    if (from === to || prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
        element.textContent = formatter(to);
        return;
    }

    const start = performance.now();
    const step = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        const current = Math.round(from + (to - from) * eased);
        element.textContent = formatter(current);
        if (progress < 1) {
            requestAnimationFrame(step);
        }
    };
    requestAnimationFrame(step);
}

/**
 * Applies choice selection feedback classes.
 */
export function applyChoiceFeedback(btn, isCorrect, wasSelected) {
    if (!btn) return;
    btn.classList.remove('choice-neutral', 'choice-correct', 'choice-wrong', 'choice-selected');
    if (isCorrect) {
        btn.classList.add('choice-correct');
    } else if (wasSelected) {
        btn.classList.add('choice-wrong');
    }
}
