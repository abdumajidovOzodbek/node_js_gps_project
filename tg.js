const TelegramBot = require("node-telegram-bot-api");
const piexif = require("piexifjs");
const fs = require("fs");
const path = require("path");
const proj4 = require("proj4");
const kadastrData = require("./combined_kadastr_coordinates.json");

const token = "7702593390:AAGhJDRt3Rhc0ok-cUhsdDJH_jA1IXyMcF4";
const bot = new TelegramBot(token, { polling: true });

const userStates = {};
const SUPPORTED_MIME_TYPES = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/tiff",
];

const customProj =
    "+proj=tmerc +lat_0=0 +lon_0=69 +k=1 +x_0=-182.2698 +y_0=-4500719.7668 +ellps=krass +towgs84=23.92,-141.27,-80.9,0,0.35,0.82,-0.12000000004786 +units=m +no_defs";
const wgs84 = proj4.WGS84;

const toDMS = (deg) => {
    const absDeg = Math.abs(deg);
    const degrees = Math.floor(absDeg);
    const minutes = Math.floor((absDeg - degrees) * 60);
    const seconds = ((absDeg - degrees - minutes / 60) * 3600).toFixed(6);
    return [degrees, minutes, Math.round(seconds * 10000) / 10000];
};

const normalizeKadastr = (s) => s.replace(/:/g, "");
const formatKadastr = (raw) => raw.match(/.{1,2}/g).join(":");

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
        chatId,
        "✨ *Rasm Geotag Botiga xush kelibsiz!* ✨\n\n" +
            "📸 *Foydalanish uchun:*\n" +
            "1. Menga rasm yuboring (foto yoki hujjat sifatida yaxshiroq sifat uchun)\n" +
            "2. Keyin quyidagilardan birini tanlang:\n" +
            "   📍 Joriy joylashuvingizni ulashing\n" +
            '   🔢 Koordinatalarni yuboring (format: "37.7749, -122.4194")\n' +
            '   🏷 Yoki KADASTR raqamini yuboring (masalan: "10:04:03:01:01:5016" yoki "10040301015016")\n\n' +
            "🔄 Men rasm EXIF ma'lumotlariga joylashuv ma'lumotlarini qo'shaman!",
        { parse_mode: "Markdown" },
    );
});

bot.on("document", async (msg) => {
    const chatId = msg.chat.id;
    const mimeType = msg.document.mime_type;
    const userMessageId = msg.message_id;

    if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
        bot.sendMessage(
            chatId,
            "❌ *Qo'llab-quvvatlanmaydigan fayl turi!*\nIltimos, JPEG, PNG yoki TIFF formatidagi rasm yuboring.",
            { parse_mode: "Markdown" },
        );
        return;
    }

    bot.sendChatAction(chatId, "typing");

    userStates[chatId] = {
        waitingForLocation: true,
        statusMessage: await bot.sendMessage(
            chatId,
            "⏳ *Rasm yuklanmoqda...*",
            { parse_mode: "Markdown" },
        ),
    };

    try {
        const fileId = msg.document.file_id;
        const fileStream = bot.getFileStream(fileId);
        const chunks = [];

        fileStream.on("data", (chunk) => chunks.push(chunk));
        fileStream.on("end", async () => {
            const buffer = Buffer.concat(chunks);
            userStates[chatId].imageBuffer = buffer;
            userStates[chatId].mimeType = mimeType;
            await bot.deleteMessage(chatId, userMessageId);

            await bot.editMessageText(
                "✅ *Rasm qabul qilindi!*\n\nEndi quyidagilardan birini tanlang:\n" +
                    "📍 Joylashuvingizni ulashing\n" +
                    "🏷 Yoki KADASTR raqamini yuboring",
                {
                    chat_id: chatId,
                    message_id: userStates[chatId].statusMessage.message_id,
                    parse_mode: "Markdown",
                },
            );
        });
    } catch (error) {
        console.error("Hujjat yuklashda xato:", error);
        await bot.editMessageText(
            "❌ *Rasmni qayta ishlashda xato!*\nIltimos, boshqa fayl bilan qayta urinib ko'ring.",
            {
                chat_id: chatId,
                message_id: userStates[chatId].statusMessage.message_id,
                parse_mode: "Markdown",
            },
        );
        delete userStates[chatId];
    }
});

bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const userMessageId = msg.message_id;

    bot.sendChatAction(chatId, "typing");

    userStates[chatId] = {
        waitingForLocation: true,
        mimeType: "image/jpeg",
        statusMessage: await bot.sendMessage(chatId, "⏳", {
            parse_mode: "Markdown",
        }),
    };

    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;

    try {
        const fileStream = bot.getFileStream(fileId);
        const chunks = [];

        fileStream.on("data", (chunk) => chunks.push(chunk));
        fileStream.on("end", async () => {
            const buffer = Buffer.concat(chunks);
            userStates[chatId].imageBuffer = buffer;
            await bot.deleteMessage(chatId, userMessageId);

            await bot.editMessageText(
                "📸✅ *Rasm qabul qilindi!*\n\n" +
                "📍 Joylashuvingizni ulashing\n" +
                "🏷 Yoki KADASTR raqamini yuboring",
                {
                    chat_id: chatId,
                    message_id: userStates[chatId].statusMessage.message_id,
                    parse_mode: "Markdown"
                }
            );

        });
    } catch (error) {
        console.error("Fotoni yuklashda xato:", error);
        await bot.editMessageText(
            "❌ *Fotoni qayta ishlashda xato!*\nIltimos, yaxshiroq sifat uchun hujjat sifatida yuboring.",
            {
                chat_id: chatId,
                message_id: userStates[chatId].statusMessage.message_id,
                parse_mode: "Markdown",
            },
        );
        delete userStates[chatId];
    }
});

bot.on("location", async (msg) => {
    const chatId = msg.chat.id;
    const userMessageId = msg.message_id;
    if (userStates[chatId] && userStates[chatId].waitingForLocation) {
        try {
            const { latitude: lat, longitude: lon } = msg.location;
            await bot.deleteMessage(chatId, userMessageId);
            await bot.editMessageText(
                "📍 *Joylashuv qabul qilindi!*\n\n⌛ *Rasmga geotag qo'shilyapti...*",
                {
                    chat_id: chatId,
                    message_id: userStates[chatId].statusMessage.message_id,
                    parse_mode: "Markdown",
                },
            );
            await processImageWithCoordinates(chatId, lat, lon);
            delete userStates[chatId];
        } catch (error) {
            console.error("Joylashuvda xato:", error);
            await bot.editMessageText(
                "❌ *Joylashuvingizdan foydalanishda xato!*\nIltimos, qayta urinib ko'ring yoki koordinatalarni qo'lda kiriting.",
                {
                    chat_id: chatId,
                    message_id: userStates[chatId].statusMessage.message_id,
                    parse_mode: "Markdown",
                },
            );
        }
    }
});

bot.on("text", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const userMessageId = msg.message_id;

    if (userStates[chatId] && userStates[chatId].waitingForLocation) {
        await bot.deleteMessage(chatId, userMessageId);

        if (text.includes(",")) {
            try {
                const coords = text
                    .split(",")
                    .map((coord) => parseFloat(coord.trim()));
                if (coords.length !== 2 || isNaN(coords[0]) || isNaN(coords[1]))
                    throw new Error();
                const [lat, lon] = coords;

                await bot.editMessageText(
                    `🔢 *Koordinatalar qabul qilindi!* (${lat.toFixed(6)}, ${lon.toFixed(6)})\n\n⌛ *Geotag qo'shilyapti...*`,
                    {
                        chat_id: chatId,
                        message_id: userStates[chatId].statusMessage.message_id,
                        parse_mode: "Markdown",
                    },
                );

                await processImageWithCoordinates(chatId, lat, lon);
                delete userStates[chatId];
            } catch {
                await bot.editMessageText(
                    '❌ *Noto`g`ri koordinatalar!*\nIltimos, "kenglik, uzunlik" formatida yuboring (masalan: "37.7749, -122.4194")',
                    {
                        chat_id: chatId,
                        message_id: userStates[chatId].statusMessage.message_id,
                        parse_mode: "Markdown",
                    },
                );
            }
        } else {
            await bot.editMessageText(
                `🔍 *KADASTR raqami qidirilmoqda: ${text}...*`,
                {
                    chat_id: chatId,
                    message_id: userStates[chatId].statusMessage.message_id,
                    parse_mode: "Markdown",
                },
            );

            const normInput = normalizeKadastr(text);
            const found = kadastrData.features.find(
                (f) => normalizeKadastr(f.KADASTR) === normInput,
            );

            if (!found) {
                await bot.editMessageText(
                    "❌ *KADASTR raqami topilmadi!*\nIltimos, raqamni tekshirib, qayta urinib ko'ring.",
                    {
                        chat_id: chatId,
                        message_id: userStates[chatId].statusMessage.message_id,
                        parse_mode: "Markdown",
                    },
                );
                return;
            }

            const [x, y] = found.coordinates;
            const [lon, lat] = proj4(customProj, wgs84, [x, y]);

            await bot.editMessageText(
                `🏷 *KADASTR topildi!* (${lat.toFixed(6)}, ${lon.toFixed(6)})\n\n` +
                    `🧾 *KADASTR:* ${formatKadastr(normInput)}\n⌛ *Geotag qo'shilyapti...*`,
                {
                    chat_id: chatId,
                    message_id: userStates[chatId].statusMessage.message_id,
                    parse_mode: "Markdown",
                },
            );

            await processImageWithCoordinates(chatId, lat, lon);
            delete userStates[chatId];
        }
    }
});

