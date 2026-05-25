# Доступы Shipox / Mongo

Этот проект должен читать данные не из браузера, а через ETL-скрипты. Так секреты не попадают на публичную страницу.

## 1. Локальный файл с доступами

Создай файл:

```text
C:\Users\HP\Documents\Codex\workspace\fargo-shipox-dashboard\.env.local
```

Вариант с логином и паролем Shipox:

```env
SHIPOX_USERNAME=
SHIPOX_PASSWORD=
SHIPOX_MARKETPLACE_ID=307345429
SHIPOX_CUSTOMER_ID=
```

Вариант с готовым токеном:

```env
SHIPOX_ID_TOKEN=
SHIPOX_MARKETPLACE_ID=307345429
SHIPOX_CUSTOMER_ID=
```

Mongo:

```env
MONGODB_URI=
MONGODB_DB=zood
MONGODB_ORDERS_COLLECTION=shipoxorders
```

`.env.local` не должен попадать в GitHub.

## 2. Проверить Shipox

```powershell
cd C:\Users\HP\Documents\Codex\workspace\fargo-shipox-dashboard
npm run etl:shipox:probe -- --page-size 5
```

Скрипт делает:

1. `POST https://gateway.fargo.uz/api/v1/authenticate`
2. берет `data.id_token`
3. вызывает `GET https://gateway.fargo.uz/api/v2/admin/orders`
4. сохраняет безопасный отчет:

```text
artifacts\shipox-probe\latest-probe.json
```

## 3. Обновить сайт из Shipox

После успешной проверки:

```powershell
cd C:\Users\HP\Documents\Codex\workspace\fargo-shipox-dashboard
.\RUN_SHIPOX_UPDATE.ps1
```

Для короткого теста только на первых страницах:

```powershell
.\RUN_SHIPOX_UPDATE.ps1 -LimitPages 2
```

Что делает команда:

1. Читает Shipox API.
2. Собирает `public/generatedSnapshot.json`.
3. Собирает сайт через `npm run build`.

Потом локально можно проверить:

```powershell
npm run dev
```

## 4. Что нужно из curl

Если доступы не сработают, нужен полный текст curl, не скрин:

```text
curl --location 'https://gateway.fargo.uz/api/v1/authenticate' ...
curl --location 'https://gateway.fargo.uz/api/v2/admin/orders?size=...' ...
```

Особенно важны:

- URL
- headers
- body для авторизации
- название header для marketplace
- пример query-параметров orders

Пароль/токен лучше вставлять в `.env.local`, а не присылать в чат.
