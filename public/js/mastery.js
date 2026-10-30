/**
 * mastery.js — Spaced-Repetition Mastery Engine
 * Enforces 2-consecutive-correct mastery threshold, instant point resets on error,
 * and cognitive interleaving back-half queue re-insertion.
 * Standalone Public Quiz Platform
 */

export class MasteryEngine {
    /**
     * @param {Array<Object>} questions - Array of ImportedQuestion objects
     * @param {Array<Object>} [existingStates=[]] - Optional existing MasteryStateRecords from IndexedDB
     * @param {Array<string>} [savedQueueIds=null] - Optional serialized queue snapshot for resumption
     */
    constructor(questions, existingStates = [], savedQueueIds = null) {
        if (!Array.isArray(questions) || questions.length === 0) {
            throw new Error('MasteryEngine requires a non-empty array of questions.');
        }

        this.questionsMap = new Map(questions.map(q => [q.id, { ...q }]));
        this.totalQuestions = questions.length;
        this.states = new Map();

        // Initialize or restore question mastery states
        questions.forEach(q => {
            const existing = existingStates.find(s => s.questionId === q.id);
            if (existing) {
                this.states.set(q.id, {
                    setId: q.setId,
                    questionId: q.id,
                    consecutiveCorrect: existing.consecutiveCorrect || 0,
                    status: existing.status || 'unseen',
                    totalAttempts: existing.totalAttempts || 0,
                    correctAttempts: existing.correctAttempts || 0,
                    lastAttemptAt: existing.lastAttemptAt || 0,
                    history: existing.history || []
                });
            } else {
                this.states.set(q.id, {
                    setId: q.setId,
                    questionId: q.id,
                    consecutiveCorrect: 0,
                    status: 'unseen',
                    totalAttempts: 0,
                    correctAttempts: 0,
                    lastAttemptAt: 0,
                    history: []
                });
            }
        });

        // Construct active drill queue
        if (Array.isArray(savedQueueIds) && savedQueueIds.length > 0) {
            this.queue = savedQueueIds
                .filter(id => this.questionsMap.has(id) && (this.states.get(id).consecutiveCorrect < 2))
                .map(id => this.questionsMap.get(id));
        } else {
            // Unmastered questions populate initial queue
            this.queue = questions
                .filter(q => this.states.get(q.id).consecutiveCorrect < 2)
                .map(q => this.questionsMap.get(q.id));
        }
    }

    /**
     * Retrieves the current question at the head of the queue.
     * @returns {Object|null}
     */
    currentQuestion() {
        return this.queue.length > 0 ? this.queue[0] : null;
    }

    /**
     * Contract alias for currentQuestion.
     * @returns {Object|null}
     */
    nextQuestion() {
        return this.currentQuestion();
    }

    /**
     * Records the user's answer for the question currently at the head of the queue.
     * @param {string} questionId
     * @param {boolean} isCorrect
     * @returns {{
     *   state: Object,
     *   mastered: boolean,
     *   reinserted: boolean,
     *   insertIndex: number,
     *   remainingCount: number,
     *   progress: Object
     * }}
     */
    recordAnswer(questionId, isCorrect) {
        if (this.queue.length === 0) {
            throw new Error('Cannot record answer: Mastery queue is empty.');
        }

        const headQuestion = this.queue[0];
        if (headQuestion.id !== questionId) {
            throw new Error(`Queue head mismatch: expected ${headQuestion.id}, got ${questionId}`);
        }

        const state = this.states.get(questionId);
        const now = Date.now();

        state.totalAttempts++;
        state.lastAttemptAt = now;
        state.history.push(isCorrect);

        let mastered = false;
        let reinserted = false;
        let insertIndex = -1;

        if (isCorrect) {
            state.correctAttempts++;
            state.consecutiveCorrect++;
            if (state.consecutiveCorrect >= 2) {
                state.consecutiveCorrect = 2;
                state.status = 'mastered';
                mastered = true;
            } else {
                state.status = 'learning';
            }
        } else {
            state.consecutiveCorrect = 0;
            state.status = 'learning';
        }

        // Remove answered question from queue head
        const justAnswered = this.queue.shift();

        // If not mastered, re-insert into back half
        if (!mastered) {
            reinserted = true;
            if (this.queue.length === 0) {
                insertIndex = 0;
                this.queue.push(justAnswered);
            } else {
                const halfIndex = Math.ceil(this.queue.length / 2);
                const remainingSpaces = this.queue.length - halfIndex;
                insertIndex = halfIndex + Math.floor(Math.random() * (remainingSpaces + 1));

                if (insertIndex === 0 && this.queue.length > 1) {
                    insertIndex = 1;
                }
                this.queue.splice(insertIndex, 0, justAnswered);
            }
        }

        return {
            state: { ...state },
            mastered,
            reinserted,
            insertIndex,
            remainingCount: this.queue.length,
            progress: this.getProgress()
        };
    }

    /**
     * Calculates current progress and categorization metrics.
     * @returns {{
     *   unseenCount: number,
     *   learningCount: number,
     *   masteredCount: number,
     *   totalQuestions: number,
     *   remainingQueueCount: number,
     *   percentMastered: number,
     *   pointsPercentage: number
     * }}
     */
    getProgress() {
        let unseenCount = 0;
        let learningCount = 0;
        let masteredCount = 0;
        let totalPoints = 0;

        for (const state of this.states.values()) {
            if (state.consecutiveCorrect >= 2) {
                masteredCount++;
                totalPoints += 2;
            } else if (state.totalAttempts > 0 || state.consecutiveCorrect === 1) {
                learningCount++;
                totalPoints += state.consecutiveCorrect;
            } else {
                unseenCount++;
            }
        }

        const maxPoints = this.totalQuestions * 2;
        const percentMastered = this.totalQuestions > 0 ? Math.round((masteredCount / this.totalQuestions) * 100) : 0;
        const pointsPercentage = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;

        return {
            unseenCount,
            learningCount,
            masteredCount,
            totalQuestions: this.totalQuestions,
            remainingQueueCount: this.queue.length,
            percentMastered,
            pointsPercentage
        };
    }

    /**
     * Returns an array of question IDs in the current queue order.
     * @returns {string[]}
     */
    getQueueSnapshot() {
        return this.queue.map(q => q.id);
    }

    /**
     * Checks if the entire study set has achieved 100% mastery.
     * @returns {boolean}
     */
    isComplete() {
        return this.queue.length === 0;
    }
}

/**
 * Factory helper for initializing a MasteryEngine instance.
 */
export function initMasteryQueue(questions, existingStates = [], savedQueueIds = null) {
    return new MasteryEngine(questions, existingStates, savedQueueIds);
}
