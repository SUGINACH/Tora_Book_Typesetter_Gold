/* ==========================================================================
   generate-test-triggers.js — יוצר קבצי טקסט בדיקה שמכריחים הופעת כל הבעיות
   --------------------------------------------------------------------------
   מסמך 1: test-all-triggers.txt — פרק אחד עם כל הטריגרים יחד
   מסמך 2: test-trigger-*.txt — פרקים נפרדים לכל סוג בעיה
   
   עקרונות:
   1. כל טריגר חוזר במיקומים שונים (תחילת/אמצע/סוף פרק, עמוד ראשון/אחרון)
   2. אין תלות בגופן מסוים — כל הטריגרים מבוססי מבנה טקסט
   3. כל טריגר מתועד עם הערה: באיזו בעיה אמורה להיווצר
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'test-triggers');

// ════════════════════════════════════════════════════════════════════════
// מטא-נתונים לפרק (כותרות, שם ספר, וכו')
// ════════════════════════════════════════════════════════════════════════
function bookMeta(title) {
    return [
        'שם הספר - ספר בדיקת טריגרים',
        'נושא - בדיקות עימוד',
        'נושא מפורט - ' + title,
        'פרטי מהדורא - מהדורת בדיקה',
        'שם המחבר - מערכת אוטומטית',
        'מקום ושנת הוצאה - ירושלים | תשפ"ו',
        'שמירת זכויות - כל הזכויות הפקר',
        'פרטי הוצאה לאור - הוצאת בדיקה',
        'פרטי קשר - אין',
        'פרטים נוספים - טקסט לבדיקה בלבד',
    ].join('\n') + '\n';
}

// ════════════════════════════════════════════════════════════════════════
// מחרוזות טקסט לשימוש חוזר
// ════════════════════════════════════════════════════════════════════════

// פסקה רגילה באורך בינוני (כ-5 שורות בעמודה)
const PARA_MED = 'והנה כאן נכתוב פסקה רגילה באורך בינוני אשר תמלא כמה שורות בעמודה המרונדרת, וזאת כדי שנוכל לבדוק את התנהגות העימוד במצב רגיל. הטקסט כאן הוא טקסט תורני לדוגמה שנועד להכיל מספר מילים רב כדי שהשורות יהיו מלאות ונוכל לראות את הפליטה בין הטורים. ולכן נמשיך ונכתוב עוד ועוד מילים בפסקה זו עד שתהיה ארוכה מספיק לבדיקות שונות של איזון טורים וגלישה וכיוצא.';

// פסקה ארוכה מאוד (כ-15 שורות — לטריגר חציית עמוד)
const PARA_LONG = 'והנה זו פסקה ארוכה מאוד אשר נמשך על פני שורות רבות בעמודה ותגרום לחציית העמוד או הטור. ' + PARA_MED + ' ונוסיף עוד טקסט כדי להבטיח שהפסקה תהיה ארוכה מספיק. ' + PARA_MED + ' ועוד נוסיף כדי שתעבור את גבול העמוד בבירור. ' + PARA_MED;

// פסקה ענקית (כ-42 שורות — לטריגר widow בלתי-פתיר)
const PARA_HUGE = PARA_LONG + ' ' + PARA_LONG + ' ' + PARA_LONG + ' ' + PARA_MED + ' ' + PARA_MED + ' ' + PARA_MED;

// פסקה קצרצרה (מילה אחת — לטריגר בלתי-פתיר)
const PARA_ONE_WORD = 'והנה.';

// פסקה קצרה (כ-2 שורות — לטריגר orphan/widow)
const PARA_SHORT = 'והנה פסקה קצרה בת שתי שורות בערך שנועדה לבדיקת orphan.';

// פסקה עם סוגריים עגולות
const PARA_PAREN = 'והנה פסקה שמכילה סוגריים עגולות (וזהו טקסט מוסגר בסוגריים שאמור לקבל עיצוב מיוחד) ולאחריהן טקסט רגיל.';

// פסקה עם סוגריים חוצות (פותחת ולא סוגרת)
const PARA_OPEN_PAREN = 'והנה פסקה שפותחת סוגריים (ולא סוגרת אותן, כדי שהפסקה הבאה תהיה בתוך עומק סוגריים ותקבל עיצוב paren-text.';

// פסקה שסוגרת סוגריים מהפסקה הקודמת
const PARA_CLOSE_PAREN = 'והנה פסקה שסוגרת סוגריים) ולכן היא אמורה להיות מעוטרת ב-paren-text כי היא בתוך עומק סוגריים.';

// פסקה עם הערת שוליים
const PARA_WITH_FOOTNOTE = 'והנה פסקה שמכילה הערת שוליים [וזהו תוכן ההערה שאמור להיות מומר להערת שוליים] ולאחריה טקסט רגיל.';

// פסקה עם מספר הערות שוליים
const PARA_WITH_MANY_FOOTNOTES = 'והנה פסקה [הערה ראשונה] עם [הערה שניה] מספר [הערה שלישית] הערות [הערה רביעית] שוליים [הערה חמישית] בתוכן.';

// ════════════════════════════════════════════════════════════════════════
// בוני פרקים — כל אחד מכריח סוג בעיה אחר
// ════════════════════════════════════════════════════════════════════════

const triggers = {

// ── A. WIDOW / ORPHAN ─────────────────────────────────────────────────
widow_orphan: {
    title: 'בדיקת אלמנה ויתום',
    chapterNum: 1,
    build() {
        const lines = [];
        lines.push('כותרת 1 מספר 1 - בדיקת אלמנה ויתום');
        lines.push('כותרת 2 מספר 1 - אלמנה ויתום בעמודים שונים');
        
        // טריגר A1: פסקה ארוכה שנחתכת בין טורים — המשך של שורה אחת
        lines.push('כותרת 3 מספר 1 - אלמנה חוצת טור');
        lines.push(PARA_LONG); // ייחתך והמשך יהיה שורה אחת בטור השני
        lines.push(PARA_MED);
        
        // טריגר A2: orphan tail בתחילת עמוד חדש
        lines.push('כותרת 3 מספר 2 - יתום בתחילת עמוד');
        lines.push(PARA_HUGE); // ימלא עמוד שלם וישאיר 1-2 שורות לעמוד הבא
        lines.push(PARA_SHORT); // ייתום בתחילת העמוד הבא
        
        // חזרה במיקום שונה (סוף פרק)
        lines.push('כותרת 3 מספר 3 - אלמנה בסוף פרק');
        lines.push(PARA_MED);
        lines.push(PARA_LONG); // ייחתך בסוף הפרק
        lines.push(PARA_SHORT); // המשך קצר
        
        return lines.join('\n');
    }
},

// ── B. SPARSE LAST LINE ────────────────────────────────────────────────
sparse_line: {
    title: 'בדיקת שורה דלילה',
    chapterNum: 2,
    build() {
        const lines = [];
        lines.push('כותרת 1 מספר 2 - בדיקת שורה דלילה');
        lines.push('כותרת 2 מספר 2 - שורה דלילה ב-p-cut');
        
        // טריגר C1: פסקה שנחתכת כשהשורה האחרונה דלילה
        // טקסט שבו השורה האחרונה תהיה מילה אחת קצרה
        lines.push('כותרת 3 מספר 1 - שורה אחרונה דלילה בתחילת פרק');
        lines.push(PARA_MED);
        lines.push('והנה פסקה שתיחתך בדיוק כך שהשורה האחרונה של החלק הראשון תהיה בת מילה אחת או שתיים בלבד, וזאת כדי לבדוק את זיהוי השורה הדלילה. ' + PARA_MED + ' מילה.');
        
        // טריגר C4: paren-text על השורה האחרונה (false positive לשעבר)
        lines.push('כותרת 3 מספר 2 - paren-text על שורה אחרונה');
        lines.push(PARA_OPEN_PAREN);
        lines.push(PARA_CLOSE_PAREN + ' ' + PARA_MED); // paren-text על השורה האחרונה
        
        // חזרה בסוף פרק
        lines.push('כותרת 3 מספר 3 - שורה דלילה בסוף פרק');
        lines.push(PARA_MED);
        lines.push(PARA_MED + ' מילה.');
        
        return lines.join('\n');
    }
},

// ── C. COLUMN IMBALANCE ──────────────────────────────────────────────
imbalance: {
    title: 'בדיקת אי-איזון טורים',
    chapterNum: 3,
    build() {
        const lines = [];
        lines.push('כותרת 1 מספר 3 - בדיקת אי-איזון טורים');
        lines.push('כותרת 2 מספר 3 - אי-איזון מסוגים שונים');
        
        // טריגר D1: כותרת בטור אחד (Δ=22px)
        lines.push('כותרת 3 מספר 1 - כותרת בטור אחד');
        lines.push('כותרת 4 מספר 1 - כותרת שמופיעה בטור אחד בלבד');
        lines.push(PARA_MED);
        lines.push(PARA_MED);
        lines.push(PARA_MED);
        
        // טריגר D4: paren-text שמשנה גובה אחרי איזון
        lines.push('כותרת 3 מספר 2 - paren-text אחרי איזון');
        lines.push(PARA_OPEN_PAREN);
        lines.push(PARA_MED);
        lines.push(PARA_CLOSE_PAREN);
        lines.push(PARA_MED);
        
        // טריגר D1: פסקה ענקית בטור אחד
        lines.push('כותרת 3 מספר 3 - פסקה ענקית');
        lines.push(PARA_HUGE); // פסקה אחת ענקית מול מספר פסקאות קטנות
        lines.push(PARA_SHORT);
        lines.push(PARA_SHORT);
        lines.push(PARA_SHORT);
        
        // חזרה בסוף פרק
        lines.push('כותרת 3 מספר 4 - אי-איזון בסוף פרק');
        lines.push(PARA_MED);
        lines.push('כותרת 5 מספר 1 - כותרת משנה');
        lines.push(PARA_MED);
        
        return lines.join('\n');
    }
},

// ── D. OVERFLOW / CONTAINMENT ─────────────────────────────────────────
overflow: {
    title: 'בדיקת גלישה',
    chapterNum: 4,
    build() {
        const lines = [];
        lines.push('כותרת 1 מספר 4 - בדיקת גלישה');
        lines.push('כותרת 2 מספר 4 - גלישות מסוגים שונים');
        
        // טריגר E2: עמוד עם הערות שוליים שגולשות
        lines.push('כותרת 3 מספר 1 - גלישת הערות שוליים');
        lines.push(PARA_WITH_MANY_FOOTNOTES); // מספר הערות שיגרמו ל-fnArea להיות גדול
        lines.push(PARA_WITH_FOOTNOTE);
        lines.push(PARA_WITH_FOOTNOTE);
        lines.push(PARA_WITH_FOOTNOTE);
        lines.push(PARA_WITH_FOOTNOTE);
        lines.push(PARA_WITH_FOOTNOTE);
        lines.push(PARA_WITH_FOOTNOTE);
        lines.push(PARA_WITH_FOOTNOTE);
        lines.push(PARA_WITH_FOOTNOTE);
        lines.push(PARA_WITH_FOOTNOTE);
        
        // טריגר E1: פסקה ארוכה שגולשת לאזור הערות
        lines.push('כותרת 3 מספר 2 - גלישה לאזור הערות');
        lines.push(PARA_HUGE); // יגלוש מ-body-flow
        lines.push(PARA_WITH_FOOTNOTE);
        
        // חזרה
        lines.push('כותרת 3 מספר 3 - גלישה בסוף פרק');
        lines.push(PARA_LONG);
        lines.push(PARA_WITH_MANY_FOOTNOTES);
        
        return lines.join('\n');
    }
},

// ── E. PAGE UNDERFILL ────────────────────────────────────────────────
page_underfill: {
    title: 'בדיקת עמוד דליל',
    chapterNum: 5,
    build() {
        const lines = [];
        lines.push('כותרת 1 מספר 5 - בדיקת עמוד דליל');
        lines.push('כותרת 2 מספר 5 - עמודים דלילים');
        
        // טריגר F4: פסקה ארוכה שלא משאירה מקום לפסקה הבאה
        lines.push('כותרת 3 מספר 1 - עמוד דליל מפסקה ארוכה');
        lines.push(PARA_HUGE); // תמלא עמוד שלם
        lines.push(PARA_SHORT); // תשאיר עמוד הבא ריק ברובו
        
        // טריגר F1: עמוד לפני H3 שנשאר קצר
        lines.push('כותרת 3 מספר 2 - עמוד קצר לפני H3');
        lines.push(PARA_SHORT);
        lines.push(PARA_SHORT);
        lines.push('כותרת 3 מספר 3 - H3 שדוחק את הקודם'); // H3 שדוחק
        
        // חזרה
        lines.push(PARA_MED);
        lines.push(PARA_LONG);
        lines.push(PARA_SHORT);
        
        return lines.join('\n');
    }
},

// ── F. HEADING ESCORT ────────────────────────────────────────────────
heading_escort: {
    title: 'בדיקת כותרת בתחתית טור',
    chapterNum: 6,
    build() {
        const lines = [];
        lines.push('כותרת 1 מספר 6 - בדיקת כותרת בתחתית טור');
        lines.push('כותרת 2 מספר 6 - כותרות בתחתית טור');
        
        // טריגר G1: כותרת בסוף טור בלי טקסט אחריה
        lines.push('כותרת 3 מספר 1 - כותרת בסוף טור');
        lines.push(PARA_MED);
        lines.push(PARA_MED);
        lines.push(PARA_MED);
        lines.push(PARA_MED);
        lines.push('כותרת 4 מספר 1 - כותרת בסוף טור בלי טקסט'); // תהיה בסוף הטור
        
        // טריגר G2: כותרת עם < 2 שורות אחריה
        lines.push('כותרת 3 מספר 2 - כותרת עם פחות משתי שורות');
        lines.push(PARA_MED);
        lines.push(PARA_MED);
        lines.push('כותרת 5 מספר 1 - כותרת עם שורה אחת אחריה');
        lines.push(PARA_SHORT); // רק שורה אחת אחרי הכותרת
        lines.push(PARA_MED);
        
        // חזרה בסוף פרק
        lines.push(PARA_MED);
        lines.push(PARA_MED);
        lines.push('כותרת 6 מספר 1 - כותרת בסוף פרק');
        
        return lines.join('\n');
    }
},

// ── G. SETTINGS / CONVERSION VERIFICATION ───────────────────────────
settings_conversion: {
    title: 'בדיקת המרות והגדרות',
    chapterNum: 7,
    build() {
        const lines = [];
        lines.push('כותרת 1 מספר 7 - בדיקת המרות');
        lines.push('כותרת 2 מספר 7 - המרות והגדרות');
        
        // טריגר L7: H7 שאמור להיות מומר ל-side-note
        lines.push('כותרת 3 מספר 1 - H7 לכותרת צד');
        lines.push('כותרת 7 מספר 1 - זוהי כותרת צד שאמורה להיות מומרת להערת שוליים');
        lines.push(PARA_MED);
        lines.push('כותרת 7 מספר 2 - כותרת צד שניה לבדיקה');
        lines.push(PARA_MED);
        lines.push('כותרת 7 מספר 3 - כותרת צד שלישית לבדיקה');
        lines.push(PARA_MED);
        
        // טריגר L8: סוגריים מרובעות שאמורות להיות מומרות להערות
        lines.push('כותרת 3 מספר 2 - סוגריים מרובעות להערות');
        lines.push(PARA_WITH_FOOTNOTE);
        lines.push(PARA_WITH_MANY_FOOTNOTES);
        lines.push(PARA_WITH_FOOTNOTE);
        
        // טריגר M1: paren-text על פסקה לא-מוסגרת
        lines.push('כותרת 3 מספר 3 - paren-text על פסקה לא-מוסגרת');
        lines.push(PARA_OPEN_PAREN); // פותח סוגריים
        lines.push(PARA_MED); // פסקה רגילה שתהיה בתוך עומק סוגריים
        lines.push(PARA_CLOSE_PAREN); // סוגר סוגריים
        
        // טריגר M2: dropword על פסקת סגירת סוגריים
        lines.push('כותרת 3 מספר 4 - dropword על פסקת סגירה');
        lines.push(PARA_OPEN_PAREN);
        lines.push(PARA_MED);
        lines.push(PARA_CLOSE_PAREN); // אמור להיות בלי dropword
        
        // חזרה
        lines.push('כותרת 3 מספר 5 - חזרה על המרות');
        lines.push('כותרת 7 מספר 4 - כותרת צד נוספת');
        lines.push(PARA_WITH_FOOTNOTE);
        
        return lines.join('\n');
    }
},

// ── H. UNSOLVABLE CASES ──────────────────────────────────────────────
unsolvable: {
    title: 'בדיקת מקרים בלתי-פתירים',
    chapterNum: 8,
    build() {
        const lines = [];
        lines.push('כותרת 1 מספר 8 - בדיקת מקרים בלתי-פתירים');
        lines.push('כותרת 2 מספר 8 - מקרים שאי אפשר לפתור');
        
        // טריגר S1: פסקה בת מילה אחת
        lines.push('כותרת 3 מספר 1 - פסקה בת מילה אחת');
        lines.push(PARA_ONE_WORD);
        lines.push(PARA_MED);
        
        // טריגר S2: פסקה ענקית (800+ מילים)
        lines.push('כותרת 3 מספר 2 - פסקה ענקית');
        lines.push(PARA_HUGE + ' ' + PARA_HUGE); // כ-84 שורות
        
        // טריגר S4: כותרת + פסקה קצרצרה
        lines.push('כותרת 3 מספר 3 - כותרת ופסקה קצרה');
        lines.push('כותרת 4 מספר 1 - כותרת עם פסקה קצרה');
        lines.push(PARA_SHORT);
        lines.push(PARA_MED);
        
        // טריגר S6: רצף כותרות בלי טקסט
        lines.push('כותרת 3 מספר 4 - רצף כותרות');
        lines.push('כותרת 4 מספר 2 - כותרת ראשונה');
        lines.push('כותרת 5 מספר 1 - כותרת שניה');
        lines.push('כותרת 6 מספר 1 - כותרת שלישית');
        lines.push(PARA_MED);
        
        return lines.join('\n');
    }
},

// ── I. CONFLICTS / TRADEOFFS ─────────────────────────────────────────
conflicts: {
    title: 'בדיקת קונפליקטים',
    chapterNum: 9,
    build() {
        const lines = [];
        lines.push('כותרת 1 מספר 9 - בדיקת קונפליקטים');
        lines.push('כותרת 2 מספר 9 - קונפליקטים בין בעיות');
        
        // טריגר O1: תיקון widow יוצר sparse p-cut
        lines.push('כותרת 3 מספר 1 - תיקון widow יוצר sparse');
        lines.push(PARA_LONG); // ייחתך, והמשך יהיה widow
        lines.push(PARA_SHORT); // widow — תיקון יזיז מילים ויצור sparse
        
        // טריגר O4: כותרת → imbalance → sparse
        lines.push('כותרת 3 מספר 2 - כותרת יוצרת imbalance');
        lines.push(PARA_MED);
        lines.push('כותרת 5 מספר 1 - כותרת בטור אחד');
        lines.push(PARA_MED);
        lines.push(PARA_MED);
        
        // טריגר O6: הגנת סוגריים נוגדת widow
        lines.push('כותרת 3 מספר 3 - הגנת סוגריים נוגדת widow');
        lines.push(PARA_MED);
        lines.push('והנה פסקה עם הערת שוליים [הערה] שנחתכת [בין הסוגריים] ואמורה ליצור קונפליקט. ' + PARA_MED);
        
        return lines.join('\n');
    }
},

};

// ════════════════════════════════════════════════════════════════════════
// פרק משולב — כל הטריגרים יחד בפרק אחד
// ════════════════════════════════════════════════════════════════════════
function buildCombinedChapter() {
    const lines = [];
    lines.push('כותרת 1 מספר 1 - פרק משולב לכל הטריגרים');
    lines.push('כותרת 2 מספר 1 - כל הטריגרים בפרק אחד');
    
    let sectionNum = 1;
    for (const [key, trigger] of Object.entries(triggers)) {
        // הוסף H3 לכל קבוצת טריגרים
        lines.push(`כותרת 3 מספר ${sectionNum} - ${trigger.title} (משולב)`);
        sectionNum++;
        
        // בנה את הטקסט של הטריגר (ללא הכותרות החיצוניות)
        const triggerText = trigger.build();
        const triggerLines = triggerText.split('\n').filter(l => 
            !l.startsWith('כותרת 1 ') && 
            !l.startsWith('כותרת 2 ') &&
            !l.startsWith('שם ה') &&
            !l.startsWith('נושא') &&
            !l.startsWith('פרטי') &&
            !l.startsWith('שמירת') &&
            !l.startsWith('מקום ושנת')
        );
        lines.push(...triggerLines);
    }
    
    return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════
// יצירת קבצים
// ════════════════════════════════════════════════════════════════════════

// צור תיקייה
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// מסמך 1: פרק משולב עם כל הטריגרים
const combinedText = bookMeta('פרק משולב לכל הטריגרים') + buildCombinedChapter();
fs.writeFileSync(path.join(OUTPUT_DIR, 'test-all-triggers.txt'), combinedText, 'utf8');
console.log('נוצר: test-all-triggers.txt');

// מסמך 2: פרקים נפרדים לכל סוג בעיה
for (const [key, trigger] of Object.entries(triggers)) {
    const text = bookMeta(trigger.title) + trigger.build();
    const filename = `test-trigger-${key}.txt`;
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), text, 'utf8');
    console.log(`נוצר: ${filename}`);
}

// מסמך תיעוד
const docLines = [
    '# תכנית טקסט טריגרים לבדיקת עימוד',
    '',
    '## מטרה',
    'קבצי טקסט אלה מכריחים הופעת כל הבעיות שדווחו אי פעם במערכת העימוד.',
    'הרצת הבדיקה הגיאוממטרית על קבצים אלה תגלה אם ה-audit תופס את כל הבעיות.',
    '',
    '## קבצים',
    '',
    '### test-all-triggers.txt',
    'פרק משולב עם כל הטריגרים יחד — בודק אינטראקציות בין בעיות.',
    '',
    '### test-trigger-*.txt',
    'פרקים נפרדים — כל אחד מכריח סוג בעיה אחד:',
    '',
];

for (const [key, trigger] of Object.entries(triggers)) {
    docLines.push(`- **test-trigger-${key}.txt** — ${trigger.title}`);
}

docLines.push('', '## עקרונות', '');
docLines.push('1. כל טריגר חוזר במיקומים שונים (תחילת/אמצע/סוף פרק)');
docLines.push('2. אין תלות בגופן — כל הטריגרים מבוססי מבנה טקסט');
docLines.push('3. כל טריגר מתועד עם הערה איזו בעיה אמורה להיווצר');
docLines.push('4. המסמך המשולב בודק אינטראקציות בין בעיות (קונפליקטים)');

fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), docLines.join('\n'), 'utf8');
console.log('נוצר: README.md');

console.log(`\nסה"כ: ${Object.keys(triggers).length + 1} קבצים נוצרו ב-${OUTPUT_DIR}`);
