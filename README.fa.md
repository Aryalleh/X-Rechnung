<div dir="rtl">

# X-Rechnung — سیستم فاکتور

سیستم کامل صدور، ارسال، دریافت و آرشیو فاکتور روی **Cloudflare Workers**، مخصوص
**فریلنسر / Kleinunternehmer آلمان (§۱۹ UStG)** و همچنین **فاکتور فارسی برای ایران
(ریال/تومان)**. پنل مدیریت فارسی و راست‌به‌چپ.

> این نرم‌افزار برای نگهداری قابل‌پیگیری اسناد طراحی شده، اما **جایگزین مشاوره
> مالیاتی نیست** و ادعای «GoBD-certified» ندارد.

---

## حالت‌های نصب (فقط فارسی / فقط آلمانی / جامع)

هنگام راه‌اندازی اولیه، در گام «حساب مالک» یکی از این سه حالت را انتخاب می‌کنی
(بعداً از **تنظیمات → پول ملی و حذف صفر** قابل تغییر است):

| حالت | زبان پیش‌فرض فاکتور | ارز پیش‌فرض | توضیح |
|---|---|---|---|
| **فقط فارسی** (`fa`) | فارسی | تومان (IRT) | قالب فارسی «فاکتور فروش»، بدون §۱۹ آلمانی |
| **فقط آلمانی** (`de`) | آلمانی | یورو (EUR) | قالب آلمانی + متن §۱۹ Kleinunternehmer |
| **جامع** (`both`) | آلمانی | یورو | هر دو زبان و همهٔ ارزها در دسترس |

حالت نصب فقط پیش‌فرض‌ها و گزینه‌های نمایشی را تعیین می‌کند؛ داده و منطق مشترک است.

## ارز و پول ملی

- ارزها: **EUR** (سنت)، **IRR/ریال** و **IRT/تومان** (عدد صحیح، بدون واحد خرد) و
  واحد جدید پس از حذف صفر یعنی **IRT_NEW** با واحد خرد **قران**.
- همهٔ مبالغ به‌صورت **عدد صحیح در کوچک‌ترین واحد همان ارز** ذخیره می‌شوند (بدون
  اعشار شناور). محاسبات فقط در بک‌اند انجام می‌شود.
- **حذف صفر (مصوبه مجلس):** ۱ واحد جدید = ۱۰٬۰۰۰ ریال قدیم، «قران» واحد خرد.
  چون تاریخ اجرا و نسبت دقیق قران هنوز قطعی نیست، این قابلیت **به‌صورت پیش‌فرض
  غیرفعال، بدون تاریخ و قابل‌تنظیم** است و **هرگز خودکار روی فاکتورهای قبلی اعمال
  نمی‌شود**. فاکتور صادرشده همیشه با ارز ثبت‌شدهٔ خودش می‌ماند (تغییرناپذیر).

## قابلیت‌های اصلی

- شماره‌گذاری بدون شکاف با Durable Object و دفترچهٔ RESERVED/CONFIRMED/VOID.
- فرایند صدور Idempotent: Snapshot → JSON استاندارد → SHA-256 → PDF (Browser Run)
  → آرشیو تغییرناپذیر در R2 → ISSUED. اگر صدور شکست بخورد، شماره VOID و دیگر
  استفاده نمی‌شود.
- دریافت E-Rechnung: XRechnung (UBL/CII) و ZUGFeRD، از طریق آپلود و Email Worker،
  با Parser امن در برابر XXE، اعتبارسنجی پایه و Adapter رسمی KoSIT.
- همهٔ تنظیمات از پنل قابل انجام است؛ هیچ چیز تجاری Hardcode نیست. حتی **توکن
  راه‌اندازی** موقع اولین اجرا ساخته و فقط یک بار در لاگ چاپ می‌شود.

## نصب گام‌به‌گام

<div dir="ltr">

```bash
# 1) نصب وابستگی‌ها
npm install

# 2) ورود به Cloudflare
npx wrangler login

# 3) ساخت D1 در ناحیهٔ اتحادیه اروپا و درج database_id در wrangler.jsonc
npx wrangler d1 create x-rechnung --location=weur

# 4) فعال‌سازی R2 در داشبورد، سپس ساخت باکت در EU
npx wrangler r2 bucket create x-rechnung-archive --jurisdiction eu

# 5) صف‌ها
npx wrangler queues create x-rechnung-documents
npx wrangler queues create x-rechnung-documents-dlq

# 6) Secret اختیاری برای رمزگذاری تنظیمات حساس
npx wrangler secret put DATA_ENCRYPTION_KEY   # openssl rand -base64 32

# 7) اجرای Migrationها
npm run migrate:remote
npm run seed:local            # دادهٔ نمونه (قالب‌ها + KD-0001) — اختیاری

# 8) اجرای محلی / تست / بیلد / انتشار
npm run dev
npm test
npm run build
npm run deploy
```

</div>

### راه‌اندازی اولیه (بدون Owner از پیش تعیین‌شده)

در اولین اجرا وضعیت `SETUP_REQUIRED` است و **توکن یک‌بارمصرف فقط در لاگ** دیده می‌شود:

<div dir="ltr">

```bash
npx wrangler tail
# => "X-RECHNUNG FIRST-RUN SETUP TOKEN (shown once): ...."
```

</div>

برنامه را روی آدرس `workers.dev` باز کن → `/setup` → توکن را وارد کن → **حالت نصب**
(فارسی/آلمانی/جامع)، ایمیل مالک، اطلاعات Cloudflare و دامنه را وارد کن. پس از تکمیل،
مسیر `/setup` بسته می‌شود.

## نکتهٔ منابع کم (VPS با رم ۱ گیگ)

نصب/بیلد روی رم ۱ گیگ بدون swap ممکن است kill شود. یک swap ۲ گیگ بساز:

<div dir="ltr">

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
export NODE_OPTIONS="--max-old-space-size=512"
npm ci
```

</div>

## اسناد بیشتر

- `README.md` (آلمانی) — راهنمای اصلی
- `ARCHITECTURE.md` · `SECURITY.md`
- `VERFAHRENSDOKUMENTATION.md` · `DATA_EXPORT.md` · `EINVOICE_VALIDATION.md`

</div>
