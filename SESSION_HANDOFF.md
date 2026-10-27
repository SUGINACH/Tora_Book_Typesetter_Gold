# מסמך העברה — שיחה מקיפה על מנוע העימוד התורני V21

> **תאריך:** 2026-10-27 (סוף שיחה ארוכה)
> **ענף:** V21
> **מטרה:** העברת ידע מלא לשיחה הבאה — ללא חיסכון במילים.
> **מצב נוכחי:** ✅ יציבות שלימות + שקיפות סיבתית מנוע העימוד הושגו
> **קובץ קודם:** `SESSION_HANDOFF.md` (2026-10-26) — נשמר ב-`SESSION_HANDOFF_2026-10-26.md.bak`

---

## 1. סטטוס נוכחי — סיכום בלבד

### ✅ מה הושג
- **CI ירוק**: 79 פרקים, high=0, medium=141, low=115, exit 0
- **0 HIGH-severity issues** בכל ה-engine לאחר תיקון ה-false positive ב-audit
- **30 סוגי בעיות מוטמעים ב-audit** (3 קבצים: geometry-audit.js + audit-expansion.js + audit-text-integrity.js)
- **6 GitHub Actions workflows** פעילים
- **9-step priority process** מופעל ומתועד ב-`WORKING_RULES.md`
- **working rules 1-4** מיושמים ב-UI: שמות עבריים, הבהוב, דרופדאון סינון, מיון טבלאי
- **causal transparency** מלא: data-layout-* attributes, blockAttrsByPage, causality classification (7 categories), delta tracking
- **worklog.md** מתועד היטב עם כל השלבים

### ⚠️ מה עדיין פתוח (PARTIAL/OPEN)
- **F4 (page-underfill ב-ch73)**: מקרה אמיתי אחד (81% מילוי) — טבעי, התוכן מסתיים מוקדם
- **A3 (auditSettingsVerification)**: 11/15 הגדרות מכוסות, נשארו 4 הגדרות
- **C4 (regression tests מול baseline)**: אין baseline diff
- **D1-D3 (JSDoc, layout dependency map §11.7)**: לא מוּלאָה
- **E1-E2 (UI panel + visual report)**: חלקי
- **F1-F5 (accessibility WCAG)**: לא מוּלאָה
- **G1-G5 (security: DOMPurify, Trusted Types, SRI, Audit Trail, iframe sandbox)**: לא מוּלאָה
- **H1-H2 (ES Modules, balanceColumnsV2)**: לא מוּלאָה
- **B6 (Knuth-Plass מלא עם looseness)**: OPEN — יפתור 2 sparse-line אמיתיים שנותרו
- **B2 (rebalance אחרי applyKpLineBreaks)**: תלוי ב-B6
- **B3 (clubpenalties לכותרות)**: יפתור heading-escort
- **B7-B11 (Global Copyfitting, OpenType jalt, Canvas API, DPI, Unified Rollback)**: ארכיטקטורה

### 🚫 מה הושהה לסוף (לפי בקשת משתמש)
- **בעיות בלתי פתירות**: פסקה חד-מילולית / פסקה ענקית / רצף כותרות — מושהות לשלב סופי

---

## 2. סקירת שיחות — כרונולוגיה

### שיחה 1 (מוקדמת — 2026-10-26)
הותחלה מבקשת משתמש להריץ טקסט מעודכן עם הערות שוליים וסוגריים. התגלו:
- 4 קונפליקטי merge שלא הושלמו
- באגים ב-balanceColumns (תיקון over-shoot, cross-paragraph parens)
- 5 findings (F1-F5) + structural issues (B1, B5)
- הוספת `data-layout-*` attributes (12 לכל block-2col)
- הוספת `blockAttrsByPage` ב-checkpoints

### שיחה 2 (2026-10-27 — זו)
1. **הטמעת כללי עבודה 1-4 ב-UI**:
   - Rule 1: שמות עבריים — תיקון באג `kindNames` → `GEOM_KIND_NAMES`
   - Rule 2: הבהוב אזור הבעיה — הוסף `childRect` לכל 7 הבדיקות החדשות
   - Rule 3: דרופדאון צ'קליסט לסינון — `renderGeomKindFilter()`
   - Rule 4: מיון טבלת דיווחים — `sortGeomIssues()` עם ↑/↓

