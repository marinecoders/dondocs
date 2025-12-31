const fs = require('fs');
const content = fs.readFileSync('js/texlive-packages.js', 'utf8');

// Extract cmmi8.tfm entry more precisely
const fontArrayMatch = content.match(/const TEXLIVE_FONTS = \[([\s\S]*?)\];/);
if (!fontArrayMatch) {
    console.log('TEXLIVE_FONTS not found');
    process.exit(1);
}

// Find cmmi8.tfm line
const fontLines = fontArrayMatch[1].split(/,\s*\{/).map(l => '{' + l);
for (const line of fontLines) {
    if (line.includes('cmmi8.tfm')) {
        const contentMatch = line.match(/content: '([^']+)'/);
        if (contentMatch) {
            const base64 = contentMatch[1];
            console.log('Base64 length:', base64.length);
            console.log('First 100 chars of base64:', base64.substring(0, 100));

            // Decode and check
            const decoded = Buffer.from(base64, 'base64');
            console.log('Decoded size:', decoded.length, 'bytes');
            console.log('First 20 bytes (hex):', decoded.slice(0, 20).toString('hex'));

            // Compare with actual file
            const actual = fs.readFileSync('lib/texlive/pdftex/3/cmmi8.tfm');
            console.log('Actual file size:', actual.length, 'bytes');
            console.log('Actual first 20 bytes (hex):', actual.slice(0, 20).toString('hex'));

            console.log('Files match:', decoded.equals(actual));
        }
    }
}
