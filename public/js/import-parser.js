/**
 * import-parser.js — Multi-Syntax Question Import Parser & Lexer Engine
 * Supports: TSV, CSV (RFC 4180), Pipe, Semicolon, Aiken, Asterisk-keyed inline MCQs, and JSON.
 * Standalone Public Quiz Platform
 */

/**
 * Escapes untrusted HTML tags and special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Tokenizes LaTeX mathematical expressions and shields currency figures ($50).
 * @param {string} rawText
 * @returns {{ tokenized: string, mathTokens: string[] }}
 */
export function tokenizeMathAndCurrency(rawText) {
    if (!rawText || typeof rawText !== 'string') return { tokenized: '', mathTokens: [] };

    // Step 1: Shield currency values (e.g. $50, $100.50)
    const currencyProtected = rawText.replace(/\$(\d+(?:[.,]\d+)?(?:\s|[.,;:?!)\/|\t\r\n\-]|$))/g, '§CURR§$1');

    // Step 2: Tokenize true LaTeX math spans ($$...$$ and $...$)
    const mathTokens = [];
    const tokenized = currencyProtected.replace(/(\$\$[\s\S]+?\$\$|\$(?!\s)[^$\r\n]+(?!\s)\$)/g, (match) => {
        const placeholder = `§MATH_${mathTokens.length}§`;
        mathTokens.push(match);
        return placeholder;
    });

    return { tokenized, mathTokens };
}

/**
 * Restores original LaTeX formulas and currency signs from tokens.
 * @param {string} text
 * @param {string[]} mathTokens
 * @returns {string}
 */
export function restoreMathAndCurrency(text, mathTokens) {
    if (!text || typeof text !== 'string') return '';
    let restored = text.replace(/§CURR§/g, '$');
    if (Array.isArray(mathTokens)) {
        for (let i = 0; i < mathTokens.length; i++) {
            restored = restored.replace(new RegExp(`§MATH_${i}§`, 'g'), () => mathTokens[i]);
        }
    }
    return restored;
}

/**
 * Strips outer quotes from RFC 4180 enclosed fields and unescapes double quotes.
 */
function stripOuterQuotes(str) {
    if (typeof str !== 'string') return '';
    const trimmed = str.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1).replace(/""/g, '"').trim();
    }
    return trimmed;
}

/**
 * Parses a single line according to RFC 4180 quoted field rules.
 * @param {string} line
 * @param {string} delimiter
 * @returns {{ fields: string[], hasUnclosedQuote: boolean }}
 */
export function parseDelimitedRow(line, delimiter = '\t') {
    const fields = [];
    let inQuotes = false;
    let currentField = '';
    let hasUnclosedQuote = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                currentField += '"';
                i++; // Skip escaped quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            fields.push(currentField.trim());
            currentField = '';
        } else {
            currentField += char;
        }
    }

    if (inQuotes) {
        hasUnclosedQuote = true;
    }

    fields.push(currentField.trim());
    return { fields, hasUnclosedQuote };
}

/**
 * Splits raw text into cards, stripping trailing record delimiters (;, \r).
 * @param {string} rawText
 * @param {string} cardDelimiter
 * @returns {string[]}
 */
export function splitCards(rawText, cardDelimiter = '\n') {
    if (!rawText || typeof rawText !== 'string') return [];

    const rawCards = cardDelimiter === '\n\n'
        ? rawText.split(/\r?\n\s*\r?\n/)
        : rawText.split(/\r?\n/);

    const cards = [];
    for (let card of rawCards) {
        let trimmed = card.trim();
        // Trim trailing record delimiters (e.g. trailing ';' or '\r')
        trimmed = trimmed.replace(/[;\r]+$/, '').trim();
        if (trimmed.length > 0) {
            cards.push(trimmed);
        }
    }
    return cards;
}

/**
 * Heuristically detects input format and delimiter scoring matrix.
 * @param {string} rawText
 * @returns {{ format: string, fieldDelimiter?: string, cardDelimiter?: string, confidence?: number, data?: any }}
 */
