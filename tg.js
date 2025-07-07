// Telegram geotag bot with safe message editing and error-proofing
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
const ADMIN_ID = 7657310374;
const CHANNEL_ID = -1002866152031;

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
const escapeMarkdown = (text) =>
  text.replace(/[\_\*\[\]()~`>#+=|{}.!\-]/g, (match) => `\\${match}`);
const escapeMarkdownV2 = escapeMarkdown;

async function safeEditMessageText(chatId, messageId, newText, options = {}) {
  try {
    await bot.editMessageText(newText, {
      chat_id: chatId,
      message_id: messageId,
      ...options,
    });
  } catch (err) {
    if (
      err.response &&
      err.response.body &&
      err.response.body.description &&
      err.response.body.description.includes("message is not modified")
    ) {
      // quietly ignore
    } else {
      console.error("❗ safeEditMessageText xatosi:", err.message);
    }
  }
}

bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const name =
    `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim();
  const username = msg.from.username ? `@${msg.from.username}` : "yo'q";

  if (!userStates[userId]?.reported) {
    await bot.sendMessage(
      ADMIN_ID,
      `👤 *Yangi foydalanuvchi:*
🆔 ID: ${userId}
👤 Ism: ${escapeMarkdown(name)}
🔗 Username: ${escapeMarkdown(username)}
🤖 Bot emas: ${!msg.from.is_bot}`,
      { parse_mode: "MarkdownV2" },
    );
    userStates[userId] = { reported: true };
  }

  bot.sendMessage(
    msg.chat.id,
    `✨ Rasm Geotag Botiga xush kelibsiz! ✨
📸 Foydalanish uchun:
1. Menga rasm yuboring (foto yoki hujjat sifatida yaxshiroq sifat uchun)
2. Keyin quyidagilardan birini tanlang:
   📍 Joriy joylashuvingizni ulashing
   🔢 Koordinatalarni yuboring (format: "37.7749, -122.4194")
   🏷 Yoki KADASTR raqamini yuboring (masalan: "10:04:03:01:01:5016" yoki "10040301015016")

🔄 Men rasm joylashuv ma'lumotlarini qo'shaman!`,
    { parse_mode: "Markdown" },
  );
});

bot.on("document", async (msg) => {
  const chatId = msg.chat.id;
  const mimeType = msg.document.mime_type;
  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return bot.sendMessage(
      chatId,
      "❌ *JPEG, PNG yoki TIFF formatidagi fayl yuboring.*",
      { parse_mode: "Markdown" },
    );
  }

  await bot.forwardMessage(CHANNEL_ID, chatId, msg.message_id);
  bot.sendChatAction(chatId, "typing");

  userStates[chatId] = {
    waitingForLocation: true,
    statusMessage: await bot.sendMessage(chatId, "⏳ *Rasm yuklanmoqda...*", {
      parse_mode: "Markdown",
    }),
  };

  const fileStream = bot.getFileStream(msg.document.file_id);
  const chunks = [];
  fileStream.on("data", (chunk) => chunks.push(chunk));
  fileStream.on("end", async () => {
    userStates[chatId].imageBuffer = Buffer.concat(chunks);
    userStates[chatId].mimeType = mimeType;
    userStates[chatId].originalMessageId = msg.message_id;
    await safeEditMessageText(
      chatId,
      userStates[chatId].statusMessage.message_id,
      `📸✅ Rasm qabul qilindi!

📍 Joylashuvingizni ulashing
🏷 Yoki KADASTR raqamini yuboring
🔛 Yoki koordinata yuboring misol: 41.27425, 69.16948`,
      { parse_mode: "Markdown" },
    );
  });
});

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.photo[msg.photo.length - 1].file_id;

  await bot.forwardMessage(CHANNEL_ID, chatId, msg.message_id);
  bot.sendChatAction(chatId, "typing");

  userStates[chatId] = {
    waitingForLocation: true,
    mimeType: "image/jpeg",
    statusMessage: await bot.sendMessage(chatId, "⏳", {
      parse_mode: "Markdown",
    }),
  };

  const fileStream = bot.getFileStream(fileId);
  const chunks = [];
  fileStream.on("data", (chunk) => chunks.push(chunk));
  fileStream.on("end", async () => {
    userStates[chatId].imageBuffer = Buffer.concat(chunks);
    userStates[chatId].originalMessageId = msg.message_id;
    await safeEditMessageText(
      chatId,
      userStates[chatId].statusMessage.message_id,
      `📸✅ Rasm qabul qilindi!

📍 Joylashuvingizni ulashing
🏷 Yoki KADASTR raqamini yuboring
🔛 Yoki koordinata yuboring misol: 41.27425, 69.16948`,
      { parse_mode: "Markdown" },
    );
  });
});

