import axios from 'axios';

// ─── Cookie Parser ───────────────────────────────────────────────
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

// ─── MarkdownV2 Escape ──────────────────────────────────────────
function escMd(str) {
    return String(str || '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

// ─── Pinterest Internal Search API (bookmark-based infinite pagination) ───
async function pinterestSearch(query, bookmark = null) {
    const cookie = parseCookie(process.env.PINTEREST_COOKIE);
    const csrfMatch = cookie.match(/csrftoken=([^;]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    const payload = {
        source_url: `/search/pins/?q=${query}`,
        data: JSON.stringify({
            options: {
                query,
                scope: 'pins',
                bookmarks: bookmark ? [bookmark] : [],
                rs: 'typed',
                field_set_key: 'unauth',
                no_fetch_context_on_resource: false
            },
            context: {}
        })
    };

    const { data } = await axios.post(
        'https://in.pinterest.com/resource/BaseSearchResource/get/',
        new URLSearchParams(payload).toString(),
        {
            headers: {
                'Cookie': cookie,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'X-CSRFToken': csrfToken,
                'X-Requested-With': 'XMLHttpRequest',
                'X-Pinterest-AppState': 'active',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'Origin': 'https://in.pinterest.com',
                'Referer': `https://in.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`
            }
        }
    );

    const results = data?.resource_response?.data?.results || [];
    const nextBookmark = data?.resource?.options?.bookmarks?.[0]
        || data?.resource_response?.bookmark
        || data?.resource_response?.data?.bookmark
        || null;

    return { results, bookmark: nextBookmark };
}

// ─── Extract 5 high-res images from a page of Pinterest results ──
async function fetchPinterestImages(query, bookmark = null) {
    try {
        const { results, bookmark: nextBookmark } = await pinterestSearch(query, bookmark);

        const extractedImages = [];
        for (const pin of results) {
            if (extractedImages.length >= 5) break;
            if (!pin?.images) continue;

            // Always try orig first, fallback to 736x
            let imgUrl = pin.images.orig?.url || pin.images['736x']?.url;
            if (!imgUrl) continue;

            // Filter out non-image pins (some results are ads/modules)
            if (!imgUrl.includes('pinimg.com')) continue;

            // Verify orig exists, fallback to 736x
            if (imgUrl.includes('/originals/') || imgUrl.includes('/orig/')) {
                try {
                    await axios.head(imgUrl, { timeout: 2500 });
                } catch {
                    imgUrl = pin.images['736x']?.url || imgUrl;
                }
            }

            const title = String(pin.title || pin.grid_title || pin.description || query)
                .replace(/\n/g, ' ').trim().substring(0, 50) || query;

            extractedImages.push({ url: imgUrl, title });
        }

        return { images: extractedImages, bookmark: nextBookmark };
    } catch (error) {
        console.error("Pinterest fetch error:", error.message);
        return { images: [], bookmark: null };
    }
}

// ─── In-memory bookmark store (per chat, per query) ──────────────
const bookmarkStore = new Map();

function getBookmarkKey(chatId, query) {
    return `${chatId}:${query.toLowerCase().trim()}`;
}

// ─── Main Vercel Handler ─────────────────────────────────────────
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
            console.error(`TG API error (${method}):`, e?.response?.data || e.message);
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
                                { text: '📖 Help', callback_data: 'cmd_help' },
                                { text: '👑 Owner', callback_data: 'cmd_owner' }
                            ]]
                        }
                    });

                } else if (text.startsWith('/help')) {
                    await sendHelp(chatId, tgApi);

                } else if (text.startsWith('/owner')) {
                    await sendOwner(chatId, tgApi);

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
                    // Reset bookmark for new search
                    bookmarkStore.delete(getBookmarkKey(chatId, query));
                    await handlePicRequest(query, chatId, tgApi);
                }

            } else if (req.body.callback_query) {
                const cb = req.body.callback_query;
                const chatId = cb.message.chat.id;
                const cbData = cb.data;

                if (cbData.startsWith('next:')) {
                    const query = cbData.substring(5);
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `🔄 Loading next batch...` });
                    await handlePicRequest(query, chatId, tgApi);

                } else if (cbData.startsWith('pic:')) {
                    // Photo-specific search: uses that photo's title as a new query
                    const newQuery = cbData.substring(4);
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `🔍 Finding similar images...` });
                    // Reset bookmark for this new query
                    bookmarkStore.delete(getBookmarkKey(chatId, newQuery));
                    await handlePicRequest(newQuery, chatId, tgApi);

                } else if (cbData === 'cmd_help') {
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                    await sendHelp(chatId, tgApi);

                } else if (cbData === 'cmd_owner') {
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                    await sendOwner(chatId, tgApi);
                }
            }

            return res.status(200).send('OK');
        } catch (error) {
            console.error("Webhook error:", error);
            return res.status(200).send('OK');
        }
    }

    // ─── Direct REST API ─────────────────────────────────
    const query = req.query.query || req.body?.query;
    const bookmark = req.query.bookmark || req.body?.bookmark || null;

    if (!query) return res.status(400).json({ error: "Missing 'query' parameter" });

    try {
        const { images, bookmark: nextBookmark } = await fetchPinterestImages(query, bookmark);
        return res.status(200).json({
            success: true,
            images: images.map(img => img.url),
            next_bookmark: nextBookmark
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ─── Send Help Card ──────────────────────────────────────────────
async function sendHelp(chatId, tgApi) {
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
            `🔍 /pic \\<query\\> — Search Pinterest`,
            `━━━━━━━━━━━━━━━━━━━━`,
            ``,
            `*How to use:*`,
            `» Type /pic sasuke to get 5 HD images`,
            `» Click ▶️ *Next Batch* for more photos`,
            `» Every click loads 5 *brand new* images`,
            ``,
            `_Supports 4K · 8K · Original resolution_`,
        ].join('\n'),
        parse_mode: 'MarkdownV2',
        reply_markup: {
            inline_keyboard: [[{ text: '🔍 Try: /pic naruto', callback_data: 'next:naruto' }]]
        }
    });
}

