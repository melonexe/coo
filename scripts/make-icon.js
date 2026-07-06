const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoMod = require('png-to-ico');
const pngToIco = pngToIcoMod.default || pngToIcoMod;

const buildDir = path.join(__dirname, '..', 'build');
const svg = fs.readFileSync(path.join(buildDir, 'icon.svg'));
const sizes = [16, 24, 32, 48, 64, 128, 256];

(async () => {
  const pngs = [];
  for (const size of sizes) {
    const file = path.join(buildDir, `icon-${size}.png`);
    await sharp(svg, { density: 300 }).resize(size, size).png().toFile(file);
    pngs.push(file);
  }
  const ico = await pngToIco(pngs);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
  console.log('build/icon.ico written with sizes:', sizes.join(', '));
})();
