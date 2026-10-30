/**
 * set-manager.js — Study Set Library Management & CRUD Controller
 * Standalone Public Quiz Platform
 */

import { saveStudySet, getAllStudySets, getStudySet, deleteStudySet, getMasteryStates } from './db.js';

export class SetManager {
    constructor() {
        this.sets = [];
    }

    async init() {
        await this.ensureStarterSetLoaded();
        return this.loadSets();
    }

    async loadSets() {
        this.sets = await getAllStudySets();
        this.sets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return this.sets;
    }

    async getAllSets() {
        return this.loadSets();
    }

    async getSetWithQuestions(setId) {
        return getStudySet(setId);
    }

    async saveSet(studySet, questions) {
        const now = Date.now();
        const setRecord = {
            id: studySet.id || `set_${now}_${Math.random().toString(36).slice(2, 7)}`,
            title: (studySet.title || 'Untitled Study Set').trim(),
            description: (studySet.description || '').trim(),
            category: (studySet.category || 'General').trim(),
            questionCount: questions.length,
            source: studySet.source || 'manual',
            color: studySet.color || '#4f46e5',
            createdAt: studySet.createdAt || now,
            updatedAt: now
        };

        const normalizedQuestions = questions.map((q, idx) => ({
            id: q.id || `q_${now}_${idx + 1}`,
            setId: setRecord.id,
            type: q.type || 'mcq',
            order: idx + 1,
            question_text: (q.question_text || '').trim(),
            choices: Array.isArray(q.choices) ? q.choices.map(c => String(c).trim()) : [],
            answer: (q.answer || '').trim(),
            explanation: (q.explanation || '').trim(),
            tags: Array.isArray(q.tags) ? q.tags : [],
            starred: Boolean(q.starred),
            createdAt: q.createdAt || now
        }));

        await saveStudySet(setRecord, normalizedQuestions);
        await this.loadSets();
        return setRecord;
    }

    async renameSet(setId, newTitle) {
        const trimmed = (newTitle || '').trim();
        if (!trimmed) return false;

        const data = await getStudySet(setId);
        if (!data || !data.set) return false;

        data.set.title = trimmed;
        data.set.updatedAt = Date.now();
        await saveStudySet(data.set, data.questions);
        await this.loadSets();
        return true;
    }

    async duplicateSet(setId) {
        const data = await getStudySet(setId);
        if (!data || !data.set) return null;

        const now = Date.now();
        const newSetId = `set_${now}_dup`;
        const clonedSet = {
            ...data.set,
            id: newSetId,
            title: `${data.set.title} (Copy)`,
            createdAt: now,
            updatedAt: now
        };

        const clonedQuestions = data.questions.map((q, idx) => ({
            ...q,
            id: `q_${now}_${idx + 1}`,
            setId: newSetId,
            createdAt: now
        }));

        await saveStudySet(clonedSet, clonedQuestions);
        await this.loadSets();
        return clonedSet;
    }

    async deleteSet(setId) {
        const ok = await deleteStudySet(setId);
        await this.loadSets();
        return ok;
    }

    async exportSetJSON(setId) {
        const data = await getStudySet(setId);
        if (!data || !data.set) throw new Error('Study set not found.');

        const exportPayload = {
            ...data.set,
            questions: data.questions
        };

        const jsonString = JSON.stringify(exportPayload, null, 2);
        if (typeof document !== 'undefined' && typeof window !== 'undefined' && window.URL) {
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const safeTitle = data.set.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            a.href = url;
            a.download = `studyset_${safeTitle}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
        return jsonString;
    }

    async ensureStarterSetLoaded() {
        const existing = await getAllStudySets();
        if (existing && existing.length > 0) return;

        try {
            const res = await fetch('samples/sample_circuits_set.json');
            if (res.ok) {
                const sampleData = await res.json();
                if (sampleData && sampleData.questions) {
                    await this.saveSet(sampleData, sampleData.questions);
                    console.log('[SetManager] Starter sample set loaded successfully.');
                }
            }
        } catch (err) {
            console.warn('[SetManager] Could not load sample starter set:', err);
        }
    }

    async renderLibraryGrid(gridContainer, onAction) {
        if (!gridContainer) return;

        const sets = await this.loadSets();
        const emptyState = document.getElementById('empty-library-state');

        if (sets.length === 0) {
            gridContainer.innerHTML = '';
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');

        // Fetch mastery progress for each set in parallel
        const cardsHtml = await Promise.all(sets.map(async (set) => {
            let masteryPercent = 0;
            try {
                const states = await getMasteryStates(set.id);
                const masteredCount = states.filter(s => s.consecutiveCorrect >= 2).length;
                masteryPercent = set.questionCount > 0 ? Math.round((masteredCount / set.questionCount) * 100) : 0;
            } catch (_) { }

            const updatedDate = new Date(set.updatedAt || set.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            return `
                <div class="study-set-card glass-panel" data-set-id="${set.id}">
                    <div>
                        <div class="set-card-header">
                            <div>
                                <span class="set-card-category">${set.category || 'General'}</span>
                                <h3 class="set-card-title">${set.title}</h3>
                            </div>
                            <span class="set-card-count">${set.questionCount} Qs</span>
                        </div>
                        ${set.description ? `<p class="set-card-desc" style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.75rem;">${set.description}</p>` : ''}
                        <div class="set-card-meta" style="font-size:0.75rem;color:var(--text-dim);margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;">
                            <span>Updated ${updatedDate}</span>
                            <span>Mastery: <strong>${masteryPercent}%</strong></span>
                        </div>
                        <div class="progress-bar-wrap" style="height:4px;margin-bottom:0.75rem;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
                            <div style="height:100%;width:${masteryPercent}%;background:var(--primary);transition:width 0.3s ease;"></div>
                        </div>
                    </div>
                    <div class="set-card-actions">
                        <button class="set-action-btn speedrun" data-action="speedrun" data-set-id="${set.id}" title="Test Mode (Speedrun Exam)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="color:#f59e0b;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                            <span>Speedrun</span>
                        </button>
                        <button class="set-action-btn mastery" data-action="mastery" data-set-id="${set.id}" title="Mastery Mode (Spaced Repetition)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                            <span>Mastery</span>
                        </button>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.75rem;padding-top:0.5rem;border-top:1px solid var(--glass-border);">
                        <button class="btn-link" data-action="inspect" data-set-id="${set.id}" style="font-size:0.8rem;background:none;border:none;color:var(--primary);cursor:pointer;">Inspect Set</button>
                        <div style="display:flex;gap:0.4rem;">
                            <button class="nav-icon-btn" data-action="export" data-set-id="${set.id}" title="Export JSON" style="width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            </button>
                            <button class="nav-icon-btn" data-action="duplicate" data-set-id="${set.id}" title="Duplicate" style="width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            </button>
                            <button class="nav-icon-btn" data-action="rename" data-set-id="${set.id}" title="Rename" style="width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button class="nav-icon-btn" data-action="delete" data-set-id="${set.id}" title="Delete" style="width:28px;height:28px;color:var(--wrong);display:inline-flex;align-items:center;justify-content:center;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }));

        gridContainer.innerHTML = cardsHtml.join('');

        if (onAction) {
            gridContainer.querySelectorAll('[data-action]').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    const setId = btn.dataset.setId;
                    onAction(action, setId);
                };
            });
        }
    }
}
