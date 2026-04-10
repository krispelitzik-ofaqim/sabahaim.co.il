# מפת האפליקציה — סבא חיים / הצופן הסודי

מסמך זה הוא מפה מקיפה של כל הרכיבים באפליקציה.
מטרתו לאפשר חזרה מהירה לכל חלק בקוד בלי לחפש.

**עודכן לאחרונה:** 2026-04-10
**נתיב פרויקט:** `/Users/itzikk/Desktop/sabahaim`
**URL מקומי:** http://localhost:3000

---

## סקירה כללית

אתר ספר ילדים אינטראקטיבי בעברית. הילד מקבל קוד גישה אישי עם הספר המודפס,
מזין אותו באתר, ועובר חוויה שמסתיימת בפתיחת "כספת" עם מכתב אישי ותעודה להדפסה.

**רכיבים עיקריים:**
- שרת Node.js / Express
- SPA בקובץ HTML יחיד (`public/index.html`)
- אחסון ב-JSON files (ללא מסד נתונים)
- פאנל ניהול פנימי (admin) — **אין לשנות בלי אישור מפורש, מכיל קודים של ספרים מודפסים**

---

## מבנה תיקיות

```
sabahaim/
├── CLAUDE.md                    # הוראות לקלוד על הפרויקט
├── server.js                    # שרת Express — כל הלוגיקה של ה-backend
├── package.json                 # תלויות: express, cors, dotenv
│
├── public/                      # קבצים סטטיים שנשלחים ללקוח
│   ├── index.html              # כל האפליקציה — SPA עם 10 מסכים
│   └── assets/
│       ├── images/             # תמונות (logo, vault, letter, certificate)
│       ├── css/                # ריק (כל ה-CSS inside index.html)
│       └── js/                 # ריק (כל ה-JS inside index.html)
│
├── data/                        # נתונים דינמיים (נכתבים ע"י השרת)
│   ├── vault.json              # ניסיונות פתיחת כספת
│   ├── leads.json              # משתמשים + היסטוריית אירועים
│   ├── qa.json                 # שאלות ותשובות (ניהול)
│   └── admin_pass.json         # סיסמת אדמין (אם שונתה מה-default)
│
├── vault/                       # קודי גישה (תיקיית כספת)
│   ├── access_codes.json       # קודי משתמשים רגילים (מודפסים בספרים)
│   ├── master_codes.json       # קודי מאסטר (גישה בלתי מוגבלת, ללא טיימר)
│   ├── demo_codes.json         # קודי דמו (להדגמה)
│   ├── כספת נעולה.jpg          # תמונת רפרנס
│   └── כספת פתוחה.jpeg         # תמונת רפרנס
│
├── pages/                       # תכני הספר (50 עמודים)
├── answers/                     # תשובות לחידות
├── cover/                       # כריכה
├── letter/                      # מכתב מסבא חיים
├── certificate/                 # תעודת סיום
├── logo/                        # לוגו ונגזרות
├── טיוטות/                      # טיוטות עבודה
│
├── docs/                        # מסמכי רפרנס (המסמך הזה)
│   └── app-map.md
│
├── node_modules/                # תלויות
└── server/                      # ריק כרגע
```

---

## מסכים (Screens) באפליקציה

כל המסכים חיים בתוך `public/index.html`, כל אחד כ-`<div class="screen" id="screen-...">`.
מעברים בין מסכים דרך `showScreen(id)`.

| מסך | ID | תיאור | מה קורה שם |
|-----|----|----|----|
| 1. שער כניסה | `screen-gate` | המסך הראשון — הזנת קוד + טלפון | משתמש מזין קוד אישי (אות+8ספרות+אות) וטלפון, נשלחת קריאה ל-`/api/gate/verify` |
| 2. כספת סגורה | `screen-vault` | הזנת הקוד הסודי של הכספת | 4 שדות מתכות (ברזל/נחושת/כסף/זהב) + טיימר 10 דק' + 3 ניסיונות |
| 3. כספת פתוחה | `screen-open` | הצלחה — הכספת נפתחה | טיימר 5 דק' לחילוץ המעטפה, אנימציה ירוקה |
| 4. מטריצה / חידות | `screen-matrix` | לוח חידות לעזרה במציאת הקוד | editable grid במצב אדמין |
| 5. אזהרת כספת | `screen-vault-warning` | אחרי נעילה זמנית | 3 אפשרויות: ניסיון חדש, חזרה למטריצה, או נעילה סופית |
| 6. נעילה סופית | `screen-locked` | Game over | ניתן לקבל קוד חדש בתשלום או מתנה |
| 7. מכתב | `screen-letter` | המכתב האישי מסבא חיים | כפתור הדפסה, באנר לרכישת ספרים נוספים |
| 8. תעודה | `screen-certificate` | תעודת סיום להדפסה | כפתור הדפסה |
| 9. בית | `screen-home` | מסך בית אחרי סיום | נקודת חזרה מרכזית |
| 10. ניהול | `screen-admin` | פאנל אדמין **— אסור לשנות בלי אישור** | סטטיסטיקות, קודים, לידים, Q&A, סיסמה |

