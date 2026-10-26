# שיטת הבדיקה הגיאומממטרית רב-שלבית — step-by-step-audit

> **תאריך:** 2026-10-26
> **ענף:** V21
> **קבצים:** `typesetter.js` (checkpoint mechanism), `scripts/step-by-step-audit.js` (runner)

---

## 1. מטרה

הבדיקה הגיאומממטרית רב-שלבית נועדה להחליף וידוא חזותי ידני. במקום שהמפתח יסתכל בעמודים המרונדרים ויחפש בעיות בעיניים, המערכת:

1. **מבודדת פרק אחד** (אין השפעת עימוד בין פרקים — כותרת 2 מתחילה עמוד חדש)
2. **מעמידה את הפרק לבד** (עם כל ההגדרות המלאות מ-`collectAllSettingsForRenderer`)
3. **מפעילה בדיקה גיאומממטרית אחרי כל שלב עימוד** (4 checkpoints גלובליים + אפשרות להרחבה)
4. **מתעדת את ההגדרות של האלמנטים הבעייתיים** (type, cls, rect, text, children)
5. **מתעדת את כל האלמנטים בעמוד** (כדי לראות מה השתנה בין שלבים)
6. **מצביעה על השלב המדויק** שבו כל בעיה נוצרה, תוקנה, או שהונעה פתרון מלחול

---

## 2. ארכיטקטורה — זרימת נתונים

