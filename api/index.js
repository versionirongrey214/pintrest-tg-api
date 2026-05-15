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

// Escape text for MarkdownV2
function escMd(str) {
    return String(str || '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

// Extract Pinterest images with page offset for pagination
async function fetchPinterestImages(query, page = 0) {
    try {
        const cookie = parseCookie(process.env.PINTEREST_COOKIE);
        const url = `https://in.pinterest.com/search/pins/?q=${encodeURIComponent(query)}&page=${page}`;

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
        const pwsMatch = data.match(/<script id="__PWS_DATA__" type="application\/json">({.*?})<\/script>/);
        if (pwsMatch) {
            try {
                const pwsData = JSON.parse(pwsMatch[1]);
                findImages(pwsData, extractedImages, query);
            } catch (e) {
                console.error("Failed to parse __PWS_DATA__");
            }
        }

        // Attempt 2: HTML scraping fallback
        if (extractedImages.length === 0) {
            let matches = [...data.matchAll(/<img[^>]*alt="([^"]*)"[^>]*src="(https:\/\/i\.pinimg\.com\/(?:orig|736x|564x|474x|236x)\/[^\s"'\\]+\.jpg)"/gi)];
            if (matches.length === 0) {
                matches = [...data.matchAll(/<img[^>]*src="(https:\/\/i\.pinimg\.com\/(?:orig|736x|564x|474x|236x)\/[^\s"'\\]+\.jpg)"[^>]*alt="([^"]*)"/gi)]
                    .map(m => [m[0], m[2], m[1]]);
            }
            if (matches.length === 0) {
                matches = [...data.matchAll(/(https:\/\/i\.pinimg\.com\/(?:orig|736x|564x|474x|236x)\/[^\s"'\\]+\.jpg)/g)]
                    .map(m => [m[0], query, m[1]]);
            }

            // Deduplicate
            const seen = new Set();
            const unique = matches.filter(m => {
                const u = m[2] || m[1];
                if (seen.has(u)) return false;
                seen.add(u);
                return true;
            });

            // Offset by page so each page returns different images
            const skip = page * 5;
            const finalSlice = unique.slice(skip, skip + 5).length > 0
                ? unique.slice(skip, skip + 5)
                : unique.slice(0, 5);

            for (const m of finalSlice) {
                const rawUrl = m[2] || m[1];
                let altText = (m[1] || query).replace(/This (?:contains an image of|may contain):?\s*/i, '').trim();
                if (altText.length > 50) altText = altText.substring(0, 50);

                const origUrl = rawUrl.replace(/\/(?:orig|736x|564x|474x|236x)\//, '/orig/');
                const hdUrl = rawUrl.replace(/\/(?:orig|736x|564x|474x|236x)\//, '/736x/');

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
                title: String(obj.title || obj.grid_title || obj.description || query).substring(0, 50)
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

    const tgApi = async (method, payload) => {
        if (!BOT_TOKEN) return null;
        try {
            const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, payload);
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
                    await tgApi('sendPhoto', {
                        chat_id: chatId,
                        photo: 'https://wallpapers.com/images/file/nagato-pain-naruto-4k-pc-k9mgbclqtbcggpau.jpg',
                        caption: [
                            `🌸 *𝗣𝗜𝗡𝗧𝗘𝗥𝗘𝗦𝗧 𝗣𝗛𝗢𝗧𝗢 𝗘𝗫𝗧𝗥𝗔𝗖𝗧𝗢𝗥*`,
                            ``,
                            `━━━━━━━━━━━━━━━━━━━━`,
                            `✨ Fetch ultra high\\-res images`,
                            `🔥 4K · 8K · Original quality`,
                            `⚡ Blazing fast serverless engine`,
                            `📌 Powered by Pinterest's network`,
                            `━━━━━━━━━━━━━━━━━━━━`,
                            ``,
                            `Use /help to explore all commands`,
                            `_Created by @letmesolo\\_her_`,
                        ].join('\n'),
                        parse_mode: 'MarkdownV2',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '📖 Help', callback_data: 'show_help' },
                                { text: '👑 Owner', callback_data: 'show_owner' }
                            ]]
                        }
                    });

                } else if (text.startsWith('/help')) {
                    await tgApi('sendPhoto', {
                        chat_id: chatId,
                        photo: 'https://tse3.mm.bing.net/th/id/OIP.MrpIRpG6eLtJNPOLdO_IvQHaEK?r=0&rs=1&pid=ImgDetMain&o=7&rm=3',
                        caption: [
                            `📋 *𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦 & 𝗙𝗘𝗔𝗧𝗨𝗥𝗘𝗦*`,
                            ``,
                            `━━━━━━━━━━━━━━━━━━━━`,
                            `🚀 /start — Launch the bot`,
                            `📋 /help — Show this menu`,
                            `👑 /owner — Developer info`,
                            `🔍 /pic <query> — Search Pinterest`,
                            `━━━━━━━━━━━━━━━━━━━━`,
                            ``,
                            `*How to use:*`,
                            `» Type /pic sasuke to get 5 HD images`,
                            `» Click buttons for next batch of photos`,
                            `» Every click loads 5 fresh unique images`,
                            ``,
                            `_Supports 4K · 8K · Original resolution_`,
                        ].join('\n'),
                        parse_mode: 'MarkdownV2',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🔍 Try: /pic naruto', callback_data: 'p:0:naruto' }
                            ]]
                        }
                    });

                } else if (text.startsWith('/owner')) {
                    await tgApi('sendPhoto', {
                        chat_id: chatId,
                        photo: 'https://tse3.mm.bing.net/th/id/OIP.MrpIRpG6eLtJNPOLdO_IvQHaEK?r=0&rs=1&pid=ImgDetMain&o=7&rm=3',
                        caption: [
                            `👑 *𝗕𝗢𝗧 𝗢𝗪𝗡𝗘𝗥*`,
                            ``,
                            `━━━━━━━━━━━━━━━━━━━━`,
                            `🧑‍💻 *Developer:* @letmesolo\\_her`,
                            `🤖 *Bot:* Pinterest Photo Extractor`,
                            `⚙️ *Stack:* Node\\.js · Vercel · Telegram`,
                            `━━━━━━━━━━━━━━━━━━━━`,
                            ``,
                            `_For issues or suggestions, DM the owner\\._`,
                        ].join('\n'),
                        parse_mode: 'MarkdownV2',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '💬 Contact Owner', url: 'https://t.me/letmesolo_her' }
                            ]]
                        }
                    });

                } else if (text.startsWith('/pic')) {
                    const query = text.replace(/^\/pic(@\w+)?/i, '').trim();
                    if (!query) {
                        await tgApi('sendMessage', {
                            chat_id: chatId,
                            text: "❌ Please provide a search query\\!\n\n*Example:* `/pic naruto`",
                            parse_mode: 'MarkdownV2'
                        });
                        return res.status(200).send('OK');
                    }
                    await handlePicRequest(query, chatId, tgApi, 0);
                }

            } else if (req.body.callback_query) {
                const cb = req.body.callback_query;
                const chatId = cb.message.chat.id;
                const cbData = cb.data;

                if (cbData.startsWith('p:')) {
                    const firstColon = cbData.indexOf(':', 2);
                    const page = parseInt(cbData.substring(2, firstColon)) || 0;
                    const query = cbData.substring(firstColon + 1);
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `🔄 Loading batch ${page + 1} for: ${query}` });
                    await handlePicRequest(query, chatId, tgApi, page);

                } else if (cbData === 'show_help') {
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                    await tgApi('sendPhoto', {
                        chat_id: chatId,
                        photo: 'https://tse3.mm.bing.net/th/id/OIP.MrpIRpG6eLtJNPOLdO_IvQHaEK?r=0&rs=1&pid=ImgDetMain&o=7&rm=3',
                        caption: [
                            `📋 *𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦 & 𝗙𝗘𝗔𝗧𝗨𝗥𝗘𝗦*`,
                            ``,
                            `━━━━━━━━━━━━━━━━━━━━`,
                            `🚀 /start — Launch the bot`,
                            `📋 /help — Show this menu`,
                            `👑 /owner — Developer info`,
                            `🔍 /pic <query> — Search Pinterest`,
                            `━━━━━━━━━━━━━━━━━━━━`,
                            ``,
                            `*How to use:*`,
                            `» Type /pic sasuke to get 5 HD images`,
                            `» Click buttons for next batch of photos`,
                            `» Every click loads 5 fresh unique images`,
                            ``,
                            `_Supports 4K · 8K · Original resolution_`,
                        ].join('\n'),
                        parse_mode: 'MarkdownV2',
                        reply_markup: { inline_keyboard: [[{ text: '🔍 Try: /pic naruto', callback_data: 'p:0:naruto' }]] }
                    });

                } else if (cbData === 'show_owner') {
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                    await tgApi('sendPhoto', {
                        chat_id: chatId,
                        photo: 'https://tse3.mm.bing.net/th/id/OIP.MrpIRpG6eLtJNPOLdO_IvQHaEK?r=0&rs=1&pid=ImgDetMain&o=7&rm=3',
                        caption: [
                            `👑 *𝗕𝗢𝗧 𝗢𝗪𝗡𝗘𝗥*`,
                            ``,
                            `━━━━━━━━━━━━━━━━━━━━`,
                            `🧑‍💻 *Developer:* @letmesolo\\_her`,
                            `🤖 *Bot:* Pinterest Photo Extractor`,
                            `⚙️ *Stack:* Node\\.js · Vercel · Telegram`,
                            `━━━━━━━━━━━━━━━━━━━━`,
                            ``,
                            `_For issues or suggestions, DM the owner\\._`,
                        ].join('\n'),
                        parse_mode: 'MarkdownV2',
                        reply_markup: { inline_keyboard: [[{ text: '💬 Contact Owner', url: 'https://t.me/letmesolo_her' }]] }
                    });
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
        text: page === 0
            ? `🔍 Searching Pinterest for *${query}*\\.\\.\\.`
            : `🔄 Loading batch *${page + 1}*\\.\\.\\.`,
        parse_mode: 'MarkdownV2'
    });

    const images = preFetchedImages || await fetchPinterestImages(query, page);

    if (processingMsg?.result) {
        await tgApi('deleteMessage', { chat_id: chatId, message_id: processingMsg.result.message_id });
    }

    if (!images || images.length === 0) {
        await tgApi('sendMessage', {
            chat_id: chatId,
            text: `❌ *No images found\\.*\n\n_Try a different search term\\._`,
            parse_mode: 'MarkdownV2'
        });
        return;
    }

    // Send album with caption on first photo only
    const mediaGroup = images.map((img, idx) => ({
        type: 'photo',
        media: img.url,
        ...(idx === 0 ? {
            caption: `📌 *${escMd(query)}* — Batch ${page + 1}\n🖼 ${images.length} high\\-res photos`,
            parse_mode: 'MarkdownV2'
        } : {})
    }));

    await tgApi('sendMediaGroup', { chat_id: chatId, media: mediaGroup });

    // Build inline buttons — next page loads fresh images
    const nextPage = page + 1;
    const maxQueryLen = 64 - `p:${nextPage}:`.length;
    const safeQuery = query.length > maxQueryLen ? query.substring(0, maxQueryLen) : query;

    const emojis = ['🌸', '🔥', '✨', '💫', '🎯'];
    const allButtons = images.map((_, index) => ({
        text: `${emojis[index]} Photo ${index + 1}`,
        callback_data: `p:${nextPage}:${safeQuery}`
    }));

    // 3 buttons on row 1, remaining on row 2
    const rows = [allButtons.slice(0, 3), allButtons.slice(3)].filter(r => r.length > 0);

    await tgApi('sendMessage', {
        chat_id: chatId,
        text: `━━━━━━━━━━━━━━━━━━━━\n🖼 *${images.length} photos* delivered — Batch ${page + 1}\n📌 _Tap any button to load next batch_\n━━━━━━━━━━━━━━━━━━━━`,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: rows }
    });
}
