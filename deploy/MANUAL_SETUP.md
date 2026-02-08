# راهنمای نصب دستی سرور (Manual Server Setup)

این راهنما برای سیستم‌عامل **Ubuntu 20.04** یا **22.04** نوشته شده است. تمام دستورات را در ترمینال سرور خود اجرا کنید.

## پیش‌نیازها
1. یک سرور مجازی (VPS) با سیستم عامل اوبونتو.
2. دسترسی `root` یا کاربری با دسترسی `sudo`.
3. یک دامنه (Domain) که به IP سرور شما متصل شده باشد.

---

## قدم ۱: آپدیت کردن سیستم
ابتدا مخازن سیستم را آپدیت کنید:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential nginx ufw
```

## قدم ۲: نصب Node.js
ما از نسخه LTS (نسخه ۲۰) استفاده می‌کنیم:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

برای اطمینان از نصب:
```bash
node -v
npm -v
```

## قدم ۳: نصب و کانفیگ PostgreSQL
دیتابیس را نصب کنید:

```bash
sudo apt install -y postgresql postgresql-contrib
```

حالا باید دیتابیس و کاربر مخصوص برنامه را بسازید.
**نکته مهم:** به جای `secure_pass` حتما یک رمز عبور قوی بگذارید و آن را یادداشت کنید.

```bash
sudo -u postgres psql
```

داخل محیط `psql` دستورات زیر را خط به خط اجرا کنید:

```sql
CREATE USER telegram WITH PASSWORD 'secure_pass';
CREATE DATABASE telegram_db OWNER telegram;
ALTER USER telegram CREATEDB;
\q
```

## قدم ۴: انتقال فایل‌ها و نصب وابستگی‌ها
فرض بر این است که فایل‌های پروژه را در مسیر `/var/www/telegram-app` قرار می‌دهید.

1. پوشه را بسازید و فایل‌ها را منتقل کنید (از طریق FTP یا Git).
2. وارد پوشه شوید:

```bash
cd /var/www/telegram-app
```

3. نصب پکیج‌های NPM:

```bash
npm install
```

4. بیلد کردن فرانت‌اند:

```bash
npm run build
```

## قدم ۵: تنظیمات نهایی پروژه
قبل از اجرای سرویس‌ها، باید مشخصات دیتابیس را در فایل کانفیگ وارد کنید.

1. فایل `deploy/ecosystem.config.cjs` را باز کنید (دقت کنید پسوند فایل **cjs** است):
```bash
nano deploy/ecosystem.config.cjs
```

2. مقدار `DATABASE_URL` را پیدا کنید و اگر در قدم ۳ رمز عبور یا نام کاربری دیگری انتخاب کردید، اینجا اصلاح کنید.
فرمت: `postgres://USER:PASSWORD@localhost:5432/DB_NAME`

## قدم ۶: تنظیم PM2 (مدیریت پروسه‌ها)
PM2 باعث می‌شود سرویس‌های شما همیشه روشن بمانند.

1. نصب PM2:
```bash
sudo npm install -g pm2
```

2. اجرای سرویس‌ها (با استفاده از فایل cjs):
```bash
pm2 start deploy/ecosystem.config.cjs
```

3. ذخیره وضعیت برای اجرا پس از ریستارت سرور:
```bash
pm2 save
pm2 startup
```
(دستوری که `pm2 startup` به شما می‌دهد را کپی و اجرا کنید).

## قدم ۷: تنظیم Nginx (Reverse Proxy)
باید Nginx را تنظیم کنید تا درخواست‌ها را به پورت‌های صحیح هدایت کند.

1. فایل کانفیگ موجود در پروژه را به Nginx منتقل کنید:
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/telegram
```

2. **ویرایش فایل:** فایل را باز کنید و `example.com` را به دامنه خودتان تغییر دهید:
```bash
sudo nano /etc/nginx/sites-available/telegram
```

3. فعال‌سازی سایت:
```bash
sudo ln -s /etc/nginx/sites-available/telegram /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
```

4. تست و ریستارت Nginx:
```bash
sudo nginx -t
sudo systemctl restart nginx
```

## قدم ۸: تنظیم فایروال
پورت‌های وب و SSH را باز کنید:

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

## قدم ۹: (اختیاری) نصب SSL رایگان
برای https شدن سایت از Certbot استفاده کنید:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---
**تبریک!** سرویس شما الان باید روی دامنه شما در دسترس باشد.