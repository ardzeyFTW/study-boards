import { test, expect } from '@playwright/test';

test.describe('Standalone Public Quiz Platform E2E Flow', () => {

    test('Complete User Journey: Import, Speedrun, Mastery, Resume, Profile, and Backup', async ({ page }) => {
        // Zero-Backend Egress Audit: Intercept all outgoing network traffic
        const remoteRequests = [];
        page.on('request', request => {
            const url = request.url();
            // Disallow calls to Firebase, Cloudflare, or external analytics
            if (/firebase|firestore|cloudflare|googleapis|identitytoolkit/.test(url)) {
                remoteRequests.push(url);
            }
        });

        // 1. Navigate to application home screen
        await page.goto('/');
        await expect(page).toHaveTitle(/Study Boards/);

        // 2. Open Question Import Modal
        await page.click('#nav-import-btn');
        await expect(page.locator('#import-modal')).toBeVisible();

        // 3. Paste test study set with MathJax formulas
        const tsvData = [
            "What is Ohm's Law?\tV = IR\tI = V/R\tP = VI\tR = V^2/P\tV = IR\tRelates voltage, current, and resistance.",
            "SI unit of magnetic flux?\tTesla\tWeber\tHenry\tMaxwell\tWeber\tWeber is standard SI unit.",
            "Evaluate $\\int_0^1 x dx$\t0\t1\t1/2\t2\t1/2\tPower rule gives 1/2."
        ].join('\n');

        await page.fill('#import-set-title', 'Electrical Engineering Board Exam 2026');
        await page.fill('#import-raw-textarea', tsvData);

        // 4. Verify Live Validation Bar & Preview Grid
        await expect(page.locator('#val-total')).toContainText('3 Questions');
        await expect(page.locator('#val-valid-count')).toContainText('3');
        await expect(page.locator('#import-preview-tbody tr')).toHaveCount(3);

        // 5. Save Study Set to Library
        await page.click('#import-save-btn');
        await expect(page.locator('#import-modal')).toBeHidden();

        // 6. Verify Study Set Card appears in Library Grid
        const setCard = page.locator('.study-set-card:has-text("Electrical Engineering Board Exam 2026")');
        await expect(setCard).toBeVisible();

        // 7. Start Test Mode (Speedrun)
        await setCard.locator('button[data-action="speedrun"]').click();
        await expect(page.locator('#quiz-screen')).toBeVisible();
        await expect(page.locator('#quiz-timer-text')).toBeVisible();

        // Answer Question 1
        await page.click('.choice-btn:has-text("V = IR")');
        await page.click('#next-question-btn');

        // Answer Question 2
        await page.click('.choice-btn:has-text("Tesla")'); // Intentional mistake
        await page.click('#next-question-btn');

        // Answer Question 3
        await page.click('.choice-btn:has-text("1/2")');
        await page.click('#next-question-btn');

        // 8. Results Screen & Mistake Review Table
        await expect(page.locator('#results-screen')).toBeVisible();
        await expect(page.locator('#result-score-val')).toContainText('2 / 3');

        // 9. Return to Library and start Mastery Mode
        await page.click('#results-home-btn');
        await expect(page.locator('#home-screen')).toBeVisible();

        const setCardMastery = page.locator('.study-set-card:has-text("Electrical Engineering Board Exam 2026")');
        await setCardMastery.locator('button[data-action="mastery"]').click();
        await expect(page.locator('#quiz-screen')).toBeVisible();

        // 10. Multi-Session Resume Verification: Answer one question, then reload
        await page.click('.choice-btn:has-text("V = IR")');
        await page.click('#next-question-btn');

        // Reload page to simulate browser restart
        await page.reload();

        // Verify instant zero-CLS resume banner appears on home screen
        const resumeBanner = page.locator('#continue-quiz-container');
        await expect(resumeBanner).toBeVisible();
        await expect(resumeBanner).toContainText('Electrical Engineering Board Exam 2026');

        // Click Resume
        await page.click('#resume-quiz-btn');
        await expect(page.locator('#quiz-screen')).toBeVisible();

        // 11. Profile & Activity Heatmap Verification
        await page.click('#back-to-sets-btn');
        await page.click('#profile-btn');
        await expect(page.locator('#profile-modal')).toBeVisible();
        await expect(page.locator('#prof-lifetime-answered')).not.toHaveText('0');
        await expect(page.locator('.act-cell.lvl-1, .act-cell.lvl-2, .act-cell.lvl-3')).toHaveCount(1);

        // 12. Full Database Export Test
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.click('#export-json-btn')
        ]);
        expect(download.suggestedFilename()).toMatch(/notquizlet-backup-.*\.json/);

        // 13. Verify Zero-Backend Egress
        expect(remoteRequests).toHaveLength(0);
    });
});
