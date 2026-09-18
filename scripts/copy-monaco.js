const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '../node_modules/monaco-editor/min/vs');
const dest = path.join(__dirname, '../public/monaco-editor/vs');

console.log(`[Copy Monaco] Source: ${src}`);
console.log(`[Copy Monaco] Destination: ${dest}`);

try {
    if (!fs.existsSync(src)) {
        console.log('[Copy Monaco] Note: Local monaco-editor source not found. @monaco-editor/react will load from CDN.');
        process.exit(0);
    }

    // Create destination directory if it doesn't exist
    fs.mkdirSync(dest, { recursive: true });

    // Use cpSync (Node.js v16.7.0+)
    fs.cpSync(src, dest, { recursive: true, force: true });
    console.log('[Copy Monaco] Success: Monaco assets copied to public folder.');
} catch (err) {
    console.warn('[Copy Monaco] Notice: Monaco assets could not be copied, falling back to CDN:', err.message);
    process.exit(0);
}
