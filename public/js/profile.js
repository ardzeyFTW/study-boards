/**
 * profile.js — Profile Statistics & Activity Heatmap Calendar for Study Boards Public
 * Driven entirely by local IndexedDB (user_profile store) with zero backend egress.
 */

import { getUserProfile, updateUserProfile, getStorageHealth, exportFullDatabaseJSON, importFullDatabaseJSON } from './db.js';
import { animateNumber, prefersReducedMotion } from './anim.js';

let activeMonthCursor = null; // 'YYYY-MM' format
let calendarTipEl = null;

const fmtNum = n => Number(n || 0).toLocaleString('en-US');
const fmtPct = n => `(${Number(n || 0)}%)`;

function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Tooltip management for calendar cells.
 */
function showCalTooltip(cell) {
    if (!cell || !cell.dataset.tip) return;
    if (!calendarTipEl) {
        calendarTipEl = document.createElement('div');
        calendarTipEl.className = 'activity-tip';
        document.body.appendChild(calendarTipEl);
    }
    calendarTipEl.textContent = cell.dataset.tip;
    calendarTipEl.style.display = 'block';

    const r = cell.getBoundingClientRect();
    const tipW = calendarTipEl.offsetWidth;
    const left = Math.min(Math.max(r.left + r.width / 2 - tipW / 2, 8), window.innerWidth - tipW - 8);
    calendarTipEl.style.left = `${left}px`;
    calendarTipEl.style.top = `${Math.max(r.top - calendarTipEl.offsetHeight - 6, 6)}px`;
}

function hideCalTooltip() {
    if (calendarTipEl) calendarTipEl.style.display = 'none';
}

/**
 * Calculates current streak in consecutive days.
 */
export function calculateStreak(dailyCounts) {
    const dates = Object.keys(dailyCounts || {})
        .filter(d => (dailyCounts[d] || 0) > 0)
        .sort()
        .reverse();

    if (dates.length === 0) return 0;

    const todayStr = getLocalDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);

    let streak = 0;
    let expectedDate = dates.includes(todayStr) ? new Date() : (dates.includes(yesterdayStr) ? yesterday : null);

    if (!expectedDate) return 0;

    for (const dStr of dates) {
        const curExpStr = getLocalDateString(expectedDate);
        if (dStr === curExpStr) {
            streak++;
            expectedDate.setDate(expectedDate.getDate() - 1);
        } else if (dStr < curExpStr) {
            break;
        }
    }
    return streak;
}

/**
 * Builds HTML for GitHub-style monthly activity calendar.
 */
