# רשימת עבודות מקיפה — Tora_Book_Typesetter_Gold V23

תאריך: 2026-10-26
ענף: V21 (V23 בפועל)

---

## מצב נוכחי

| מדד | ערך |
|-----|------|
| high severity | 0 ✅ |
| medium | 19 |
| low | 74 |
| runtime errors | 0 |
| פרקים תקינים | 79/79 (100%) |
| GitHub Actions | 3/4 jobs success (page-height-max70 נכשל כצפוי) |
| determinism | ✅ יציב |

---

## A. בדיקות גיאומטריה — הוספות נדרשות

### A1. בדיקת עמודים דלילים (page-sparse) — חדש
**תיאור:** עמודים שאינם ממלאים את אזור הטקסט בשלמות.
**חריגים:** עמודי תחילת פרק (מכילים H2) ועמודי סוף פרק (דלילות טבעית ממחסור טקסט).
**מרחק גדול בין מיכלים:** הבדיקה צריכה לתפוס מקרים של עמוד דליל עם הערות שוליים — מרחק גדול בין בלוקים מצביע על דלילות גם כשיש fnArea.
**סף:** פער > 100px בין תחתית הבלוק האחרון לתחתית body-flow (למעט חריגים).

### A2. מרחק גדול בין בלוקים (block-gap) — חדש
**תיאור:** ההפך מ-containment — מרחק גדול מדי בין בלוקים עוקבים ב-body-flow.
**סף:** מרחק > 50px בין תחתית בלוק אחד לתחילת הבא אחריו (למעט מרווחים מכוונים כמו sec-divider).
**מטרה:** לתפוס מקרים שה-engine לא מילא את העמוד (page-underfill חלקי).

### A3. וידוא החלת הגדרות (settings-verification) — חדש
**תיאור:** בדיקה שהגדרות המשתמש הוחלו בפועל ב-DOM המרונדר.
**הגדרות לבדיקה:**
1. **שורה אחרונה ממורכזת** — `text-align-last: center` על `p.p-end`
2. **חלון תיבה ראשונה (drop-word)** — קיום `.first-word-window` בפסקאות עם ≥4 מילים
3. **גדלי עיטורים** — רוחב/גובה של `.h2-ornament-top/bottom` תואמים להגדרות
4. **גופן גוף** — `font-family` של `p` תואם ל-`font-body` setting
5. **גובה שורה** — `line-height` של `p` תואם ל-`line-height-body`
6. **מספר טורים** — קיום `.block-2col` (לא `block-single-col`) כשההגדרה היא דו-טורית
7. **כותרות בתחילת טור** — `margin-top: 0` על `.title-level-4/5/6:first-child`
8. **הערות שוליים** — קיום `.side-note-anchor` כשיש H7 בטקסט
9. **מפריד סעיפים** — קיום `.sec-divider-wrap` בסוף פרק
10. **תיבות שער** — קיום `.main-shaar-page`, `.back-shaar-page`, `.sub-shaar-page` במקומ הנכון
11. **תוכן עניינים** — קיום `.toc-page` עם תוכן
12. **עיטורי כותרת** — קיום `.h2-ornament-top/bottom` כשמוגדר
13. **סמני פרקים** — קיום `.h2-siman-badge` כש-auto-siman מופעל
14. **קו מפריד טורים** — קיום `.col-gutter-divider` כשמוגדר
15. **מספור עמודים** — קיום `.page-number-footer` עם מספר

---

## B. שיפורי engine — פריטים פתוחים ממסמכי ריפו

### B1. P2.5 לכל הכותרות (H4/H5/H6) — לא מומש
**מקור:** Comprehensive §6.1 סעיף 3; Defining §20.2
**תיאור:** P2.5 (margin-bottom של כותרת כבלוף איזון) פועל רק על H5. צריך להרחיב ל-H4 ו-H6.
**השפעה:** יפתור imbalance עם כותרות (Δ=22px).
**סטטוס:** חלקי — `stretchByHeadingSpacing` (שלב 4) מטפל בזה, אבל P2.5 המקורי עדיין רק H5.

### B2. rebalance אחרי `applyKpLineBreaks` — לא מומש
**מקור:** Comprehensive §6.1 סעיף 1
**תיאור:** `<br>` משנה גבהי פסקאות אחרי איזון → 617 imbalanced columns.
**פתרון:** הרצת `balanceColumns` שוב אחרי `applyKpLineBreaks`, או שימוש ב-`numLines` של KP לחישוב גובה ללא DOM.
**סטטוס:** לא מומש — ה-caches של KP (`_kpCache`) לא קיימים ב-engine הנוכחי.