```
┌─────────────────────────────────────────────────────────────┐
│  סקריפט חיצוני (step-by-step-audit.js)                    │
│                                                             │
│  1. טוען דף (index.html) משרת HTTP                         │
│  2. מפעיל דגל ב-iframe: window.__stepByStepAudit = true   │
│  3. שולח טקסט פרק + הגדרות ל-iframe (postMessage typeset) │
│  4. ממתין ל-render-done                                     │
│  5. קורא window.__auditCheckpoints מה-iframe                 │
│  6. מנתח: השוואת checkpoints, זיהוי שלב יצירה               │
│  7. מדפיס דוח                                               │
│                                                             │
│  ┌──────────────────────────────────────────────────┐      │
│  │ iframe (renderer.html)                           │      │
│  │                                                   │      │
│  │  typesetDocumentCore()                           │      │
│  │  ├── שלב 1: לולאה ראשית (מילוי עמודים)         │      │
│  │  │   └── balanceColumns לכל block-2col          │      │
│  │  │       ├── split point selection               │      │
│  │  │       ├── appendItemFinal (לכל פסקה)         │      │
│  │  │       │   └── createDropWord                   │      │
│  │  │       ├── justifyColumnVertically              │      │
│  │  │       │   ├── stretchByHeadingSpacing          │      │
│  │  │       │   ├── stretchByWordSpacing             │      │
│  │  │       │   ├── stretchByLetterSpacing           │      │
│  │  │       │   └── line-height stretch              │      │
│  │  │       ├── fixDropWordInColumns                 │      │
│  │  │       └── finalizeNotePositions                │      │
│  │  │                                               │      │
│  │  ├── stretchPageToBottom (לכל עמוד)              │      │
│  │  ├── tryReclaimOrphanTail (לכל עמוד)             │      │
│  │  ├── rebalance1 (לכל עמוד — פערים שנותרו)       │      │
│  │  ├── flushFootnotesInto (לכל עמוד)               │      │
│  │  │                                               │      │
│  │  ╔═══════════════════════════════════════════╗   │      │
│  │  ║ CHECKPOINT 1: after-initial-layout         ║   │      │
│  │  ╚═══════════════════════════════════════════╝   │      │
│  │  │                                               │      │
│  │  ├── applyCrossParagraphParens (גלובלי)         │      │
│  │  │                                               │      │
│  │  ╔═══════════════════════════════════════════╗   │      │
│  │  ║ CHECKPOINT 2: after-cross-paragraph-parens ║   │      │
│  │  ╚═══════════════════════════════════════════╝   │      │
│  │  │                                               │      │
│  │  ├── rebalance2 (גלובלי — פערים אחרי paren)     │      │
│  │  │   └── justifyColumnVertically + shrink        │      │
│  │  │                                               │      │
│  │  ╔═══════════════════════════════════════════╗   │      │
│  │  ║ CHECKPOINT 3: after-rebalance2             ║   │      │
│  │  ╚═══════════════════════════════════════════╝   │      │
│  │  │                                               │      │
│  │  ├── page-height adjustment (אם מופעל)           │      │
│  │  │   └── rebalance אחרי page-height              │      │
│  │  │                                               │      │
│  │  ╔═══════════════════════════════════════════╗   │      │
│  │  ║ CHECKPOINT 4: after-page-height            ║   │      │
│  │  ╚═══════════════════════════════════════════╝   │      │
│  │  │                                               │      │
│  │  └── (סיום typesetDocumentCore)                  │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. מה קורה בכל checkpoint

בכל checkpoint, הפונקציה `window.__runAuditCheckpoint(name)` מופעלת ומבצעת:

### 3.1 extractGeometry()

בונה מודל גיאומממטרי מלא מה-DOM הנוכחי:
- עובר על כל `.a4-page`
- לכל עמוד: שומר `idx`, `label`, `rect`, `cls` (class), `children`
- לכל אלמנט: שומר `type`, `cls`, `rect` (x, y, w, h, bottom), `text`, `lines`, `children`
- מיפוי סוגים: `page` → `wrapper` → `body-flow` → `block-2col` → `column` → `p-end/p-cut` → `drop-word`

### 3.2 auditGeometry(model)

מריץ 12+ בדיקות גיאומממטריות:

| בדיקה | מה בודק |
|-------|---------|
| `auditContainment` | האם בלוק חורג מטור/עמוד? (overflow) |
| `auditSiblingOverlap` | האם יש חפיפה בין אחים? |
| `auditColumnBalance` | האם יש פער בין טור ימין ושמאל? (imbalance) |
| `auditWidowOrphan` | האם יש שורה בודדת בתחילת/סוף טור? |
| `auditSparseLastLine` | האם השורה האחרונה ב-p-cut דלילה (<50% רוחב)? |
| `auditOverflowToFootnote` | האם טקסט גולש לאזור הערות? |
| `auditFnContainment` | האם הערות שוליים חורגות? |
| `auditPageOverflow` | האם תוכן חורג מגבולות העמוד? |
| `auditOrnaments` | האם עיטורים במקום הנכון? |
| `auditPageFillRatio` | האם עמוד מלא פחות מ-50%? (page-underfill) |
| `auditBlockGaps` | האם יש מרחק גדול בין בלוקים? |
| `auditSettingsVerification` | האם הגדרות המשתמש הוחלו ב-DOM? |

### 3.3 העשרת נתונים — תיעוד האלמנטים הבעייתיים

עבור **כל בעיה** שנמצאה, המערכת מתעדת:

1. **האלמנט הבעייתי עצמו** (`problemElement`):
   - `type` — סוג האלמנט (block-2col, column, p-cut, וכו')
   - `cls` — ה-class המלא (למשל `block-2col p-cut`)
   - `rect` — מיקום וגודל (x, y, w, h)
   - `text` — טקסט קצר מהאלמנט (עד 50 תווים)
   - `lines` — מספר שורות
   - `childCount` — מספר ילדים
   - `children` — עד 8 ילדים עם התיאור שלהם (רקורסיבית, עד עומק 2)

2. **כל האלמנטים בעמוד** (`pageElements`):
   - רשימה מלאה של כל האלמנטים בעמוד (עד עומק 3)
   - כולל: `type`, `cls`, `rect` (y, h, bottom), `text`
   - מאפשר השוואה: מה השתנה בין checkpoint N-1 ל-N

3. **מספר העמודים הכולל** (`pageCount`):
   - מאפשר להבדיל "לא יכלה להופיע" מ"נגרמה"

---

## 4. לוגיקת אבחון — הבחנה בין סוגי הופעה

עבור כל בעיה, המערכת עוקבת אחרי הופעתה לאורך השלבים ומסווגת:

### 4.1 מקרה א' — "לא יכלה להופיע קודם"

הבעיה מופיעה בשלב N אבל לא בשלב N-1, **כי העמוד/הבלוק לא היה קיים עדיין**.

**איך מזהים:**
- `pageCount` בשלב N > `pageCount` בשלב N-1 (נוצרו עמודים חדשים)
- או: `pageIdx` של הבעיה ≥ `pageCount` בשלב N-1 (העמוד לא היה קיים)

**מסקנה:** הבעיה נוצרה יחד עם האלמנט — חלק טבעי מתהליך היצירה. לא רגרסיה.

**דוגמה:** עמוד 13 נוצר בלולאה הראשית. בעיית containment-rounding על עמוד 13 מופיעה ב-checkpoint 1 (after-initial-layout) — ברור שהבעיה נוצרה במהלך הלולאה.

### 4.2 מקרה ב' — "היה כראוי ואז נוצרה" (regression של שלב)

הבעיה מופיעה בשלב N אבל לא בשלב N-1, **למרוץ שהעמוד כבר היה קיים** בשלב N-1.

**איך מזהים:**
- `pageCount` בשלב N == `pageCount` בשלב N-1 (אותו מספר עמודים)
- `pageIdx` של הבעיה < `pageCount` בשלב N-1 (העמוד כבר היה קיים)
- הבעיה לא הייתה קיימת בשלב N-1 (count = 0 עבור אותו kind באותו עמוד)

**מסקנה:** השלב N גרם לבעיה. השלב שינה משהו שהיה תקין ויצר חריגה.

**דוגמה:** עמוד 6 קיים ב-checkpoint 1 (pageCount=19) בלי בעיות containment/imbalance. ב-checkpoint 3 (after-rebalance2) מופיעות בעיות חדשות בעמוד 6. מסקנה: **rebalance2 גרם לבעיה** — הוא שינה את גובה הטורים ויצר חריגה.

### 4.3 מקרה ג' — "נעלמה" (תיקון של שלב)

הבעיה הייתה קיימת בשלב N-1 ונעלמת בשלב N.

**מסקנה:** השלב N תיקן את הבעיה. התיקון הצליח.

### 4.4 מקרה ד' — "הונעה פתרון מלחול"

הבעיה לא מופיעה באף checkpoint, **אבל הייתה אמורה להופיע** כי הטקסט יוצר מצב שדורש תיקון.

**איך מזהים:** זה קשה יותר — צריך להשוות בין מסמכים דומים (למשל, אותו פרק עם ובלי שלב תיקון מסוים). ניתן להשתמש ב-determinism-test כדי להשוות.

**דוגמה:** `stretchByHeadingSpacing` אמור לאזן טורים. אם הוא לא פועל, לא תהיה בעיית imbalance (כי ה-engine לא ניסה לאזן). אבל הטקסט עדיין לא מאוזן. כדי לזהות זאת, משווים: עם heading-spacing vs בלי — אם אין הבדל, הפונקציה לא פעלה.

### 4.5 מקרה ה' — "ביטל פתרון שהוחל"

בעיה מופיעה בשלב N, **אבל נעלמת בשלב N+1**, ואז **חוזרת בשלב N+2**.

**מסקנה:** שלב N יצר את הבעיה, שלב N+1 תיקן אותה, אבל שלב N+2 ביטל את התיקון. זהו קונפליקט בין שלבים.

**דוגמה:** `balanceColumns` מאזן טורים (תיקון). אחר כך `applyCrossParagraphParens` עוטף פסקאות ב-span עם גופן קטן יותר — זה משנה את גובה הטורים ומבטל את האיזון. `rebalance2` אמור לתקן, אבל לפעמים הוא יוצר בעיה חדשה.

---

## 5. שימוש

### 5.1 הרצה בסיסית

```bash
# ודא ששרת HTTP רץ
python3 -m http.server 8765

