/**
 * import-ui.js — Interactive 5-Step Import Workflow UI Controller
 * Features: Debounced input, live validation summary, editable preview table,
 * click-to-set answer chip, quick-fix popover, MathJax preview toggle, and library commit.
 * Standalone Public Quiz Platform
 */

import { parseImportText, validateQuestion, escapeHtml } from './import-parser.js';

export class ImportUI {
    /**
     * @param {HTMLElement} modalElement - #import-modal
     * @param {SetManager} setManager
     * @param {Function} onSaveSuccess - callback(studySet, startQuizImmediately)
     */
    constructor(modalElement, setManager, onSaveSuccess) {
        this.modal = modalElement;
        this.setManager = setManager;
        this.onSaveSuccess = onSaveSuccess;

        this.rawText = '';
        this.parsedResult = null;
        this.filterTab = 'all';
        this.isLatexPreviewActive = false;
        this.debounceTimer = null;

        this.initDOMElements();
        this.attachEventListeners();
    }

    initDOMElements() {
        if (!this.modal) return;
        this.titleInput = this.modal.querySelector('#import-set-title');
        this.categoryInput = this.modal.querySelector('#import-set-category');
        this.formatSelect = this.modal.querySelector('#import-format-select');
        this.fieldDelimSelect = this.modal.querySelector('#import-field-delim');
        this.fieldDelimItem = this.modal.querySelector('#field-delim-item');
        this.unpackPairsCheckbox = this.modal.querySelector('#import-unpack-matching');
        this.textarea = this.modal.querySelector('#import-raw-textarea') || this.modal.querySelector('#import-textarea');
        this.dropZone = this.modal.querySelector('#import-drop-zone') || this.modal.querySelector('#import-dropzone');
        this.summaryBar = this.modal.querySelector('#validation-summary-bar') || this.modal.querySelector('#import-summary-bar');
        this.valValidCount = this.modal.querySelector('#val-valid-count') || this.modal.querySelector('#val-valid');
        this.valWarnCount = this.modal.querySelector('#val-warn-count') || this.modal.querySelector('#val-warning');
        this.valErrCount = this.modal.querySelector('#val-err-count') || this.modal.querySelector('#val-error');
        this.previewContainer = this.modal.querySelector('#import-preview-container') || this.modal.querySelector('.preview-table-wrap');
        this.previewTbody = this.modal.querySelector('#import-preview-tbody');
        this.saveBtn = this.modal.querySelector('#import-save-btn');
        this.saveStartBtn = this.modal.querySelector('#import-save-start-btn');
        this.cancelBtn = this.modal.querySelector('#import-cancel-btn');
        this.closeBtn = this.modal.querySelector('#close-import-btn') || this.modal.querySelector('#import-close-btn');
    }

    attachEventListeners() {
        if (!this.modal) return;

        // Debounced text input (150ms)
        if (this.textarea) {
            this.textarea.addEventListener('input', () => {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => {
                    this.handleTextInput(this.textarea.value);
                }, 150);
            });
        }

        // Format dropdown change
        if (this.formatSelect) {
            this.formatSelect.addEventListener('change', () => {
                if (this.fieldDelimItem) {
                    this.fieldDelimItem.style.display = this.formatSelect.value === 'delimited' || this.formatSelect.value === 'auto' ? 'block' : 'none';
                }
                this.reparse();
            });
        }

        // Delimiter dropdown change
        if (this.fieldDelimSelect) {
            this.fieldDelimSelect.addEventListener('change', () => this.reparse());
        }

        // Unpack pairs toggle
        if (this.unpackPairsCheckbox) {
            this.unpackPairsCheckbox.addEventListener('change', () => this.reparse());
        }

        // Set title input change (enables/disables save button)
        if (this.titleInput) {
            this.titleInput.addEventListener('input', () => this.updateSaveButtonState());
        }