### B3. `clubpenalties` לכותרות — לא מומש
**מקור:** Comprehensive §6.1 סעיף 6
**תיאור:** מנגנון `clubpenalties: [10000, 10000, 150]` קיים אך לא מועבר מ-`getLinesFromParagraph`.
**מטרה:** הבטחת "שתי שורות אחרי כותרת".

### B4. `fixWidowContinuation` — שיפור
**מקור:** Comprehensive §6.1 סעיף 5; Defining §20.1
**תיאור:** מטפל רק בחיתוך האחרון. פסקה ענקית (42 שורות) עם המשך קצר — לא מגיע ל-2 שורות.
**פתרון:** fallback — מיזוג ההמשך חזרה ל-p-cut.

### B5. page-height — תיקון overflow 7px
**מקור:** LAYOUT_DEPENDENCY_MAP §13.10 סעיף 1
**תיאור:** rebalance אחרי page-height פתר imbalance אבל יצר page-overflow 7px.
**פתרון:** בדיקת overflow חוזרת אחרי rebalance, והקטנת wrapper בחזרה אם יש overflow.

### B6. Knuth-Plass מלא עם `looseness` — לא מומש
**מקור:** Comprehensive §6.1 סעיפים 2, 4, 7, 9
**תיאור:** KP מלא עם `looseness` ו-`bestByLineCount` מנוטרל כעת (בעיות ביצועים).
**צריך:** מימוש מחדש עם caching והגבלת קריאות.

### B7. Global Copyfitting — לא מומש
**מקור:** Comprehensive §6.1 סעיף 12; §2.6.4
**תיאור:** מדידת נפח תוכן כל פרק וחלוקה שווה של מרחב עמודים.

### B8. OpenType `jalt` (justification alternates) — לא מומש
**מקור:** Comprehensive §6.1 סעיף 11; Research §5.1
**תיאור:** 8 אותיות הרחבה מסורתיות (א, ד, ה, כ, ל, ם, ר, ת).

### B9. Canvas API למדידה (off-DOM) — לא מומש
**מקור:** Research §5.2, §8 סעיף 1
**תיאור:** החלפת `getBoundingClientRect` ב-`canvas.measureText()` עם caching.

### B10. DPI Normalization (screen↔print) — לא מומש
**מקור:** Research §8 סעיף 3
**תיאור:** נורמליזציה של פיקסלים לנקודות DTP.

### B11. Unified Fixed-Point Rollback Loop — לא מומש
**מקור:** Comprehensive §6.1 סעיף 13; Defining §19.6
**תיאור:** לולאה מאוחדת שמוודא את כל האילוצים בו-זמנית.

---

## C. יציבות ובדיקות

### C1. קריסות דפדפן (פרקים 5, 71, 75) — לא נחקרו לעומק
**מקור:** SESSION_HANDOFF §9.2.1
**תיאור:** קריסות אינטרמיטנטיות. חשד: זיכרון/GC.
**פתרון אפשרי:** `page.gc()` בין פרקים, רענון browser כל 3 פרקים במקום 5.

### C2. determinism-test — הבהרת מטרה
**מקור:** בקשת משתמש
**תיאור:** המטרה העיקרית היא וידוא ששינויי קוד (שלא נועדו להשפיע על העימוד) אכן לא משפיעים.
**פעולה:** עדכן את התיעוד וה-comment ב-determinism-test.js.

### C3. כל בדיקות העימוד על very_long_test_text.txt
**מקור:** בקשת משתמש
**תיאור:** ודא ש-test-chapters-enhanced.js, determinism-test.js, ו-regression-test.js כולם משתמשים ב-very_long_test_text.txt.
**סטטוס:** ✅ כבר מוגדר כך (TEST_TEXT_PATH = very_long_test_text.txt).

### C4. בדיקות רגרסיה נוספות
**מקור:** SESSION_HANDOFF §9.2.2
**תיאור:** הוסף בדיקות ספציפיות ל:
- הערות שוליים (ספור `note-line`)
- סוגריים חוצי פסקאות (ספור `paren-text`)
- עיטורים (ספור `h2-ornament`)

### C5. בדיקת יציבות ב-GitHub Actions
**מקור:** LAYOUT_DEPENDENCY_MAP §13.10 סעיף 4
**תיאור:** הרצת אותו פרק פעמיים והשוואת תוצאות (כבר קיים כ-determinism job).

---

## D. תיעוד ושקיפות

### D1. JSDoc לפונקציות חדשות
**מקור:** LAYOUT_DEPENDENCY_MAP §13.10 סעיף 2
**פונקציות:** `stretchByHeadingSpacing`, `stretchByLetterSpacing`, page-height adjustment, rebalance.