# הרץ על פרק 9
cd scripts
node step-by-step-audit.js 9

# הרץ על פרק 35
node step-by-step-audit.js 35
```

### 5.2 פלט הסקריפט

הסקריפט מדפיס:
1. **ניתוח כל checkpoint** — summary + issues מקובצים לפי kind
2. **טבלת התפתחות** — kind × checkpoint (כמה בעיות מכל סוג בכל שלב)
3. **בעיות high — מתי נוצרו** — רק בעיות high עם השלב שבו הופיעו
4. **השוואת התחלה → סוף** — מה נעלם, מה נוצר

### 5.3 פלט מועשר (מתועד בכל issue)

כל issue ב-checkpoint כולל:
- `kind` — סוג הבעיה
- `severity` — high/medium/low
- `pageIdx` — מספר העמוד (0-based)
- `message` — תיאור הבעיה (עד 150 תווים)
- `problemElement` — תיאור האלמנט הבעייתי:
  - `type`, `cls`, `rect`, `text`, `lines`, `childCount`, `children`
- `pageElements` — כל האלמנטים בעמוד:
  - `type`, `cls`, `rect` (y, h, bottom), `text`

---

## 6. אפשרויות כיוונון למקרים שהסיבה לא מתגלה

### 6.1 הוספת checkpoint פר-עמוד

כאשר 4 ה-checkpoint הגלובליים לא מספיקים (הבעיה נוצרת בתוך הלולאה הראשית), אפשר להוסיף checkpoint אחרי כל עמוד:

```javascript
// בתוך הלולאה הראשית, אחרי עיבוד כל עמוד:
if (window.__stepByStepAudit) window.__runAuditCheckpoint('page-' + pageIndex);
```

**מתי להפעיל:** כשהבעיה מופיעה ב-checkpoint 1 (after-initial-layout) וצריך לדעת באיזה עמוד בדיוק.

**חיסרון:** איטי יותר (כל checkpoint מפעיל layout flush).

### 6.2 הוספת checkpoint בתוך balanceColumns

כדי לדעת אם הבעיה נוצרת בשלב איזון הטורים עצמו:

```javascript
// בתוך balanceColumns, אחרי בחירת נקודת החיתוך:
if (window.__stepByStepAudit) window.__runAuditCheckpoint('balanceColumns-split-block-' + blockIdx);

