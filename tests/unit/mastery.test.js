import { describe, it, expect } from 'vitest';
import { MasteryEngine } from '../../public/js/mastery.js';

describe('Spaced-Repetition Mastery Engine Unit Tests', () => {
    const mockQuestions = [
        { id: 'q1', setId: 'set1', question_text: 'Question 1', choices: ['A', 'B', 'C', 'D'], answer: 'A' },
        { id: 'q2', setId: 'set1', question_text: 'Question 2', choices: ['A', 'B', 'C', 'D'], answer: 'B' },
        { id: 'q3', setId: 'set1', question_text: 'Question 3', choices: ['A', 'B', 'C', 'D'], answer: 'C' }
    ];

    it('requires strictly 2 consecutive correct answers to master a question', () => {
        const engine = new MasteryEngine(mockQuestions);
        expect(engine.getProgress().masteredCount).toBe(0);
        expect(engine.getProgress().percentMastered).toBe(0);

        // 1st correct answer on q1
        const res1 = engine.recordAnswer('q1', true);
        expect(res1.mastered).toBe(false);
        expect(res1.state.consecutiveCorrect).toBe(1);
        expect(res1.state.status).toBe('learning');
        expect(engine.getProgress().masteredCount).toBe(0);

        // Cycle through other questions until q1 appears again
        while (engine.currentQuestion().id !== 'q1') {
            engine.recordAnswer(engine.currentQuestion().id, true);
        }

        // 2nd consecutive correct answer on q1
        const res2 = engine.recordAnswer('q1', true);
        expect(res2.mastered).toBe(true);
        expect(res2.state.consecutiveCorrect).toBe(2);
        expect(res2.state.status).toBe('mastered');
        expect(engine.getProgress().masteredCount).toBeGreaterThanOrEqual(1);
    });

    it('resets consecutiveCorrect to 0 immediately on mistake (after 1 correct)', () => {
        const engine = new MasteryEngine(mockQuestions);

        // 1st correct answer
        engine.recordAnswer('q1', true);
        expect(engine.states.get('q1').consecutiveCorrect).toBe(1);

        // Advance until q1 is back at head
        while (engine.currentQuestion().id !== 'q1') {
            engine.recordAnswer(engine.currentQuestion().id, true);
        }

        // Mistake on 2nd attempt
        const res = engine.recordAnswer('q1', false);
        expect(res.mastered).toBe(false);
        expect(res.state.consecutiveCorrect).toBe(0);
        expect(res.state.status).toBe('learning');
    });

    it('re-inserts unmastered question into back half of queue with boundary safeguard', () => {
        // Test with 3 cards: q1 shifted leaves 2 cards (q2, q3)
        // Math.ceil(2 / 2) = 1. Valid insert indices: 1 or 2.
        const engine = new MasteryEngine(mockQuestions);
        const res = engine.recordAnswer('q1', false);

        expect(res.reinserted).toBe(true);
        expect(res.insertIndex).toBeGreaterThanOrEqual(1);
        // Guaranteed that head question is now q2, NEVER q1
        expect(engine.currentQuestion().id).not.toBe('q1');
    });

    it('safely handles small queue of length 1 without crash', () => {
        const singleQ = [mockQuestions[0]];
        const engine = new MasteryEngine(singleQ);

        // Mistake on only card: re-inserts at index 0 because queue was empty
        const res = engine.recordAnswer('q1', false);
        expect(res.reinserted).toBe(true);
        expect(res.insertIndex).toBe(0);
        expect(engine.currentQuestion().id).toBe('q1');
    });

    it('achieves 100% completion when all questions reach 2 consecutive correct answers', () => {
        const engine = new MasteryEngine(mockQuestions);

        while (!engine.isComplete()) {
            const cur = engine.currentQuestion();
            engine.recordAnswer(cur.id, true);
        }

        const finalProg = engine.getProgress();
        expect(finalProg.masteredCount).toBe(3);
        expect(finalProg.remainingQueueCount).toBe(0);
        expect(finalProg.percentMastered).toBe(100);
        expect(engine.isComplete()).toBe(true);
    });

    it('creates queue snapshots and restores resumed session order correctly', () => {
        const engine = new MasteryEngine(mockQuestions);
        const snapshot = engine.getQueueSnapshot();
        expect(snapshot).toEqual(['q1', 'q2', 'q3']);

        // Resume engine with custom saved queue order
        const resumedEngine = new MasteryEngine(mockQuestions, [], ['q3', 'q1']);
        expect(resumedEngine.currentQuestion().id).toBe('q3');
        expect(resumedEngine.queue).toHaveLength(2);
    });

    it('throws errors on invalid operations such as queue head mismatch or empty queue', () => {
        const engine = new MasteryEngine(mockQuestions);
        expect(() => engine.recordAnswer('q999', true)).toThrow('Queue head mismatch');

        while (!engine.isComplete()) {
            engine.recordAnswer(engine.currentQuestion().id, true);
        }
        expect(() => engine.recordAnswer('q1', true)).toThrow('queue is empty');
    });
});
