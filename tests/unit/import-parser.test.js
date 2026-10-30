import { describe, it, expect } from 'vitest';
import {
    parseImportText,
    detectInputFormat,
    tokenizeMathAndCurrency,
    restoreMathAndCurrency,
    escapeHtml,
    validateQuestion,
    resolveAnswerKey
} from '../../public/js/import-parser.js';

describe('Multi-Syntax Question Import Parser Tests', () => {
    it('parses 2-column TSV into identification questions', () => {
        const tsv = "Ohm's Law\tV = IR\nCoulomb's Law\tF = k q1 q2 / r^2";
        const result = parseImportText(tsv, { delimiter: '\t' });
        expect(result.success).toBe(true);
        expect(result.questions).toHaveLength(2);
        expect(result.questions[0].question_text).toBe("Ohm's Law");
        expect(result.questions[0].answer).toBe("V = IR");
        expect(result.questions[0].type).toBe('identification');
    });

    it('parses 3-column TSV into identification questions with explanation', () => {
        const tsv = "Faraday's Law\tElectromagnetic Induction\tDiscovered by Michael Faraday";
        const result = parseImportText(tsv, { delimiter: '\t' });
        expect(result.success).toBe(true);
        expect(result.questions[0].question_text).toBe("Faraday's Law");
        expect(result.questions[0].answer).toBe("Electromagnetic Induction");
        expect(result.questions[0].explanation).toBe("Discovered by Michael Faraday");
        expect(result.questions[0].type).toBe('identification');
    });

    it('parses 4-column TSV with tags', () => {
        const tsv = "Kirchhoff's Current Law\tSum of currents at a node is zero\tConservation of electric charge\tCircuits; KCL; Physics";
        const result = parseImportText(tsv, { delimiter: '\t' });
        expect(result.success).toBe(true);
        expect(result.questions[0].tags).toEqual(['Circuits', 'KCL', 'Physics']);
    });

    it('parses 5-column MCQ with letter key in Column 5', () => {
        const tsv = "Which unit measures capacitance?\tHenry\tFarad\tOhm\tB";
        const result = parseImportText(tsv, { delimiter: '\t' });
        expect(result.success).toBe(true);
        expect(result.questions[0].choices).toEqual(['Henry', 'Farad', 'Ohm']);
        expect(result.questions[0].answer).toBe('Farad');
        expect(result.questions[0].type).toBe('mcq');
    });

    it('flags error on 5-column MCQ with missing or unmatched answer key', () => {
        const tsv = "Which unit measures capacitance?\tHenry\tFarad\tOhm\tInvalidKey";
        const result = parseImportText(tsv, { delimiter: '\t' });
        expect(result.questions[0].answer).toBe('');
        expect(result.questions[0]._validation.status).toBe('error');
        expect(result.success).toBe(false);
    });

    it('parses 6-column MCQ with answer key in Column 6', () => {
        const tsv = "What is the SI unit of resistance?\tVolt\tAmpere\tOhm\tFarad\tOhm\tResistance unit definition";
        const result = parseImportText(tsv, { delimiter: '\t' });
        expect(result.success).toBe(true);
        expect(result.questions[0].choices).toEqual(['Volt', 'Ampere', 'Ohm', 'Farad']);
        expect(result.questions[0].answer).toBe('Ohm');
        expect(result.questions[0].explanation).toBe('Resistance unit definition');
        expect(result.questions[0].type).toBe('mcq');
    });

    it('parses 6-column MCQ with inline asterisk and preserves column 6 as explanation', () => {
        const tsv = "What is Ohm's Law?\t*V = IR\tI = V/R\tP = VI\tR = V^2/P\tRelates voltage and current";
        const result = parseImportText(tsv, { delimiter: '\t' });
        expect(result.success).toBe(true);
        expect(result.questions[0].answer).toBe('V = IR');
        expect(result.questions[0].explanation).toBe('Relates voltage and current');
        expect(result.questions[0].choices).toHaveLength(4);
    });

    it('parses 7-column MCQ with answer key and explanation', () => {
        const pipe = "What is active power unit? | Watt | Volt-Ampere | VAR | Joule | Watt | Measured in watts";
        const result = parseImportText(pipe, { delimiter: '|' });
        expect(result.success).toBe(true);
        expect(result.questions[0].choices).toEqual(['Watt', 'Volt-Ampere', 'VAR', 'Joule']);
        expect(result.questions[0].answer).toBe('Watt');
        expect(result.questions[0].explanation).toBe('Measured in watts');
    });

    it('parses 8-column MCQ with answer key, explanation, and tags', () => {
        const pipe = "Reactive power unit? | Watt | Volt-Ampere | VAR | Joule | VAR | Reactive voltamperes | Power; AC";
        const result = parseImportText(pipe, { delimiter: '|' });
        expect(result.success).toBe(true);
        expect(result.questions[0].tags).toEqual(['Power', 'AC']);
    });

    it('parses asterisk-keyed inline MCQs with priority over column count', () => {
        const pipe = "What is Ohm's Law? | *V = IR | I = V/R | P = VI | R = V^2/P";
        const result = parseImportText(pipe, { delimiter: '|' });
        expect(result.success).toBe(true);
        expect(result.questions[0].answer).toBe('V = IR');
        expect(result.questions[0].choices).toContain('V = IR');
        expect(result.questions[0].choices).not.toContain('*V = IR');
    });

    it('preserves RFC 4180 quotes containing commas inside fields', () => {
        const csv = '"What is Ohm\'s Law, according to physics?",V = IR,I = V/R,P = VI,R = V^2/P,V = IR';
        const result = parseImportText(csv, { delimiter: ',' });
        expect(result.success).toBe(true);
        expect(result.questions[0].question_text).toBe("What is Ohm's Law, according to physics?");
        expect(result.questions[0].answer).toBe('V = IR');
    });

    it('preserves LaTeX math formulas containing delimiters inside equations', () => {
        const tsv = "Evaluate $\\int_0^1 x, dx$\t0\t1\t$1/2$\t2\t$1/2$\tPower rule integration";
        const result = parseImportText(tsv, { delimiter: '\t' });
        expect(result.success).toBe(true);
        expect(result.questions[0].question_text).toContain("$\\int_0^1 x, dx$");
    });

    it('shields currency numbers without confusing them with LaTeX spans', () => {
        const { tokenized, mathTokens } = tokenizeMathAndCurrency('Price is $50 per item | Total is $100 | Answer');
        expect(tokenized).toContain('§CURR§50');
        expect(tokenized).toContain('§CURR§100');
        const restored = restoreMathAndCurrency(tokenized, mathTokens);
        expect(restored).toBe('Price is $50 per item | Total is $100 | Answer');
    });

    it('strips trailing record delimiters (e.g. semicolons) to prevent phantom columns', () => {
        const pipe = "Question text | Answer | Explanation;";
        const result = parseImportText(pipe, { delimiter: '|' });
        expect(result.success).toBe(true);
        expect(result.questions[0].question_text).toBe("Question text");
        expect(result.questions[0].answer).toBe("Answer");
        expect(result.questions[0].explanation).toBe("Explanation");
    });

    it('parses standard academic Aiken format with multi-line statements', () => {
        const aiken = `What is the capital of France?
It is known as the City of Light.
A. London
B. Paris
C. Berlin
D. Madrid
ANSWER: B
EXPLANATION: Paris is the capital and largest city of France.
TAGS: Geography; Europe`;

        const result = parseImportText(aiken, { format: 'aiken' });
        expect(result.success).toBe(true);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].question_text).toBe('What is the capital of France? It is known as the City of Light.');
        expect(result.questions[0].choices).toEqual(['London', 'Paris', 'Berlin', 'Madrid']);
        expect(result.questions[0].answer).toBe('Paris');
        expect(result.questions[0].explanation).toContain('Paris is the capital');
        expect(result.questions[0].tags).toEqual(['Geography', 'Europe']);
    });

    it('unpacks matching pair rows into discrete MCQ cards', () => {
        const tsv = "Electrical Units\tCurrent = Ampere, Voltage = Volt, Resistance = Ohm\tBasic electrical units";
        const result = parseImportText(tsv, { delimiter: '\t', unpackMatchingPairs: true });
        expect(result.success).toBe(true);
        expect(result.questions).toHaveLength(3);
        expect(result.questions[0].question_text).toContain('Current');
        expect(result.questions[0].answer).toBe('Ampere');
        expect(result.questions[0].choices).toEqual(['Ampere', 'Volt', 'Ohm']);
    });

    it('auto-detects delimiter formats using candidate scoring matrix', () => {
        const pipeSample = "Q1 | A | B | C | D | A\nQ2 | A | B | C | D | B\nQ3 | A | B | C | D | C";
        const detected = detectInputFormat(pipeSample);
        expect(detected.format).toBe('delimited');
        expect(detected.fieldDelimiter).toBe('|');
    });

    it('sanitizes malicious HTML to prevent script injection', () => {
        const dirty = '<script>alert("xss")</script> & <b>test</b>';
        const clean = escapeHtml(dirty);
        expect(clean).not.toContain('<script>');
        expect(clean).toContain('&lt;script&gt;');
        expect(clean).toContain('&amp;');
    });

    it('prioritizes verbatim answer matches before single letter decoding', () => {
        const choices = ['O', 'A', 'B', 'AB'];
        // Choice 'A' is at index 1.
        // If verbatim was not checked first, letter 'A' would decode to index 0 ('O').
        const res = resolveAnswerKey('A', choices);
        expect(res.answer).toBe('A');
    });
});
