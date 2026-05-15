import axios from 'axios';

// Extract Pinterest images
async function fetchPinterestImages(query) {
    try {
        let cookie = process.env.PINTEREST_COOKIE ? process.env.PINTEREST_COOKIE.replace(/^'|'$/g, '') : '';
        
        // Auto-detect and parse if the user pasted raw JSON instead of a cookie string
        if (cookie.trim().startsWith('[')) {
            try {
                const parsedCookie = JSON.parse(cookie);
                if (Array.isArray(parsedCookie)) {
                    cookie = parsedCookie.map(c => `${c.name}=${c.value}`).join('; ');
                }
            } catch (e) {
                console.error("Failed to parse JSON cookie from env.");
            }
        }
        
        const url = `https://in.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Cookie': cookie
            }
        });

        // Use a Regex to extract the __PWS_DATA__ JSON blob
        const match = data.match(/<script id="__PWS_DATA__" type="application\/json">({.*?})<\/script>/);
        const extractedImages = [];

        if (match) {
            try {
                const pwsData = JSON.parse(match[1]);
                
                // Start searching from typical state location or root
                if (pwsData?.props?.initialReduxState?.pins) {
                    findImages(pwsData.props.initialReduxState.pins);
                } else {
                    findImages(pwsData);
                }
            } catch (e) {
                console.error("Failed to parse __PWS_DATA__ JSON");
            }
        }
        
        // Deep search function to find orig or 736x versions robustly
        function findImages(obj) {
            if (extractedImages.length >= 5) return;
            if (obj && typeof obj === 'object') {
                // If it has images object with orig or 736x
                if (obj.images && (obj.images.orig || obj.images['736x'])) {
                    let imgUrl = obj.images.orig?.url || obj.images['736x']?.url;
                    
                    if (imgUrl) {
                        if (!extractedImages.find(img => img.url === imgUrl)) {
                            extractedImages.push({
                                url: imgUrl,
                                title: obj.title || obj.grid_title || obj.description || query
                            });
                        }
                    }
                }
                // Recursively check deeper properties
                for (const key in obj) {
                    if (extractedImages.length >= 5) break;
                    if (typeof obj[key] === 'object') {
                        findImages(obj[key]);
                    }
                }
            }
        }
        

        // Fallback: if JSON parse failed or found 0 images, scrape HTML for raw image URLs
        if (extractedImages.length === 0) {
            const rawUrls = [...data.matchAll(/https:\/\/i\.pinimg\.com\/(?:orig|736x|564x|474x|236x)\/[^\s"'\\]+\.jpg/g)].map(m => m[0]);
            const uniqueUrls = [...new Set(rawUrls)];
            
            // Check availability to prevent S3 403 Access Denied on missing orig files
            const checkAndPush = async (imgUrl) => {
                if (extractedImages.length >= 5) return;
                const origRes = imgUrl.replace(/\/\d+x\//, '/orig/');
                const highResFallback = imgUrl.replace(/\/\d+x\//, '/736x/');
                
                try {
                    // Fast HEAD request to check if /orig/ actually exists
                    await axios.head(origRes, { timeout: 2000 });
                    if (!extractedImages.find(e => e.url === origRes)) {
                        extractedImages.push({ url: origRes, title: query });
                    }
                } catch (e) {
                    // Fallback to 736x if orig doesn't exist
                    if (!extractedImages.find(e => e.url === highResFallback)) {
                        extractedImages.push({ url: highResFallback, title: query });
                    }
                }
            };

            const promises = uniqueUrls.slice(0, 10).map(img => checkAndPush(img));
            await Promise.all(promises);
        }
        
        // Final deduplication just in case
        const seenUrls = new Set();
        return extractedImages.filter(img => {
            if (seenUrls.has(img.url)) return false;
            seenUrls.add(img.url);
            return true;
        }).slice(0, 5);
    } catch (error) {
        console.error("Pinterest fetch error:", error.message);
        return [];
    }
}

export default async function handler(req, res) {
    // Basic error handler for methods
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

    // Check if request is from Telegram Webhook
    const isTelegramWebhook = req.body && (req.body.message || req.body.callback_query);
    
    if (isTelegramWebhook) {
        try {
            if (req.body.message && req.body.message.text) {
                const msg = req.body.message;
                const chatId = msg.chat.id;
                const text = msg.text.trim();

                if (text.startsWith('/start')) {
                    await tgApi('sendMessage', {
                        chat_id: chatId,
                        text: "Welcome to Pinterest Photo Extractor Bot!\nCredit: @letmesolo_her\nUse /help to see available commands."
                    });
                } else if (text.startsWith('/help')) {
                    await tgApi('sendMessage', {
                        chat_id: chatId,
                        text: "Features:\n/start - Start the bot\n/help - Show all features\n/owner - View owner details\n/pic <query> - Extract top 5 high-res photos from Pinterest"
                    });
                } else if (text.startsWith('/owner')) {
                    await tgApi('sendMessage', {
                        chat_id: chatId,
                        text: "Bot Owner & Creator: @letmesolo_her"
                    });
                } else if (text.startsWith('/pic')) {
                    const query = text.replace('/pic', '').trim();
                    if (!query) {
                        await tgApi('sendMessage', { chat_id: chatId, text: "Please provide a search query. Example: /pic naruto" });
                        return res.status(200).send('OK');
                    }
                    
                    await handlePicRequest(query, chatId, tgApi);
                }
            } else if (req.body.callback_query) {
                const cb = req.body.callback_query;
                const chatId = cb.message.chat.id;
                const data = cb.data;

                // Handle inline button clicks
                if (data.startsWith('pic_')) {
                    const query = data.replace('pic_', '');
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `Searching for: ${query}` });
                    await handlePicRequest(query, chatId, tgApi);
                }
            }
            return res.status(200).send('OK'); // Always return 200 for Telegram
        } catch (error) {
            console.error("Webhook handler error:", error);
            return res.status(200).send('OK'); 
        }
    }

    // Direct API Usage Logic
    const query = req.query.query || req.body?.query;
    const chatId = req.query.chat_id || req.body?.chat_id;

    if (!query) {
        return res.status(400).json({ error: "Missing 'query' parameter" });
    }

    try {
        const images = await fetchPinterestImages(query);
        
        // Optional Telegram Integration via direct API hit
        if (chatId && BOT_TOKEN) {
            await handlePicRequest(query, chatId, tgApi, images);
        }

        // Return JSON output containing array of image links
        return res.status(200).json({ success: true, images: images.map(img => img.url) });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// Logic to process the Telegram album and inline buttons
async function handlePicRequest(query, chatId, tgApi, preFetchedImages = null) {
    const processingMsg = await tgApi('sendMessage', { chat_id: chatId, text: `Searching Pinterest for: ${query}...` });
    
    const images = preFetchedImages || await fetchPinterestImages(query);
    
    if (processingMsg && processingMsg.result) {
        await tgApi('deleteMessage', { chat_id: chatId, message_id: processingMsg.result.message_id });
    }

    if (!images || images.length === 0) {
        await tgApi('sendMessage', { chat_id: chatId, text: "No images found or error occurred." });
        return;
    }

    // Prepare MediaGroup
    const mediaGroup = images.map((img, idx) => ({
        type: 'photo',
        media: img.url,
        caption: idx === 0 ? `Results for: ${query}` : ''
    }));
    
    // Send 5 photos as album
    await tgApi('sendMediaGroup', {
        chat_id: chatId,
        media: mediaGroup
    });

    // Send 5 inline buttons
    const inlineKeyboard = [];
    const row = [];
    images.forEach((img, index) => {
        // Keep callback_data within Telegram's 64 byte limit
        let safeQuery = img.title || query;
        if (safeQuery.length > 30) safeQuery = safeQuery.substring(0, 30);
        
        row.push({
            text: `Photo ${index + 1}`,
            callback_data: `pic_${safeQuery}`
        });
    });
    
    inlineKeyboard.push(row);

    await tgApi('sendMessage', {
        chat_id: chatId,
        text: "Select a photo to find similar images:",
        reply_markup: {
            inline_keyboard: inlineKeyboard
        }
    });
}