        // Drag and drop zone
        if (this.dropZone) {
            this.dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                this.dropZone.classList.add('drag-over');
            });
            this.dropZone.addEventListener('dragleave', () => {
                this.dropZone.classList.remove('drag-over');
            });
            this.dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                this.dropZone.classList.remove('drag-over');
                const file = e.dataTransfer.files && e.dataTransfer.files[0];
                if (file) this.handleFileUpload(file);
            });
        }

        // Filter tabs
        const filterTabsContainer = this.modal.querySelector('#import-filter-tabs');
        if (filterTabsContainer) {
            filterTabsContainer.addEventListener('click', (e) => {
                const tab = e.target.closest('[data-filter]');
                if (tab) {
                    filterTabsContainer.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    this.filterTab = tab.dataset.filter;
                    this.renderPreviewTable();
                }
            });
        }

        // Sample loaders
        this.modal.querySelectorAll('[data-sample]').forEach(btn => {
            btn.onclick = () => this.loadSample(btn.dataset.sample);
        });

        // Close & cancel buttons
        if (this.closeBtn) this.closeBtn.onclick = () => this.close();
        if (this.cancelBtn) this.cancelBtn.onclick = () => this.close();

        // Save buttons
        if (this.saveBtn) {
            this.saveBtn.onclick = () => this.saveToLibrary(false);
        }
        if (this.saveStartBtn) {
            this.saveStartBtn.onclick = () => this.saveToLibrary(true);
        }

        // LaTeX toggle button
        const latexBtn = this.modal.querySelector('#toggle-latex-preview-btn');
        if (latexBtn) {
            latexBtn.onclick = () => this.toggleLatexPreview();
        }
    }

    open(initialText = '') {
        if (!this.modal) return;
        this.modal.classList.add('active');
        this.modal.classList.remove('hidden');

        if (initialText && this.textarea) {
            this.textarea.value = initialText;
            this.handleTextInput(initialText);
        }
    }

    close() {
        if (!this.modal) return;
        this.modal.classList.remove('active');
        this.modal.classList.add('hidden');
        this.closeFixPopover();
    }

    handleTextInput(text) {
        this.rawText = text || '';
        this.reparse();
    }

    handleFileUpload(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            if (this.textarea) this.textarea.value = text;
            if (!this.titleInput.value) {
                const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
                this.titleInput.value = nameWithoutExt.replace(/[-_]/g, ' ');
            }
            this.handleTextInput(text);
        };
        reader.readAsText(file);
    }

    loadSample(sampleType) {
        let sampleContent = '';
        let defaultTitle = 'Sample Study Set';
        let defaultCategory = 'Science';

        if (sampleType === 'tsv' || sampleType === 'flashcards') {
            defaultTitle = 'Physics & SI Units Flashcards';
            sampleContent = "Electric Current\tAmpere\tFundamental SI unit\nElectric Potential\tVolt\tJoule per coulomb\nCapacitance\tFarad\tCoulomb per volt\nMagnetic Flux\tWeber\tVolt-second";
        } else if (sampleType === 'pipe') {
            defaultTitle = 'Circuit Theorems MCQ Set';
            sampleContent = "What is Thevenin's Theorem? | Replaces linear circuit with Vth and Rth | Replaces with In and Rn | Maximum power only | Superposition only | Replaces linear circuit with Vth and Rth | Thevenin equivalent simplifies circuits.\nWhat is Norton's Theorem? | Current source In in parallel with Rn | Voltage source with series R | Maximum power transfer | Reciprocal network | Current source In in parallel with Rn | Norton dual of Thevenin.";
        } else if (sampleType === 'asterisk') {
            defaultTitle = 'Inline Asterisk Circuits Set';
            sampleContent = "What is Ohm's Law? | *V = IR | I = V/R | P = VI | R = V^2/P\nIn series resonance, what cancels? | *Reactances XL and XC | Resistances | Current | Frequency\nSI unit of inductance? | Tesla | Weber | *Henry | Farad";
        } else if (sampleType === 'aiken') {
            defaultTitle = 'Aiken Academic Set';
            sampleContent = `What is the speed of light in vacuum?
A. 3 x 10^8 m/s
B. 3 x 10^6 m/s
C. 3 x 10^5 km/s
D. Both A and C
ANSWER: D
EXPLANATION: Light travels at approximately 300,000 km/s or 3 x 10^8 m/s.

What is Newton's Second Law of Motion?
A. F = ma
B. E = mc^2
C. P = IV
D. V = IR
ANSWER: A
EXPLANATION: Force equals mass times acceleration.`;
        } else if (sampleType === 'circuits') {
            fetch('samples/sample_circuits_set.json')
                .then(r => r.json())
                .then(data => {
                    if (this.titleInput) this.titleInput.value = data.title;
                    if (this.categoryInput) this.categoryInput.value = data.category;
                    const jsonStr = JSON.stringify(data, null, 2);
                    if (this.textarea) this.textarea.value = jsonStr;
                    this.handleTextInput(jsonStr);
                })
                .catch(err => console.warn('Could not load circuits sample:', err));
            return;
        }

        if (this.titleInput && !this.titleInput.value) this.titleInput.value = defaultTitle;
        if (this.categoryInput && !this.categoryInput.value) this.categoryInput.value = defaultCategory;
        if (this.textarea) this.textarea.value = sampleContent;
        this.handleTextInput(sampleContent);
    }

    reparse() {
        const raw = this.textarea ? this.textarea.value : this.rawText;
        if (!raw || !raw.trim()) {
            this.parsedResult = null;
            if (this.summaryBar) this.summaryBar.classList.add('hidden');
            if (this.previewContainer) this.previewContainer.classList.add('hidden');
            this.updateSaveButtonState();
            return;
        }

        let format = this.formatSelect ? this.formatSelect.value : 'auto';
        let fieldDelimiter = this.fieldDelimSelect ? this.fieldDelimSelect.value : 'auto';
        if (fieldDelimiter === 'auto') fieldDelimiter = undefined;

        const options = {
            format,
            fieldDelimiter,
            unpackMatchingPairs: this.unpackPairsCheckbox ? this.unpackPairsCheckbox.checked : true
        };

        this.parsedResult = parseImportText(raw, options);

        // If JSON populated title or category, fill them in if inputs are empty
        if (this.parsedResult.setMetadata) {
            if (this.parsedResult.setMetadata.title && this.titleInput && !this.titleInput.value) {
                this.titleInput.value = this.parsedResult.setMetadata.title;
            }
            if (this.parsedResult.setMetadata.category && this.categoryInput && !this.categoryInput.value) {
                this.categoryInput.value = this.parsedResult.setMetadata.category;
            }
        }

        this.renderSummaryBar();
        this.renderPreviewTable();
        this.updateSaveButtonState();
    }

    renderSummaryBar() {
        if (!this.summaryBar || !this.parsedResult) return;
        this.summaryBar.classList.remove('hidden');

        const { stats } = this.parsedResult;
        const totalBadge = this.summaryBar.querySelector('#val-total');
        if (totalBadge) totalBadge.textContent = `${stats.total} Questions`;

        if (this.valValidCount) {
            this.valValidCount.textContent = this.valValidCount.id === 'val-valid' ? `🟢 ${stats.valid} Valid` : `${stats.valid}`;
        }
        if (this.valWarnCount) {
            this.valWarnCount.textContent = this.valWarnCount.id === 'val-warning' ? `🟡 ${stats.warning} Warnings` : `${stats.warning}`;
        }
        if (this.valErrCount) {
            this.valErrCount.textContent = this.valErrCount.id === 'val-error' ? `🔴 ${stats.error} Errors` : `${stats.error}`;
        }
    }

    renderPreviewTable() {
        if (!this.previewTbody || !this.parsedResult) return;

        if (this.previewContainer) {
            this.previewContainer.classList.remove('hidden');
        }

        const filtered = this.parsedResult.questions.filter(q => {
            if (this.filterTab === 'valid') return q._validation?.status === 'valid';
            if (this.filterTab === 'warning') return q._validation?.status === 'warning';
            if (this.filterTab === 'error') return q._validation?.status === 'error';
            return true;
        });

        const rowsHtml = filtered.map((q, idx) => {
            const status = q._validation?.status || 'valid';
            const statusBadge = status === 'valid'
                ? '<span style="color:var(--correct);font-weight:600;">🟢 Valid</span>'
                : (status === 'warning'
                    ? `<span style="color:#f59e0b;font-weight:600;" title="${q._validation?.warnings?.join(' ')}">🟡 Warn</span>`
                    : `<span style="color:var(--wrong);font-weight:600;" title="${q._validation?.errors?.join(' ')}">🔴 Error</span>`);

            const typeBadge = q.type === 'mcq'
                ? '<span class="nav-badge" style="border-color:var(--primary);color:var(--primary);">MCQ</span>'
                : '<span class="nav-badge" style="border-color:var(--accent);color:var(--accent);">ID</span>';

            // Choices chips
            let choicesHtml = '';
            if (q.type === 'mcq' && Array.isArray(q.choices)) {
                choicesHtml = q.choices.map(c => {
                    const isAnswer = c === q.answer;
                    return `
                        <button type="button" class="choice-chip ${isAnswer ? 'is-answer' : ''}" data-choice="${escapeHtml(c)}" data-question-index="${idx}" style="display:inline-flex;align-items:center;gap:0.25rem;padding:0.2rem 0.5rem;margin:0.15rem;border-radius:0.4rem;font-size:0.8rem;border:1px solid ${isAnswer ? 'var(--correct)' : 'var(--glass-border)'};background:${isAnswer ? 'var(--correct-bg)' : 'rgba(255,255,255,0.05)'};color:var(--text-main);cursor:pointer;">
                            ${isAnswer ? '✓ ' : ''}${escapeHtml(c)}
                        </button>
                    `;
                }).join('');

                if (!q.answer) {
                    choicesHtml += `
                        <button type="button" class="choice-chip missing-key-btn" data-question-index="${idx}" style="display:inline-flex;padding:0.2rem 0.5rem;margin:0.15rem;border-radius:0.4rem;font-size:0.8rem;border:1px solid var(--wrong);background:var(--wrong-bg);color:var(--wrong);cursor:pointer;">
                            ⚠️ Select Answer
                        </button>
                    `;
                }
            } else {
                choicesHtml = `<span style="font-size:0.85rem;color:var(--text-muted);">${escapeHtml(q.answer)}</span>`;
            }

            return `
                <tr data-index="${idx}">
                    <td style="font-weight:600;color:var(--text-dim);">${idx + 1}</td>
                    <td>${statusBadge}</td>
                    <td>${typeBadge}</td>
                    <td>
                        <div class="cell-editable" contenteditable="true" data-field="question_text" data-index="${idx}" style="outline:none;padding:0.25rem;border-radius:0.3rem;">
                            ${escapeHtml(q.question_text)}
                        </div>
                    </td>
                    <td>
                        <div class="choices-chips-wrap">
                            ${choicesHtml}
                        </div>
                    </td>
                    <td>
                        <div class="cell-editable" contenteditable="true" data-field="explanation" data-index="${idx}" style="outline:none;padding:0.25rem;border-radius:0.3rem;font-size:0.85rem;color:var(--text-muted);">
                            ${escapeHtml(q.explanation || '')}
                        </div>
                    </td>
                    <td>
                        <button type="button" class="icon-btn delete-row-btn" data-index="${idx}" title="Delete Question" style="background:none;border:none;color:var(--wrong);cursor:pointer;">🗑️</button>
                    </td>
                </tr>
            `;
        });

        this.previewTbody.innerHTML = rowsHtml.join('');
        this.attachTableEventListeners();

        if (this.isLatexPreviewActive && window.MathJax && window.MathJax.typesetPromise) {
            window.MathJax.typesetPromise([this.previewTbody]).catch(console.warn);
        }
    }

    attachTableEventListeners() {
        if (!this.previewTbody) return;

        // In-place editable cell blur
        this.previewTbody.querySelectorAll('.cell-editable').forEach(cell => {
            cell.addEventListener('blur', () => {
                const idx = parseInt(cell.dataset.index, 10);
                const field = cell.dataset.field;
                const value = cell.innerText.trim();

                if (this.parsedResult && this.parsedResult.questions[idx]) {
                    this.parsedResult.questions[idx][field] = value;
                    const val = validateQuestion(this.parsedResult.questions[idx]);
                    this.parsedResult.questions[idx]._validation = val;
                    this.renderSummaryBar();
                    this.updateSaveButtonState();
                }
            });
        });

        // Click choice chip to designate canonical answer
        this.previewTbody.querySelectorAll('.choice-chip[data-choice]').forEach(chip => {
            chip.addEventListener('click', () => {
                const idx = parseInt(chip.dataset.questionIndex, 10);
                const choice = chip.dataset.choice;

                if (this.parsedResult && this.parsedResult.questions[idx]) {
                    this.parsedResult.questions[idx].answer = choice;
                    const val = validateQuestion(this.parsedResult.questions[idx]);
                    this.parsedResult.questions[idx]._validation = val;
                    this.renderPreviewTable();
                    this.renderSummaryBar();
                    this.updateSaveButtonState();
                }
            });
        });

        // Missing key button opens popover
        this.previewTbody.querySelectorAll('.missing-key-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(btn.dataset.questionIndex, 10);
                this.openFixPopover(idx, btn);
            });
        });

        // Delete row
        this.previewTbody.querySelectorAll('.delete-row-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index, 10);
                if (this.parsedResult && this.parsedResult.questions[idx]) {
                    this.parsedResult.questions.splice(idx, 1);
                    this.renderPreviewTable();
                    this.renderSummaryBar();
                    this.updateSaveButtonState();
                }
            });
        });
    }

    openFixPopover(questionIndex, targetElement) {
        let popover = document.getElementById('choice-popover');
        if (!popover) return;

        const q = this.parsedResult?.questions[questionIndex];
        if (!q) return;

        const listContainer = popover.querySelector('#popover-choices-list');
        if (listContainer) {
            listContainer.innerHTML = (q.choices || []).map(c => `
                <button type="button" class="popover-choice-btn" data-choice="${escapeHtml(c)}" style="display:block;width:100%;text-align:left;padding:0.4rem 0.6rem;margin-bottom:0.3rem;border-radius:0.4rem;background:rgba(255,255,255,0.06);border:1px solid var(--glass-border);color:var(--text-main);cursor:pointer;">
                    ${escapeHtml(c)}
                </button>
            `).join('');

            listContainer.querySelectorAll('.popover-choice-btn').forEach(b => {
                b.onclick = () => {
                    q.answer = b.dataset.choice;
                    q._validation = validateQuestion(q);
                    this.closeFixPopover();
                    this.renderPreviewTable();
                    this.renderSummaryBar();
                    this.updateSaveButtonState();
                };
            });
        }

        const rect = targetElement.getBoundingClientRect();
        popover.style.position = 'fixed';
        popover.style.top = `${rect.bottom + 8}px`;
        popover.style.left = `${Math.max(10, rect.left)}px`;
        popover.classList.remove('hidden');
    }

    closeFixPopover() {
        const popover = document.getElementById('choice-popover');
        if (popover) popover.classList.add('hidden');
    }

    toggleLatexPreview() {
        this.isLatexPreviewActive = !this.isLatexPreviewActive;
        const latexBtn = this.modal.querySelector('#toggle-latex-preview-btn');
        if (latexBtn) {
            latexBtn.innerHTML = `<span>LaTeX Preview: <strong>${this.isLatexPreviewActive ? 'On' : 'Off'}</strong></span>`;
        }
        this.renderPreviewTable();
    }

    updateSaveButtonState() {
        const title = this.titleInput ? this.titleInput.value.trim() : '';
        const hasQuestions = this.parsedResult && this.parsedResult.questions.length > 0;
        const hasErrors = this.parsedResult && this.parsedResult.questions.some(q => q._validation?.status === 'error');

        const canSave = Boolean(title && hasQuestions && !hasErrors);

        if (this.saveBtn) this.saveBtn.disabled = !canSave;
        if (this.saveStartBtn) this.saveStartBtn.disabled = !canSave;

        const statusEl = this.modal.querySelector('#import-commit-status');
        if (statusEl) {
            if (!title) {
                statusEl.textContent = 'Please enter a study set title.';
            } else if (!hasQuestions) {
                statusEl.textContent = 'Please paste questions to import.';
            } else if (hasErrors) {
                statusEl.textContent = 'Please fix questions marked with 🔴 Error before saving.';
            } else {
                statusEl.textContent = `Ready to import ${this.parsedResult.questions.length} questions.`;
            }
        }
    }

    async saveToLibrary(startQuizImmediately = false) {
        if (!this.parsedResult || !this.titleInput.value.trim()) return;

        const title = this.titleInput.value.trim();
        const category = this.categoryInput ? this.categoryInput.value.trim() || 'General' : 'General';
        const questions = this.parsedResult.questions;

        const studySet = {
            title,
            category,
            questionCount: questions.length,
            source: this.parsedResult.detectedFormat || 'delimited'
        };

        try {
            const savedSet = await this.setManager.saveSet(studySet, questions);
            this.close();
            if (this.onSaveSuccess) {
                this.onSaveSuccess(savedSet, startQuizImmediately);
            }
        } catch (err) {
            alert(`Failed to save study set: ${err.message}`);
        }
    }
}