export function detectInputFormat(rawText) {
    const trimmed = (rawText || '').trim();
    if (!trimmed) return { format: 'empty' };

    // 1. JSON Detection
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            const parsed = JSON.parse(trimmed);
            return { format: 'json', data: parsed };
        } catch (_) {}
    }

    // 2. Academic Aiken Format Detection
    const hasAikenAnswer = /^ANSWER\s*:\s*[A-Za-z0-9]/im.test(trimmed);
    const hasAikenChoices = /^[A-Za-z][\.\)]\s+.+/m.test(trimmed);
    if (hasAikenAnswer && hasAikenChoices) {
        return { format: 'aiken', cardDelimiter: '\n\n' };
    }

    // 3. Delimited Matrix Scoring (Tab vs Pipe vs Semicolon vs Comma)
    const sampleLines = trimmed.split(/\r?\n/)
        .map(l => l.trim().replace(/[;\r]+$/, '').trim())
        .filter(l => l.length > 0)
        .slice(0, 30);

    const candidates = [
        { delim: '\t', name: 'Tab', bias: 1.6 },
        { delim: '|',  name: 'Pipe', bias: 1.4 },
        { delim: ';',  name: 'Semicolon', bias: 1.1 },
        { delim: ',',  name: 'Comma', bias: 1.0 }
    ];

    let bestCandidate = candidates[0];
    let highestScore = -1;

    for (const candidate of candidates) {
        const counts = sampleLines.map(line => parseDelimitedRow(line, candidate.delim).fields.length);
        const avg = counts.reduce((a, b) => a + b, 0) / (counts.length || 1);
        const variance = counts.reduce((acc, c) => acc + Math.pow(c - avg, 2), 0) / (counts.length || 1);

        if (avg >= 2) {
            const consistencyScore = (avg / (1.0 + variance)) * candidate.bias;
            if (consistencyScore > highestScore) {
                highestScore = consistencyScore;
                bestCandidate = candidate;
            }
        }
    }

    return {
        format: 'delimited',
        fieldDelimiter: bestCandidate.delim,
        cardDelimiter: '\n',
        confidence: highestScore
    };
}

/**
 * Resolves canonical answer key against choices using strict priority:
 * 1. Verbatim match in choices
 * 2. Letter key A-Z
 * 3. 1-based numeric index
 * @param {string} rawAnswer
 * @param {string[]} choices
 * @returns {{ answer: string, status: 'valid' | 'error', message?: string }}
 */
export function resolveAnswerKey(rawAnswer, choices) {
    const trimmed = (rawAnswer || '').trim();
    if (!trimmed) {
        return { answer: '', status: 'error', message: 'Missing answer key.' };
    }

    // Rule 1: Verbatim match has absolute priority
    if (choices.includes(trimmed)) {
        return { answer: trimmed, status: 'valid' };
    }

    // Rule 2: Single letter A-Z mapping (A=0, B=1, C=2, D=3)
    const letterMatch = trimmed.match(/^[A-Za-z]$/);
    if (letterMatch) {
        const index = letterMatch[0].toUpperCase().charCodeAt(0) - 65;
        if (index >= 0 && index < choices.length) {
            return { answer: choices[index], status: 'valid' };
        }
    }

    // Rule 3: 1-based numeric index mapping (1=0, 2=1, 3=2, 4=3)
    const numMatch = trimmed.match(/^[1-9]$/);
    if (numMatch) {
        const index = parseInt(numMatch[0], 10) - 1;
        if (index >= 0 && index < choices.length) {
            return { answer: choices[index], status: 'valid' };
        }
    }

    return {
        answer: trimmed,
        status: 'error',
        message: `Answer '${trimmed}' does not match any of the provided choices.`
    };
}

/**
 * Validates a single question object.
 * @param {Object} q
 * @returns {{ valid: boolean, status: 'valid' | 'warning' | 'error', errors: string[], warnings: string[] }}
 */
export function validateQuestion(q) {
    const errors = [];
    const warnings = [];

    if (!q.question_text || !q.question_text.trim()) {
        errors.push('Question statement is empty.');
    }

    if (!q.answer || !q.answer.trim()) {
        errors.push('Correct answer key is missing.');
    }

    if (q.type === 'mcq') {
        if (!Array.isArray(q.choices) || q.choices.length < 2) {
            errors.push(`Multiple-choice questions require at least 2 choices (found ${q.choices ? q.choices.length : 0}).`);
        } else if (q.answer && !q.choices.includes(q.answer)) {
            errors.push(`Correct answer '${q.answer}' is not listed among the choices.`);
        }

        // Warnings check
        if (Array.isArray(q.choices)) {
            const unique = new Set(q.choices);
            if (unique.size < q.choices.length) {
                warnings.push('Contains duplicate choice options.');
            }
        }
    }

    if (!q.explanation || !q.explanation.trim()) {
        warnings.push('No explanation provided.');
    }

    const valid = errors.length === 0;
    const status = errors.length > 0 ? 'error' : (warnings.length > 0 ? 'warning' : 'valid');

    return { valid, status, errors, warnings };
}