// אחרי justifyColumnVertically:
if (window.__stepByStepAudit) window.__runAuditCheckpoint('balanceColumns-justify-block-' + blockIdx);

// אחרי fixDropWordInColumns:
if (window.__stepByStepAudit) window.__runAuditCheckpoint('fixDropWord-block-' + blockIdx);
```

**מתי להפעיל:** כשהבעיה היא imbalance וצריך לדעת איזה שלב בתוך balanceColumns יצר אותה.

### 6.3 הוספת checkpoint אחרי stretchPageToBottom

```javascript
// אחרי stretchPageToBottom בלולאה הראשית:
if (window.__stepByStepAudit) window.__runAuditCheckpoint('stretchPageToBottom-page-' + pageIndex);

// אחרי tryReclaimOrphanTail:
if (window.__stepByStepAudit) window.__runAuditCheckpoint('reclaimOrphan-page-' + pageIndex);

// אחרי rebalance1:
if (window.__stepByStepAudit) window.__runAuditCheckpoint('rebalance1-page-' + pageIndex);

// אחרי flushFootnotesInto:
if (window.__stepByStepAudit) window.__runAuditCheckpoint('flushFootnotes-page-' + pageIndex);
```

### 6.4 השוואת מצבים — עם ובלי פונקציית תיקון

כדי לבודד האם פונקציית תיקון מונעת פתרון או מבטלת אותו:

```bash
# 1. הרץ עם הפונקציה מופעלת:
node step-by-step-audit.js 9 > with-fix.txt

# 2. כבה את הפונקציה (למשל aq-heading-spacing):
ENABLE_HEADING_SPACING=0 node step-by-step-audit.js 9 > without-fix.txt

# 3. השווה:
diff with-fix.txt without-fix.txt
```

### 6.5 מצב debug מפורט — תיעוד מלא של כל אלמנט

להגדלת עומק התיעוד (יותר ילדים, יותר טקסט):

```javascript
// ב-collectPageElements, הגדל maxDepth:
pageElements = collectPageElements(page, 5);  // במקום 3

// ב-describeNode, הגדל depth:
problemElements = [describeNode(problemNode, 4)];  // במקום 2

// ב-text, הגדל אורך:
text: (node.text || '').slice(0, 100),  // במקום 50
```

### 6.6 השוואת עמודים בין checkpoints

כדי לראות בדיוק מה השתנה בעמוד מסוים בין שני checkpoints:

```javascript
// בסקריפט החיצוני, אחרי קריאת checkpoints:
const pageIdx = 5; // עמוד 6 (0-based)
const cp1_page6 = checkpoints[0].issues.find(i => i.pageIdx === pageIdx);
const cp3_page6 = checkpoints[2].issues.find(i => i.pageIdx === pageIdx);

// השווה pageElements בין cp1 ל-cp3
const cp1_elements = cp1_page6?.pageElements || [];
const cp3_elements = cp3_page6?.pageElements || [];