### D2. JSDoc ל-75+ פונקציות ב-typesetter.js
**מקור:** SESSION_HANDOFF §9.3.2
**תיאור:** רוב הפונקציות הציבוריות לא מתועדות עם JSDoc.

### D3. LAYOUT_DEPENDENCY_MAP §11.7 — מדריך הוספת אלמנטים
**מקור:** SESSION_HANDOFF §9.3.1
**תיאור:** סעיף 11.7 קיים אבל צריך דוגמת קוד קונקרטית.

### D4. עדכון worklog בכל commit
**מקור:** בקשת משתמש
**תיאור:** כלל מחייב — כל commit חייב לכלול עדכון worklog.

---

## E. שיפורים פונקציונליים

### E1. פאנל "איכות עימוד אוטומטי" ב-UI
**מקור:** SESSION_HANDOFF §9.5.1
**תיאור:** כפתור "בדיקת רגרסיה מהירה" ב-UI שמפעיל `regression-test.js --quick`.

### E2. דוח בדיקה ויזואלי
**מקור:** SESSION_HANDOFF §9.5.2
**תיאור:** הצגת תוצאות בדיקה בצורה גרפית עם טבלת סטטוס לכל פרק.

### E3. מערכת המלצות עריכה
**מקור:** REPO_AUDIT_AND_TESTING.md §3
**תיאור:** מערכת שממליצה על עריכה קלה (הוספת מילים, חלוקת פסקה, וכו') לפתרון בעיות עימוד.
**ארכיטקטורה:** identifyIssues → proposeEdits → verifyEdit (גיאוממטרי או עימוד בפועל) → reportRecommendations.

---

## F. נגישות (accessibility)

### F1. אלמנטים סמנטיים חסרים (High)
**מקור:** Comprehensive §8.4 סעיף 1
**תיאור:** הוסף `<main>`, `<aside>`, `<nav>`.

### F2. ARIA ל-contenteditable (High)
**מקור:** Comprehensive §8.4 סעיף 3
**תיאור:** הוסף `role="textbox"`, `aria-multiline="true"`, `aria-label`.

### F3. aria-label לכפתורים עם emoji (Medium)
**מקור:** Comprehensive §8.4 סעיף 4

### F4. meta tags (Medium)
**מקור:** Comprehensive §8.4 סעיף 2
**תיאור:** `<meta name="description">`, `<meta name="theme-color">`, Open Graph.

### F5. בדיקת ניגודיות צבעים
**מקור:** Comprehensive §8.4 סעיף 5
**תיאור:** הרצת Lighthouse / axe DevTools.

---

## G. אבטחה (security)

### G1. החלפת sanitizeSVG ב-DOMPurify
### G2. Trusted Types CSP
### G3. SRI לסקריפטים חיצוניים
### G4. Audit Trail לפעולות רגישות
### G5. iframe sandbox

---

## H. סידור קוד

### H1. מעבר ל-ES Modules
**מקור:** Comprehensive §6.2 סעיף 8

### H2. מעבר ל-balanceColumnsV2
**מקור:** Comprehensive §6.1 סעיף 9
**תיאור:** מנוע מבוסס מועמדים שיכול לנצל את KP טוב יותר. כרגע מנוטרל.

---

## עדיפויות מומלצות

### עדיפות גבוהה (ביצוע מיידי)
1. **A1** — בדיקת עמודים דלילים
2. **A2** — מרחק גדול בין בלוקים
3. **A3** — וידוא החלת הגדרות
4. **C2** — הבהרת determinism-test
5. **B5** — תיקון page-height overflow 7px
6. **D4** — עדכון worklog בכל commit (כלל מחייב)

### עדיפות בינונית (ביצוע לאחר עדיפות גבוהה)
7. **B1** — P2.5 לכל הכותרות
8. **B4** — שיפור fixWidowContinuation
9. **C1** — חקירת קריסות דפדפן
10. **C4** — בדיקות רגרסיה נוספות
11. **D1** — JSDoc לפונקציות חדשות
12. **E3** — מערכת המלצות עריכה

### עדיפות נמוכה (ביצוע לטווח ארוך)
13. **B6** — Knuth-Plass מלא
14. **B7** — Global Copyfitting
15. **B8** — OpenType jalt
16. **B9** — Canvas API off-DOM
17. **B10** — DPI Normalization
18. **B11** — Unified Fixed-Point Rollback Loop
19. **F1-F5** — נגישות
20. **G1-G5** — אבטחה
21. **H1-H2** — סידור קוד

---

## קביעות שאינן ניתנות לפתרון (acknowledged limitations)
- פסקאות בנות מילה אחת
- פסקאות ענקיות (800+ מילים)
- שתי פסקאות ענקיות זו אחר זו
- כותרת + פסקה קצרצרה
- הערת שוליים ארוכה מעמוד
