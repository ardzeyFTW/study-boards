/**
 * db.js — Client-Side Persistence Layer for Study Boards Public
 * W3C IndexedDB Wrapper with 6 Stores, Safari ITP Mitigation, and Atomic JSON Backup/Restore.
 */

const DB_NAME = 'notquizlet-db';
const DB_VERSION = 1;

let dbInstance = null;

/**
 * Open or initialize the IndexedDB connection with all 6 object stores.
 * @returns {Promise<IDBDatabase>}
 */
export function initDB() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            return reject(new Error('IndexedDB is not supported in this environment.'));
        }

        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
            const db = event.target.result;

            // 1. study_sets store
            if (!db.objectStoreNames.contains('study_sets')) {
                const setStore = db.createObjectStore('study_sets', { keyPath: 'id' });
                setStore.createIndex('title', 'title', { unique: false });
                setStore.createIndex('category', 'category', { unique: false });
                setStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                setStore.createIndex('source', 'source', { unique: false });
            }

            // 2. questions store
            if (!db.objectStoreNames.contains('questions')) {
                const qStore = db.createObjectStore('questions', { keyPath: 'id' });
                qStore.createIndex('setId', 'setId', { unique: false });
                qStore.createIndex('setId_order', ['setId', 'order'], { unique: false });
                qStore.createIndex('type', 'type', { unique: false });
                qStore.createIndex('order', 'order', { unique: false });
            }

            // 3. mastery_state store (Composite Primary Key: [setId, questionId])
            if (!db.objectStoreNames.contains('mastery_state')) {
                const mStore = db.createObjectStore('mastery_state', { keyPath: ['setId', 'questionId'] });
                mStore.createIndex('setId', 'setId', { unique: false });
                mStore.createIndex('status', 'status', { unique: false });
                mStore.createIndex('consecutiveCorrect', 'consecutiveCorrect', { unique: false });
                mStore.createIndex('lastAttempt', 'lastAttempt', { unique: false });
            }

            // 4. session_history store
            if (!db.objectStoreNames.contains('session_history')) {
                const sStore = db.createObjectStore('session_history', { keyPath: 'id' });
                sStore.createIndex('setId', 'setId', { unique: false });
                sStore.createIndex('timestamp', 'timestamp', { unique: false });
                sStore.createIndex('mode', 'mode', { unique: false });
            }

            // 5. user_profile store
            if (!db.objectStoreNames.contains('user_profile')) {
                db.createObjectStore('user_profile', { keyPath: 'key' });
            }

            // 6. active_sessions store
            if (!db.objectStoreNames.contains('active_sessions')) {
                const aStore = db.createObjectStore('active_sessions', { keyPath: 'setId' });
                aStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                aStore.createIndex('mode', 'mode', { unique: false });
            }
        };

        req.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        req.onerror = (event) => {
            reject(new Error(`Failed to open IndexedDB '${DB_NAME}': ${event.target.error?.message}`));
        };
    });
}

/**
 * Generic helper for executing a transaction on an object store.
 */
function getStore(storeName, mode = 'readonly') {
    return initDB().then(db => {
        const tx = db.transaction(storeName, mode);
        return tx.objectStore(storeName);
    });
}

/* ==========================================================================
   STUDY SET & QUESTION CRUD OPERATIONS
   ========================================================================== */

/**
 * Save a study set and all associated questions atomically.
 */
export async function saveStudySet(studySet, questions) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['study_sets', 'questions'], 'readwrite');
        const setStore = tx.objectStore('study_sets');
        const qStore = tx.objectStore('questions');

        tx.oncomplete = () => resolve(studySet.id);
        tx.onerror = (e) => reject(new Error(`Failed to save study set: ${e.target.error?.message}`));

        setStore.put(studySet);
        if (Array.isArray(questions)) {
            questions.forEach(q => qStore.put(q));
        }
    });
}

/**
 * Retrieve all study sets.
 */
export async function getAllStudySets() {
    const store = await getStore('study_sets', 'readonly');
    return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Retrieve a single study set and its ordered questions.
 */
export async function getStudySet(setId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['study_sets', 'questions'], 'readonly');
        const setStore = tx.objectStore('study_sets');
        const qStore = tx.objectStore('questions');
        const qIndex = qStore.index('setId_order');

        let setRecord = null;
        const questions = [];

        setStore.get(setId).onsuccess = (e) => {
            setRecord = e.target.result;
        };

        const range = IDBKeyRange.bound([setId, -Infinity], [setId, Infinity]);
        qIndex.openCursor(range).onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                questions.push(cursor.value);
                cursor.continue();
            }
        };

        tx.oncomplete = () => {
            if (!setRecord) return resolve(null);
            resolve({ set: setRecord, questions });
        };
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Delete a study set, its questions, mastery states, and active sessions.
 */
