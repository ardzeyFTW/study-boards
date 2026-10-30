import { describe, it, expect } from 'vitest';
import { ImportUI } from '../../public/js/import-ui.js';
import { parseImportText } from '../../public/js/import-parser.js';

describe('AI Prompt Generator & Parser Interoperability', () => {
    // Instantiate ImportUI in mock environment
    const mockModal = { querySelector: () => null, querySelectorAll: () => [] };
    const ui = new ImportUI(mockModal, null, null);

    it('generates a valid MCQ prompt with pipe format, asterisk answer, and LaTeX instructions', () => {
        const prompt = ui.generateAIPrompt('mcq', '10', 'rigorous exam', true);
        expect(prompt).toContain('10 multiple-choice questions');
        expect(prompt).toContain('rigorous exam');
        expect(prompt).toContain('Question Text | *Correct Choice | Distractor 1 | Distractor 2 | Distractor 3 | Detailed step-by-step explanation');
        expect(prompt).toContain('Prefix the exact correct choice with an asterisk (*) so the system marks it as the answer key');
        expect(prompt).toContain('Format all mathematical equations, variables, units, and formulas using inline LaTeX');
    });

    it('generates a valid Flashcard prompt with 2-column format', () => {
        const prompt = ui.generateAIPrompt('flashcards', '5', 'introductory', false);
        expect(prompt).toContain('5 terms and definitions');
        expect(prompt).toContain('introductory');
        expect(prompt).toContain('Term | Detailed Definition or Explanation');
        expect(prompt).toContain('Write all numbers, units, and formulas using standard plain text');
    });

    it('generates a valid Aiken prompt', () => {
        const prompt = ui.generateAIPrompt('aiken', 'all', 'intermediate college', true);
        expect(prompt).toContain('a comprehensive set covering all key concepts');
        expect(prompt).toContain('ANSWER: [Letter]');
        expect(prompt).toContain('EXPLANATION: [Reasoning]');
    });

    it('verifies that output matching the AI MCQ prompt parses seamlessly into questions with answer key & explanation', () => {
        // Simulated AI response following the prompt instructions
        const simulatedAIOutput = [
            'What is the SI unit of magnetic flux? | *Weber | Henry | Tesla | Maxwell | Weber ($Wb$) is the SI unit of magnetic flux, equal to one volt-second.',
            'In an AC circuit at resonance, the power factor is: | *Unity (1.0) | Zero | 0.707 lagging | 0.8 leading | At resonance, inductive and capacitive reactances cancel out ($X_L = X_C$), making the circuit purely resistive with a power factor of $1.0$.'
        ].join('\n');

        const result = parseImportText(simulatedAIOutput, {
            format: 'auto',
            fieldDelim: '|',
            cardDelim: '\n'
        });

        expect(result.questions.length).toBe(2);
        
        // Question 1 assertions
        const q1 = result.questions[0];
        expect(q1.question_text).toBe('What is the SI unit of magnetic flux?');
        expect(q1.answer).toBe('Weber');
        expect(q1.choices).toEqual(['Weber', 'Henry', 'Tesla', 'Maxwell']);
        expect(q1.explanation).toContain('Weber ($Wb$) is the SI unit');
        expect(q1._validation.status).toBe('valid');

        // Question 2 assertions
        const q2 = result.questions[1];
        expect(q2.question_text).toBe('In an AC circuit at resonance, the power factor is:');
        expect(q2.answer).toBe('Unity (1.0)');
        expect(q2.choices).toEqual(['Unity (1.0)', 'Zero', '0.707 lagging', '0.8 leading']);
        expect(q2.explanation).toContain('At resonance, inductive and capacitive reactances cancel out');
        expect(q2._validation.status).toBe('valid');
    });
});