/**
 * Disambiguates a delimited row (2 to 8 columns) and constructs an ImportedQuestion.
 */
function parseDelimitedRowToQuestion(rawFields, rowIndex, options = {}) {
    const fields = rawFields.map(f => (f || '').trim());
    const colCount = fields.length;

    if (colCount < 2) {
        return {
            error: {
                line: rowIndex + 1,
                questionIndex: rowIndex,
                message: `Insufficient columns (${colCount}). At least 2 columns required.`,
                type: 'insufficient_columns'
            }
        };
    }

    let questionText = fields[0];
    let choices = [];
    let answer = '';
    let explanation = '';
    let tags = [];
    let type = 'identification';
    let asteriskFound = false;

    // Scan for Asterisk Key Convention (*Choice) across choice candidates (cols 1..5)
    let asteriskIndex = -1;
    const potentialChoiceEnd = Math.min(fields.length, 6);
    for (let c = 1; c < potentialChoiceEnd; c++) {
        if (fields[c].startsWith('*')) {
            asteriskFound = true;
            asteriskIndex = c;
            break;
        }
    }

    if (colCount === 2) {
        // 2 Columns: [Question/Term, Answer/Definition]
        type = 'identification';
        answer = fields[1];
        choices = [fields[1]];
    } else if (colCount === 3) {
        // 3 Columns: [Question, Answer, Explanation]
        type = 'identification';
        answer = fields[1];
        choices = [fields[1]];
        explanation = fields[2];
    } else if (colCount === 4) {
        // 4 Columns: [Question, Answer, Explanation, Tags]
        type = 'identification';
        answer = fields[1];
        choices = [fields[1]];
        explanation = fields[2];
        tags = fields[3].split(/[;,]\s*/).filter(t => t.length > 0);
    } else if (colCount === 5) {
        // 5 Columns Disambiguation
        if (asteriskFound && asteriskIndex >= 1 && asteriskIndex <= 4) {
            type = 'mcq';
            choices = fields.slice(1, 5).map(c => c.startsWith('*') ? c.slice(1).trim() : c);
            answer = choices[asteriskIndex - 1];
        } else {
            const col5 = fields[4];
            const threeChoices = fields.slice(1, 4);
            const isVerbatim = threeChoices.includes(col5);
            const isLetterKey = /^[A-Ca-c]$/.test(col5);
            const isNumericKey = /^[1-3]$/.test(col5);

            if (isVerbatim || isLetterKey || isNumericKey) {
                type = 'mcq';
                choices = threeChoices;
                const res = resolveAnswerKey(col5, choices);
                answer = res.answer;
            } else {
                type = 'mcq';
                choices = fields.slice(1, 5);
                answer = '';
            }
        }
    } else if (colCount === 6) {
        // 6 Columns Disambiguation
        if (asteriskFound && asteriskIndex >= 1 && asteriskIndex <= 4) {
            type = 'mcq';
            choices = fields.slice(1, 5).map(c => c.startsWith('*') ? c.slice(1).trim() : c);
            answer = choices[asteriskIndex - 1];
            explanation = fields[5];
        } else {
            type = 'mcq';
            choices = fields.slice(1, 5);
            const res = resolveAnswerKey(fields[5], choices);
            answer = res.answer;
        }
    } else if (colCount === 7) {
        // 7 Columns: [Question, C1, C2, C3, C4, Answer Key, Explanation]
        type = 'mcq';
        choices = fields.slice(1, 5);
        const res = resolveAnswerKey(fields[5], choices);
        answer = res.answer;
        explanation = fields[6];
    } else if (colCount >= 8) {
        // 8 Columns: [Question, C1, C2, C3, C4, Answer Key, Explanation, Tags]
        type = 'mcq';
        choices = fields.slice(1, 5);
        const res = resolveAnswerKey(fields[5], choices);
        answer = res.answer;
        explanation = fields[6];
        tags = fields[7].split(/[;,]\s*/).filter(t => t.length > 0);
    }

    const question = {
        id: `q_${Date.now()}_${rowIndex + 1}`,
        setId: options.setId || '',
        type,
        order: rowIndex + 1,
        question_text: questionText,
        choices,
        answer,
        explanation,
        tags,
        starred: false,
        createdAt: Date.now()
    };

    return { question };
}