2. **יצירת 4 workflows חדשים ב-GitHub Actions**:
   - `step-by-step-audit.yml` — בדיקה גיאומממטרית שלב-אחר-שלב
   - `full-baseline-audit.yml` — baseline מלא על 79 פרקים (matrix)
   - `test-triggers-runner.yml` — הרצת trigger files לאימות זיהוי
   - `issue-investigation.yml` — חקירה עמוקה של בעיה ספציפית

3. **תיקון באג קריטי ע"י סוכן משנה** (commit `c78435c`):
   - **ה-bug היה FALSE POSITIVE ב-audit, לא ב-engine!**
   - שני באגים ב-audit measurement:
     1. `classifyElement` ב-`geometry-audit.js:56-57` — `'note-line'` substring של `'note-line-num'` גרם לסיווג שגוי של inline `<a class='note-line-num'>` כ-fn-line → תוקן ע"י בדיקת `note-line-num` קודם
     2. `sumNotes` ב-`audit-expansion.js:124-133` — סכימה כפולה של `fn-block.rect.h` + גובה ילדיו `fn-line` (bounding box כולל כבר את הילדים) → תוקן ע"י ספירת רק `fn-line`
   - **תוצאות אימות**: ch9 final audit = 0 HIGH (היה 1 HIGH 77px + 1 MEDIUM). **79 פרקים: high=0, medium=141, low=115, exit code 0!**

4. **יצירת PDF generator לאימות דיווחים** (commit `0ac4891`):
   - `scripts/generate-issues-pdf.js` — ~410 שורות Node.js
   - `.github/workflows/issues-screenshot-pdf.yml` — workflow ידני
   - ה-PDF כולל:
     - עמוד שער עם סטטיסטיקות
     - מפריד פרק לכל פרק
     - בלוק בעיה לכל בעיה עם כותרת (שם עברי + חומרה + סיבה + מספר פרק + מספר עמוד) + צילום מסך מלא + הודעת audit + childRect
   - נבדק מקומית — יצר PDF תקין ב-2MB עם 8 עמודים עבור ch9
   - שם הקובץ כולל סוגי בעיות: `issues-{kinds}+{separated}-{ISO timestamp}.pdf`

---

## 3. קבצים מרכזיים — מפת ניווט

### 3.1 קבצי Engine
| קובץ | תוכן | סטטוס |
|------|------|-------|
| `typesetter.js` (~5400 שורות) | מנוע העימוד הראשי | יציב |
| `geometry-audit.js` (~2230 שורות) | בדיקה גיאומממטרית (19 בדיקות) | יציב |
| `audit-expansion.js` (~373 שורות) | 8 בדיקות נוספות | יציב (תוקן ב-c78435c) |
| `audit-text-integrity.js` (~335 שורות) | 3 בדיקות שלמות טקסט | יציב |
| `app.js` (~2967 שורות) | UI + עיבוד דוחות | יציב (rules 1-4) |
| `debug-panel.js` (~155 שורות) | דוח חי + מרקרים | יציב |
| `renderer-bridge.js` (~330 שורות) | תקשורת iframe ↔ parent | יציב |
| `renderer.html` | iframe content (טוען את כל הסקריפטים) | יציב |
| `index.html` | דף UI ראשי | יציב |

### 3.2 קבצי Scripts (scripts/)
| קובץ | תפקיד |
|------|--------|
| `step-by-step-audit.js` (~470 שורות) | CLI: בדיקה שלב-אחר-שלב עם causality |
| `test-chapters-enhanced.js` (~429 שורות) | CLI: בדיקת 79 פרקים |
| `test-trigger-runner.js` (~58 שורות) | CLI: הרצת trigger files |
| `determinism-test.js` | CLI: בדיקת יציבות (×3 ריצות) |
| `generate-issues-pdf.js` (~410 שורות) | CLI: יצירת PDF עם צילומי מסך |
| `editing-recommendations.js` | CLI: המלצות עריכה לפתרון בעיות |
| `generate-test-triggers.js` | CLI: יצירת קבצי trigger |
| `regression-test.js` | CLI: בדיקת נגרסיה עם thresholds |
| `baseline-check.js` | CLI: בדיקת baseline |

