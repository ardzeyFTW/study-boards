/**
 * app.js — Main Application Controller, Quiz Runner & Client-Side Hash Router
 * Standalone Public Quiz Platform
 * Pure client-side, zero backend, zero Firebase/Cloudflare egress.
 */

import {
    initDB,
    getStudySet,
    getAllStudySets,
    saveMasteryState,
    getMasteryStates,
    saveActiveSession,
    getActiveSession,
    clearActiveSession,
    saveSessionHistory,
    getUserProfile,
    updateUserProfile,
    initStoragePersistence,
    exportFullDatabaseJSON
} from './db.js';
import { SetManager } from './set-manager.js';
import { ImportUI } from './import-ui.js';
import { MasteryEngine, initMasteryQueue } from './mastery.js';
import { renderProfileDashboard, calculateStreak } from './profile.js';
import { attachRippleEffect, applyChoiceFeedback, animateNumber } from './anim.js';
import { launchCelebrationConfetti } from './confetti.js';

/* ==========================================================================
   STOPWATCH TIMER FOR SPEEDRUN EXAMS
   ========================================================================== */
class QuizStopwatch {
    constructor(onTick, initialSeconds = 0) {
        this.onTick = onTick;
        this.accumulatedMs = initialSeconds * 1000;
        this.timerId = null;
        this.lastTimestamp = null;
    }

    start() {
        if (this.timerId) return;
        this.lastTimestamp = performance.now();
        this.timerId = setInterval(() => {
            const now = performance.now();
            const delta = now - this.lastTimestamp;
            this.lastTimestamp = now;
            this.accumulatedMs += delta;
            if (this.onTick) {
                this.onTick(this.getElapsedSeconds(), this.formatTime());
            }
        }, 250);
    }

    pause() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
    }

    reset() {
        this.pause();
        this.accumulatedMs = 0;
    }

    getElapsedSeconds() {
        return Math.floor(this.accumulatedMs / 1000);
    }

    formatTime() {
        const totalSec = this.getElapsedSeconds();
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const pad = n => String(n).padStart(2, '0');
        if (mins >= 60) {
            const hrs = Math.floor(mins / 60);
            const remMins = mins % 60;
            return `${pad(hrs)}:${pad(remMins)}:${pad(secs)}`;
        }
        return `${pad(mins)}:${pad(secs)}`;
    }
}

/* ==========================================================================
   CLIENT-SIDE HASH ROUTER
   ========================================================================== */
class HashRouter {
    constructor(routes, defaultRoute = '#/sets') {
        this.routes = routes;
        this.defaultRoute = defaultRoute;
        this.currentRoute = null;

        window.addEventListener('hashchange', () => this.handleRoute());
        window.addEventListener('popstate', () => this.handleRoute());
    }

    start() {
        if (!window.location.hash) {
            window.location.hash = this.defaultRoute;
        } else {
            this.handleRoute();
        }
    }

    navigate(hash) {
        if (window.location.hash === hash) {
            this.handleRoute();
        } else {
            window.location.hash = hash;
        }
    }

    handleRoute() {
        const fullHash = window.location.hash || this.defaultRoute;
        const [path, queryString] = fullHash.split('?');
        const params = new URLSearchParams(queryString || '');

        for (const [pattern, handler] of Object.entries(this.routes)) {
            const match = this.matchRoute(pattern, path);
            if (match) {
                this.currentRoute = { path, pattern, pathParams: match, queryParams: params };
                handler(match, params);
                return;
            }
        }

        // Fallback
        if (fullHash !== this.defaultRoute) {
            this.navigate(this.defaultRoute);
        }
    }

    matchRoute(pattern, path) {
        const patternParts = pattern.split('/');
        const pathParts = path.split('/');

        if (patternParts.length !== pathParts.length) return null;

        const params = {};
        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(':')) {
                const paramName = patternParts[i].slice(1);
                params[paramName] = decodeURIComponent(pathParts[i]);
            } else if (patternParts[i] !== pathParts[i]) {
                return null;
            }
        }
        return params;
    }
}

/* ==========================================================================
   APPLICATION SINGLETON
   ========================================================================== */
