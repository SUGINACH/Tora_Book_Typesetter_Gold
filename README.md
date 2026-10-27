# חבילת מערכת עימוד תורנית — גרסת V21 Gold (2026-10-27)

> **ענף נוכחי:** `V21`  
> **דף נחיתי:** https://suginach.github.io/IMUD_TORANI/  
> **ריפו:** https://github.com/SUGINACH/Tora_Book_Typesetter_Gold

מערכת עימוד מקצועית לספרי תורה, עם מנוע עימוד ניתן לכוונון, בדיקות גיאומטריה אוטומטיות, וכלי אבחון שלב-אחר-שלב.

---

## תוכן עניינים

1. [מה חדש ב-V21](#1-מה-חדש-ב-v21)
2. [רכיבי המערכת](#2-רכיבי-המערכת)
3. [בדיקות גיאומטריה אוטומטיות](#3-בדיקות-גיאוממטריה-אוטומטיות)
4. [מערכת אבחון שלב-אחר-שלב](#4-מערכת-אבחון-שלב-אחר-שלב)
5. [כלי CLI לבדיקות](#5-כלי-cli-לבדיקות)
6. [GitHub Actions CI](#6-github-actions-ci)
7. [מצב נוכחי — ממצאים ותיקונים](#7-מצב-נוכחי--ממצאים-ותיקונים)
8. [מפת דרכים](#8-מפת-דרכים)
9. [התקנה ושימוש](#9-התקנה-ושימוש)
10. [תיעוד נוסף](#10-תיעוד-נוסף)

---

## 1. מה חדש ב-V21

V21 היא גרסת ה-Gold של מערכת העימוד, עם דגש על **אבחון אוטומטי** ו**תיקון בעיות גיאומטריה**. השינויים המרכזיים:

### 1.1 מנוע עימוד משופר (`typesetter.js`, ~5400 שורות)
- **Knuth-Plass חלקי** — שבירת שורות מתקדמת (לא גרידי בלבד)
- **balanceColumns עם penalty** — מועמדים שמייצרים שורה אחרונה דלילה מקבלים עונש וירטואלי
- **stretchByHeadingSpacing / stretchByLetterSpacing** — שלבי מתיחה 4 ו-7 (letter-spacing כבוי כברירת מחדל)
- **page-height adjustment** — שלב 6 (ניסיוני, כבוי כברירת מחדל)
- **rebalance2 אחרי cross-paragraph-parens** — איזון מחדש אחרי עטיפת סוגריים
- **fixDropWordInColumns** — שומר רק את ה-first-word-window הראשון בכל עמודה (מונע עיצוב מילה ראשונה בעמודה שמאלית)
- **tryReclaimOrphanTail** — מנגנון משיכת זנב יתומ (1-2 שורות) עם באפר 12px

### 1.2 בודק גיאוממטרי מקיף (`geometry-audit.js`, ~1980 שורות)
- **12+ בדיקות גיאוממטריות**: containment, sibling-overlap, column-balance, widow-orphan, sparse-last-line, overflow-to-footnote, fn-containment, page-overflow, ornaments, page-fill-ratio, block-gaps, settings-verification
- **extractGeometryWithDomRefs** — בונה מודל עם הפניות ל-DOM (WeakMap) לצורך אבחון
- **API ציבורי**: `extract()`, `audit()`, `paint()`, `clear()`, `highlightIssue()`, `findDom()`, `enrichNode()`, `getPageMetrics()`, `semanticRole()`
- **סיווג רכיבים סמנטי** — 14+ roles: `paragraph-continuation-cut/end`, `drop-word`, `parenthetical-run`, `running-header`, `page-number`, וכו'

### 1.3 מערכת אבחון שלב-אחר-שלב (`scripts/step-by-step-audit.js`)
- **4 checkpoints גלובליים**: after-initial-layout, after-cross-paragraph-parens, after-rebalance2, after-page-height
- **delta tracking** — מעקב added/removed/changed בין checkpoints
- **causality classification** — 7 קטגוריות סיבתיות (created-by-stage, fixed-by-stage, correction-reverted, couldnt-appear-before, created-at-first-checkpoint, never-appeared, unresolved)
- **issue-specific reading patterns** — 9 דפוסי אבחון לכל kind
- **CLI flags**: `--causality`, `--deltas-only`, `--verbose`, `--json`, `--no-typography`, `--no-line-rects`, `--summary-only`

### 1.4 GitHub Actions CI
- **regression-test.yml** — 4 jobs מטריצה:
  1. `baseline` — ברירת מחדל, maxHigh=10
  2. `page-height-max15` — עם page-height adjustment (max15)
  3. `page-height-max70` — עם page-height adjustment (max70)
  4. `determinism` — בדיקת דטרמיניזם (אותו פרק N פעמים)

### 1.5 ניקוי וארגון
- **מחיקת 167MB קבצים ישנים** — `_linesCache`, `_wordWidthCache`, `_kpCache`, וכו' (נשמר בהיסטוריה)
- **package.json** — תלות ב-playwright ל-CI
- **.gitignore** — התאמות ל-`__pycache__`

---

## 2. רכיבי המערכת

### 2.1 קבצי מנוע עיקריים

| קובץ | גודל | תיאור |
|---|---|---|
| `typesetter.js` | ~304KB | מנוע עימוד מרכזי (checkpoint mechanism, balanceColumns, stretchPageToBottom, rebalance, page-height) |
| `geometry-audit.js` | ~96KB | בודק גיאוממטרי (12+ בדיקות, enrichNode, getPageMetrics) |
| `app.js` | ~140KB | UI + loadExtendedFonts() + collectAllSettingsForRenderer() |
| `style.css` | ~58KB | גיליון סגנונות (כולל @font-face variables) |
| `renderer-bridge.js` | ~19KB | גשר בין index.html ל-iframe renderer |
| `settings-manager.js` | ~13KB | ניהול הגדרות משתמש |
| `decorations.js` | ~39KB | עיטורים, מפרידי סעיפים, סמני סימן |
| `debug-panel.js` | ~21KB | פאנל דיבאג עם כפתורים להפעלת בדיקות |
| `trace-manager.js` | ~23KB | ניהול trace של פעולות ה-engine |
| `test-suite.js` | ~57KB | דוח מועשר (DOM, גופן, RTL, עימוד מתקדם) |

### 2.2 קבצי גופנים

| קובץ | תיאור |
|---|---|
| `fonts-def.css` | רשימה 1 — 439 @font-face (נטענת מיד) |
| `fonts-extended.css` | רשימה 2 — 1315 @font-face (נטענת בלחיצה) |
| `fonts-priority.json` | רשימה 1 — 439 שמות |
| `fonts-extended.json` | רשימה 2 — 1315 שמות |
| `fonts-def.css` | הגדרות @font-face ברירת מחדל |

### 2.3 קבצי נתונים

| קובץ | תיאור |
|---|---|
| `default_settings.json` | הגדרות ברירת מחדל |
| `note_rules.json` | חוקי הערות שוליים |
| `header_ornaments.json` | עיטורי כותרת |
| `ornaments_left_right.json` | עיטורים שמאל-ימין |
| `ornaments_up_down.json` | עיטורים מעלה-מטה |
| `section_dividers.json` | מפרידי סעיפים |
| `shaar_back.json`, `shaar_main.json`, `shaar_sub.json` | שערים (אחורי/ראשי/משנה) |
| `reference-analysis.json` | ניתוח ייחוסים |
| `assets_manifest.json` | מניפסט נכסים |

### 2.4 HTML

| קובץ | תיאור |
|---|---|
| `index.html` | ממשק ראשי (UI + iframe renderer) |
| `renderer.html` | דף העימוד הפנימי (נטען ב-iframe) |

### 2.5 סקריפטים (`scripts/`)

| קובץ | תיאור |
|---|---|
| `test-chapters-enhanced.js` | בדיקת 79 פרקים עם ניתוח גיאוממטרי (רינדור + אודיט) |
| `step-by-step-audit.js` | בדיקה גיאוממטרית שלב-אחר-שלב (4 checkpoints, delta, causality) |
| `regression-test.js` | בדיקת רגרסיה — `--quick` (פרקים 1,3,4) / `--full` (79 פרקים) |
| `determinism-test.js` | בדיקת דטרמיניזם (אותו פרק N פעמים, השוואת תוצאות) |
| `baseline-check.js` | השוואת מול baseline |
| `debug-sparse-line.js` | debug: חוקר p-cut עם sparse-line |
| `debug-collectLines-vs-enrichNode.js` | debug: משווה collectLines מול enrichNode |
| `debug-side-notes-overflow.js` | debug: בודק גלישת טקסט לאזור הערות שוליים |
| `summarize-chapter-results.py` | מסכם תוצאות מ-`chapter-results/` |

### 2.6 תיעוד

| קובץ | תיאור |
|---|---|
| `step-by-step-audit-Method.md` | מתודולוגיית הבדיקה השלב-אחר-שלב (11 סעיפים, ~470 שורות) |
| `WORK_PLAN.md` | תוכנית עבודה מקיפה (40+ פריטים ב-8 קטגוריות A-H) |
| `REPO_AUDIT_AND_TESTING.md` | סקירת ריפו + הסברת בדיקות + המלצות עריכה |
| `LAYOUT_DEPENDENCY_MAP.md` | מפת תלות עימוד (כולל סעיף 13 — שינויים אחרונים) |
| `SESSION_HANDOFF.md` | העברת מידע בין sessions |
| `ACCESSIBILITY.md` | נגישות |
| `SECURITY.md` | אבטחה |
| `worklog.md` | יומן עבודה משותף (~330KB, מתעדכן על-ידי כל agent) |

---

## 3. בדיקות גיאוממטריה אוטומטיות

המערכת מריצה **12+ בדיקות גיאוממטריות** על כל עמוד לאחר העימוד:

| בדיקה | מה בודקת | חומרה |
|-------|----------|-------|
| `auditContainment` | האם בלוק חורג מטור/עמוד? | high/med/low (תלוי בסוג) |
| `auditSiblingOverlap` | האם יש חפיפה בין אחים? | high |
| `auditColumnBalance` | האם יש פער בין טור ימין ושמאל? | med (>50px) |
| `auditWidowOrphan` | האם יש שורה בודדת בתחילת/סוף טור? | high |
| `auditSparseLastLine` | האם השורה האחרונה ב-p-cut דלילה (<50%)? | low |
| `auditOverflowToFootnote` | האם טקסט גולש לאזור הערות? | high |
| `auditFnContainment` | האם הערות שוליים חורגות? | high |
| `auditPageOverflow` | האם תוכן חורג מגבולות העמוד? | high |
| `auditOrnaments` | האם עיטורים במקום הנכון? | med |
| `auditPageFillRatio` | האם עמוד מלא פחות מ-85%? | high/med/low |
| `auditBlockGaps` | האם יש מרחק גדול בין בלוקים? | med (>50px) |
| `auditSettingsVerification` | האם הגדרות משתמש הוחלו ב-DOM? | low |

### סף חומרה נוכחי
- **high**: > 0 (כל חריגה חמורה)
- **medium**: ≤ 5 (תיקונים מומלצים)
- **low**: ≤ 30 (מידע בלבד)

---

## 4. מערכת אבחון שלב-אחר-שלב

כלי לאבחון מדויק של **באיזה שלב נוצרת כל בעיה**. ראה תיעוד מלא ב-`step-by-step-audit-Method.md`.

### 4.1 הרצה בסיסית

```bash
# ודא ששרת HTTP נץ
python3 -m http.server 8765

# הרץ על פרק 9
cd scripts
node step-by-step-audit.js 9

# הרץ עם סיווג סיבתיות
node step-by-step-audit.js 9 --causality

# הרץ עם פלט מלא
node step-by-step-audit.js 9 --verbose
```

### 4.2 סיווג סיבתיות (7 קטגוריות)

1. **couldnt-appear-before** — העמוד לא היה קיים קודם
2. **created-at-first-checkpoint** — נוצרה בשלב הראשון (לולאה הראשית)
3. **created-by-stage** — נוצרה ע"י שלב N (רגרסיה של השלב)
4. **fixed-by-stage** — תוקנה ע"י שלב N
5. **correction-reverted** — בוטל פתרון שהוחל (appeared→fixed→re-appeared)
6. **never-appeared** — לא הופיע באף checkpoint (זקוק להשוואה חיצונית)
7. **unresolved** — נתונים לא מספיקים

### 4.3 דפוסי אבחון לפי סוג בעיה

לכל kind מוגדרים שדות חשובים והנחיית אבחון:
- `widow-orphan` — tokenId, dataAttrs, lineCount, lineRects, typography.lineHeight
- `imbalance` — children heights (R vs L), pageMetrics.twoColumnBlocks, pageDelta.changed
- `containment` — problemElement.rect.bottom, pageMetrics.bodyFlow.bottom, pageDelta.changed
- `page-overflow` — pageMetrics.page.h, footnoteArea.bottom, pageDelta.added
- `sparse-last-line` — lineCount, lineRects[last], typography
- `page-underfill` — pageMetrics.bodyFlow.bottom, pageDelta.removed
- `block-gap` — pageElements (rects sorted by y), pageDelta.added
- `overflow-to-footnote` — problemElement.rect.x, pageMetrics.bodyFlow (right edge)
- `fn-containment` — pageMetrics.footnoteArea.bottom, pageMetrics.noteLines

---

## 5. כלי CLI לבדיקות

### 5.1 בדיקת 79 פרקים

```bash
cd scripts
# כל 79 הפרקים
node test-chapters-enhanced.js 1 79 baseline

# טווח מצומצם
node test-chapters-enhanced.js 9 9 focus-ch9
```

תוצאות נשמרות ב-`chapter-results/chapter-NN.json` עם: `geomSummary`, `geomIssues`, `geomStats`, `highSeverityIssues`.

### 5.2 בדיקת רגרסיה

```bash
# מהיר (פרקים 1, 3, 4 — כ-30 שניות)
node regression-test.js --quick

# מלא (79 פרקים — 5-10 דקות)
node regression-test.js --full
```

ספים:
- **quick**: maxHigh=2, maxMedium=10
- **full**: maxHigh=10, maxMedium=30

### 5.3 בדיקת דטרמיניזם

```bash
# הרץ פרק 9 שלוש פעמים, השווה
node determinism-test.js 9 3
```

מוודא ש**שינויי קוד לא משפיעים על ה-layout הסופי** (כל עוד אותו input + אותן הגדרות → אותו output).

### 5.4 סקריפטי debug

```bash
# בודק p-cut עם sparse-line
node debug-sparse-line.js

# משווה collectLines vs enrichNode
node debug-collectLines-vs-enrichNode.js

# בודק גלישת טקסט לאזור הערות שוליים
node debug-side-notes-overflow.js
```

---

## 6. GitHub Actions CI

תצורה ב-`.github/workflows/regression-test.yml` — 4 jobs מטריצה:

| Job | תיאור | סף עמידה |
|-----|-------|----------|
| `baseline` | ברירת מחדל | maxHigh=10, maxMedium=30 |
| `page-height-max15` | עם page-height adjustment (max15) | maxHigh=10, maxMedium=30 |
| `page-height-max70` | עם page-height adjustment (max70) | maxHigh=10, maxMedium=30 |
| `determinism` | אותו פרק N פעמים, השוואת תוצאות | הפרש תווים ≤ 0 |

ה-CI מופעל אוטומטית על push/PR ל-`V21`.

---

## 7. מצב נוכחי — ממצאים ותיקונים

### 7.1 סיכום בעיות שתוקנו

| ממצא | בעיה | תיקון | commit |
|------|------|-------|--------|
| **1** | drop-word על עמודה שלמה | `fixDropWordInColumns` — שומר רק first-word-window ראשון | `ef3bad6` |
| **2** | שורות דלילות ממילה בודדת | paren-text overlap + note-marker detection + balanceColumns sparse penalty | `74c8dcc` |
| **3** | טקסט באזור הערות שוליים | RESOLVED — 0 מופעים נוכחית (debug-side-notes-overflow.js מאמת) | — |
| **4** | עמוד דליל מ-overflow הערות | page-underfill threshold fix (88% fill לא נחשב "דליל") | (commit להשלמה) |
| **5** | דיווחי שווא בתחילת פרק | hasH2() מורחב ל-h2-spacer, h2-orn-top/btm וכו' | `ef3bad6` |
| **sec-div** | sec-div overflow 3px כ-high | sec-div ≤5px → low (containment-rounding) | `ef3bad6` |
| **B5** | page-height overflow 7px | בדיקה מ-wrapper bottom במקום body-flow bottom | `728801e` |

### 7.2 מדדים נוכחיים (79 פרקים, baseline)

```
high:     0  (מ-8 בהתחלה → 0, -100%)
medium:   5  (מ-69 → 5, -93%)
low:     16  (מ-25 → 16, -36%)
total:   21  (מ-102 → 21, -79%)
```

חלוקה לפי kind:
- `containment-rounding`: 58 (טבעי — block-2col עם p-cut cross-page, עיגול פיקסלים)
- `imbalance`: 15
- `containment`: 9
- `settings-verification`: 7
- `page-underfill`: 1 (ch73, 81% fill — אמיתי)
- `sparse-line`: 2 (ch55, ch63 — דורש Knuth-Plass מלא)

### 7.3 מגבלות ידועות

1. **2 sparse-line אמיתיים** (ch55, ch63) — דורשים Knuth-Plass line breaking מלא. הסיבה: paren-text מרוב-שורות דוחק טקסט רגיל, מה שיוצר שורה אחרונה עם מילה אחת קצרה.
2. **פקודות determinism-test** עלולות להראות הפרשים זעירים בי ריצות (קשור ל-GC/memory), אך ה-layout הסופי זהה.
3. **4 checkpoints גלובליים בלבד** — לא תופס בעיות שנוצרות בתוך הלולאה הראשית. פתרון: הוספת `--per-page-checkpoints` (עתידי).

---

## 8. מפת דרכים

מתוך `WORK_PLAN.md`:

### A. אבחון (קטגוריה A)
- ✅ A1: בדיקת מרחק בין בלוקים
- ✅ A2: הגדרות settings verification
- ⏳ A3: קובץ בדיקה מקיף לכל סוג הגדרה

### B. תיקוני עימוד (B1-B11)
- ✅ B5: page-height overflow 7px
- ✅ heading-spacing (שלב 4)
- ✅ letter-spacing (שלב 7, מושבת כברירת מחדל)
- ⏳ B1-B4: פסקאות מסוגלות רב-עמוד
- ⏳ B6-B11: שיפורי איזון טורים

### C. בדיקות (C1-C5)
- ✅ C1: baseline
- ✅ C2: determinism
- ⏳ C3-C5: השוואה חוצת-גרסאות

### D. תיעוד (D1-D4)
- ✅ D1: WORK_PLAN.md
- ✅ D2: REPO_AUDIT_AND_TESTING.md
- ✅ D3: LAYOUT_DEPENDENCY_MAP.md (כולל סעיף 13)
- ⏳ D4: מדריך משתמש

### E. אופטימיזציה (E1-E3)
- ⏳ E1: cache מדידות גופן
- ⏳ E2: cache balance
- ⏳ E3: מקביליות

### F. תכונות חדשות (F1-F5)
- ⏳ F1: פיצול הערות אוטומטי
- ⏳ F2: חישוב גובה הערות לפני עימוד
- ⏳ F3-F5: שיפורי ornaments

### G. CI/CD (G1-G5)
- ✅ G1: regression-test.yml
- ⏳ G2: coverage דוחות
- ⏳ G3-G5: השוואת baseline חוצת-PR

### H. אינטגרציה (H1-H2)
- ⏳ H1: hot-reload מהגדרות
- ⏳ H2: ייצוא PDF משופר

---

## 9. התקנה ושימוש

### 9.1 הרצה מקומית

```bash
# 1. clone
git clone -b V21 https://github.com/SUGINACH/Tora_Book_Typesetter_Gold.git
cd Tora_Book_Typesetter_Gold

# 2. התקן תלות
npm install

# 3. הרץ שרת HTTP
python3 -m http.server 8765

# 4. פתח בדפדפן
open http://localhost:8765/index.html
```

### 9.2 הרצת בדיקות

```bash
# חיוני: שרת HTTP חייב לרוץ על פורט 8765

# בדיקה מהירה
cd scripts && node regression-test.js --quick

# בדיקה מלאה
cd scripts && node regression-test.js --full

# בדיקת step-by-step על פרק מסוים
cd scripts && node step-by-step-audit.js 9 --causality
```

### 9.3 פריסה (deploy) ל-GitHub Pages

```bash
# 1. commit
git add -A && git commit -m "v21-update" && git push origin V21

# 2. הפעלת GitHub Pages (בהגדרות הריפו):
#    Settings → Pages → Source: branch V21 / root
#    URL: https://suginach.github.io/IMUD_TORANI/
```

---

## 10. תיעוד נוסף

| מסמך | תיאור |
|------|-------|
| [`step-by-step-audit-Method.md`](step-by-step-audit-Method.md) | מתודולוגיית בדיקה שלב-אחר-שלב (11 סעיפים, 7 קטגוריות סיבתיות, 9 דפוסי אבחון, 7 אפשרויות כיוונון) |
| [`WORK_PLAN.md`](WORK_PLAN.md) | תוכנית עבודה מקיפה (40+ פריטים ב-8 קטגוריות) |
| [`REPO_AUDIT_AND_TESTING.md`](REPO_AUDIT_AND_TESTING.md) | סקירת ריפו + הסברת בדיקות |
| [`LAYOUT_DEPENDENCY_MAP.md`](LAYOUT_DEPENDENCY_MAP.md) | מפת תלות עימוד (כולל סעיף 13 — שינויים אחרונים) |
| [`worklog.md`](worklog.md) | יומן עבודה משותף (~330KB, מתעדכן על-ידי כל agent) |
| [`SESSION_HANDOFF.md`](SESSION_HANDOFF.md) | העברת מידע בין sessions |
| [`ACCESSIBILITY.md`](ACCESSIBILITY.md) | נגישות |
| [`SECURITY.md`](SECURITY.md) | אבטחה |

---

## היסטוריית גרסאות

| גרסה | תאריך | דגש מרכזי |
|------|-------|----------|
| v10 | 2026-10-12 | שמות גופנים בעברית, טעינה דו-שלבית, דוח מועשר |
| V15 | אוקטובר 2026 | תיקוני איזון, .nojekyll |
| V21 (Gold) | 2026-10-27 | מערכת אבחון שלב-אחר-שלב, 12+ בדיקות גיאוממטריה, GitHub Actions CI, תיקון 5 ממצאים (high 8→0, medium 69→5) |

---

## רישיון

פרויקט פרטי. כל הזכויות שמורות.
