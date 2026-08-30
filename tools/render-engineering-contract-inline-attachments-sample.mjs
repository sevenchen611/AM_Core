import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { __test as reviewTest } from '../modules/construction/contract-draft-review.js';

const base = await PDFDocument.create();
const baseFont = await base.embedFont(StandardFonts.Helvetica);
const basePage = base.addPage([595.28, 841.89]);
basePage.drawText('ENGINEERING CONTRACT DRAFT', { x: 72, y: 760, size: 22, font: baseFont, color: rgb(0.08, 0.2, 0.15) });
basePage.drawText('Contract body content appears before the attached source pages.', { x: 72, y: 720, size: 12, font: baseFont });

const drawing = await PDFDocument.create();
const drawingFont = await drawing.embedFont(StandardFonts.Helvetica);
for (let index = 1; index <= 2; index += 1) {
  const page = drawing.addPage([841.89, 595.28]);
  page.drawText(`CONSTRUCTION DRAWING - PAGE ${index}`, { x: 56, y: 530, size: 20, font: drawingFont });
  for (let x = 60; x <= 780; x += 60) page.drawLine({ start: { x, y: 70 }, end: { x, y: 500 }, thickness: 0.5 });
  for (let y = 80; y <= 480; y += 50) page.drawLine({ start: { x: 50, y }, end: { x: 790, y }, thickness: 0.5 });
}

const baseBytes = Buffer.from(await base.save());
const drawingBytes = Buffer.from(await drawing.save());
const sha256 = crypto.createHash('sha256').update(drawingBytes).digest('hex');
const output = await reviewTest.composeDraftBundle(baseBytes, [{
  id: '0', fileId: 'qa-drawing', sha256, name: 'construction-drawing.pdf',
  category: 'construction_drawing', mimeType: 'application/pdf',
}], {
  async auditDrivePrivate() { return { private: true }; },
  async downloadFromDrive() { return { buffer: drawingBytes }; },
});

const outputPath = path.resolve('tmp/pdfs/engineering-contract-inline-attachments-qa.pdf');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);
console.log(outputPath);