// ─── Send Owner Card ─────────────────────────────────────────────
async function sendOwner(chatId, tgApi) {
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
            inline_keyboard: [[{ text: '💬 Contact Owner', url: 'https://t.me/letmesolo_her' }]]
        }
    });
}

// ─── Handle /pic Request ─────────────────────────────────────────
async function handlePicRequest(query, chatId, tgApi) {
    const bKey = getBookmarkKey(chatId, query);
    const currentBookmark = bookmarkStore.get(bKey) || null;
    const batchNum = (bookmarkStore.get(bKey + ':count') || 0) + 1;

    const processingMsg = await tgApi('sendMessage', {
        chat_id: chatId,
        text: batchNum === 1
            ? `🔍 Searching Pinterest for *${escMd(query)}*\\.\\.\\.`
            : `🔄 Loading batch *${batchNum}*\\.\\.\\.`,
        parse_mode: 'MarkdownV2'
    });

    const { images, bookmark: nextBookmark } = await fetchPinterestImages(query, currentBookmark);

    // Store the next bookmark for this chat+query
    if (nextBookmark) {
        bookmarkStore.set(bKey, nextBookmark);
        bookmarkStore.set(bKey + ':count', batchNum);
    }

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

    // Send album
    const mediaGroup = images.map((img, idx) => ({
        type: 'photo',
        media: img.url,
        ...(idx === 0 ? {
            caption: `📌 *${escMd(query)}* — Batch ${batchNum}\n🖼 ${images.length} high\\-res photos`,
            parse_mode: 'MarkdownV2'
        } : {})
    }));

    await tgApi('sendMediaGroup', { chat_id: chatId, media: mediaGroup });

    // Build per-photo "Similar" buttons + "Next Batch" button
    const emojis = ['🌸', '🔥', '✨', '💫', '🎯'];
    const photoButtons = images.map((img, index) => {
        // Use the image title as query for similar search, keep under 64 bytes
        let photoQuery = img.title || query;
        const maxLen = 64 - 4; // "pic:" prefix
        if (photoQuery.length > maxLen) photoQuery = photoQuery.substring(0, maxLen);
        return {
            text: `${emojis[index]} Photo ${index + 1}`,
            callback_data: `pic:${photoQuery}`
        };
    });

    // Next batch button
    const maxQueryLen = 64 - 5; // "next:" prefix
    const safeQuery = query.length > maxQueryLen ? query.substring(0, maxQueryLen) : query;

    // Row 1: Photos 1-3 | Row 2: Photos 4-5 | Row 3: Next Batch
    const rows = [
        photoButtons.slice(0, 3),
        photoButtons.slice(3),
        [{ text: `▶️ Next Batch (${batchNum + 1})`, callback_data: `next:${safeQuery}` }]
    ].filter(r => r.length > 0);

    await tgApi('sendMessage', {
        chat_id: chatId,
        text: `━━━━━━━━━━━━━━━━━━━━\n🖼 *${images.length} photos* — Batch ${batchNum}\n📌 _Tap a photo for similar, or load next batch_\n━━━━━━━━━━━━━━━━━━━━`,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: rows }
    });
}