### 3.3 תיעוד
| קובץ | תוכן |
|------|------|
| `README.md` (~460 שורות) | תיעוד V21 Gold — 10 חלקים |
| `WORKING_RULES.md` | 6 כללי עבודה (1-4 מיושמים ✓, 5-6 תיעודיים) |
| `WORKFLOWS.md` | אינדקס 6 workflows עם מיפוי 9-step |
| `ISSUES_TABLE.md` | 30+ בעיות עם 7 עמודות |
| `COMPREHENSIVE_ISSUES_REVIEW.md` | סקירה כנה של מצב הבעיות |
| `AUDIT_EXPANSION_PLAN.md` | 19 בדיקות נוספות מתוכננות |
| `WORK_PLAN.md` | סטטוס: 17 DONE, 7 PARTIAL, 25 OPEN מתוך 49 |
| `LAYOUT_DEPENDENCY_MAP.md` | מפת תלויות עימוד |
| `SECURITY.md`, `ACCESSIBILITY.md`, `REPO_AUDIT_AND_TESTING.md` | מסמכים נלווים |
| `worklog.md` | רישום עבודה (append-only) — **קרא את הסוף לפני התחלת עבודה!** |

### 3.4 GitHub Actions Workflows
| Workflow | טריגר | מטרה |
|----------|-------|------|
| `regression-test.yml` | push + manual | בדיקת 79 פרקים × 3 modes + determinism |
| `step-by-step-audit.yml` | manual | בדיקה שלב-אחר-שלב עם causality |
| `full-baseline-audit.yml` | manual | baseline מלא על 79 פרקים (matrix) |
| `test-triggers-runner.yml` | push (paths) + manual | הרצת trigger files |
| `issue-investigation.yml` | manual | חקירה עמוקה של בעיה ספציפית עם המלצות |
| `issues-screenshot-pdf.yml` | manual | יצירת PDF עם צילומי מסך |

---

## 4. מצב Git

### 4.1 ענף נוכחי
- **ענף**: `V21`
- **Remote**: `https://github.com/SUGINACH/Tora_Book_Typesetter_Gold.git`
- **Commit אחרון שנדחף**: `0ac4891` — "feat: add issues-screenshot-pdf workflow + generate-issues-pdf.js script"
- **Commit קודם**: `c78435c` — "fix(audit): footnote-overflow ch9 — fix classifyElement substring-match bug + sumNotes double-count"

