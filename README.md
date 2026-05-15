# Pinterest TG API 📌🤖

A powerful, headless Node.js Serverless Function built for Vercel. It acts as an unofficial Pinterest Photo Extractor with native Telegram Bot integration. It completely bypasses anti-bot walls by using authenticated session cookies to reliably deliver maximum-resolution (4K/8K `/orig/`) images straight to Telegram.

## ⚡ Features
- **Dynamic Quality Engine**: Asynchronously checks S3 buckets to guarantee the absolute highest resolution available (`/orig/` or `/736x/`) without ever crashing or throwing 403 errors.
- **Telegram Inline Navigation**: Sends 5 ultra-high-res images as an album, paired with 5 interactive inline buttons. Clicking a button seamlessly fetches similar images based on the photo's metadata.
- **Universal Chat Compatibility**: Works effortlessly in private DMs and large group chats without requiring any admin privileges.
- **Vercel Serverless Ready**: Architected specifically to deploy directly on Vercel's Edge network with zero overhead.

## 🚀 One-Click Deploy

Deploy directly to Vercel. The deployment process will automatically prompt you to enter your `BOT_TOKEN` and `PINTEREST_COOKIE` environment variables!

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fajisth69%2Fpintrest-tg-api&env=BOT_TOKEN,PINTEREST_COOKIE&project-name=pintrest-tg-api)

### ⚙️ Required Environment Variables
During deployment (or locally in your `.env` file), you must provide:
- `BOT_TOKEN`: Your Telegram Bot API Token (from @BotFather).
- `PINTEREST_COOKIE`: Your serialized Pinterest login cookie string (starting with `_pinterest_referrer=...`).

## 🛠 Webhook Setup
After your Vercel project successfully deploys, you must register the URL to your Telegram bot. Open your web browser and visit:

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR-VERCEL-URL>.vercel.app/api
```

## 💻 Local Testing
1. Clone the repository and run `npm install`.
2. Add your `.env` file with `BOT_TOKEN` and `PINTEREST_COOKIE`.
3. Run `npm run dev` to start the local Express server.
4. Expose the local port `3000` via Ngrok to test the webhook in Telegram.

## 📝 Commands
* `/start` - Start the bot.
* `/help` - Show all features.
* `/owner` - View owner details (@letmesolo_her).
* `/pic <query>` - Extract top 5 high-res photos.

---
*Created by [@letmesolo_her](https://t.me/letmesolo_her)*
