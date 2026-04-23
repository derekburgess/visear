const Jimp = require('jimp');
const fs = require('fs').promises;

async function convertToBase64(imagePath) {
    const image = await Jimp.read(imagePath);
    const base64 = await image.quality(50).getBase64Async(Jimp.MIME_JPEG);
    return base64.replace(/^data:image\/jpeg;base64,/, '');
}

async function isImageTiff(imagePath) {
    return /\.tiff?$/i.test(imagePath);
}

module.exports = {
    convertToBase64,
    isImageTiff
}; 