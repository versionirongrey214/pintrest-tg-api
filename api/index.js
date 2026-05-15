import axios from 'axios';

// Parse cookie from JSON array or plain string
function parseCookie(raw) {
    const str = raw ? raw.replace(/^'|'$/g, '') : '';
    if (str.trim().startsWith('[')) {
        try {
            const arr = JSON.parse(str);
            if (Array.isArray(arr)) return arr.map(c => `${c.name}=${c.value}`).join('; ');
        } catch (e) {}
    }
    return str;
}

// Extract Pinterest images — supports page offset for pagination
async function fetchPinterestImages(query, page = 0) {
    try {
        const cookie = parseCookie(process.env.PINTEREST_COOKIE);
        
        // Use page offset to get unique results each time
        const pageSize = 25;
        const url = `https://in.pinterest.com/search/pins/?q=${encodeURIComponent(query)}&rs=typed&term_meta[]=${encodeURIComponent(query)}%7Ctyped&page=${page}`;

        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cookie': cookie
            }
        });

        const extractedImages = [];

        // Attempt 1: Parse __PWS_DATA__ JSON blob
        const match = data.match(/<script id="__PWS_DATA__" type="application\/json">({.*?})<\/script>/);
        if (match) {
            try {
                const pwsData = JSON.parse(match[1]);
                findImages(pwsData, extractedImages, query);
            } catch (e) {
                console.error("Failed to parse __PWS_DATA__");
            }
        }

        // Attempt 2: HTML scraping fallback with alt text extraction
        if (extractedImages.length === 0) {
            // Try alt before src
            let matches = [...data.matchAll(/<img[^>]*alt="([^"]*)"[^>]*src="(https:\/\/i\.pinimg\.com\/(?:orig|736x|564x|474x|236x)\/[^\s"'\\]+\.jpg)"/gi)];
            
            // Try src before alt
            if (matches.length === 0) {
                matches = [...data.matchAll(/<img[^>]*src="(https:\/\/i\.pinimg\.com\/(?:orig|736x|564x|474x|236x)\/[^\s"'\\]+\.jpg)"[^>]*alt="([^"]*)"/gi)]
                    .map(m => [m[0], m[2], m[1]]);
            }

            // Last resort: raw URL sweep
            if (matches.length === 0) {
                matches = [...data.matchAll(/(https:\/\/i\.pinimg\.com\/(?:orig|736x|564x|474x|236x)\/[^\s"'\\]+\.jpg)/g)]
                    .map(m => [m[0], query, m[1]]);
            }

            // Deduplicate
            const seen = new Set();
            const unique = matches.filter(m => {
                const url = m[2] || m[1];
                if (seen.has(url)) return false;
                seen.add(url);
                return true;
            });

            // Skip the first (page * 5) images so each page returns fresh ones
            const skip = page * 5;
            const sliced = unique.slice(skip, skip + 5);

            // If we've run out of unique images, wrap around with a different offset
            const finalSlice = sliced.length > 0 ? sliced : unique.slice(0, 5);

            for (const m of finalSlice) {
                const rawUrl = m[2] || m[1];
                let altText = (m[1] || query).replace(/This (?:contains an image of|may contain):?\s*/i, '').trim();
                if (altText.length > 50) altText = altText.substring(0, 50);

                // Upgrade to best resolution
                const origUrl = rawUrl.replace(/\/\d+x\//, '/orig/').replace(/\/(?:orig|736x|564x|474x|236x)\//, '/orig/');
                const hdUrl = rawUrl.replace(/\/\d+x\//, '/736x/').replace(/\/(?:orig|736x|564x|474x|236x)\//, '/736x/');

                try {
                    await axios.head(origUrl, { timeout: 2500 });
                    extractedImages.push({ url: origUrl, title: altText });
                } catch {
                    extractedImages.push({ url: hdUrl, title: altText });
                }

                if (extractedImages.length >= 5) break;
            }
        }

        return extractedImages.slice(0, 5);
    } catch (error) {
        console.error("Pinterest fetch error:", error.message);
        return [];
    }
}

// Deep search for Pinterest image objects inside JSON
function findImages(obj, results, query) {
    if (results.length >= 5 || !obj || typeof obj !== 'object') return;

    if (obj.images && (obj.images.orig || obj.images['736x'])) {
        const imgUrl = obj.images.orig?.url || obj.images['736x']?.url;
        if (imgUrl && !results.find(r => r.url === imgUrl)) {
            results.push({
                url: imgUrl,
                title: (obj.title || obj.grid_title || obj.description || query).substring(0, 50)
            });
        }
    }

    for (const key in obj) {
        if (results.length >= 5) break;
        if (typeof obj[key] === 'object') findImages(obj[key], results, query);
    }
}

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const BOT_TOKEN = process.env.BOT_TOKEN;

    const tgApi = async (method, data) => {
        if (!BOT_TOKEN) return null;
        try {
            const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, data);
            return response.data;
        } catch (e) {
            console.error(`Telegram API error (${method}):`, e?.response?.data || e.message);
            return null;
        }
    };

    const isTelegramWebhook = req.body && (req.body.message || req.body.callback_query);

    if (isTelegramWebhook) {
        try {
            if (req.body.message?.text) {
                const msg = req.body.message;
                const chatId = msg.chat.id;
                const text = msg.text.trim();

                if (text.startsWith('/start')) {
                    await tgApi('sendMessage', {
                        chat_id: chatId,
                        text: "📌 Welcome to Pinterest Photo Extractor!\nCredit: @letmesolo_her\nUse /help to see available commands."
                    });
                } else if (text.startsWith('/help')) {
                    await tgApi('sendMessage', {
                        chat_id: chatId,
                        text: "Commands:\n/start - Start the bot\n/help - Show all features\n/owner - View owner details\n/pic <query> - Extract top 5 high-res photos from Pinterest\n\n💡 After results, click Photo buttons to load the NEXT SET of similar images!"
                    });
                } else if (text.startsWith('/owner')) {
                    await tgApi('sendMessage', {
                        chat_id: chatId,
                        text: "Bot Owner & Creator: @letmesolo_her"
                    });
                } else if (text.startsWith('/pic')) {
                    const query = text.replace(/^\/pic(@\w+)?/i, '').trim();
                    if (!query) {
                        await tgApi('sendMessage', { chat_id: chatId, text: "Please provide a search query. Example: /pic naruto" });
                        return res.status(200).send('OK');
                    }
                    await handlePicRequest(query, chatId, tgApi, 0);
                }
            } else if (req.body.callback_query) {
                const cb = req.body.callback_query;
                const chatId = cb.message.chat.id;
                const cbData = cb.data;

                if (cbData.startsWith('p:')) {
                    // Format: p:<page>:<query>
                    const firstColon = cbData.indexOf(':', 2);
                    const page = parseInt(cbData.substring(2, firstColon)) || 0;
                    const query = cbData.substring(firstColon + 1);
                    
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `Loading page ${page + 1} for: ${query}...` });
                    await handlePicRequest(query, chatId, tgApi, page);
                }
            }
            return res.status(200).send('OK');
        } catch (error) {
            console.error("Webhook handler error:", error);
            return res.status(200).send('OK');
        }
    }

    // Direct REST API
    const query = req.query.query || req.body?.query;
    const chatId = req.query.chat_id || req.body?.chat_id;
    const page = parseInt(req.query.page || '0');

    if (!query) return res.status(400).json({ error: "Missing 'query' parameter" });

    try {
        const images = await fetchPinterestImages(query, page);
        if (chatId && BOT_TOKEN) await handlePicRequest(query, chatId, tgApi, page, images);
        return res.status(200).json({ success: true, page, images: images.map(img => img.url) });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

async function handlePicRequest(query, chatId, tgApi, page = 0, preFetchedImages = null) {
    const processingMsg = await tgApi('sendMessage', {
        chat_id: chatId,
        text: page === 0 ? `🔍 Searching Pinterest for: *${query}*...` : `🔄 Loading more results...`,
        parse_mode: 'Markdown'
    });

    const images = preFetchedImages || await fetchPinterestImages(query, page);

    if (processingMsg?.result) {
        await tgApi('deleteMessage', { chat_id: chatId, message_id: processingMsg.result.message_id });
    }

    if (!images || images.length === 0) {
        await tgApi('sendMessage', { chat_id: chatId, text: "❌ No images found. Try a different search term." });
        return;
    }

    // Send album
    const mediaGroup = images.map((img, idx) => ({
        type: 'photo',
        media: img.url,
        caption: idx === 0 ? `📌 *${query}* — Page ${page + 1}` : '',
        parse_mode: 'Markdown'
    }));

    await tgApi('sendMediaGroup', { chat_id: chatId, media: mediaGroup });

    // Build inline buttons — each button loads the NEXT page
    // Format: p:<nextPage>:<query>  (must be < 64 bytes total)
    const nextPage = page + 1;
    const maxQueryLen = 64 - `p:${nextPage}:`.length;
    const safeQuery = query.length > maxQueryLen ? query.substring(0, maxQueryLen) : query;

    const row = images.map((img, index) => ({
        text: `▶️ More like ${index + 1}`,
        callback_data: `p:${nextPage}:${safeQuery}`
    }));

    await tgApi('sendMessage', {
        chat_id: chatId,
        text: `🖼 *${images.length} photos found* — Click to load next batch:`,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [row] }
    });
}
