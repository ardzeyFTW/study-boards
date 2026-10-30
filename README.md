# Study Boards — Standalone Public Quiz Platform

A pure client-side, privacy-first, zero-runtime study and spaced-repetition platform deployable to **GitHub Pages**.

All study sets, questions, quiz progress, and streak statistics persist securely within your browser's **IndexedDB** (`notquizlet-db`). The application operates with **zero server backend**, **zero Cloudflare dependencies**, and **zero Firebase network egress**.

---

## 🌟 Key Features

### 1. Multi-Format Question Import Engine
Import your study materials seamlessly from spreadsheets, Quizlet, text notes, or learning management systems:
- **Spreadsheets / Delimited**: Tab-separated (`\t`), Pipe-separated (`|`), Comma-separated (CSV with RFC 4180 quotes), and Semicolon (`;`).
- **Inline Asterisk MCQs**: Designate the canonical answer directly with an asterisk (e.g. `Question | *Choice A | Choice B | Choice C`).
- **Academic Aiken Format**: Standard plain-text question blocks with `A.`, `B.`, `ANSWER:`, and optional `EXPLANATION:` lines.
- **Matching Pairs**: Automatically unpacks `Term = Definition` tables into discrete playable multiple-choice cards.
- **LaTeX Math Formulas**: Full support for scientific equations `$x^2$` and `$$\int_0^1 f(x) dx$$` without delimiter corruption.
- **Interactive Live Preview**: 5-step import modal with 150ms debounced auto-detection, validation summary (Valid 🟢, Warnings 🟡, Errors 🔴), in-place table cell editing, and click-to-set answer chips.

### 2. Pedagogical Quiz Execution Modes
- **Test Mode (Speedrun Exam)**:
  - Linear examination simulation with stopwatch timer (`performance.now()`).
  - Score accumulation and accuracy metrics.
  - Comprehensive post-test review table detailing selected answers vs canonical answers with full solutions.
- **Mastery Mode (Spaced-Repetition)**:
  - Cognitive interleaving queue enforcing a strict **2-consecutive-correct mastery threshold**.
  - Any mistake immediately resets consecutive points to `0`.
  - Mathematically bounded back-half queue re-insertion ensures you never see a missed question immediately on the next card.
  - Snapshotting supports seamless multi-session pause and resumption.

### 3. Personal Analytics & Data Sovereignty
- **Lifetime Statistics**: Track total questions answered, correct attempts, overall accuracy, and total mastered items.
- **Study Streak**: Automatically calculates consecutive daily study activity.
- **GitHub-Style Activity Heatmap**: 5-level monthly interactive calendar with daily question volume tooltips.
- **Atomic JSON Backup & Restore**: One-click export (`notquizlet-backup-YYYY-MM-DD.json`) and restore (`merge` or `replace` mode) to move your data between devices or browsers without an account.
- **Safari ITP Protection**: Storage persistence requests (`navigator.storage.persist()`), quota monitoring, and inactivity warning advisories.

### 4. Zero-Egress Static Architecture
- Fully static, single-page application (SPA).
- Document-level `<base href="./">` and trailing-slash guard script ensures flawless navigation under GitHub Pages repository subpaths (`https://<user>.github.io/<repo>/`).
- Offline PWA Service Worker caches all shell and CDN assets (Google Fonts, MathJax) with zero tracking.

---

## 📋 Question Import Examples

### 1. Tab-Separated Values (TSV / Flashcards)
```tsv
Electric Current	Ampere	Fundamental SI unit of current
Capacitance	Farad	Coulomb per volt
Magnetic Flux	Weber	Volt-second
```

### 2. Pipe-Delimited Multiple Choice (with Answer Key in Column 6)
```text
What is the SI unit of resistance? | Volt | Ampere | Ohm | Farad | Ohm | Definition of electrical resistance
What is Ohm's Law? | V = IR | I = V/R | P = VI | R = V^2/P | V = IR | Relates voltage, current, and resistance
```

### 3. Inline Asterisk-Keyed MCQs
```text
What is Ohm's Law? | *V = IR | I = V/R | P = VI | R = V^2/P
In series resonance, what reactances cancel? | *XL and XC | R and XL | V and I
```

### 4. Academic Aiken Format
```text
What is the speed of light in vacuum?
A. 3 x 10^8 m/s
B. 3 x 10^6 m/s
C. 3 x 10^5 km/s
D. Both A and C
ANSWER: D
EXPLANATION: Light travels at approximately 300,000 km/s or 3 x 10^8 m/s.
```

---

## 🚀 Local Development & Testing

### Prerequisites
- Node.js 18+ or 20+
- npm

### Installation
```bash
# Install dependencies
npm install
```

### Running the Test Suite
```bash
# Run unit tests (Vitest)
npm test

# Run tests in watch mode
npm run test:watch

# Run end-to-end tests (Playwright)
npm run test:e2e
```

### Running Locally
```bash
# Start local static development server
npm run serve
# Navigate to http://localhost:8080/
```

---

## 🌐 Deploying to GitHub Pages

1. Push this repository to GitHub.
2. In your repository settings, navigate to **Settings > Pages**.
3. Under **Build and deployment > Source**, select **GitHub Actions**.
4. The workflow at `.github/workflows/deploy.yml` will automatically build, test, and publish `./public` to GitHub Pages.

---

## 📄 License
MIT License. Created by Ardzey.
