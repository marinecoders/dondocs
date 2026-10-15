/** pdf.js ships no types for its worker module; the page only needs its one export to exist. */
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
