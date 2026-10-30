import { describe, it, expect } from 'vitest';
import { ImportUI } from '../../public/js/import-ui.js';
import { parseImportText, stripMarkdownCodeFences } from '../../public/js/import-parser.js';

describe('AI Reformat Prompt Generator & Parser Interoperability', () => {
    // Instantiate ImportUI in mock environment
    const mockModal = { querySelector: () => null, querySelectorAll: () => [] };
    const ui = new ImportUI(mockModal, null, null);

    it('generates a valid MCQ reformat prompt targeting existing user questions', () => {
        const prompt = ui.generateAIPrompt({ type: 'mcq', explanationMode: 'add_missing', includeLatex: true, wrapInCodeBlock: true });
        expect(prompt).toContain('Please reformat ALL of the questions provided below');
        expect(prompt).toContain('Do not skip any questions, do not invent new questions');
        expect(prompt).toContain('Question Text | *Correct Choice | Distractor 1 | Distractor 2 | Distractor 3 | Detailed step-by-step explanation');
        expect(prompt).toContain('Prefix the exact correct choice with an asterisk (*) so the system marks it as the answer key');
        expect(prompt).toContain('Wrap the entire output inside a single raw text code block');
        expect(prompt).toContain('inline LaTeX enclosed in single dollar signs');
    });

    it('generates a valid Flashcard reformat prompt', () => {
        const prompt = ui.generateAIPrompt({ type: 'flashcards', includeLatex: false, wrapInCodeBlock: true });
        expect(prompt).toContain('Please reformat ALL of the terms, vocabulary, or review items provided below');
        expect(prompt).toContain('Term | Detailed Definition or Explanation');
        expect(prompt).toContain('plain text without LaTeX');
    });

    it('generates a valid Aiken reformat prompt', () => {
        const prompt = ui.generateAIPrompt({ type: 'aiken', includeLatex: true, wrapInCodeBlock: true });
        expect(prompt).toContain('Please reformat ALL of the multiple-choice questions provided below into standard Aiken format');
        expect(prompt).toContain('ANSWER: [Letter]');
        expect(prompt).toContain('EXPLANATION: [Reasoning]');
    });

    it('correctly strips outer markdown code block fences', () => {
        const wrapped = '```text\nQuestion 1 | *A | B | C | D | Exp\n```';
        const stripped = stripMarkdownCodeFences(wrapped);
        expect(stripped).toBe('Question 1 | *A | B | C | D | Exp');
    });

    it('verifies that output with code block fences and LaTeX formulas parses seamlessly', () => {
        // Simulated AI response following the prompt instructions enclosed in a code block
        const simulatedAIOutput = [
            '```text',
            'A three-phase fault occurs at synchronous generator with reactance $X_d\'\' = 0.20\\text{ pu}$. What is the fault current? | *26.24 kA | 15.15 kA | 52.49 kA | 5.25 kA | First, calculate base current $I_b = \\frac{S}{\\sqrt{3}V} = 5248.64\\text{ A}$. Per-unit current is $I_{f(pu)} = 5.0\\text{ pu}$, giving $I_f = 26.24\\text{ kA}$.',
            'An RLC series circuit has $R = 10\\ \\Omega$, $L = 0.1\\text{ H}$, and $C = 10\\ \\mu\\text{F}$. What is the damping ratio $\\zeta$? | *0.05 | 0.50 | 1.00 | 0.10 | The damping ratio is defined as $\\zeta = \\frac{R}{2}\\sqrt{\\frac{C}{L}} = 0.05$. Because $\\zeta < 1$, the system is underdamped.',
            '```'
        ].join('\n');

        const result = parseImportText(simulatedAIOutput, {
            format: 'auto',
            fieldDelim: '|',
            cardDelim: '\n'
        });

        expect(result.questions.length).toBe(2);

        // Question 1 assertions
        const q1 = result.questions[0];
        expect(q1.question_text).toContain('reactance $X_d\'\' = 0.20\\text{ pu}$');
        expect(q1.answer).toBe('26.24 kA');
        expect(q1.choices).toEqual(['26.24 kA', '15.15 kA', '52.49 kA', '5.25 kA']);
        expect(q1.explanation).toContain('\\frac{S}{\\sqrt{3}V}');
        expect(q1._validation.status).toBe('valid');

        // Question 2 assertions
        const q2 = result.questions[1];
        expect(q2.question_text).toContain('$R = 10\\ \\Omega$');
        expect(q2.answer).toBe('0.05');
        expect(q2.choices).toEqual(['0.05', '0.50', '1.00', '0.10']);
        expect(q2.explanation).toContain('\\frac{R}{2}\\sqrt{\\frac{C}{L}}');
        expect(q2._validation.status).toBe('valid');
    });
});
