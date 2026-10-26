/* ==========================================================================
   regression-test.js — בדיקת רגרסיה אוטומטית למערכת העימוד התורנית
   --------------------------------------------------------------------------
   שימוש:
     node regression-test.js --quick    # פרקים 1, 3, 4 — בדיקה מהירה (~30s)
     node regression-test.js --full    # כל 79 הפרקים — בדיקה מלאה (~5-10 דקות)

   ספים:
     --quick: maxHigh=2, maxMedium=10, maxErrors=0
     --full:  maxHigh=10, maxMedium=30, maxErrors=0

   יציאה:
     0 = הצלחה (מתחת לסף)
     1 = רגרסיה (מעל לסף)

   דרוש: שרת HTTP על פורט 8765
   ========================================================================== */

const { execSync } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = path.dirname(__filename);
const ENHANCED_SCRIPT = path.join(SCRIPTS_DIR, 'test-chapters-enhanced.js');

// פרסור args
const argv = process.argv.slice(2);
const mode = argv.includes('--quick') ? 'quick' :
             argv.includes('--full')  ? 'full'  : null;

if (!mode) {
  console.error('Usage: node regression-test.js --quick | --full');
  process.exit(2);
}

// הגדרת ספים לפי מצב
const THRESHOLDS = {
  quick: { maxHigh: 2,  maxMedium: 10, maxErrors: 0 },
  full:  { maxHigh: 10, maxMedium: 30, maxErrors: 0 },
};
const TH = THRESHOLDS[mode];

// רשימת פרקים לפי מצב
const CHAPTERS = {
  quick: [1, 3, 4],
  // full מורץ כטווח 1-79 על-ידי test-chapters-enhanced.js ישירות
};

// ============================================================================
// הרצת בדיקות
// ============================================================================
(async () => {
  console.log(`[regression-test] mode=${mode}`);
  console.log(`[regression-test] ספים: maxHigh=${TH.maxHigh}, maxMedium=${TH.maxMedium}, maxErrors=${TH.maxErrors}`);

  let results = [];

  if (mode === 'quick') {
    // הרץ פרקים בודדים (1, 3, 4)
    for (const chNum of CHAPTERS.quick) {
      console.log(`\n[regression-test] מריץ פרק ${chNum}...`);
      try {
        execSync(`node ${ENHANCED_SCRIPT} ${chNum} ${chNum} quick-ch${chNum}`, {
          stdio: 'inherit',
          cwd: SCRIPTS_DIR,
          timeout: 240000, // 4 דקות max לפרק
        });
      } catch (err) {
        // exit code != 0 לא בהכרח אומר כישלון — test-chapters-enhanced.js מחזיר 1 אם יש high>0
        // נקרא את התוצאה מהקובץ
      }
      // קרא את התוצאה שנשמרה
      const resultFile = path.join(
        process.env.RESULTS_DIR || path.join(__dirname, 'chapter-results'),
        `chapter-${String(chNum).padStart(2, '0')}.json`
      );
      try {
        const r = JSON.parse(require('fs').readFileSync(resultFile, 'utf8'));
        results.push(r);
      } catch (e) {
        console.error(`[regression-test] שגיאה בקריאת ${resultFile}: ${e.message}`);
        results.push({ chapterNum: chNum, error: e.message, geomSummary: {} });
      }
    }
  } else {
    // full: הרץ את כל 79 הפרקים
    console.log(`\n[regression-test] מריץ כל 79 הפרקים (יקח זמן)...`);
    try {
      execSync(`node ${ENHANCED_SCRIPT} 1 79 full-regression`, {
        stdio: 'inherit',
        cwd: SCRIPTS_DIR,
        timeout: 3600000, // שעה
      });
    } catch (err) {
      // המשך — נקרא את כל התוצאות
    }
    // קרא את כל התוצאות
    const RESULTS_DIR = process.env.RESULTS_DIR || path.join(__dirname, 'chapter-results');
    for (let n = 1; n <= 79; n++) {
      const resultFile = path.join(RESULTS_DIR, `chapter-${String(n).padStart(2, '0')}.json`);
      try {
        const r = JSON.parse(require('fs').readFileSync(resultFile, 'utf8'));
        results.push(r);
      } catch (e) {
        results.push({ chapterNum: n, error: e.message, geomSummary: {} });
      }
    }
  }

  // ============================================================================
  // ניתוח תוצאות
  // ============================================================================
  let totalHigh = 0;
  let totalMedium = 0;
  let totalLow = 0;
  let totalErrors = 0;
  let problemChapters = [];

  for (const r of results) {
    const s = r.geomSummary || {};
    const high = s.high || 0;
    const med = s.medium || 0;
    const low = s.low || 0;
    totalHigh += high;
    totalMedium += med;
    totalLow += low;
    if (r.error) totalErrors++;
    if (high > 0 || r.error) {
      problemChapters.push({ num: r.chapterNum, high, medium: med, low, error: r.error, title: r.title });
    }
  }

  console.log('\n========== דוח רגרסיה ==========\n');
  console.log(`mode: ${mode}`);
  console.log(`פרקים נבדקו: ${results.length}`);
  console.log(`total high:   ${totalHigh} (סף: ${TH.maxHigh})`);
  console.log(`total medium: ${totalMedium} (סף: ${TH.maxMedium})`);
  console.log(`total low:    ${totalLow}`);
  console.log(`errors:       ${totalErrors} (סף: ${TH.maxErrors})`);

  if (problemChapters.length > 0) {
    console.log('\nפרקים בעייתיים:');
    for (const p of problemChapters) {
      console.log(`  פרק ${p.num}: high=${p.high} medium=${p.medium} low=${p.low} error=${p.error || '-'}`);
      if (p.title) console.log(`    title: ${p.title.slice(0, 70)}`);
    }
  }

  // החלטת הצלחה/רגרסיה
  const highFailed = totalHigh > TH.maxHigh;
  const medFailed = totalMedium > TH.maxMedium;
  const errorsFailed = totalErrors > TH.maxErrors;
  const failed = highFailed || medFailed || errorsFailed;

  console.log('\n========== תוצאה ==========\n');
  if (failed) {
    if (highFailed) console.log(`✗ רגרסיה: high=${totalHigh} > ${TH.maxHigh}`);
    if (medFailed) console.log(`✗ רגרסיה: medium=${totalMedium} > ${TH.maxMedium}`);
    if (errorsFailed) console.log(`✗ רגרסיה: errors=${totalErrors} > ${TH.maxErrors}`);
    process.exit(1);
  } else {
    console.log(`✓ עבר: כל המדדים מתחת לסף`);
    process.exit(0);
  }
})();