export async function deleteStudySet(setId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['study_sets', 'questions', 'mastery_state', 'active_sessions'], 'readwrite');

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);

        // Delete set record
        tx.objectStore('study_sets').delete(setId);
        tx.objectStore('active_sessions').delete(setId);

        // Delete questions by setId index
        const qStore = tx.objectStore('questions');
        const qIndex = qStore.index('setId');
        qIndex.openKeyCursor(IDBKeyRange.only(setId)).onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                qStore.delete(cursor.primaryKey);
                cursor.continue();
            }
        };

        // Delete mastery state by setId index
        const mStore = tx.objectStore('mastery_state');
        const mIndex = mStore.index('setId');
        mIndex.openKeyCursor(IDBKeyRange.only(setId)).onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                mStore.delete(cursor.primaryKey);
                cursor.continue();
            }
        };
    });
}

/* ==========================================================================
   MASTERY STATE OPERATIONS
   ========================================================================== */

/**
 * Save question mastery state (2 consecutive correct threshold).
 */
export async function saveMasteryState(setId, questionId, state) {
    const store = await getStore('mastery_state', 'readwrite');
    return new Promise((resolve, reject) => {
        const record = { setId, questionId, ...state };
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get all mastery states for a specific study set.
 */
export async function getMasteryStates(setId) {
    const store = await getStore('mastery_state', 'readonly');
    const index = store.index('setId');
    return new Promise((resolve, reject) => {
        const req = index.getAll(IDBKeyRange.only(setId));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

/* ==========================================================================
   ACTIVE SESSION & CRASH RECOVERY
   ========================================================================== */

export async function saveActiveSession(session) {
    const store = await getStore('active_sessions', 'readwrite');
    return new Promise((resolve, reject) => {
        const req = store.put(session);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function getActiveSession(setId) {
    const store = await getStore('active_sessions', 'readonly');
    return new Promise((resolve, reject) => {
        const req = store.get(setId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export async function clearActiveSession(setId) {
    const store = await getStore('active_sessions', 'readwrite');
    return new Promise((resolve, reject) => {
        const req = store.delete(setId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/* ==========================================================================
   SESSION HISTORY & USER PROFILE
   ========================================================================== */

export async function saveSessionHistory(session) {
    const store = await getStore('session_history', 'readwrite');
    return new Promise((resolve, reject) => {
        const req = store.put(session);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function getUserProfile() {
    const store = await getStore('user_profile', 'readonly');
    return new Promise((resolve, reject) => {
        const profileReq = store.get('profile');
        const statsReq = store.get('stats');

        let profile = null;
        let stats = null;

        profileReq.onsuccess = () => { profile = profileReq.result; };
        statsReq.onsuccess = () => { stats = statsReq.result; };

        store.transaction.oncomplete = () => {
            resolve({
                profile: profile || { key: 'profile', displayName: 'Student', avatar: '⚡', createdAt: Date.now() },
                stats: stats || {
                    key: 'stats',
                    totalQuestionsAnswered: 0,
                    totalCorrect: 0,
                    accuracyPercentage: 0,
                    masteredQuestionsCount: 0,
                    studyStreakDays: 0,
                    dailyCounts: {}
                }
            });
        };
        store.transaction.onerror = () => reject(store.transaction.error);
    });
}

export async function updateUserProfile(statsDelta = {}) {
    const store = await getStore('user_profile', 'readwrite');
    return new Promise((resolve, reject) => {
        const getReq = store.get('stats');
        getReq.onsuccess = () => {
            const current = getReq.result || {
                key: 'stats',
                totalQuestionsAnswered: 0,
                totalCorrect: 0,
                accuracyPercentage: 0,
                masteredQuestionsCount: 0,
                studyStreakDays: 0,
                lastStudyDate: '',
                dailyCounts: {}
            };

            const updated = {
                ...current,
                ...statsDelta,
                dailyCounts: { ...(current.dailyCounts || {}), ...(statsDelta.dailyCounts || {}) }
            };

            if (statsDelta.totalQuestionsAnswered || statsDelta.totalCorrect) {
                const totalAns = (current.totalQuestionsAnswered || 0) + (statsDelta.totalQuestionsAnswered || 0);
                const totalCorr = (current.totalCorrect || 0) + (statsDelta.totalCorrect || 0);
                updated.totalQuestionsAnswered = totalAns;
                updated.totalCorrect = totalCorr;
                updated.accuracyPercentage = totalAns > 0 ? Number(((totalCorr / totalAns) * 100).toFixed(1)) : 0;
            }

            const putReq = store.put(updated);
            putReq.onsuccess = () => resolve(updated);
            putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
    });
}

/* ==========================================================================
   SAFARI ITP MITIGATION & STORAGE HEALTH
   ========================================================================== */

export async function initStoragePersistence() {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
        try {
            const isPersisted = await navigator.storage.persist();
            console.log(`[Storage] Origin granted persistent storage: ${isPersisted}`);
            return isPersisted;
        } catch (_) {
            return false;
        }
    }
    return false;
}

export async function getStorageHealth() {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
        try {
            const { usage, quota } = await navigator.storage.estimate();
            const usageMB = (usage / (1024 * 1024)).toFixed(2);
            const quotaMB = (quota / (1024 * 1024)).toFixed(0);
            const percentUsed = quota > 0 ? ((usage / quota) * 100).toFixed(1) : '0';
            const isPersisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
            return { usageMB, quotaMB, percentUsed, isPersisted };
        } catch (_) {}
    }
    return { usageMB: '0.00', quotaMB: '1000', percentUsed: '0', isPersisted: false };
}

/* ==========================================================================
   ATOMIC DATABASE JSON BACKUP & RESTORE
   ========================================================================== */

export async function exportFullDatabaseJSON() {
    const db = await initDB();
    const storeNames = ['study_sets', 'questions', 'mastery_state', 'session_history', 'user_profile', 'active_sessions'];

    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, 'readonly');
        const dump = {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            appName: 'StudyBoardsStandalone',
            data: {}
        };

        storeNames.forEach(name => {
            tx.objectStore(name).getAll().onsuccess = (e) => {
                dump.data[name] = e.target.result || [];
            };
        });

        tx.oncomplete = () => {
            const jsonString = JSON.stringify(dump, null, 2);

            if (typeof document !== 'undefined' && typeof window !== 'undefined' && window.URL && window.URL.createObjectURL) {
                try {
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    const dateStr = new Date().toISOString().split('T')[0];
                    a.href = url;
                    a.download = `notquizlet-backup-${dateStr}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (e) {
                    console.warn('[DB] Download trigger skipped or failed:', e);
                }
            }

            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('quizLastBackupTimestamp', Date.now().toString());
                }
            } catch (_) {}

            resolve(jsonString);
        };

        tx.onerror = () => reject(new Error(`Failed to export database: ${tx.error?.message}`));
    });
}

export function importFullDatabaseJSON(jsonString, mode = 'merge') {
    return new Promise(async (resolve, reject) => {
        let payload;
        try {
            payload = JSON.parse(jsonString);
        } catch (e) {
            return reject(new Error(`Invalid JSON syntax: ${e.message}`));
        }

        if (!payload.schemaVersion || !payload.data) {
            return reject(new Error('Invalid backup file format: missing schemaVersion or data payload.'));
        }

        try {
            const db = await initDB();
            const storeNames = ['study_sets', 'questions', 'mastery_state', 'session_history', 'user_profile', 'active_sessions'];
            const tx = db.transaction(storeNames, 'readwrite');

            tx.oncomplete = () => {
                try {
                    if (typeof localStorage !== 'undefined') {
                        localStorage.setItem('quizLastBackupTimestamp', Date.now().toString());
                    }
                } catch (_) {}
                resolve({ success: true, count: payload.data.questions?.length || 0 });
            };

            tx.onerror = (e) => reject(new Error(`Restore transaction failed: ${e.target.error?.message}`));
            tx.onabort = (e) => reject(new Error(`Restore transaction aborted: ${e.target.error?.message}`));

            if (mode === 'replace') {
                storeNames.forEach(name => tx.objectStore(name).clear());
            }

            storeNames.forEach(name => {
                const store = tx.objectStore(name);
                const items = payload.data[name] || [];
                items.forEach(item => store.put(item));
            });
        } catch (err) {
            reject(new Error(`Failed to initialize restore: ${err.message}`));
        }
    });
}