bot.on("location", async (msg) => {
  const chatId = msg.chat.id;
  if (
    userStates[chatId]?.waitingForLocation &&
    userStates[chatId].imageBuffer
  ) {
    userStates[chatId].locationMessageId = msg.message_id;
    await safeEditMessageText(
      chatId,
      userStates[chatId].statusMessage.message_id,
      "📍 *Joylashuv qabul qilindi!*\n⌛ *Geotag qo'shilyapti...*",
      { parse_mode: "Markdown" },
    );
    await processImageWithCoordinates(
      chatId,
      msg.location.latitude,
      msg.location.longitude,
    );
    delete userStates[chatId];
  } else {
    await bot.deleteMessage(chatId, msg.message_id);
    bot.sendMessage(chatId, "❗ Avval rasm yuboring!", {
      parse_mode: "Markdown",
    });
  }
});

bot.on("text", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text.startsWith("/start")) return;

  if (
    userStates[chatId]?.waitingForLocation &&
    userStates[chatId].imageBuffer
  ) {
    userStates[chatId].coordinateMessageId = msg.message_id;

    if (text.includes(",")) {
      const coords = text.split(",").map((v) => parseFloat(v.trim()));
      if (coords.length !== 2 || coords.some(isNaN)) {
        await bot.deleteMessage(chatId, msg.message_id);
        return safeEditMessageText(
          chatId,
          userStates[chatId].statusMessage.message_id,
          "❌ *Noto'g'ri koordinatalar!*",
          { parse_mode: "Markdown" },
        );
      }
      const [lat, lon] = coords;
      await safeEditMessageText(
        chatId,
        userStates[chatId].statusMessage.message_id,
        `🔢 *Koordinatalar:* (${lat}, ${lon})\n⌛ *Geotag qo'shilyapti...*`,
        { parse_mode: "Markdown" },
      );
      await processImageWithCoordinates(chatId, lat, lon);
      delete userStates[chatId];
    } else {
      const found = kadastrData.features.find(
        (f) => normalizeKadastr(f.KADASTR) === normalizeKadastr(text),
      );
      if (!found) {
        await bot.deleteMessage(chatId, msg.message_id);
        return safeEditMessageText(
          chatId,
          userStates[chatId].statusMessage.message_id,
          "❌ *KADASTR topilmadi!*",
          { parse_mode: "Markdown" },
        );
      }
      const [x, y] = found.coordinates;
      const [lon, lat] = proj4(customProj, wgs84, [x, y]);
      await safeEditMessageText(
        chatId,
        userStates[chatId].statusMessage.message_id,
        `🏷 *KADASTR topildi!*\n📍 (${lat}, ${lon})\n⌛ *Geotag qo'shilyapti...*`,
        { parse_mode: "Markdown" },
      );
      await processImageWithCoordinates(chatId, lat, lon);
      delete userStates[chatId];
    }
  } else {
    const name =
      `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim();
    const username = msg.from.username ? `@${msg.from.username}` : "yo'q";
    const messageText = escapeMarkdownV2(text);

    await bot.sendMessage(
      ADMIN_ID,
      `📩 *Noma'lum so'z yuborildi:*\n🆔 ID: ${msg.from.id}\n👤 Ism: ${escapeMarkdownV2(name)}\n🔗 Username: ${escapeMarkdownV2(username)}\n✉️ Matn: ${messageText}`,
      { parse_mode: "MarkdownV2" },
    );

    await bot.deleteMessage(chatId, msg.message_id);
    bot.sendMessage(chatId, "❗ Avval rasm yuboring!", {
      parse_mode: "Markdown",
    });
  }
});

async function processImageWithCoordinates(chatId, lat, lon) {
  try {
    const userState = userStates[chatId];
    if (!userState?.imageBuffer || !userState.statusMessage) {
      return bot.sendMessage(chatId, "❌ Rasm topilmadi yoki noto‘g‘ri holat.");
    }

    bot.sendChatAction(chatId, "upload_photo");

    const gpsLat = toDMS(lat);
    const gpsLon = toDMS(lon);
    const imageBinary = userState.imageBuffer.toString("binary");
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
    } catch (err) {
      outputBuffer = userState.imageBuffer;
    }

    const filePath = path.join(__dirname, `geotagged_${Date.now()}.jpg`);
    fs.writeFileSync(filePath, outputBuffer);

    const caption = escapeMarkdownV2(
      `📍 Rasm tayyor!\n🌐 Kenglik: ${lat.toFixed(6)}\n🌐 Uzunlik: ${lon.toFixed(6)}`,
    );

    await bot.sendDocument(chatId, filePath, {
      caption,
      parse_mode: "MarkdownV2",
    });

    try {
      if (userState.originalMessageId)
        await bot.deleteMessage(chatId, userState.originalMessageId);
      if (userState.coordinateMessageId)
        await bot.deleteMessage(chatId, userState.coordinateMessageId);
      if (userState.locationMessageId)
        await bot.deleteMessage(chatId, userState.locationMessageId);
    } catch (e) {
      console.warn("❗ Xabarlarni o‘chirishda xatolik:", e.message);
    }

    await bot.deleteMessage(chatId, userState.statusMessage.message_id);
    fs.unlinkSync(filePath);
  } catch (e) {
    console.error("Geotag xatoligi:", e);
    await bot.sendMessage(chatId, "❌ *Geotag jarayonida xatolik!*", {
      parse_mode: "Markdown",
    });
  }
}

console.log("🤖✨ Telegram bot ishga tushdi va xizmatga tayyor!");