---

## API Endpoints

כל ה-endpoints מוגדרים ב-[server.js](../server.js).

### Public (ללא אימות)

| Method | נתיב | תיאור | שדות |
|--------|-----|----|----|
| `POST` | `/api/track` | רישום אירוע משתמש | `code`, `event` |
| `POST` | `/api/gate/verify` | אימות קוד גישה + טלפון | `code`, `phone` |
| `POST` | `/api/vault/open` | ניסיון פתיחת כספת | `key`, `iron`, `copper`, `silver`, `gold` |

### Admin (דורש `X-Admin-Token` header או `?token=` בשאילתה)

| Method | נתיב | תיאור |
|--------|-----|----|
| `GET` | `/api/admin/attempts` | כל ניסיונות פתיחת הכספת |
| `GET` | `/api/admin/codes` | כל קודי המשתמשים |
| `POST` | `/api/admin/codes/toggle` | הפעלה/ביטול של קוד |
| `POST` | `/api/admin/codes/generate` | ייצור batch של קודים חדשים |
| `GET` | `/api/admin/codes/batch/:batch` | קבלת קודים לפי מספר batch |
| `GET` | `/api/admin/demo` | קודי דמו |
| `GET` | `/api/admin/master` | קודי מאסטר |
| `GET` | `/api/admin/stats` | סטטיסטיקות כלליות |
| `GET` | `/api/admin/leads` | רשימת לידים (`?status=active\|archived\|trashed`) |
| `POST` | `/api/admin/leads/status` | שינוי סטטוס ליד |
| `POST` | `/api/admin/password` | שינוי סיסמת אדמין |
| `GET` | `/api/admin/qa` | כל פריטי ה-Q&A |
| `POST` | `/api/admin/qa` | הוספת פריט Q&A |
| `POST` | `/api/admin/qa/edit` | עריכת פריט Q&A |
| `POST` | `/api/admin/qa/delete` | מחיקת פריט Q&A |

---

## קבצי נתונים

| קובץ | תוכן | מי כותב | מי קורא |
|------|------|----|----|
| `data/vault.json` | `{ keys, attempts }` — לוג ניסיונות פתיחה | `/api/vault/open` | `/api/admin/attempts` |
| `data/leads.json` | `{ leads: { CODE: {...} } }` — משתמשים + events | `/api/gate/verify`, `/api/track` | `/api/admin/leads`, `/api/admin/stats` |
| `data/qa.json` | `{ items: [...] }` — שאלות ותשובות | `/api/admin/qa/*` | `/api/admin/qa` |
| `data/admin_pass.json` | `{ password: "..." }` — סיסמת אדמין | `/api/admin/password` | `getAdminPass()` |
| `vault/access_codes.json` | `{ codes: [...] }` — קודים מודפסים בספרים | `/api/admin/codes/generate` | `/api/gate/verify` |
| `vault/master_codes.json` | `{ codes: [...] }` — קודי מאסטר | ידני | `/api/gate/verify` |
| `vault/demo_codes.json` | `{ codes: [...] }` — קודי דמו | ידני | `/api/gate/verify` |

**מבנה ליד (`leads.json`):**
```json
{
  "code": "A12345678Z",
  "phone": "050-1234567",
  "firstEntry": "ISO date",
  "lastEntry": "ISO date",
  "gateEntry": true,
  "vaultOpened": false,
  "printedLetter": false,
  "gotCertificate": false,
  "printedCertificate": false,
  "status": "active | archived | trashed",
  "events": [{ "event": "...", "timestamp": "..." }]
}
```

---

## אירועים (Events) שנרשמים

נקראים דרך `trackEvent(name)` ב-`index.html`, נשלחים ל-`/api/track`.

| אירוע | נורה מתי | משפיע על שדה |
|-------|---|---|
| `gate_entry` | כניסה מוצלחת משער הכניסה | — (נספר ב-stats כ-siteEntries) |
| `vault_opened` | פתיחה מוצלחת של הכספת | `vaultOpened = true` |
| `print_letter` | לחיצה על "הדפסת המכתב" | `printedLetter = true` |
| `envelope_extracted` | לחיצה על "חלץ את המעטפה" | `printedLetter = true` |
| `got_certificate` | מעבר למסך התעודה | `gotCertificate = true` |
| `print_certificate` | לחיצה על "הדפסת התעודה" | `printedCertificate = true` |
| `click_purchase` | לחיצה על באנר רכישה | — |
| `click_gift` | לחיצה על באנר מתנה | — |

---

## קוד הכספת (החידה המרכזית)

המשקלים האטומיים של ארבע מתכות, מקודדים קשיח ב-[server.js:73-78](../server.js):