/**
 * Unpacks matching pairs (e.g. Key = Value, A = 1, B = 2) into discrete MCQ questions.
 * @param {string[]} fields
 * @param {number} rowIndex
 * @param {Object} options
 * @returns {Object[]|null}
 */
export function unpackMatchingPairs(fields, rowIndex, options = {}) {
    if (!fields || fields.length < 2) return null;
    const topic = fields[0] || 'Term Match';
    const rawPairs = fields[1] || '';
    const explanation = fields[2] || '';
    const tags = fields[3] ? fields[3].split(/[;,]\s*/).filter(Boolean) : [];

    const pairItems = rawPairs.split(/[;,]\s*/).filter(Boolean);
    const parsedPairs = [];

    for (const item of pairItems) {
        const eqIdx = item.indexOf('=') !== -1 ? item.indexOf('=') : item.indexOf(':');
        if (eqIdx !== -1) {
            const key = item.slice(0, eqIdx).trim();
            const val = item.slice(eqIdx + 1).trim();
            if (key && val) {
                parsedPairs.push({ key, val });
            }
        }
    }

    if (parsedPairs.length < 2) return null;

    const allValues = parsedPairs.map(p => p.val);
    const explodedQuestions = [];

    for (let i = 0; i < parsedPairs.length; i++) {
        const pair = parsedPairs[i];
        explodedQuestions.push({
            id: `q_${Date.now()}_${rowIndex}_${i + 1}`,
            setId: options.setId || '',
            type: 'mcq',
            order: rowIndex + i + 1,
            question_text: `What is the ${topic} of ${pair.key}?`,
            choices: [...allValues],
            answer: pair.val,
            explanation: explanation || `Matching pair: ${pair.key} = ${pair.val}`,
            tags: [...tags, 'Matching Pairs'],
            starred: false,
            createdAt: Date.now()
        });
    }

    return explodedQuestions;
}

/**
 * Parses academic Aiken formatted plain text.
 */
