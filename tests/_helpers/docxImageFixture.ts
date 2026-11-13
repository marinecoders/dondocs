import sharp from 'sharp';

/** Synthetic artwork with distinct dimensions and visible shapes. */
export async function docxImageFixture() {
  const signature = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="90"><rect width="360" height="90" fill="white"/><path d="M15 65 Q45 10 70 55 T125 45 Q155 85 185 35 T250 50 L340 40" fill="none" stroke="black" stroke-width="5"/></svg>')).png().toBuffer();
  const figure = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="#e6f0ff"/><rect x="30" y="50" width="120" height="140" fill="#004c99"/><circle cx="310" cy="120" r="80" fill="#b32929"/></svg>')).png().toBuffer();
  const jpeg = await sharp(figure).jpeg().toBuffer();
  return { signature, figure, jpeg };
}
