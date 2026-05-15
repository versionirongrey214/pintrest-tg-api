import express from 'express';
import dotenv from 'dotenv';
import handler from './api/index.js';

dotenv.config();

const app = express();
app.use(express.json());

// Forward requests to our Vercel serverless function
app.all('/api', async (req, res) => {
    // Vercel serverless functions have a specific request/response signature
    // Express provides a highly compatible req/res object
    await handler(req, res);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Local Vercel dev server running on http://localhost:${PORT}`);
    console.log(`To test the Telegram Bot webhook, use ngrok to expose port ${PORT}`);
    console.log(`Command: ngrok http ${PORT}`);
    console.log(`Then set your webhook to: https://<your-ngrok-url>/api`);
});
