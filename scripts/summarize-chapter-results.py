#!/usr/bin/env python3
"""
summarize-chapter-results.py — סיכום תוצאות בדיקות פרקים
קורא את כל קבצי ה-JSON ב-../Tora_Book_Typesetter_Gold/scripts/chapter-results/
ומדפיס סיכום מצטבר + רשימת פרקים בעייתיים.

שימוש:
    python3 summarize-chapter-results.py
    python3 summarize-chapter-results.py --detailed  # כולל פירוט issues
"""

import json
import os
import sys
import glob

RESULTS_DIR = os.environ.get('RESULTS_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'chapter-results'))

def main():
    detailed = '--detailed' in sys.argv

    if not os.path.isdir(RESULTS_DIR):
        print(f'תיקיית תוצאות לא נמצאה: {RESULTS_DIR}')
        sys.exit(1)

    chapter_files = sorted(glob.glob(os.path.join(RESULTS_DIR, 'chapter-*.json')))
    if not chapter_files:
        print(f'לא נמצאו קבצי תוצאות ב-{RESULTS_DIR}')
        sys.exit(1)

    print(f'סיכום {len(chapter_files)} פרקים:\n')
    print(f"{'פרק':>4} | {'עמודים':>6} | {'total':>5} | {'high':>4} | {'med':>3} | {'low':>3} | הערה")
    print('-' * 75)

    totals = {'high': 0, 'medium': 0, 'low': 0, 'total': 0, 'pages': 0, 'errors': 0}
    problem_chapters = []
    chapter_data = []

    for cf in chapter_files:
        try:
            with open(cf, 'r', encoding='utf-8') as f:
                r = json.load(f)
        except Exception as e:
            print(f'שגיאה בקריאת {cf}: {e}')
            continue

        cn = r.get('chapterNum', '?')
        title = r.get('title', '')
        pages = r.get('pageCount', 0)
        s = r.get('geomSummary') or {}
        high = s.get('high', 0)
        med = s.get('medium', 0)
        low = s.get('low', 0)
        total = s.get('total', 0)
        err = r.get('error')

        totals['high'] += high
        totals['medium'] += med
        totals['low'] += low
        totals['total'] += total
        totals['pages'] += pages
        if err:
            totals['errors'] += 1

        note = ''
        if err:
            note = f'שגיאה: {err[:30]}'
        elif high > 0:
            note = f'{high} high issues'

        print(f"{str(cn):>4} | {pages:>6} | {total:>5} | {high:>4} | {med:>3} | {low:>3} | {note}")

        chapter_data.append({
            'num': cn, 'pages': pages, 'high': high, 'medium': med, 'low': low,
            'total': total, 'error': err, 'title': title,
            'high_issues': [i for i in (r.get('geomIssues') or []) if i.get('severity') == 'high']
        })

        if high > 0 or err:
            problem_chapters.append({'num': cn, 'high': high, 'medium': med, 'low': low, 'error': err, 'title': title, 'high_issues': chapter_data[-1]['high_issues']})

    print('-' * 75)
    print(f"{'סה"כ':>4} | {totals['pages']:>6} | {totals['total']:>5} | {totals['high']:>4} | {totals['medium']:>3} | {totals['low']:>3} | errors={totals['errors']}")
    print()

    if not problem_chapters:
        print('✓ אין פרקים בעייתיים (high=0 ו-ללא שגיאות)')
    else:
        print(f'\n{len(problem_chapters)} פרקים בעייתיים:')
        for p in problem_chapters:
            err_part = f' error={p["error"][:50]}' if p['error'] else ''
            print(f'\n  פרק {p["num"]}: high={p["high"]} medium={p["medium"]} low={p["low"]}{err_part}')
            print(f'    title: {p["title"][:80]}')
            if detailed and p['high_issues']:
                print(f'    high issues:')
                for i in p['high_issues'][:15]:
                    kind = i.get('kind', '?')
                    desc = i.get('description', '')[:80]
                    print(f'      - [{kind}] {desc}')
                if len(p['high_issues']) > 15:
                    print(f'      ... ועוד {len(p["high_issues"]) - 15} high issues')

    # כתוב קובץ סיכום master
    summary_path = os.path.join(RESULTS_DIR, '_master-summary.json')
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump({
            'totals': totals,
            'problemChapters': [{'num': p['num'], 'high': p['high'], 'medium': p['medium'], 'low': p['low'], 'error': p['error'], 'title': p['title']} for p in problem_chapters],
            'allChapters': [{'num': c['num'], 'pages': c['pages'], 'high': c['high'], 'medium': c['medium'], 'low': c['low']} for c in chapter_data],
        }, f, ensure_ascii=False, indent=2)
    print(f'\nסיכום master נשמר: {summary_path}')

if __name__ == '__main__':
    main()
