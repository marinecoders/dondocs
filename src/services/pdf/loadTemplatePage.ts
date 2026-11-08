/** Load a built-in PDF page with a bounded retry for a failed request or read. */
export async function loadTemplatePage(url: string): Promise<ArrayBuffer> {
  const read = async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Could not load PDF template (${response.status}).`);
    return response.arrayBuffer();
  };
  try { return await read(); }
  catch { return read(); }
}