// מצא אלמנטים שנוספו/השתנו
for (const el of cp3_elements) {
    const prev = cp1_elements.find(e => e.type === el.type && e.rect?.y === el.rect?.y);
    if (!prev) console.log('NEW:', el.type, el.rect);
    else if (prev.rect?.h !== el.rect?.h) console.log('CHANGED:', el.type, 'h:', prev.rect?.h, '→', el.rect?.h);
}
```

---

## 7. מגבלות נוכחיות

1. **4 checkpoints גלובליים בלבד** — לא תופס בעיות שנוצרות בתוך הלולאה הראשית (בין עמוד לעמוד). פתרון: סעיף 6.1.

2. **ביצועים** — כל checkpoint מפעיל `extractGeometry()` + `auditGeometry()` שכוללים `getBoundingClientRect()` (layout flush). זה לוקח ~100-300ms לכל checkpoint. עם 4 checkpoints, זה מוסיף ~1-2 שניות לעימוד.

3. **אין השוואה אוטומטית של pageElements בין checkpoints** — הנתונים נשמרים, אבל הסקריפט החיצוני לא משווה אותם אוטומטית. פתרון: סעיף 6.6.

4. **אין מיפוי מספר עמוד מלא → מבודד** — כשבודקים את המסמך המלא (79 פרקים), מספר העמוד של בעיה הוא גלובלי. בבדיקה המבודדת, המספר מתחיל מ-1. פתרון: להריץ קודם את הפרק המבודד, למצוא את הבעיה לפי kind+severity (לא לפי מספר עמוד), ואז להריץ step-by-step.

5. **אין תמיכה בבידוד אוטומטי** — המשתמש צריך לציין את מספר הפרק ידנית. פתרון עתידי: סקריפט שקורא את תוצאות ה-baseline, מוצא פרקים עם בעיות, ומריץ step-by-step על כל אחד.

---

## 8. דוגמה מעשית — פרק 9, עמוד 6

### הבעיה
ב-checkpoint 3 (after-rebalance2), מופיעות 2 בעיות חדשות בעמוד 6:
- `containment` (medium) — block-2col חורג 63.6px מ-body-flow
- `imbalance` (medium) — פער 66px בין טור ימין (355px) ושמאל (289px)

### האבחון

| שלב | pageCount | בעיות בעמוד 6 | מסקנה |
|-----|-----------|---------------|-------|
| after-initial-layout | 19 | 0 | עמוד 6 קיים ותקין |
| after-cross-paragraph-parens | 19 | 0 | אין שינוי |
| **after-rebalance2** | **19** | **2** | **rebalance2 גרם לבעיות!** |
| after-page-height | 19 | 2 | אין שינוי (page-height כבוי) |

**סיווג:** מקרה ב' — "היה כראוי ואז נוצרה". העמוד היה קיים (pageCount=19 בכל השלבים) ותקין, אבל rebalance2 שינה את גובה הטורים ויצר חריגה.

### האלמנט הבעייתי (מתועד)

```json
{
  "type": "block-2col",
  "rect": {"x": 57, "y": 5769, "w": 680, "h": 355},
  "childCount": 4,
  "children": [
    {"type": "margin-col", "h": 355},
    {"type": "column", "h": 355, "text": ""},  // טור ימין
    {"type": "column", "h": 289, "text": ""},  // טור שמאל — קצר ב-66px!
    {"type": "margin-col", "h": 355}
  ]
}
```

### כל האלמנטים בעמוד 6 (מתועד)

```
wrapper      y=5719  h=1009  bottom=6728
body-flow    y=5769  h=915   bottom=6684  ← גבול הטור
block-2col   y=5769  h=355   bottom=6124  ← הבלוק הראשון
  column(R)  y=5769  h=355   bottom=6124  ← טור ימין
  column(L)  y=5769  h=289   bottom=6059  ← טור שמאל (קצר!)
block-h3-span y=6124 h=34    bottom=6158  ← כותרת H3
block-2col   y=6158  h=586   bottom=6744  ← הבלוק השני — חורג 60px מ-body-flow!
```

**מסקנה:** הבלוק השני (block-2col, h=586, bottom=6744) חורג מ-body-flow (bottom=6684) ב-60px. ה-imbalance בבלוק הראשון (R=355, L=289, diff=66px) נוצר על-ידי rebalance2.

---

## 9. כללי זהב

1. **השווה pageCount תמיד** — אם pageCount גדל בין checkpoints, הבעיות החדשות עשויות להיות "לא יכלה להופיע קודם".
2. **השווה pageIdx** — אם pageIdx ≥ pageCount הקודם, העמוד לא היה קיים.
3. **השווה problemElement.rect** — אם ה-rect השתנה בין checkpoints, השלב שינה את האלמנט.
4. **השווה pageElements** — אם נוספו/נעלמו אלמנטים, השלב שינה את מבנה העמוד.
5. **בדוק children** — אם childCount השתנה, השלב הוסיף/הסיר ילדים.
6. **עדכן worklog** — תעד כל ממצא ב-worklog.md עם Task ID.
