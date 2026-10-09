/**
 * Server-Sent Events frame parser for environments without EventSource
 * (Node CLI). Handles multi-line `data:`, `id:`, comments and CRLF.
 */

export interface SseFrame {
  event: string;
  data: string;
  id?: string;
}

export function parseSseFrame(raw: string): SseFrame | null {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
  }
  if (data.length === 0 && event === 'message') return null; // keep-alive only
  return { event, data: data.join('\n'), id };
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let m: RegExpExecArray | null;
      while ((m = /\r?\n\r?\n/.exec(buffer))) {
        const frame = parseSseFrame(buffer.slice(0, m.index));
        buffer = buffer.slice(m.index + m[0].length);
        if (frame) yield frame;
      }
    }
    const tail = parseSseFrame(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