class StudyBoardsApp {
    constructor() {
        this.setManager = new SetManager();
        this.importUI = null;
        this.router = null;

        // Current active quiz state
        this.currentSet = null;
        this.currentQuestions = [];
        this.quizMode = 'speedrun'; // 'speedrun' | 'mastery'
        this.speedrunIndex = 0;
        this.speedrunScore = 0;
        this.speedrunAnswers = []; // { question, selectedAnswer, isCorrect }
        this.masteryEngine = null;
        this.stopwatch = null;
        this.activeQuestion = null;
        this.hasAnsweredCurrent = false;

        // Settings
        this.settings = {
            fontSize: 18,
            showProgress: true,
            autoExplain: false
        };
    }

    async init() {
        console.log('[App] Initializing Study Boards Public Platform...');

        // 1. Initialize DB and persistent storage
        await initDB();
        await initStoragePersistence();

        // 2. Initialize SetManager & sample starter set
        await this.setManager.init();

        // 3. Initialize UI elements
        this.initTheme();
        this.initSettings();
        this.initStorageAdvisoryBanner();
        this.initResumeBanner();
        this.attachGlobalNavEvents();

        // 4. Initialize Import UI
        const importModal = document.getElementById('import-modal');
        this.importUI = new ImportUI(importModal, this.setManager, (savedSet, startQuizImmediately) => {
            if (startQuizImmediately) {
                this.router.navigate(`#/quiz/${savedSet.id}?mode=speedrun`);
            } else {
                this.router.navigate('#/sets');
                this.refreshLibrary();
            }
        });

        // 5. Initialize Hash Router
        this.initRouter();

        // 6. Refresh home library & stats
        await this.refreshHomeStats();
        await this.refreshLibrary();
    }

    initRouter() {
        const routes = {
            '#/sets': () => this.showHomeScreen(),
            '#/import': () => {
                this.showHomeScreen();
                if (this.importUI) this.importUI.open();
            },
            '#/set/:id': ({ id }) => this.showSetDetailScreen(id),
            '#/quiz/:id': ({ id }, params) => {
                const mode = params.get('mode') || 'speedrun';
                this.startQuiz(id, mode);
            },
            '#/profile': () => {
                this.showHomeScreen();
                this.openProfileModal();
            }
        };

        this.router = new HashRouter(routes, '#/sets');
        this.router.start();
    }

