const fs = require('fs');
const path = require('path');
const https = require('https');

const LIBS_DIR = path.join(__dirname, '..', 'public', 'assets', 'libs');
const FONTS_DIR = path.join(__dirname, '..', 'public', 'assets', 'fonts');

// Create directories
fs.mkdirSync(LIBS_DIR, { recursive: true });
fs.mkdirSync(FONTS_DIR, { recursive: true });

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const request = https.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        }, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                // Handle redirect
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: Status ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`Downloaded: ${path.basename(dest)}`);
                resolve();
            });
        });
        request.on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

function fetchText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        }, (response) => {
            let data = '';
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function downloadGoogleFonts() {
    console.log('Downloading Google Fonts & Material Icons...');
    
    // We will download Sora and Hanken Grotesk
    const fontsCssUrl = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Hanken+Grotesk:wght@400;600&display=swap';
    const iconsCssUrl = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap';
    
    let fontCss = await fetchText(fontsCssUrl);
    let iconCss = await fetchText(iconsCssUrl);
    
    // Parse font URLs and download them
    fontCss = await downloadAndReplaceFonts(fontCss, 'fonts');
    iconCss = await downloadAndReplaceFonts(iconCss, 'icons');
    
    // Save CSS files locally
    fs.writeFileSync(path.join(FONTS_DIR, 'fonts.css'), fontCss, 'utf8');
    fs.writeFileSync(path.join(FONTS_DIR, 'icons.css'), iconCss, 'utf8');
    console.log('Google Fonts and Icons saved locally!');
}

async function downloadAndReplaceFonts(cssContent, prefix) {
    // Regex to find src: url(https://...)
    const urlRegex = /url\((https:\/\/[^)]+)\)/g;
    let match;
    const urls = [];
    
    while ((match = urlRegex.exec(cssContent)) !== null) {
        urls.push(match[1]);
    }
    
    // Remove duplicates
    const uniqueUrls = [...new Set(urls)];
    
    for (let i = 0; i < uniqueUrls.length; i++) {
        const url = uniqueUrls[i];
        const ext = path.extname(new URL(url).pathname) || '.woff2';
        const filename = `${prefix}_font_${i}${ext}`;
        const destPath = path.join(FONTS_DIR, filename);
        
        try {
            await downloadFile(url, destPath);
            // Replace in CSS with relative path
            cssContent = cssContent.split(url).join(`./${filename}`);
        } catch (e) {
            console.error(`Failed to download font: ${url}`, e.message);
        }
    }
    
    return cssContent;
}

async function run() {
    try {
        console.log('Starting libraries download...');
        // Download Alpine.js
        await downloadFile('https://unpkg.com/alpinejs@3.13.5/dist/cdn.min.js', path.join(LIBS_DIR, 'alpine.min.js'));
        
        // Download QRious QR Code library
        await downloadFile('https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js', path.join(LIBS_DIR, 'qrious.min.js'));
        
        // Download Google Fonts and Icons
        await downloadGoogleFonts();
        
        console.log('All offline libraries downloaded successfully!');
    } catch (e) {
        console.error('Error in libraries download:', e);
    }
}

run();