| מתכת | ערך |
|------|-----|
| ברזל (Iron) | `7.87` |
| נחושת (Copper) | `8.96` |
| כסף (Silver) | `10.49` |
| זהב (Gold) | `19.32` |

---

## סוגי קודי גישה

| סוג | פורמט | התנהגות | איפה מנוהל |
|-----|------|----|----|
| **רגיל** | אות + 8 ספרות + אות (ללא I, O) | מודפס בכל ספר, שימוש אחד-רב | `vault/access_codes.json` |
| **מאסטר** | כנ"ל | גישה לא מוגבלת, ללא טיימר ועם ∞ ניסיונות | `vault/master_codes.json` |
| **דמו** | כנ"ל | דומה למאסטר, מסומן כ"דמו" בהודעות | `vault/demo_codes.json` |

ולידציה: `/^[A-Za-z]\d{8}[A-Za-z]$/`
ייצור: מאותיות `ABCDEFGHJKLMNPQRSTUVWXYZ` (ללא I, O)

---

## טכנולוגיה (Tech Stack)

| שכבה | כלי |
|------|-----|
| Backend | Node.js + Express 5.2 |
| אחסון | JSON files (ללא DB) |
| Frontend | HTML/CSS/JS vanilla (בלי React/framework) — SPA בקובץ אחד |
| פונטים | Assistant (Google Fonts) |
| תלויות | `express`, `cors`, `dotenv` |
| גודל index.html | ~138KB |

---

## משתני סביבה (.env)

| משתנה | ברירת מחדל | תפקיד |
|--------|------|----|
| `PORT` | `3000` | פורט השרת |
| `ADMIN_PASSWORD` | `admin123` ⚠️ | סיסמת כניסה לפאנל אדמין |

---

## איך להריץ

```bash
cd ~/Desktop/sabahaim
node server.js
# → http://localhost:3000
```

---

## קבצים כבדים (טעינה איטית)

| קובץ | גודל | הערה |
|------|------|------|
| `public/assets/images/logo.png` | 10 MB | גדול מאוד |
| `public/assets/images/certificate.png` | 8.7 MB | |
| `public/assets/images/letter.png` | 6.2 MB | |
| `public/assets/images/vault-open.jpeg` | 320 KB | תקין |
| `public/assets/images/vault-closed.jpg` | 136 KB | תקין |

סה"כ ~25MB של תמונות שנטענות כרגע ללא cache.

---

## קשרים בין רכיבים (זרימת משתמש)

```
┌──────────────┐
│ screen-gate  │ ← משתמש מזין קוד + טלפון
└──────┬───────┘
       │ POST /api/gate/verify
       ↓ (הצלחה)
┌──────────────┐
│ screen-vault │ ← מזין 4 משקלים אטומיים
│              │   טיימר 10 דק', 3 ניסיונות
└──────┬───────┘
       │ POST /api/vault/open
       ↓
       ├─ (נכון) → screen-open → screen-letter → screen-certificate → screen-home
       │
       └─ (שגוי × 3 או timeout) → screen-vault-warning
                                     ├─ ניסיון נוסף → screen-vault (עם 3 דק')
                                     ├─ עזרה → screen-matrix
                                     └─ נעילה → screen-locked
```

---

## מקומות שבהם כבר זוהו באגים / חולשות

ראה דוח ביקורת (בשיחה, לא נשמר לקובץ).
סיכום קצר של הנושאים הקריטיים:

- **שעון מתהפך בכספת** — דורש `perspective` ב-CSS (לא תוקן כדי לא לסכן את האפליקציה)
- **XSS במטריצה (admin)** — `cell.t` ל-`innerHTML` ללא escape
- **סיסמת ברירת מחדל `admin123`** ב-`server.js:230`
- **טוקן אדמין ב-query string** — חשוף בלוגים
- **Race conditions** ב-I/O סינכרוני של קבצי JSON
- **אין rate limiting** — ניתן לברוט-פורס קודים
- **תמונות ללא cache** — `maxAge: 0`
- **סיסמה ב-plaintext** ב-`admin_pass.json`

---

## מה כן תוקן (2026-04-10)

שינויים אדיטיביים בלבד ב-`public/index.html` — לא נמחק קוד:

1. **נגישות** — הוספת `aria-label` ו-`aria-labelledby` לשדות הקלט של הכספת, gate-code ו-gate-phone.
2. **מקלדות מובייל** — הוספת `inputmode="decimal"` לשדות המתכות, `inputmode="tel"` לטלפון, `inputmode="text"` לקוד.
3. **Touch targets במובייל** — media queries חדשות שמגדילות את שדות הכספת (68×54px ב-`max-width: 480px`, 64×52 ב-`max-width: 360px`).
4. **Focus indicator גלובלי** — `:focus-visible` עם מסגרת זהב לכפתורים ושדות קלט (רק למשתמשי מקלדת).

התוספות ממוקמות ב-[index.html:1436-1478](../public/index.html#L1436-L1478).