export function parseAikenText(rawText, options = {}) {
    const trimmed = (rawText || '').trim();
    if (!trimmed) {
        return { success: true, questions: [], warnings: [], errors: [], stats: { total: 0, valid: 0, warning: 0, error: 0 } };
    }

    const lines = trimmed.split(/\r?\n/);
    const questions = [];
    const warnings = [];
    const errors = [];

    let currentQuestion = null;
    let lineNum = 0;

    function flushCurrent() {
        if (!currentQuestion) return;

        if (!currentQuestion.question_text) {
            errors.push({
                line: currentQuestion.startLine,
                questionIndex: questions.length,
                message: 'Empty question text in Aiken block.',
                type: 'missing_question'
            });
            currentQuestion = null;
            return;
        }

        if (currentQuestion.choices.length < 2) {
            errors.push({
                line: currentQuestion.startLine,
                questionIndex: questions.length,
                message: `MCQ question has fewer than 2 choices (${currentQuestion.choices.length}).`,
                type: 'insufficient_columns'
            });
            currentQuestion = null;
            return;
        }

        if (!currentQuestion.rawAnswer) {
            errors.push({
                line: currentQuestion.startLine,
                questionIndex: questions.length,
                message: 'Missing ANSWER: line.',
                type: 'missing_answer'
            });
            currentQuestion = null;
            return;
        }

        const resolution = resolveAnswerKey(currentQuestion.rawAnswer, currentQuestion.choices);
        currentQuestion.answer = resolution.answer;
        if (resolution.status === 'error') {
            errors.push({
                line: currentQuestion.startLine,
                questionIndex: questions.length,
                message: `ANSWER '${currentQuestion.rawAnswer}' out of bounds for ${currentQuestion.choices.length} choices.`,
                type: 'answer_not_in_choices'
            });
        }

        delete currentQuestion.rawAnswer;
        delete currentQuestion.startLine;

        const val = validateQuestion(currentQuestion);
        currentQuestion._validation = val;

        questions.push(currentQuestion);
        currentQuestion = null;
    }

    for (let i = 0; i < lines.length; i++) {
        lineNum = i + 1;
        const line = lines[i].trim();

        if (!line) {
            flushCurrent();
            continue;
        }

        const answerMatch = line.match(/^ANSWER\s*:\s*([A-Za-z0-9]+)/i);
        const choiceMatch = line.match(/^([A-Za-z])[\.\)]\s+(.+)$/);
        const explanationMatch = line.match(/^EXPLANATION\s*:\s*(.+)$/i);
        const tagsMatch = line.match(/^TAGS\s*:\s*(.+)$/i);

        if (answerMatch) {
            if (currentQuestion) {
                currentQuestion.rawAnswer = answerMatch[1].trim();
            }
        } else if (explanationMatch) {
            if (currentQuestion) {
                currentQuestion.explanation = explanationMatch[1].trim();
            }
        } else if (tagsMatch) {
            if (currentQuestion) {
                currentQuestion.tags = tagsMatch[1].split(/[;,]\s*/).map(t => t.trim()).filter(Boolean);
            }
        } else if (choiceMatch) {
            if (currentQuestion) {
                currentQuestion.choices.push(choiceMatch[2].trim());
            }
        } else {
            if (!currentQuestion) {
                currentQuestion = {
                    id: `q_${Date.now()}_${questions.length + 1}`,
                    setId: options.setId || '',
                    type: 'mcq',
                    order: questions.length + 1,
                    question_text: line,
                    choices: [],
                    answer: '',
                    rawAnswer: '',
                    explanation: '',
                    tags: [],
                    starred: false,
                    createdAt: Date.now(),
                    startLine: lineNum
                };
            } else if (currentQuestion.choices.length === 0) {
                currentQuestion.question_text += ` ${line}`;
            } else {
                flushCurrent();
                currentQuestion = {
                    id: `q_${Date.now()}_${questions.length + 1}`,
                    setId: options.setId || '',
                    type: 'mcq',
                    order: questions.length + 1,
                    question_text: line,
                    choices: [],
                    answer: '',
                    rawAnswer: '',
                    explanation: '',
                    tags: [],
                    starred: false,
                    createdAt: Date.now(),
                    startLine: lineNum
                };
            }
        }
    }

    flushCurrent();

    const validCount = questions.filter(q => q._validation?.status === 'valid').length;
    const warningCount = questions.filter(q => q._validation?.status === 'warning').length;
    const errorCount = errors.length + questions.filter(q => q._validation?.status === 'error').length;

    return {
        success: errorCount === 0,
        questions,
        warnings,
        errors,
        stats: {
            total: questions.length,
            valid: validCount,
            warning: warningCount,
            error: errorCount
        },
        detectedFormat: 'aiken',
        resolvedCardDelimiter: '\n\n'
    };
}

/**
 * Parses native JSON study set or questions array.
 */
export function parseJsonText(rawText, options = {}) {
    let data;
    try {
        data = JSON.parse(rawText);
    } catch (err) {
        return {
            success: false,
            questions: [],
            warnings: [],
            errors: [{ line: 1, questionIndex: 0, message: `Invalid JSON syntax: ${err.message}`, type: 'invalid_json' }],
            stats: { total: 0, valid: 0, warning: 0, error: 1 },
            detectedFormat: 'json'
        };
    }

    let rawQuestions = [];
    let setMetadata = {};

    if (Array.isArray(data)) {
        rawQuestions = data;
    } else if (data && typeof data === 'object') {
        if (Array.isArray(data.questions)) {
            rawQuestions = data.questions;
            setMetadata = {
                title: data.title,
                category: data.category,
                description: data.description
            };
        } else {
            return {
                success: false,
                questions: [],
                warnings: [],
                errors: [{ line: 1, questionIndex: 0, message: 'JSON object missing "questions" array.', type: 'invalid_json' }],
                stats: { total: 0, valid: 0, warning: 0, error: 1 },
                detectedFormat: 'json'
            };
        }
    }

    const questions = [];
    const errors = [];
    const warnings = [];

    for (let i = 0; i < rawQuestions.length; i++) {
        const q = rawQuestions[i];
        const normalized = {
            id: q.id || `q_${Date.now()}_${i + 1}`,
            setId: options.setId || q.setId || '',
            type: q.type === 'identification' ? 'identification' : 'mcq',
            order: typeof q.order === 'number' ? q.order : i + 1,
            question_text: typeof q.question_text === 'string' ? q.question_text.trim() : (q.term || '').trim(),
            choices: Array.isArray(q.choices) ? q.choices.map(c => String(c).trim()) : (q.answer ? [String(q.answer).trim()] : []),
            answer: typeof q.answer === 'string' ? q.answer.trim() : (q.definition || '').trim(),
            explanation: typeof q.explanation === 'string' ? q.explanation.trim() : '',
            tags: Array.isArray(q.tags) ? q.tags.map(t => String(t).trim()) : [],
            starred: Boolean(q.starred),
            createdAt: typeof q.createdAt === 'number' ? q.createdAt : Date.now()
        };

        const val = validateQuestion(normalized);
        normalized._validation = val;
        questions.push(normalized);
    }

    const validCount = questions.filter(q => q._validation.status === 'valid').length;
    const warningCount = questions.filter(q => q._validation.status === 'warning').length;
    const errorCount = questions.filter(q => q._validation.status === 'error').length;

    return {
        success: errorCount === 0,
        questions,
        warnings,
        errors,
        stats: {
            total: questions.length,
            valid: validCount,
            warning: warningCount,
            error: errorCount
        },
        setMetadata,
        detectedFormat: 'json'
    };
}

