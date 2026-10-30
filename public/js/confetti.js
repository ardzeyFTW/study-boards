/**
 * confetti.js — Canvas Confetti Celebration Engine
 * Pure HTML5 Canvas particles, zero external dependencies.
 * Standalone Public Quiz Platform
 */

import { prefersReducedMotion } from './anim.js';

const COLORS = ['#6366f1', '#818cf8', '#22c55e', '#facc15', '#f472b6', '#38bdf8', '#fb923c', '#ffffff'];
const GRAVITY = 900;

let activeSimulation = null;

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function createParticle(x, y, angle, speed) {
    const shape = pick(['rect', 'strip', 'circle']);
    return {
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: shape === 'strip' ? rand(4, 6) : rand(7, 12),
        h: shape === 'strip' ? rand(14, 22) : rand(7, 12),
        shape,
        color: pick(COLORS),
        rot: rand(0, Math.PI * 2),
        vr: rand(-8, 8),
        flip: rand(0, Math.PI * 2),
        vflip: rand(4, 10),
        drag: rand(0.5, 1.1),
        wobble: rand(0, Math.PI * 2),
        life: 0,
        maxLife: rand(3.0, 4.5)
    };
}

export function launchCelebrationConfetti() {
    if (prefersReducedMotion() || typeof document === 'undefined') return;
    if (activeSimulation) activeSimulation.stop();

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:99999;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = window.innerWidth;
    let h = window.innerHeight;

    const resize = () => {
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Two corner cannons
    const pieces = [];
    for (let i = 0; i < 90; i++) {
        pieces.push(createParticle(0, h, -Math.PI / 3 + rand(-0.3, 0.3), rand(800, 1300)));
        pieces.push(createParticle(w, h, -Math.PI * 2 / 3 + rand(-0.3, 0.3), rand(800, 1300)));
    }

    let startTime = null;
    let lastTime = null;
    let rafId = 0;
    let stopped = false;

    const stop = () => {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(rafId);
        window.removeEventListener('resize', resize);
        canvas.remove();
        if (activeSimulation && activeSimulation.canvas === canvas) {
            activeSimulation = null;
        }
    };
    activeSimulation = { canvas, stop };

    const frame = (now) => {
        if (stopped) return;
        if (startTime === null) { startTime = now; lastTime = now; }
        const dt = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        ctx.clearRect(0, 0, w, h);

        for (let i = pieces.length - 1; i >= 0; i--) {
            const p = pieces[i];
            p.life += dt;
            p.vy += GRAVITY * dt;
            const damp = Math.exp(-p.drag * dt);
            p.vx *= damp;
            p.vy *= damp;
            p.wobble += dt * 6;
            p.x += (p.vx + Math.sin(p.wobble) * 30) * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
            p.flip += p.vflip * dt;

            if (p.life > p.maxLife || p.y > h + 50) {
                pieces.splice(i, 1);
                continue;
            }

            const fade = p.life > p.maxLife - 0.6 ? (p.maxLife - p.life) / 0.6 : 1;
            ctx.save();
            ctx.globalAlpha = Math.max(0, fade);
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.scale(1, Math.cos(p.flip));
            ctx.fillStyle = p.color;

            if (p.shape === 'circle') {
                ctx.beginPath();
                ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            }
            ctx.restore();
        }

        if (pieces.length === 0) {
            stop();
            return;
        }
        rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
}