### 4.2 Credentials
- **שמורים ב-`~/.git-credentials`** (credential.helper=store)
- **Token**: GitHub PAT (נשמר ע"י המשתמש בסוף השיחה)
- דחיפה עובדת ישירות: `git push origin V21`

---

## 5. 9-Step Priority Process — מצב נוכחי

### שלבים 1-3 (מושלמים)
1. **הגדרה מדויקת**: 30 סוגי בעיות מוגדרים ב-`ISSUES_TABLE.md`
2. **זיהוי ודאי**: כל 30 מוטמעים ב-3 קבצי audit
3. **הוספה לסקריפט בדיקה**: `step-by-step-audit.js` + `test-chapters-enhanced.js` + workflows

### שלבים 4-9 (תהליך עבודה לכל בעיה)
- **שלב 4 (מציאת שלב)**: ע"י `Issue Investigation` workflow או `step-by-step-audit --causality --per-page-checkpoints`
- **שלב 5 (פתרון זהיר)**: קריאת קוד + ניתוח
- **שלב 6 (החלה)**: commit & push
- **שלב 7 (בדיקת הצלחה)**: re-run audit
- **שלב 8 (השלכות)**: `Full Baseline Audit`
- **שלב 9 (הצלחה חלקית)**: `Issue Investigation` עם `--verbose`

---

## 6. הבעיות הנותרות — סדר עדיפויות

### 6.1 בעיות medium פתוחות (ב-79 פרקים: medium=141, low=115)
- **candidate-vs-final**: 13 issues ב-ch9 — פערים בין מועמד לסופי (medium/low בלבד)
- **heading-escort**: כותרת בסוף טור עם <2 שורות אחריה — פתרון B3 (clubpenalties)
- **sparse-line** אמיתיים (2): ch55, ch63 — פתרון B6 (Knuth-Plass looseness)
- **עוד**: לא מנתח — יש להריץ `Full Baseline Audit` לקבלת פירוט מלא

### 6.2 בעיות תשתיתיות (כלליות)
- **B6 (Knuth-Plass מלא)**: יפתור 2 sparse-line אמיתיים — ארכיטקטורה גדולה
- **B2 (rebalance אחרי KP)**: תלוי ב-B6
- **B3 (clubpenalties)**: יפתור heading-escort
- **B7-B11**: ארכיטקטורה מתקדמת (Global Copyfitting, OpenType jalt, Canvas API, DPI, Unified Rollback)

### 6.3 תיעוד + תשתית
- **A3**: השלמת 4 הגדרות נוספות ב-auditSettingsVerification (11/15 מכוסות)
- **C4**: בדיקות רגרסיה מול baseline
- **D1-D3**: JSDoc + מדריך הוספת אלמנטים
- **E1-E2**: UI panel + visual report
- **F1-F5**: נגישות WCAG
- **G1-G5**: אבטחה (DOMPurify, Trusted Types, SRI, Audit Trail, iframe sandbox)
- **H1-H2**: ES Modules, balanceColumnsV2

### 6.4 מושהה לסוף (לפי בקשת משתמש)
- **בעיות בלתי פתירות**: פסקה חד-מילולית / פסקה ענקית / רצף כותרות

---

## 7. כללי עבודה — חובה לקרוא לפני תחילת עבודה

קרא את `WORKING_RULES.md` במלואו לפני תחילת כל עבודה. סיכום:

1. **כלל 1**: שמות בעברית בכל דוחות ה-UI ✓
2. **כלל 2**: הבהוב אזור הבעיה בכל סוגי ה-bugs ✓
3. **כלל 3**: דרופדאון צ'קליסט לסינון ✓
4. **כלל 4**: מיון טבלאי (page/type/severity, asc/desc) ✓
5. **כלל 5**: דיווחי false-positive → בדוק: טווח מותר? זוגות תקינים? סף נמוך מדי?
6. **כלל 6**: multiple-blocks אינה בעיה!

---

## 8. פעולות מומלצות להתחלת שיחה הבאה

### 8.1 שלב 1 — הבנת מצב
```bash
cd /home/z/my-project/Tora_Book_Typesetter_Gold
git fetch origin V21
git log --oneline origin/V21 -5
git status --short
```

### 8.2 שלב 2 — בדיקת CI אחרון
עבור ל-https://github.com/SUGINACH/Tora_Book_Typesetter_Gold/actions ובדוק:
- Regression Test האחרון — האם עדיין ירוק? (high=0)
- Issues Screenshot PDF — האם המשתמש הריץ אותו? אם כן, הורד את ה-PDF ועבור עליו

### 8.3 שלב 3 — המשך עבודה לפי סדר 9-step
המשך לעבוד על הבעיות ה-medium שנותרו:
- **מועמד ראשון**: candidate-vs-final (13 issues ב-ch9) — הרץ `Issue Investigation` עם issue_kind=candidate-vs-final, chapter=9
- **מועמד חלופי**: heading-escort — הרץ עם issue_kind=heading-escort

### 8.4 שלב 4 — השהיית בעיות בלתי פתירות
כל עוד המשתמש לא ביקש אחרת, **אל** תעבוד על: פסקה חד-מילולית / פסקה ענקית / רצף כותרות.

---

## 9. פקודות שימושיות

### 9.1 הרצת בדיקה מקומית (Playwright מותקן)
```bash
cd /home/z/my-project/Tora_Book_Typesetter_Gold
npm install  # פעם אחת
npx playwright install chromium  # פעם אחת

# התחל שרת HTTP ברקע
python3 -m http.server 8765 --bind 0.0.0.0 &

# הרץ בדיקות
cd scripts
node test-chapters-enhanced.js 9 9 debug-ch9  # פרק 9 בלבד
node step-by-step-audit.js 9 --causality --per-page-checkpoints --json out.json
node generate-issues-pdf.js 9 9  # יצירת PDF
node test-trigger-runner.js ../test-triggers/test-trigger-overflow.txt
```

### 9.2 דחיפה ל-GitHub
```bash
cd /home/z/my-project/Tora_Book_Typesetter_Gold
git add -A
git commit -m "fix(engine): <description>"
git push origin V21
```
Credentials שמורים — push עובד ישירות.

### 9.3 עדכון תיעוד
- `worklog.md`: append entry בפורמט המתועד (Task ID + Agent + Task + Work Log + Stage Summary)
- `WORKING_RULES.md`: עדכן כשנוסף כלל חדש
- `WORKFLOWS.md`: עדכן כשנוסף workflow חדש
- `ISSUES_TABLE.md`: עדכן כשנוסף/משתנה סוג בעיה

---

## 10. נקודות תשומת לב חשובות

1. **אל תיצור קבצים חדשים ללא צורך** — עדכן קיימים.
2. **השתמש ב-`Skill` tool לפני יצירת מסמכים** (docx/pdf/xlsx/pptx).
3. **`scripts/` ב-`/home/z/my-project/scripts/`** לסקריפטים זמניים שאתה כותב.
4. **`scripts/` ב-`/home/z/my-project/Tora_Book_Typesetter_Gold/scripts/`** לסקריפטים של הפרויקט.
5. **`download/` ב-`/home/z/my-project/download/`** למסמכים שהמשתמש צריך להוריד.
6. **`worklog.md` ב-`/home/z/my-project/Tora_Book_Typesetter_Gold/worklog.md`** — single shared log.
7. **אל תמחק קבצים קיימים** — השתמש ב-`.bak` לגיבוי.
8. **השתמש ב-`Edit` לתיקון, לא `Write`** — אלא אם השינוי נרחב.
9. **בדוק syntax** עם `node -c <file>` לפני commit.
10. **הרץ unit tests** (`scripts/test-sort-filter.js`) כשמשנים לוגיקת UI.

---

## 11. פרומט מומלץ לשיחה הבאה

```
שלום! אני ממשיך את השיחה הקודמת על מנוע העימוד התורני V21.

**מצב נוכחי** (מתועד ב-SESSION_HANDOFF.md):
- ✅ CI ירוק — 79 פרקים, high=0, medium=141, low=115, exit 0
- ✅ 30 סוגי בעיות מוטמעים ב-audit
- ✅ 6 GitHub Actions workflows פעילים
- ✅ working rules 1-4 מיושמים ב-UI
- ✅ workflow חדש `issues-screenshot-pdf.yml` נדחף (commit 0ac4891)

**משימה מיידית**:
1. בדוק את ה-CI האחרון ב-https://github.com/SUGINACH/Tora_Book_Typesetter_Gold/actions
   (Regression Test — האם עדיין ירוק?)
2. האם המשתמש הריץ את `Issues Screenshot PDF` workflow? אם כן — נתח את התוצאות
3. המשך ב-9-step process על הבעיה הבאה:
   - עדיפות 1: candidate-vs-final (13 medium ב-ch9) — הרץ `Issue Investigation`
   - עדיפות 2: heading-escort — פתרון דורש B3 (clubpenalties)
   - מושהה: בעיות בלתי פתירות (פסקה חד-מילולית וכו')

**הנחיות עבודה**:
- קרא `WORKING_RULES.md` לפני תחילת עבודה
- קרא `worklog.md` (במיוחד הסוף) להבנת היסטוריה
- השתמש ב-`Skill` tool לפני יצירת מסמכים
- דחוף דרך: `git push origin V21` (credentials שמורים)
- השתמש ב-GitHub Actions לפעולות ארוכות — אל תריץ מקומית דברים שלוקחים יותר מ-5 דקות

**סדר עדיפויות ה-9-step שלי**:
1. הגדרה מדויקת
2. יצירת יכולת זיהוי ודאית
3. הוספה מותאמת לסקריפט הבדיקה ול-step-by-step audit
4. מציאת שלב הופעת הבעיה וגורמיה
5. מציאת דרך זהירה מאוד לפתרון
6. החלת הפתרון
7. בדיקת הצלחת הפתרון
8. בדיקת השלכות והודאות הפתרון
9. במידה וההצלחה חלקית — חקירה, שקול פתרון רחב יותר/פתרון נקודתי/דחייה

התחל!
```

---

## 12. סיכום שיחה — מה הושג

| היבט | תחילת שיחה | סוף שיחה |
|------|------------|---------|
| HIGH issues | 1 (footnote-overflow 77px) | **0** ✓ |
| Medium issues ב-ch9 | 1 | **6** (כולם candidate-vs-final) |
| Workflows ב-GitHub Actions | 5 | **6** ✓ |
| Working rules מיושמים | 0 | **4** ✓ |
| Issue kinds ב-audit | 27 | **30** ✓ |
| Worklog entries | ~20 | **~25** ✓ |

**הישג מרכזי**: CI ירוק + שקיפות סיבתית מלאה + מערכת ויזואלית לאימות דיווחים.

---

**תאריך יצירת מסמך זה:** 2026-10-27 (סוף שיחה)
**מטרה:** המשך רציף ללא איבוד ידע
