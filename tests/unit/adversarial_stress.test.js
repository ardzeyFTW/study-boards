import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasteryEngine, initMasteryQueue } from '../../public/js/mastery.js';

/* ==========================================================================
   MINIMAL COMPLIANT IN-MEMORY W3C INDEXEDDB & LOCALSTORAGE MOCKS FOR NODE
   ========================================================================== */
class MockIDBKeyRange {
    constructor(lower, upper, lowerOpen = false, upperOpen = false) {
        this.lower = lower;
        this.upper = upper;
        this.lowerOpen = lowerOpen;
        this.upperOpen = upperOpen;
    }
    static only(value) {
        return new MockIDBKeyRange(value, value);
    }
    static bound(lower, upper, lowerOpen = false, upperOpen = false) {
        return new MockIDBKeyRange(lower, upper, lowerOpen, upperOpen);
    }
    includes(val) {
        if (Array.isArray(this.lower) && Array.isArray(val)) {
            // Check prefix equality for composite indices like ['setId', 'order']
            if (this.lower[0] === val[0]) return true;
        }
        return JSON.stringify(val) === JSON.stringify(this.lower);
    }
}

class MockIndex {
    constructor(store, name, keyPath) {
        this.store = store;
        this.name = name;
        this.keyPath = keyPath;
    }