    /* ---------------- Theme & Settings ---------------- */
    initTheme() {
        const savedTheme = localStorage.getItem('quizTheme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        this.updateThemeIcons(savedTheme);

        const themeToggleBtn = document.getElementById('theme-toggle-btn');
        if (themeToggleBtn) {
            themeToggleBtn.onclick = () => {
                const current = document.documentElement.getAttribute('data-theme') || 'dark';
                const next = current === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                localStorage.setItem('quizTheme', next);
                this.updateThemeIcons(next);
            };
        }
    }

    updateThemeIcons(theme) {
        const darkIcon = document.querySelector('.theme-icon-dark');
        const lightIcon = document.querySelector('.theme-icon-light');
        if (darkIcon && lightIcon) {
            if (theme === 'dark') {
                darkIcon.style.display = 'inline';
                lightIcon.style.display = 'none';
            } else {
                darkIcon.style.display = 'none';
                lightIcon.style.display = 'inline';
            }
        }
    }

    initSettings() {
        try {
            const saved = localStorage.getItem('quizSettings');
            if (saved) this.settings = { ...this.settings, ...JSON.parse(saved) };
        } catch (_) {}

        const slider = document.getElementById('font-size-slider');
        const valSpan = document.getElementById('font-size-val');
        if (slider && valSpan) {
            slider.value = this.settings.fontSize;
            valSpan.textContent = `${this.settings.fontSize}px`;
            slider.oninput = () => {
                this.settings.fontSize = parseInt(slider.value, 10);
                valSpan.textContent = `${this.settings.fontSize}px`;
                this.applyQuestionFontSize();
                this.saveSettings();
            };
        }

        const autoExplainCheck = document.getElementById('toggle-auto-explain');
        if (autoExplainCheck) {
            autoExplainCheck.checked = Boolean(this.settings.autoExplain);
            autoExplainCheck.onchange = () => {
                this.settings.autoExplain = autoExplainCheck.checked;
                this.saveSettings();
            };
        }

        this.applyQuestionFontSize();
    }

    saveSettings() {
        try {
            localStorage.setItem('quizSettings', JSON.stringify(this.settings));
        } catch (_) {}
    }

    applyQuestionFontSize() {
        const qText = document.getElementById('question-text');
        if (qText) qText.style.fontSize = `${this.settings.fontSize}px`;
    }

    /* ---------------- Storage Eviction Advisory Banner ---------------- */
    initStorageAdvisoryBanner() {
        const banner = document.getElementById('storage-advisory-banner');
        if (!banner) return;

        const lastBackup = localStorage.getItem('quizLastBackupTimestamp');
        const now = Date.now();
        const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

        if (!lastBackup || (now - parseInt(lastBackup, 10) > fiveDaysMs)) {
            banner.classList.remove('hidden');
        }

        const backupBtn = document.getElementById('banner-backup-btn');
        if (backupBtn) {
            backupBtn.onclick = async () => {
                await exportFullDatabaseJSON();
                banner.classList.add('hidden');
            };
        }

        const dismissBtn = document.getElementById('banner-dismiss-btn');
        if (dismissBtn) {
            dismissBtn.onclick = () => {
                banner.classList.add('hidden');
                localStorage.setItem('quizLastBackupTimestamp', Date.now().toString());
            };
        }
    }

    /* ---------------- Multi-Session Resumption ---------------- */
    initResumeBanner() {
        const banner = document.getElementById('continue-quiz-container');
        if (!banner) return;

        let pointer = null;
        try {
            pointer = JSON.parse(localStorage.getItem('quizActiveSession'));
        } catch (_) {}

        if (pointer && pointer.setId && pointer.title) {
            const titleEl = document.getElementById('continue-title');
            const metaEl = document.getElementById('continue-meta');
            if (titleEl) titleEl.textContent = `Resume: ${pointer.title}`;
            if (metaEl) {
                const modeLabel = pointer.mode === 'mastery' ? 'Mastery Mode' : 'Test Mode';
                metaEl.textContent = `${modeLabel} · ${pointer.progressPercent || 0}% complete`;
            }
            banner.classList.remove('hidden');

            const resumeBtn = document.getElementById('resume-quiz-btn');
            if (resumeBtn) {
                resumeBtn.onclick = async () => {
                    const session = await getActiveSession(pointer.setId);
                    if (session) {
                        this.resumeQuizSession(session);
                    } else {
                        localStorage.removeItem('quizActiveSession');
                        banner.classList.add('hidden');
                    }
                };
            }

            const abandonBtn = document.getElementById('abandon-quiz-btn');
            if (abandonBtn) {
                abandonBtn.onclick = async () => {
                    if (confirm('Discard this in-progress quiz session?')) {
                        await clearActiveSession(pointer.setId);
                        localStorage.removeItem('quizActiveSession');
                        banner.classList.add('hidden');
                    }
                };
            }
        } else {
            banner.classList.add('hidden');
        }
    }

    /* ---------------- Navigation & Screen Transitions ---------------- */
    attachGlobalNavEvents() {
        // Brand logo button
        const brandBtn = document.getElementById('nav-brand-btn');
        if (brandBtn) brandBtn.onclick = () => this.router.navigate('#/sets');

        // Nav import button
        const navImportBtn = document.getElementById('nav-import-btn');
        if (navImportBtn) navImportBtn.onclick = () => this.router.navigate('#/import');

        // Empty state import & sample buttons
        const emptyImportBtn = document.getElementById('empty-import-btn');
        if (emptyImportBtn) emptyImportBtn.onclick = () => this.router.navigate('#/import');

        const emptySampleBtn = document.getElementById('empty-sample-btn');
        if (emptySampleBtn) emptySampleBtn.onclick = async () => {
            await this.setManager.ensureStarterSetLoaded();
            await this.refreshLibrary();
        };

        // Profile button
        const profileBtn = document.getElementById('profile-btn');
        if (profileBtn) profileBtn.onclick = () => this.router.navigate('#/profile');

        const closeProfileBtn = document.getElementById('close-profile-btn');
        if (closeProfileBtn) {
            closeProfileBtn.onclick = () => {
                const modal = document.getElementById('profile-modal');
                if (modal) modal.classList.remove('active');
                if (window.location.hash === '#/profile') this.router.navigate('#/sets');
            };
        }

        // Settings modal
        const settingsBtn = document.getElementById('settings-btn');
        const settingsModal = document.getElementById('settings-modal');
        const closeSettingsBtn = document.getElementById('close-settings-btn');
        if (settingsBtn && settingsModal) {
            settingsBtn.onclick = () => settingsModal.classList.add('active');
        }
        if (closeSettingsBtn && settingsModal) {
            closeSettingsBtn.onclick = () => settingsModal.classList.remove('active');
        }

        // Quiz back button
        const backToSetsBtn = document.getElementById('back-to-sets-btn');
        if (backToSetsBtn) {
            backToSetsBtn.onclick = () => {
                if (this.stopwatch) this.stopwatch.pause();
                this.router.navigate('#/sets');
            };
        }

        // Results screen actions
        const retakeBtn = document.getElementById('retake-quiz-btn');
        if (retakeBtn) {
            retakeBtn.onclick = () => {
                if (this.currentSet) {
                    this.startQuiz(this.currentSet.id, this.quizMode);
                } else {
                    this.router.navigate('#/sets');
                }
            };
        }

        const resultsHomeBtn = document.getElementById('results-home-btn');
        if (resultsHomeBtn) resultsHomeBtn.onclick = () => this.router.navigate('#/sets');

        // Next Question button
        const nextBtn = document.getElementById('next-question-btn');
        if (nextBtn) {
            nextBtn.onclick = () => this.advanceToNextQuestion();
        }

        // Explanation accordion toggle
        const explainHeader = document.getElementById('explanation-toggle-btn');
        const explainContent = document.getElementById('explanation-content');
        const chevron = document.getElementById('explanation-chevron');
        if (explainHeader && explainContent) {
            explainHeader.onclick = () => {
                const isHidden = explainContent.classList.contains('hidden');
                if (isHidden) {
                    explainContent.classList.remove('hidden');
                    if (chevron) chevron.textContent = '▲';
                } else {
                    explainContent.classList.add('hidden');
                    if (chevron) chevron.textContent = '▼';
                }
            };
        }

        // Hint button
        const hintBtn = document.getElementById('hint-btn');
        const hintBox = document.getElementById('hint-box');
        if (hintBtn && hintBox) {
            hintBtn.onclick = () => {
                if (this.activeQuestion && this.activeQuestion.explanation) {
                    hintBox.textContent = `💡 Hint: ${this.activeQuestion.explanation.slice(0, 100)}...`;
                    hintBox.classList.remove('hidden');
                }
            };
        }

        // Search input on library
        const searchInput = document.getElementById('set-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const q = searchInput.value.toLowerCase().trim();
                document.querySelectorAll('.study-set-card').forEach(card => {
                    const title = (card.querySelector('.set-card-title')?.textContent || '').toLowerCase();
                    const category = (card.querySelector('.set-card-category')?.textContent || '').toLowerCase();
                    if (!q || title.includes(q) || category.includes(q)) {
                        card.style.display = 'flex';
                    } else {
                        card.style.display = 'none';
                    }
                });
            });
        }
    }

    switchScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(screenId);
        if (target) target.classList.add('active');
        window.scrollTo(0, 0);
    }

    showHomeScreen() {
        this.switchScreen('home-screen');
        this.initResumeBanner();
        this.refreshHomeStats();
        this.refreshLibrary();
    }

    async refreshLibrary() {
        const grid = document.getElementById('study-sets-grid');
        if (!grid) return;
        await this.setManager.renderLibraryGrid(grid, async (action, setId) => {
            if (action === 'speedrun') {
                this.router.navigate(`#/quiz/${setId}?mode=speedrun`);
            } else if (action === 'mastery') {
                this.router.navigate(`#/quiz/${setId}?mode=mastery`);
            } else if (action === 'inspect') {
                this.router.navigate(`#/set/${setId}`);
            } else if (action === 'export') {
                await this.setManager.exportSetJSON(setId);
            } else if (action === 'duplicate') {
                await this.setManager.duplicateSet(setId);
                await this.refreshLibrary();
            } else if (action === 'rename') {
                const newTitle = prompt('Enter new title for study set:');
                if (newTitle) {
                    await this.setManager.renameSet(setId, newTitle);
                    await this.refreshLibrary();
                }
            } else if (action === 'delete') {
                if (confirm('Are you sure you want to delete this study set and all question records?')) {
                    await this.setManager.deleteSet(setId);
                    await clearActiveSession(setId);
                    await this.refreshLibrary();
                    await this.refreshHomeStats();
                }
            }
        });
    }

    async refreshHomeStats() {
        try {
            const { stats } = await getUserProfile();
            const totalAnsEl = document.getElementById('stat-total-answered');
            const masteredEl = document.getElementById('stat-mastered-count');
            const streakEl = document.getElementById('stat-streak-days');

            const streak = calculateStreak(stats.dailyCounts || {});

            if (totalAnsEl) totalAnsEl.textContent = Number(stats.totalQuestionsAnswered || 0).toLocaleString();
            if (masteredEl) masteredEl.textContent = Number(stats.masteredQuestionsCount || 0).toLocaleString();
            if (streakEl) streakEl.textContent = `${streak}🔥`;
        } catch (_) {}
    }

    async showSetDetailScreen(setId) {
        const data = await getStudySet(setId);
        if (!data || !data.set) {
            this.router.navigate('#/sets');
            return;
        }

        // Show set details or start quiz
        const startMode = confirm(`Start quiz for "${data.set.title}"?\n\nClick OK for Speedrun (Test Mode), or Cancel for Mastery Mode.`);
        if (startMode) {
            this.router.navigate(`#/quiz/${setId}?mode=speedrun`);
        } else {
            this.router.navigate(`#/quiz/${setId}?mode=mastery`);
        }
    }

    openProfileModal() {
        const modal = document.getElementById('profile-modal');
        if (modal) {
            modal.classList.add('active');
            renderProfileDashboard(modal);
        }
    }

    /* ==========================================================================
       QUIZ EXECUTION ENGINE (SPEEDRUN & MASTERY)
       ========================================================================== */
    async startQuiz(setId, mode = 'speedrun') {
        const data = await getStudySet(setId);
        if (!data || !data.set || data.questions.length === 0) {
            alert('Study set not found or contains no questions.');
            this.router.navigate('#/sets');
            return;
        }

        this.currentSet = data.set;
        this.currentQuestions = data.questions;
        this.quizMode = mode;
        this.speedrunIndex = 0;
        this.speedrunScore = 0;
        this.speedrunAnswers = [];
        this.hasAnsweredCurrent = false;

        // Reset and initialize stopwatch
        if (this.stopwatch) this.stopwatch.reset();
        this.stopwatch = new QuizStopwatch((sec, formatted) => {
            const timerEl = document.getElementById('quiz-timer-text');
            if (timerEl) timerEl.textContent = formatted;
        });

        // Initialize header badges
        const setTitleBadge = document.getElementById('quiz-set-title-badge');
        if (setTitleBadge) setTitleBadge.textContent = `${this.currentSet.title} (${mode === 'mastery' ? 'Mastery' : 'Speedrun'})`;

        const scoreBadge = document.getElementById('quiz-score-badge');
        if (scoreBadge) scoreBadge.textContent = 'Score: 0';

        if (mode === 'mastery') {
            const existingStates = await getMasteryStates(setId);
            this.masteryEngine = initMasteryQueue(this.currentQuestions, existingStates);
        } else {
            this.masteryEngine = null;
        }

        this.switchScreen('quiz-screen');
        this.stopwatch.start();
        this.renderNextQuestion();
    }

    async resumeQuizSession(session) {
        const data = await getStudySet(session.setId);
        if (!data || !data.set) {
            alert('Study set for active session no longer exists.');
            return;
        }

        this.currentSet = data.set;
        this.currentQuestions = data.questions;
        this.quizMode = session.mode || 'mastery';
        this.speedrunIndex = session.currentQuestionIndex || 0;
        this.speedrunScore = session.score || 0;
        this.speedrunAnswers = [];
        this.hasAnsweredCurrent = false;

        if (this.stopwatch) this.stopwatch.reset();
        this.stopwatch = new QuizStopwatch((sec, formatted) => {
            const timerEl = document.getElementById('quiz-timer-text');
            if (timerEl) timerEl.textContent = formatted;
        }, session.elapsedSeconds || 0);

        if (this.quizMode === 'mastery') {
            const existingStates = await getMasteryStates(session.setId);
            this.masteryEngine = initMasteryQueue(this.currentQuestions, existingStates, session.masteryQueue);
        }

        this.switchScreen('quiz-screen');
        this.stopwatch.start();
        this.renderNextQuestion();
    }

    renderNextQuestion() {
        this.hasAnsweredCurrent = false;

        // Hide explanation & hint
        const explainBox = document.getElementById('explanation-container');
        const explainContent = document.getElementById('explanation-content');
        const hintBox = document.getElementById('hint-box');
        const nextBtn = document.getElementById('next-question-btn');

        if (explainBox) explainBox.classList.add('hidden');
        if (explainContent) explainContent.classList.add('hidden');
        if (hintBox) hintBox.classList.add('hidden');
        if (nextBtn) nextBtn.classList.add('hidden');

        let q = null;
        let progressPercent = 0;
        let counterText = '';

        if (this.quizMode === 'mastery') {
            if (this.masteryEngine.isComplete()) {
                this.completeQuiz();
                return;
            }
            q = this.masteryEngine.currentQuestion();
            const prog = this.masteryEngine.getProgress();
            progressPercent = prog.pointsPercentage;
            counterText = `Mastery: ${prog.masteredCount}/${prog.totalQuestions} (${prog.remainingQueueCount} in queue)`;
        } else {
            // Speedrun
            if (this.speedrunIndex >= this.currentQuestions.length) {
                this.completeQuiz();
                return;
            }
            q = this.currentQuestions[this.speedrunIndex];
            progressPercent = Math.round((this.speedrunIndex / this.currentQuestions.length) * 100);
            counterText = `Question ${this.speedrunIndex + 1}/${this.currentQuestions.length}`;
        }

        this.activeQuestion = q;

        // Update progress bar
        const progressFill = document.getElementById('quiz-progress-fill');
        if (progressFill) progressFill.style.width = `${progressPercent}%`;

        // Update counter
        const counterEl = document.getElementById('quiz-counter-text');
        if (counterEl) counterEl.textContent = counterText;

        // Render Question statement
        const qTextEl = document.getElementById('question-text');
        if (qTextEl) qTextEl.textContent = q.question_text;

        const qTypeBadge = document.getElementById('question-type-badge');
        if (qTypeBadge) {
            qTypeBadge.textContent = q.type === 'identification' ? 'Identification' : 'Multiple Choice';
        }

        // Render Choices
        const choicesContainer = document.getElementById('choices-container');
        const idContainer = document.getElementById('id-input-container');

        if (q.type === 'identification') {
            if (choicesContainer) choicesContainer.innerHTML = '';
            if (idContainer) {
                idContainer.classList.remove('hidden');
                const input = document.getElementById('id-answer-input');
                const submit = document.getElementById('id-submit-btn');
                if (input) {
                    input.value = '';
                    input.focus();
                    input.onkeydown = (e) => {
                        if (e.key === 'Enter') this.handleAnswerSubmission(input.value.trim());
                    };
                }
                if (submit) {
                    submit.onclick = () => {
                        if (input) this.handleAnswerSubmission(input.value.trim());
                    };
                }
            }
        } else {
            if (idContainer) idContainer.classList.add('hidden');
            if (choicesContainer) {
                choicesContainer.innerHTML = '';

                // Synthesize peer distractors if needed
                let choices = Array.isArray(q.choices) && q.choices.length >= 2 ? [...q.choices] : [q.answer];
                if (choices.length < 2) {
                    const peerAnswers = this.currentQuestions
                        .filter(item => item.id !== q.id && item.answer)
                        .map(item => item.answer);
                    const sampleDistractors = peerAnswers.slice(0, 3);
                    choices = [...choices, ...sampleDistractors];
                }

                // Shuffle choices for quiz display
                choices.sort(() => Math.random() - 0.5);

                choices.forEach(choiceText => {
                    const btn = document.createElement('button');
                    btn.className = 'choice-btn choice-neutral glass-panel';
                    btn.textContent = choiceText;
                    attachRippleEffect(btn);

                    btn.onclick = () => {
                        if (this.hasAnsweredCurrent) return;
                        this.handleAnswerSubmission(choiceText, btn);
                    };

                    choicesContainer.appendChild(btn);
                });
            }
        }

        // Apply MathJax typesetting
        if (window.MathJax && window.MathJax.typesetPromise) {
            const container = document.querySelector('.question-container');
            if (container) window.MathJax.typesetPromise([container]).catch(console.warn);
        }

        // Save active session snapshot for crash recovery / resumption
        this.persistActiveSessionSnapshot();
    }

    async handleAnswerSubmission(userAnswer, clickedButton = null) {
        if (this.hasAnsweredCurrent || !this.activeQuestion) return;
        this.hasAnsweredCurrent = true;

        const q = this.activeQuestion;
        const isCorrect = userAnswer.toLowerCase().trim() === q.answer.toLowerCase().trim();

        // Highlight choices
        if (q.type === 'mcq') {
            document.querySelectorAll('.choice-btn').forEach(btn => {
                const txt = btn.textContent.trim();
                const isThisCorrect = txt.toLowerCase() === q.answer.toLowerCase();
                const wasSelected = btn === clickedButton || txt.toLowerCase() === userAnswer.toLowerCase();
                applyChoiceFeedback(btn, isThisCorrect, wasSelected);
            });
        }

        // Update score
        if (isCorrect) {
            this.speedrunScore++;
        }

        const scoreBadge = document.getElementById('quiz-score-badge');
        if (scoreBadge) scoreBadge.textContent = `Score: ${this.speedrunScore}`;

        // Save answer record
        this.speedrunAnswers.push({
            question: q,
            selectedAnswer: userAnswer,
            isCorrect
        });

        // Spaced repetition update if mastery mode
        if (this.quizMode === 'mastery' && this.masteryEngine) {
            const res = this.masteryEngine.recordAnswer(q.id, isCorrect);
            await saveMasteryState(q.setId, q.id, res.state);
        }

        // Show explanation
        const explainBox = document.getElementById('explanation-container');
        const explainBody = document.getElementById('explanation-body');
        const explainContent = document.getElementById('explanation-content');
        if (explainBox && explainBody) {
            explainBody.innerHTML = `
                <p><strong>Correct Answer:</strong> ${q.answer}</p>
                ${q.explanation ? `<p style="margin-top:0.5rem;">${q.explanation}</p>` : ''}
            `;
            explainBox.classList.remove('hidden');
            if (this.settings.autoExplain && explainContent) {
                explainContent.classList.remove('hidden');
            }

            if (window.MathJax && window.MathJax.typesetPromise) {
                window.MathJax.typesetPromise([explainBox]).catch(console.warn);
            }
        }

        // Show Next Question button
        const nextBtn = document.getElementById('next-question-btn');
        if (nextBtn) {
            nextBtn.classList.remove('hidden');
            nextBtn.focus();
        }

        // Update profile stats (answers count, daily activity)
        const todayStr = new Date().toISOString().split('T')[0];
        await updateUserProfile({
            totalQuestionsAnswered: 1,
            totalCorrect: isCorrect ? 1 : 0,
            dailyCounts: { [todayStr]: 1 }
        });
    }

    advanceToNextQuestion() {
        if (this.quizMode === 'speedrun') {
            this.speedrunIndex++;
        }
        this.renderNextQuestion();
    }

    async persistActiveSessionSnapshot() {
        if (!this.currentSet) return;

        const now = Date.now();
        let progressPercent = 0;
        let masteryQueue = [];

        if (this.quizMode === 'mastery' && this.masteryEngine) {
            const prog = this.masteryEngine.getProgress();
            progressPercent = prog.pointsPercentage;
            masteryQueue = this.masteryEngine.getQueueSnapshot();
        } else {
            progressPercent = Math.round((this.speedrunIndex / (this.currentQuestions.length || 1)) * 100);
        }

        const snapshot = {
            setId: this.currentSet.id,
            mode: this.quizMode,
            title: this.currentSet.title,
            progressPercent,
            currentQuestionIndex: this.speedrunIndex,
            score: this.speedrunScore,
            masteryQueue,
            elapsedSeconds: this.stopwatch ? this.stopwatch.getElapsedSeconds() : 0,
            updatedAt: now
        };

        // 1. IndexedDB heavy snapshot
        await saveActiveSession(snapshot);

        // 2. localStorage synchronous pointer
        try {
            localStorage.setItem('quizActiveSession', JSON.stringify({
                setId: this.currentSet.id,
                mode: this.quizMode,
                title: this.currentSet.title,
                progressPercent,
                updatedAt: now
            }));
        } catch (_) {}
    }

    async completeQuiz() {
        if (this.stopwatch) this.stopwatch.pause();

        // Clear active session upon completion
        if (this.currentSet) {
            await clearActiveSession(this.currentSet.id);
            localStorage.removeItem('quizActiveSession');
        }

        const duration = this.stopwatch ? this.stopwatch.formatTime() : '00:00';
        const total = this.quizMode === 'mastery' ? this.currentQuestions.length : this.currentQuestions.length;
        const score = this.speedrunScore;
        const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;

        // Save session history
        const historyRecord = {
            id: `session_${Date.now()}`,
            setId: this.currentSet?.id || '',
            mode: this.quizMode,
            score,
            total,
            accuracy,
            duration,
            timestamp: Date.now()
        };
        await saveSessionHistory(historyRecord);

        // Show results screen
        this.switchScreen('results-screen');

        // Results metrics
        const scoreVal = document.getElementById('result-score-val');
        const accVal = document.getElementById('result-accuracy-val');
        const timeVal = document.getElementById('result-time-val');
        const titleEl = document.getElementById('results-title');
        const subtitleEl = document.getElementById('results-subtitle');

        if (scoreVal) scoreVal.textContent = `${score} / ${total}`;
        if (accVal) accVal.textContent = `${accuracy}%`;
        if (timeVal) timeVal.textContent = duration;

        if (this.quizMode === 'mastery') {
            if (titleEl) titleEl.textContent = '🏆 100% Mastered!';
            if (subtitleEl) subtitleEl.textContent = `All questions in "${this.currentSet.title}" answered correctly twice consecutively.`;
        } else {
            if (titleEl) titleEl.textContent = accuracy >= 80 ? '🎉 Exam Completed!' : '📚 Quiz Completed!';
            if (subtitleEl) subtitleEl.textContent = `Speedrun linear results for "${this.currentSet.title}".`;
        }

        // Launch confetti celebration
        launchCelebrationConfetti();

        // Render Mistake Review Table
        this.renderMistakeReviewTable();
    }

    renderMistakeReviewTable() {
        const container = document.getElementById('review-list-container');
        const countNum = document.getElementById('review-count-num');
        const searchInput = document.getElementById('review-search');
        const filterSelect = document.getElementById('review-filter-select');

        if (!container) return;

        const renderList = () => {
            const query = (searchInput?.value || '').toLowerCase().trim();
            const filter = filterSelect?.value || 'all';

            const filtered = this.speedrunAnswers.filter(item => {
                if (filter === 'wrong' && item.isCorrect) return false;
                if (filter === 'correct' && !item.isCorrect) return false;
                if (query && !item.question.question_text.toLowerCase().includes(query)) return false;
                return true;
            });

            if (countNum) countNum.textContent = filtered.length;

            if (filtered.length === 0) {
                container.innerHTML = '<p style="text-align:center;padding:1.5rem;color:var(--text-dim);">No questions match the current filter.</p>';
                return;
            }

            container.innerHTML = filtered.map((item, idx) => `
                <div class="glass-panel" style="padding:1rem;margin-bottom:0.75rem;border-left:4px solid ${item.isCorrect ? 'var(--correct)' : 'var(--wrong)'};">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">
                        <span style="font-weight:600;font-size:0.85rem;color:var(--text-dim);">Question ${idx + 1}</span>
                        <span style="font-weight:600;font-size:0.8rem;color:${item.isCorrect ? 'var(--correct)' : 'var(--wrong)'};">
                            ${item.isCorrect ? '✓ Correct' : '✕ Mistake'}
                        </span>
                    </div>
                    <p style="font-weight:500;margin-bottom:0.5rem;">${item.question.question_text}</p>
                    <div style="font-size:0.88rem;margin-bottom:0.3rem;">
                        <span style="color:var(--text-muted);">Your pick: </span>
                        <strong style="color:${item.isCorrect ? 'var(--correct)' : 'var(--wrong)'};">${item.selectedAnswer || 'None'}</strong>
                    </div>
                    ${!item.isCorrect ? `
                        <div style="font-size:0.88rem;color:var(--correct);margin-bottom:0.3rem;">
                            <span>Correct answer: </span>
                            <strong>${item.question.answer}</strong>
                        </div>
                    ` : ''}
                    ${item.question.explanation ? `
                        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.4rem;padding-top:0.4rem;border-top:1px solid var(--glass-border);">
                            💡 ${item.question.explanation}
                        </div>
                    ` : ''}
                </div>
            `).join('');

            if (window.MathJax && window.MathJax.typesetPromise) {
                window.MathJax.typesetPromise([container]).catch(console.warn);
            }
        };

        renderList();

        if (searchInput) searchInput.oninput = renderList;
        if (filterSelect) filterSelect.onchange = renderList;
    }
}

// Bootstrap application on DOMContentLoaded
const app = new StudyBoardsApp();
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => app.init());
}

export { app, QuizStopwatch, HashRouter };
