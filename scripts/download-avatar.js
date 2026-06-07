const fs = require('fs');
const https = require('https');
const path = require('path');

const dest = path.join(__dirname, '..', 'public', 'assets', 'avatars.png');
const url = 'https://lh3.googleusercontent.com/aida-public/AB6AXuCL7GVDRMhKlcjx8bcgRsApT77voGdlzUygBjZDZWVsz0v2anhN9lsYjmCuFbSS8nowmKlgVI5PchmdLn8Hc8r98vY7MSQxYhMN7JTaAEfej8R8B5wEQMz4wVcGzmXeNAdlCf-8EBCLYUfIGQgA9yuRSGWMRbtJWZ26s1mQa21Tv3uzY9bEKHF-Jb4y3wTK-QJpzInT8QLGmFKA5301IH5F1SMj9nY92h19Soqo8d6VnGM2-cBww6qs7kIhihv8gaq-d6GV-EcTjg75';

const file = fs.createWriteStream(dest);
https.get(url, (response) => {
    response.pipe(file);
    file.on('finish', () => {
        file.close();
        console.log('Downloaded avatar sprite sheet!');
    });
}).on('error', (err) => {
    fs.unlink(dest, () => {});
    console.error('Error downloading avatar sprite sheet:', err.message);
});