function buildCalendarHTML(dailyCounts, targetYm, progressMonths, todayStr) {
    const pad = n => String(n).padStart(2, '0');
    const curIndex = Math.max(0, progressMonths.indexOf(targetYm));
    const ym = progressMonths[curIndex] || todayStr.slice(0, 7);
    const [year, monthNum] = ym.split('-').map(Number);
    const month = monthNum - 1;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leadDays = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0

    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${pad(month + 1)}-${pad(d)}`;
        days.push({
            d,
            dateStr,
            count: Number(dailyCounts[dateStr]) || 0,
            isFuture: dateStr > todayStr,
            isToday: dateStr === todayStr
        });
    }

    const monthTotal = days.reduce((sum, x) => sum + x.count, 0);
    const todayCount = Number(dailyCounts[todayStr]) || 0;

    // Heatmap level mapping (0-4)
    const getLevel = (c) => {
        if (c <= 0) return 0;
        if (c <= 10) return 1;
        if (c <= 25) return 2;
        if (c <= 50) return 3;
        return 4;
    };

    const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    let cellsHtml = '';
    for (let i = 0; i < leadDays; i++) {
        cellsHtml += '<div class="act-cell empty"></div>';
    }

    days.forEach(x => {
        const tipDate = new Date(year, month, x.d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const tip = x.isFuture ? tipDate : `${tipDate}: ${x.count.toLocaleString('en-US')} question${x.count === 1 ? '' : 's'}`;
        const cls = `act-cell lvl-${getLevel(x.count)}${x.isToday ? ' today' : ''}${x.isFuture ? ' future' : ''}`;
        cellsHtml += `<div class="${cls}" data-tip="${tip}">${x.d}</div>`;
    });

    for (let i = leadDays + daysInMonth; i < 42; i++) {
        cellsHtml += '<div class="act-cell empty"></div>';
    }

    const weekdays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(w => `<span>${w}</span>`).join('');
    const prevDisabled = curIndex <= 0 ? 'disabled' : '';
    const nextDisabled = curIndex >= progressMonths.length - 1 ? 'disabled' : '';

    const html = `
        <div class="ps-calendar-header">
            <div class="ps-mastery-title-group">
                <span class="ps-calendar-icon" style="display:inline-flex;align-items:center;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--primary);"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </span>
                <span class="ps-mastery-title">Activity Calendar</span>
            </div>
            <div class="act-nav">
                <button type="button" class="act-nav-btn" data-cal-nav="-1" aria-label="Previous month" ${prevDisabled}>‹</button>
                <span class="act-nav-label">${monthLabel}</span>
                <button type="button" class="act-nav-btn" data-cal-nav="1" aria-label="Next month" ${nextDisabled}>›</button>
            </div>
        </div>
        <div class="act-weekdays">${weekdays}</div>
        <div class="act-grid">${cellsHtml}</div>
        <div class="act-footer">
            <span class="act-footer-text">Today: <strong>${todayCount}</strong> Qs · Month: <strong>${monthTotal}</strong> Qs</span>
            <span class="act-legend">Less <i class="act-swatch lvl-0"></i><i class="act-swatch lvl-1"></i><i class="act-swatch lvl-2"></i><i class="act-swatch lvl-3"></i><i class="act-swatch lvl-4"></i> More</span>
        </div>
    `;

    return { html, ym, monthTotal, todayCount };
}

/**
 * Primary rendering function for profile stats and activity heatmap.
 */
export async function renderProfileDashboard(modalContainer) {
    if (!modalContainer) return;

    const { profile, stats } = await getUserProfile();
    const storage = await getStorageHealth();
    const todayStr = getLocalDateString();
    const dailyCounts = stats.dailyCounts || {};

    // 1. Compute distinct active months
    const monthSet = new Set();
    Object.keys(dailyCounts).forEach(d => {
        if ((dailyCounts[d] || 0) > 0) monthSet.add(d.slice(0, 7));
    });
    monthSet.add(todayStr.slice(0, 7));
    const progressMonths = Array.from(monthSet).sort();

    if (!activeMonthCursor || !progressMonths.includes(activeMonthCursor)) {
        activeMonthCursor = progressMonths[progressMonths.length - 1];
    }

    // 2. Populate Header & Lifetime Stats
    const lifetimeAnsweredEl = modalContainer.querySelector('#prof-lifetime-answered');
    const masteredValEl = modalContainer.querySelector('#prof-mastered-val');
    const totalValEl = modalContainer.querySelector('#prof-total-val');
    const pctValEl = modalContainer.querySelector('#prof-pct-val');
    const masteryFillEl = modalContainer.querySelector('#prof-mastery-fill');

    const totalAnswered = stats.totalQuestionsAnswered || 0;
    const masteredCount = stats.masteredQuestionsCount || 0;
    const totalQuestions = stats.totalQuestionsInLibrary || masteredCount;
    const pct = totalQuestions > 0 ? Math.round((masteredCount / totalQuestions) * 100) : 0;

    if (lifetimeAnsweredEl) lifetimeAnsweredEl.textContent = fmtNum(totalAnswered);
    if (masteredValEl) masteredValEl.textContent = fmtNum(masteredCount);
    if (totalValEl) totalValEl.textContent = fmtNum(totalQuestions);
    if (pctValEl) pctValEl.textContent = fmtPct(pct);
    if (masteryFillEl) masteryFillEl.style.width = `${Math.min(100, pct)}%`;

    // 3. Render Calendar Heatmap
    const calContainer = modalContainer.querySelector('#profile-calendar-card');
    if (calContainer) {
        const calData = buildCalendarHTML(dailyCounts, activeMonthCursor, progressMonths, todayStr);
        calContainer.innerHTML = calData.html;
    }

    // 4. Update Storage Health Display
    const quotaTextEl = modalContainer.querySelector('#storage-quota-text');
    const persistStatusEl = modalContainer.querySelector('#storage-persist-status');
    if (quotaTextEl) quotaTextEl.textContent = `${storage.usageMB} MB / ${storage.quotaMB} MB (${storage.percentUsed}%)`;
    if (persistStatusEl) persistStatusEl.textContent = storage.isPersisted ? 'Persistent (Protected)' : 'Standard (Subject to ITP)';

    // 5. Attach Calendar Events
    attachCalendarListeners(modalContainer, dailyCounts, progressMonths, todayStr);

    // 6. Attach Export / Import JSON actions
    const exportBtn = modalContainer.querySelector('#export-json-btn');
    if (exportBtn && !exportBtn.dataset.bound) {
        exportBtn.dataset.bound = 'true';
        exportBtn.onclick = async () => {
            try {
                await exportFullDatabaseJSON();
            } catch (err) {
                alert(`Export failed: ${err.message}`);
            }
        };
    }

    const importInput = modalContainer.querySelector('#import-json-input');
    if (importInput && !importInput.dataset.bound) {
        importInput.dataset.bound = 'true';
        importInput.onchange = async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (evt) => {
                try {
                    const text = evt.target.result;
                    const res = await importFullDatabaseJSON(text, 'merge');
                    alert(`Database restored successfully! (${res.count} items merged)`);
                    window.location.reload();
                } catch (err) {
                    alert(`Restore failed: ${err.message}`);
                }
            };
            reader.readAsText(file);
        };
    }
}

function attachCalendarListeners(container, dailyCounts, progressMonths, todayStr) {
    if (container.dataset.calBound) return;
    container.dataset.calBound = 'true';

    container.addEventListener('mouseover', (e) => {
        const cell = e.target.closest('.act-cell:not(.empty)');
        if (cell) showCalTooltip(cell);
    });

    container.addEventListener('mouseout', (e) => {
        if (e.target.closest('.act-cell')) hideCalTooltip();
    });

    container.addEventListener('click', (e) => {
        const navBtn = e.target.closest('[data-cal-nav]');
        if (navBtn && !navBtn.disabled) {
            const delta = parseInt(navBtn.dataset.calNav, 10) || 0;
            const curIdx = progressMonths.indexOf(activeMonthCursor);
            const nextIdx = Math.min(progressMonths.length - 1, Math.max(0, curIdx + delta));
            if (nextIdx !== curIdx) {
                activeMonthCursor = progressMonths[nextIdx];
                hideCalTooltip();
                const calContainer = container.querySelector('#profile-calendar-card');
                if (calContainer) {
                    const calData = buildCalendarHTML(dailyCounts, activeMonthCursor, progressMonths, todayStr);
                    calContainer.innerHTML = calData.html;
                }
            }
        }
    });

    if (typeof document !== 'undefined') {
        document.addEventListener('scroll', hideCalTooltip, true);
    }
}
