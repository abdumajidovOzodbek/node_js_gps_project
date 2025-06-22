const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const piexif = require('piexifjs');
const cors = require('cors');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const corsOptions = {
    origin: 'https://0431ae38-40d8-409b-ab1b-275a5a9a204f-00-bxp0bulcl2wd.pike.replit.dev', // Your frontend URL
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type'],
};

app.use(cors(corsOptions));
app.use(express.json());

app.post('/upload', upload.single('image'), async (req, res) => {
    const lat = parseFloat(req.body.lat);
    const lon = parseFloat(req.body.lon);

    const toDMS = (deg) => {
        const absDeg = Math.abs(deg);
        const degrees = Math.floor(absDeg);
        const minutes = Math.floor((absDeg - degrees) * 60);
        const seconds = ((absDeg - degrees - minutes / 60) * 3600).toFixed(6);
        return [degrees, minutes, Math.round(seconds * 10000) / 10000];
    };

    const gpsLatitude = toDMS(lat);
    const gpsLongitude = toDMS(lon);

    try {
        const jpegImage = req.file.buffer.toString('binary');
        const exifObj = piexif.load(jpegImage);

        // Debugging line to check EXIF structure
        console.log("EXIF Object:", exifObj.GPS);

        // Initialize the GPS object if it doesn't exist
        if (!exifObj.GPS) {
            exifObj.GPS = {};
        }

        exifObj.GPS[piexif.GPSIFD.GPSLatitude] = [
            [gpsLatitude[0], 1], // degrees
            [gpsLatitude[1], 1], // minutes
            [Math.round(gpsLatitude[2] * 10000), 10000], // seconds
        ];
        exifObj.GPS[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? 'N' : 'S';

        exifObj.GPS[piexif.GPSIFD.GPSLongitude] = [
            [gpsLongitude[0], 1], // degrees
            [gpsLongitude[1], 1], // minutes
            [Math.round(gpsLongitude[2] * 10000), 10000], // seconds
        ];
        exifObj.GPS[piexif.GPSIFD.GPSLongitudeRef] = lon >= 0 ? 'E' : 'W';

        // Serialize back to EXIF binary
        const exifBytes = piexif.dump(exifObj);
        const newJpeg = piexif.insert(exifBytes, jpegImage);
        const outputBuffer = Buffer.from(newJpeg, 'binary');

        const outputFileName = path.join(__dirname, 'geotagged_image.jpg');
        await fs.promises.writeFile(outputFileName, outputBuffer);

        res.sendFile(outputFileName, (err) => {
            if (err) {
                console.error("Error sending file:", err);
                res.status(500).send("Error processing the image");
            }
            fs.unlinkSync(outputFileName); // Remove the file after sending it
        });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).send("Error processing the image");
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