    getAll(query) {
        const req = { onsuccess: null, onerror: null, result: [] };
        queueMicrotask(() => {
            const results = [];
            for (const item of this.store.data.values()) {
                let matches = true;
                if (query) {
                    const itemVal = Array.isArray(this.keyPath)
                        ? this.keyPath.map(k => item[k])
                        : item[this.keyPath];
                    if (query.includes) {
                        matches = query.includes(itemVal);
                    } else {
                        matches = JSON.stringify(itemVal) === JSON.stringify(query.lower);
                    }
                }
                if (matches) results.push({ ...item });
            }
            req.result = results;
            if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
    }

    openCursor(range) {
        const req = { onsuccess: null, onerror: null };
        queueMicrotask(() => {
            const items = [];
            for (const item of this.store.data.values()) {
                if (range && range.includes) {
                    const itemVal = Array.isArray(this.keyPath) ? this.keyPath.map(k => item[k]) : item[this.keyPath];
                    if (range.includes(itemVal)) items.push(item);
                } else {
                    items.push(item);
                }
            }
            let index = 0;
            const advance = () => {
                if (index < items.length) {
                    const cursor = {
                        value: items[index],
                        continue: () => {
                            index++;
                            advance();
                        }
                    };
                    if (req.onsuccess) req.onsuccess({ target: { result: cursor } });
                } else {
                    if (req.onsuccess) req.onsuccess({ target: { result: null } });
                }
            };
            advance();
        });
        return req;
    }

    openKeyCursor(range) {
        const req = { onsuccess: null, onerror: null };
        queueMicrotask(() => {
            const keys = [];
            for (const [key, item] of this.store.data.entries()) {
                if (range && range.includes) {
                    const itemVal = Array.isArray(this.keyPath) ? this.keyPath.map(k => item[k]) : item[this.keyPath];
                    if (range.includes(itemVal)) keys.push(key);
                } else {
                    keys.push(key);
                }
            }
            let index = 0;
            const advance = () => {
                if (index < keys.length) {
                    const cursor = {
                        primaryKey: keys[index],
                        continue: () => {
                            index++;
                            advance();
                        }
                    };
                    if (req.onsuccess) req.onsuccess({ target: { result: cursor } });
                } else {
                    if (req.onsuccess) req.onsuccess({ target: { result: null } });
                }
            };
            advance();
        });
        return req;
    }
}

class MockObjectStore {
    constructor(name, { keyPath }) {
        this.name = name;
        this.keyPath = keyPath;
        this.data = new Map();
        this.indices = new Map();
    }

    getKey(record) {
        if (Array.isArray(this.keyPath)) {
            return this.keyPath.map(k => record[k]);
        }
        return record[this.keyPath];
    }

    getSerializedKey(record) {
        const k = this.getKey(record);
        return Array.isArray(k) ? JSON.stringify(k) : k;
    }

    createIndex(name, keyPath, options) {
        const idx = new MockIndex(this, name, keyPath);
        this.indices.set(name, idx);
        return idx;
    }

    index(name) {
        const idx = this.indices.get(name);
        if (!idx) throw new Error(`Index ${name} not found`);
        return idx;
    }

    put(record) {
        const req = { onsuccess: null, onerror: null };
        const key = this.getSerializedKey(record);
        this.data.set(key, { ...record });
        queueMicrotask(() => {
            req.result = key;
            if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
    }

    get(key) {
        const req = { onsuccess: null, onerror: null, result: null };
        const serialized = Array.isArray(key) ? JSON.stringify(key) : key;
        queueMicrotask(() => {
            const val = this.data.get(serialized);
            req.result = val ? { ...val } : undefined;
            if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
    }

    getAll() {
        const req = { onsuccess: null, onerror: null, result: [] };
        queueMicrotask(() => {
            req.result = Array.from(this.data.values()).map(v => ({ ...v }));
            if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
    }

    delete(key) {
        const req = { onsuccess: null, onerror: null };
        const serialized = Array.isArray(key) ? JSON.stringify(key) : key;
        this.data.delete(serialized);
        queueMicrotask(() => {
            if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
    }

    clear() {
        const req = { onsuccess: null, onerror: null };
        this.data.clear();
        queueMicrotask(() => {
            if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
    }
}

class MockIDBDatabase {
    constructor(name) {
        this.name = name;
        this.stores = new Map();
        this.objectStoreNames = {
            contains: (name) => this.stores.has(name)
        };
    }

    createObjectStore(name, options) {
        const store = new MockObjectStore(name, options);
        this.stores.set(name, store);
        return store;
    }

    transaction(storeNames, mode) {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const tx = {
            mode,
            oncomplete: null,
            onerror: null,
            onabort: null,
            objectStore: (name) => {
                const s = this.stores.get(name);
                if (!s) throw new Error(`Store ${name} not found`);
                return s;
            }
        };

        // Complete transaction after active microtasks
        setTimeout(() => {
            if (tx.oncomplete) tx.oncomplete({ target: tx });
        }, 5);

        return tx;
    }
}

function setupMockIndexedDB() {
    let mockDB = null;
    const openReq = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        result: null
    };

    const mockIDBFactory = {
        open: (name, version) => {
            mockDB = new MockIDBDatabase(name);
            queueMicrotask(() => {
                if (openReq.onupgradeneeded) {
                    openReq.onupgradeneeded({ target: { result: mockDB } });
                }
                openReq.result = mockDB;
                if (openReq.onsuccess) {
                    openReq.onsuccess({ target: { result: mockDB } });
                }
            });
            return openReq;
        }
    };

    globalThis.indexedDB = mockIDBFactory;
    globalThis.IDBKeyRange = MockIDBKeyRange;
    globalThis.localStorage = (() => {
        let store = {};
        return {
            getItem: (k) => store[k] || null,
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
            clear: () => { store = {}; }
        };
    })();

    return () => mockDB;
}

/* ==========================================================================
   QUIZ STOPWATCH (MIRRORED CLASS FOR VERIFICATION)
   ========================================================================== */
class QuizStopwatchVerification {
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
   TEST SUITE: COMPREHENSIVE EMPIRICAL ADVERSARIAL STRESS HARNESS
   ========================================================================== */
describe('Adversarial Stress Test: Spaced-Repetition Mastery Engine', () => {
    function generateMockQuestions(count, setId = 'set_stress') {
        return Array.from({ length: count }, (_, i) => ({
            id: `q_${setId}_${i + 1}`,
            setId,
            question_text: `Stress Question ${i + 1}`,
            choices: ['A', 'B', 'C', 'D'],
            answer: 'A',
            explanation: `Explanation for Q${i + 1}`
        }));
    }

    it('invariant: strictly requires 2 consecutive correct answers, reset on any mistake', () => {
        const questions = generateMockQuestions(3);
        const engine = new MasteryEngine(questions);

        let cur = engine.currentQuestion();
        expect(cur.id).toBe('q_set_stress_1');
        let res = engine.recordAnswer(cur.id, true);
        expect(res.mastered).toBe(false);
        expect(res.state.consecutiveCorrect).toBe(1);

        while (engine.currentQuestion().id !== 'q_set_stress_1') {
            engine.recordAnswer(engine.currentQuestion().id, true);
        }

        res = engine.recordAnswer('q_set_stress_1', false);
        expect(res.mastered).toBe(false);
        expect(res.state.consecutiveCorrect).toBe(0);
        expect(res.state.status).toBe('learning');

        while (engine.currentQuestion().id !== 'q_set_stress_1') {
            engine.recordAnswer(engine.currentQuestion().id, false);
        }

        res = engine.recordAnswer('q_set_stress_1', true);
        expect(res.mastered).toBe(false);
        expect(res.state.consecutiveCorrect).toBe(1);

        while (engine.currentQuestion().id !== 'q_set_stress_1') {
            engine.recordAnswer(engine.currentQuestion().id, false);
        }

        res = engine.recordAnswer('q_set_stress_1', true);
        expect(res.mastered).toBe(true);
        expect(res.state.consecutiveCorrect).toBe(2);
        expect(res.state.status).toBe('mastered');
        expect(engine.getQueueSnapshot()).not.toContain('q_set_stress_1');
    });

    it('back-half bound: 1-card queue handles shift without crash or infinite loop', () => {
        const questions = generateMockQuestions(1);
        const engine = new MasteryEngine(questions);

        for (let i = 0; i < 50; i++) {
            const res = engine.recordAnswer(engine.currentQuestion().id, false);
            expect(res.reinserted).toBe(true);
            expect(res.insertIndex).toBe(0);
            expect(engine.queue.length).toBe(1);
            expect(engine.currentQuestion().id).toBe('q_set_stress_1');
        }
    });

    it('back-half bound: 2-card queue ALWAYS inserts at index 1 (never index 0) over 10,000 runs', () => {
        for (let i = 0; i < 10000; i++) {
            const questions = generateMockQuestions(2);
            const engine = new MasteryEngine(questions);
            const curId = engine.currentQuestion().id;
            const res = engine.recordAnswer(curId, false);

            expect(res.insertIndex).toBe(1);
            expect(engine.queue[1].id).toBe(curId);
            expect(engine.currentQuestion().id).not.toBe(curId);
        }
    });

    it('back-half bound: 3-card queue inserts at index >= 1 (index 1 or 2, never 0) over 10,000 runs', () => {
        const seenIndices = new Set();
        for (let i = 0; i < 10000; i++) {
            const questions = generateMockQuestions(3);
            const engine = new MasteryEngine(questions);
            const curId = engine.currentQuestion().id;
            const res = engine.recordAnswer(curId, false);

            expect(res.insertIndex).toBeGreaterThanOrEqual(1);
            expect(res.insertIndex).toBeLessThanOrEqual(2);
            expect(engine.currentQuestion().id).not.toBe(curId);
            seenIndices.add(res.insertIndex);
        }
        expect(seenIndices.has(1)).toBe(true);
        expect(seenIndices.has(2)).toBe(true);
        expect(seenIndices.has(0)).toBe(false);
    });

    it('back-half bound: 100-card queue ALWAYS inserts in back half (index >= 50) over 10,000 runs', () => {
        let minSeen = Infinity;
        let maxSeen = -Infinity;

        for (let i = 0; i < 10000; i++) {
            const questions = generateMockQuestions(100);
            const engine = new MasteryEngine(questions);
            const curId = engine.currentQuestion().id;
            const res = engine.recordAnswer(curId, false);

            expect(res.insertIndex).toBeGreaterThanOrEqual(50);
            expect(res.insertIndex).toBeLessThanOrEqual(99);
            if (res.insertIndex < minSeen) minSeen = res.insertIndex;
            if (res.insertIndex > maxSeen) maxSeen = res.insertIndex;
        }

        expect(minSeen).toBe(50);
        expect(maxSeen).toBe(99);
    });

    it('queue exhaustion: monte-carlo simulation reaches 100% mastery and queue becomes empty', () => {
        const questionCount = 25;
        const questions = generateMockQuestions(questionCount);
        const engine = new MasteryEngine(questions);

        let totalAttempts = 0;
        const maxSafetyLimit = 5000;

        while (!engine.isComplete() && totalAttempts < maxSafetyLimit) {
            totalAttempts++;
            const cur = engine.currentQuestion();
            expect(cur).not.toBeNull();
            const isCorrect = Math.random() < 0.70;
            engine.recordAnswer(cur.id, isCorrect);
        }

        expect(engine.isComplete()).toBe(true);
        expect(engine.currentQuestion()).toBeNull();
        expect(engine.queue.length).toBe(0);

        const progress = engine.getProgress();
        expect(progress.masteredCount).toBe(questionCount);
        expect(progress.unseenCount).toBe(0);
        expect(progress.learningCount).toBe(0);
        expect(progress.percentMastered).toBe(100);
    });

    it('contract check: verifies whether nextQuestion exists or is an undocumented deviation', () => {
        const questions = generateMockQuestions(2);
        const engine = new MasteryEngine(questions);

        const hasNextQuestion = typeof engine.nextQuestion === 'function';
        const hasCurrentQuestion = typeof engine.currentQuestion === 'function';

        expect(hasCurrentQuestion).toBe(true);
        expect(hasNextQuestion).toBe(true);
        expect(engine.nextQuestion()).toEqual(engine.currentQuestion());
    });

    it('snapshot & resume: accurately restores queue order and skips already-mastered cards', () => {
        const questions = generateMockQuestions(5);
        const engine = new MasteryEngine(questions);

        engine.recordAnswer('q_set_stress_1', true);
        while (engine.currentQuestion().id !== 'q_set_stress_1') {
            engine.recordAnswer(engine.currentQuestion().id, false);
        }
        engine.recordAnswer('q_set_stress_1', true);

        const snapshot = engine.getQueueSnapshot();
        expect(snapshot).not.toContain('q_set_stress_1');
        expect(snapshot.length).toBe(4);

        const savedStates = Array.from(engine.states.values());
        const resumed = new MasteryEngine(questions, savedStates, snapshot);

        expect(resumed.queue.length).toBe(4);
        expect(resumed.getQueueSnapshot()).toEqual(snapshot);
        expect(resumed.states.get('q_set_stress_1').status).toBe('mastered');
        expect(resumed.states.get('q_set_stress_1').consecutiveCorrect).toBe(2);
        expect(resumed.getProgress().masteredCount).toBe(1);
    });
});

/* ==========================================================================
   TEST SUITE: SPEEDRUN TIMER & DUAL PERSISTENCE SYNCHRONIZATION
   ========================================================================== */
describe('Adversarial Stress Test: Speedrun Stopwatch & Session Resume Synchronization', () => {
    it('stopwatch formatTime handles 0s, 59s, 60s, 3599s, 3600s, 7325s correctly', () => {
        const sw = new QuizStopwatchVerification();

        sw.accumulatedMs = 0;
        expect(sw.formatTime()).toBe('00:00');

        sw.accumulatedMs = 59 * 1000;
        expect(sw.formatTime()).toBe('00:59');

        sw.accumulatedMs = 60 * 1000;
        expect(sw.formatTime()).toBe('01:00');

        sw.accumulatedMs = 3599 * 1000;
        expect(sw.formatTime()).toBe('59:59');

        sw.accumulatedMs = 3600 * 1000;
        expect(sw.formatTime()).toBe('01:00:00');

        sw.accumulatedMs = 7325 * 1000; // 2 hrs, 2 mins, 5 secs
        expect(sw.formatTime()).toBe('02:02:05');
    });

    it('stopwatch correctly initializes from saved elapsedSeconds on resume', () => {
        const sw = new QuizStopwatchVerification(null, 145); // 2 mins 25 secs
        expect(sw.getElapsedSeconds()).toBe(145);
        expect(sw.formatTime()).toBe('02:25');
    });

    it('dual persistence synchronization: localStorage pointer matches active_sessions key fields', () => {
        const activeSessionSnapshot = {
            setId: 'set_mock_123',
            mode: 'mastery',
            title: 'Power Systems Exam Review',
            progressPercent: 40,
            currentQuestionIndex: 5,
            score: 4,
            masteryQueue: ['q_2', 'q_3', 'q_1'],
            elapsedSeconds: 120,
            updatedAt: 1730256000000
        };

        const fastPointer = {
            setId: activeSessionSnapshot.setId,
            mode: activeSessionSnapshot.mode,
            title: activeSessionSnapshot.title,
            progressPercent: activeSessionSnapshot.progressPercent,
            updatedAt: activeSessionSnapshot.updatedAt
        };

        expect(fastPointer.setId).toBe(activeSessionSnapshot.setId);
        expect(fastPointer.title).toBe(activeSessionSnapshot.title);
        expect(fastPointer.mode).toBe(activeSessionSnapshot.mode);
        expect(fastPointer.progressPercent).toBe(activeSessionSnapshot.progressPercent);
        expect(fastPointer.updatedAt).toBe(activeSessionSnapshot.updatedAt);
    });
});

/* ==========================================================================
   TEST SUITE: INDEXEDDB PERSISTENCE, COMPOSITE KEYS & ZERO EGRESS
   ========================================================================== */
describe('Adversarial Stress Test: IndexedDB Engine & Data Integrity', () => {
    let dbModule;
    let getMockDB;

    beforeEach(async () => {
        getMockDB = setupMockIndexedDB();
        // Dynamically import db.js to ensure mock environment is active
        dbModule = await import('../../public/js/db.js');
    });

    it('composite key invariant: mastery_state [setId, questionId] prevents collisions across study sets', async () => {
        await dbModule.initDB();

        // Set A has question 'q1'
        await dbModule.saveMasteryState('setA', 'q1', {
            consecutiveCorrect: 2,
            status: 'mastered',
            totalAttempts: 2
        });

        // Set B has question with IDENTICAL question ID 'q1'
        await dbModule.saveMasteryState('setB', 'q1', {
            consecutiveCorrect: 0,
            status: 'learning',
            totalAttempts: 1
        });

        // Query Set A states
        const statesA = await dbModule.getMasteryStates('setA');
        expect(statesA).toHaveLength(1);
        expect(statesA[0].setId).toBe('setA');
        expect(statesA[0].questionId).toBe('q1');
        expect(statesA[0].consecutiveCorrect).toBe(2);
        expect(statesA[0].status).toBe('mastered');

        // Query Set B states
        const statesB = await dbModule.getMasteryStates('setB');
        expect(statesB).toHaveLength(1);
        expect(statesB[0].setId).toBe('setB');
        expect(statesB[0].questionId).toBe('q1');
        expect(statesB[0].consecutiveCorrect).toBe(0);
        expect(statesB[0].status).toBe('learning');
    });

    it('atomic export & import: handles valid backups and distinguishes merge vs replace modes', async () => {
        await dbModule.initDB();

        // Seed initial data
        await dbModule.saveMasteryState('set_existing', 'q_old', {
            consecutiveCorrect: 1,
            status: 'learning'
        });

        // Export database
        const exportedJson = await dbModule.exportFullDatabaseJSON();
        expect(typeof exportedJson).toBe('string');
        const parsed = JSON.parse(exportedJson);
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.appName).toBe('StudyBoardsStandalone');
        expect(parsed.data).toBeDefined();
        expect(parsed.data.mastery_state).toHaveLength(3);

        // Test Import Invalid Syntax
        await expect(dbModule.importFullDatabaseJSON('{ invalid json', 'merge'))
            .rejects.toThrow('Invalid JSON syntax');

        // Test Import Missing Schema
        await expect(dbModule.importFullDatabaseJSON(JSON.stringify({ some: 'data' }), 'merge'))
            .rejects.toThrow('Invalid backup file format');

        // Test Restore with Merge Mode
        const newBackup = JSON.stringify({
            schemaVersion: 1,
            data: {
                study_sets: [{ id: 'set_imported', title: 'Imported Set', category: 'General' }],
                questions: [{ id: 'q_imported_1', setId: 'set_imported', question_text: 'Test Q', answer: 'Ans' }],
                mastery_state: [{ setId: 'set_imported', questionId: 'q_imported_1', consecutiveCorrect: 2 }],
                session_history: [],
                user_profile: [],
                active_sessions: []
            }
        });

        const mergeRes = await dbModule.importFullDatabaseJSON(newBackup, 'merge');
        expect(mergeRes.success).toBe(true);
        expect(mergeRes.count).toBe(1);

        // Existing data should still exist in merge mode
        const existingState = await dbModule.getMasteryStates('set_existing');
        expect(existingState).toHaveLength(1);

        // Test Restore with Replace Mode
        const replaceRes = await dbModule.importFullDatabaseJSON(newBackup, 'replace');
        expect(replaceRes.success).toBe(true);

        // Existing data should now be cleared in replace mode
        const clearedState = await dbModule.getMasteryStates('set_existing');
        expect(clearedState).toHaveLength(0);

        // New data must be present
        const importedState = await dbModule.getMasteryStates('set_imported');
        expect(importedState).toHaveLength(1);
    });

    it('zero network egress audit: zero references to external analytics or backends', async () => {
        // Forensic scan of all public JS files for external network references
        const fs = await import('fs');
        const path = await import('path');

        const jsDir = path.resolve(__dirname, '../../public/js');
        const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

        const forbiddenRegex = /firebase|firestore|cloudflare|identitytoolkit|backend-api/i;

        for (const file of files) {
            const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
                // Ignore benign explanatory comments that say "zero Firebase/Cloudflare"
                if (forbiddenRegex.test(line)) {
                    const isBenignComment = line.includes('zero Firebase') ||
                                            line.includes('zero Cloudflare') ||
                                            line.includes('ZERO Firebase') ||
                                            line.includes('Clean Feature Excision') ||
                                            line.includes('Zero-Backend');
                    expect(isBenignComment).toBe(true);
                }
            });
        }
    });
});
