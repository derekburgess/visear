const sharp = require('sharp');

async function convertToBase64(imagePath) {
    const buf = await sharp(imagePath)
        .rotate()
        .resize({ width: 1024, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    return buf.toString('base64');
}

async function isImageTiff(imagePath) {
    return /\.tiff?$/i.test(imagePath);
}

module.exports = {
    convertToBase64,
    isImageTiff
};