/**
 * Master entry point for parsing any supported question import format.
 * @param {string} rawText
 * @param {Object} [options={}]
 * @returns {Object} ParseResult
 */
export function parseImportText(rawText, options = {}) {
    const trimmed = (rawText || '').trim();
    if (!trimmed) {
        return {
            success: true,
            questions: [],
            warnings: [],
            errors: [],
            stats: { total: 0, valid: 0, warning: 0, error: 0 },
            detectedFormat: 'empty'
        };
    }

    let format = options.format || 'auto';
    let fieldDelimiter = options.delimiter || options.fieldDelimiter;
    let cardDelimiter = options.cardDelimiter || '\n';

    if (format === 'auto' || !fieldDelimiter) {
        const detection = detectInputFormat(trimmed);
        if (format === 'auto') {
            format = detection.format;
        }
        if (!fieldDelimiter && detection.fieldDelimiter) {
            fieldDelimiter = detection.fieldDelimiter;
        }
    }

    if (format === 'json') {
        return parseJsonText(trimmed, options);
    }

    if (format === 'aiken') {
        return parseAikenText(trimmed, options);
    }

    // Delimited processing (TSV, CSV, Pipe, Semicolon)
    const delimiter = fieldDelimiter || '\t';
    const { tokenized, mathTokens } = tokenizeMathAndCurrency(trimmed);
    const rawCardLines = splitCards(tokenized, cardDelimiter);

    const questions = [];
    const warnings = [];
    const errors = [];

    const startIndex = options.skipHeaderRow ? 1 : 0;

    for (let r = startIndex; r < rawCardLines.length; r++) {
        const line = rawCardLines[r];
        const { fields, hasUnclosedQuote } = parseDelimitedRow(line, delimiter);

        if (hasUnclosedQuote) {
            warnings.push({
                line: r + 1,
                questionIndex: questions.length,
                message: 'Line contains an unclosed quote. Auto-closed at end of line.',
                type: 'unclosed_quote'
            });
        }

        // Restore math and currency for all fields
        const restoredFields = fields.map(f => restoreMathAndCurrency(f, mathTokens));

        // Unpack matching pairs if enabled
        if (options.unpackMatchingPairs !== false && restoredFields.length >= 2) {
            const unpacked = unpackMatchingPairs(restoredFields, questions.length, options);
            if (unpacked && unpacked.length > 0) {
                unpacked.forEach(q => {
                    const val = validateQuestion(q);
                    q._validation = val;
                    questions.push(q);
                });
                continue;
            }
        }

        const res = parseDelimitedRowToQuestion(restoredFields, questions.length, options);
        if (res.error) {
            errors.push(res.error);
        } else if (res.question) {
            const val = validateQuestion(res.question);
            res.question._validation = val;
            questions.push(res.question);
        }
    }

    const validCount = questions.filter(q => q._validation?.status === 'valid').length;
    const warningCount = warnings.length + questions.filter(q => q._validation?.status === 'warning').length;
    const errorCount = errors.length + questions.filter(q => q._validation?.status === 'error').length;

    return {
        success: errorCount === 0,
        questions,
        warnings,
        errors,
        stats: {
            total: questions.length,
            valid: validCount,
            warning: warningCount,
            error: errorCount
        },
        detectedFormat: format,
        resolvedFieldDelimiter: delimiter,
        resolvedCardDelimiter: cardDelimiter
    };
}