async function processImageWithCoordinates(chatId, lat, lon) {
    try {
        const imageBuffer = userStates[chatId].imageBuffer;
        const mimeType = userStates[chatId].mimeType;
        if (!imageBuffer) throw new Error("Rasm ma'lumotlari yo'q.");

        bot.sendChatAction(chatId, "upload_photo");

        if (mimeType === "image/png") {
            await bot.editMessageText(
                "ℹ️ *Eslatma:* PNG rasmlar EXIF ma'lumotlarini mukammal saqlamasligi mumkin.\n⌛ *Qayta ishlanmoqda...*",
                {
                    chat_id: chatId,
                    message_id: userStates[chatId].statusMessage.message_id,
                    parse_mode: "Markdown",
                },
            );
        }

        const gpsLat = toDMS(lat);
        const gpsLon = toDMS(lon);
        const imageBinary = imageBuffer.toString("binary");
        let outputBuffer;

        try {
            const exifObj = piexif.load(imageBinary);
            exifObj.GPS = {
                [piexif.GPSIFD.GPSLatitude]: [
                    [gpsLat[0], 1],
                    [gpsLat[1], 1],
                    [Math.round(gpsLat[2] * 10000), 10000],
                ],
                [piexif.GPSIFD.GPSLatitudeRef]: lat >= 0 ? "N" : "S",
                [piexif.GPSIFD.GPSLongitude]: [
                    [gpsLon[0], 1],
                    [gpsLon[1], 1],
                    [Math.round(gpsLon[2] * 10000), 10000],
                ],
                [piexif.GPSIFD.GPSLongitudeRef]: lon >= 0 ? "E" : "W",
            };
            const exifBytes = piexif.dump(exifObj);
            const newImage = piexif.insert(exifBytes, imageBinary);
            outputBuffer = Buffer.from(newImage, "binary");
        } catch (e) {
            console.log("EXIF xatosi:", e);
            outputBuffer = imageBuffer;
        }

        const filePath = path.join(__dirname, `geotagged_${Date.now()}.jpg`);
        fs.writeFileSync(filePath, outputBuffer);

        await bot.sendDocument(chatId, filePath, {
            caption:
                `📍 *Rasm tayyor ✅* 📍\n\n` +
                `🌐 *Kenglik:* ${lat.toFixed(6)}\n` +
                `🌐 *Uzunlik:* ${lon.toFixed(6)}\n\n`,
            parse_mode: "Markdown",
        });

        await bot.deleteMessage(
            chatId,
            userStates[chatId].statusMessage.message_id,
        );
        fs.unlinkSync(filePath);
    } catch (err) {
        console.error("Rasmni qayta ishlashda xato:", err);
        await bot.editMessageText(
            "❌ *Rasmni qayta ishlashda xato!*\nIltimos, boshqa rasm bilan qayta urinib ko'ring.",
            {
                chat_id: chatId,
                message_id: userStates[chatId].statusMessage.message_id,
                parse_mode: "Markdown",
            },
        );
    }
}

console.log("🤖✨ Telegram bot ishga tushdi va xizmatga tayyor!");
async function handleIncomingRequest(event) {
  let url = new URL(event.request.url);
  let path = url.pathname;
  let method = event.request.method;
  let workerUrl = `${url.protocol}//${url.host}`;

  if (method === "POST" && path === webhookEndpoint) {
    const update = await event.request.json();
    event.waitUntil(bot.processUpdate(update));
    return new Response("✅ Webhook update qabul qilindi", { status: 200 });
  }

  if (method === "GET" && path === "/configure-webhook") {
    const fullUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${workerUrl}${webhookEndpoint}`;
    const telegramResp = await fetch(fullUrl);
    if (telegramResp.ok) {
      return new Response("✅ Webhook muvaffaqiyatli o‘rnatildi", { status: 200 });
    } else {
      const errorText = await telegramResp.text();
      return new Response(`❌ Xato: ${errorText}`, { status: 500 });
    }
  }

  return new Response("❓ Not found", { status: 404 });
}

addEventListener("fetch", (event) => {
  event.respondWith(handleIncomingRequest(event));
});
