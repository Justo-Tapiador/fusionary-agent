/**
 * generate-fusionary-logo.js
 * Generates a cyber-punk futuristic logo for the FUSIONARY project.
 * Output: /home/z/my-project/download/fusionary-logo.png
 */

import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const OUTPUT_PATH = '/home/z/my-project/download/fusionary-logo.png';

const PROMPT = [
  // Subject: logo emblem
  'A cyber-punk futuristic logo emblem for a nuclear fusion research project called FUSIONARY',
  // Central motif: stylized tokamak / fusion reactor core
  'central iconic tokamak fusion reactor torus with glowing plasma ring',
  'plasma core swirling with electric blue and magenta energy arcs',
  'atom symbol with three electron orbits merging into the tokamak',
  // Style: cyber-punk
  'cyberpunk aesthetic, neon glow, dark background',
  'holographic chrome metallic surfaces with cyan and purple neon accents',
  'glitch art details, scan lines, digital circuitry patterns',
  'futuristic sci-fi high-tech corporate logo design',
  // Composition
  'centered symmetric composition, clean logo silhouette',
  'detailed vector-like crisp edges, professional branding',
  // Quality
  'ultra detailed, 8k, sharp focus, high quality, professional digital art',
  // Color palette
  'dominant colors: deep black background, electric cyan #00f0ff, neon magenta #ff00aa, plasma orange #ff6600',
].join(', ');

async function main() {
  console.log('Generating FUSIONARY cyber-punk logo...');
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(`Size: 1024x1024 (square, ideal for README insertion)`);

  const zai = await ZAI.create();

  const response = await zai.images.generations.create({
    prompt: PROMPT,
    size: '1024x1024',
  });

  if (!response?.data?.[0]?.base64) {
    throw new Error('No image data in response: ' + JSON.stringify(response).slice(0, 500));
  }

  const imageBase64 = response.data[0].base64;
  const buffer = Buffer.from(imageBase64, 'base64');

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, buffer);

  const stats = fs.statSync(OUTPUT_PATH);
  console.log(`\n✓ Logo generated successfully`);
  console.log(`  Path: ${OUTPUT_PATH}`);
  console.log(`  Size: ${stats.size.toLocaleString()} bytes (${(stats.size / 1024).toFixed(1)} KB)`);
  console.log(`\nTo insert in README.md, add this line at the top:`);
  console.log(`<p align="center"><img src="fusionary-logo.png" alt="FUSIONARY" width="256"/></p>`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
