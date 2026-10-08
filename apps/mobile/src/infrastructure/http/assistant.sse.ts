import type { SseFrame } from './assistant.dto';

/**
 * Incremental text/event-stream parser. Feed chunks with `push`; call `flush`
 * at end of stream. Frames are separated by a blank line; supports CRLF, multi
 * line `data:` and ignores `:` comments. Works the same whether chunks arrive
 * one by one (streaming) or as the whole body at once (fallback).
 */
export function createSseParser(onFrame: (frame: SseFrame) => void) {
  let buffer = '';

  function emit(block: string): void {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0 || event !== 'message') onFrame({ event, data: data.join('\n') });
  }

  function drain(final: boolean): void {
    // A lone trailing CR may be half of a CRLF split across chunks: hold it for the next push.
    const held = !final && buffer.endsWith('\r') ? '\r' : '';
    buffer = buffer.slice(0, buffer.length - held.length).replace(/\r\n?/g, '\n');
    let index = buffer.indexOf('\n\n');
    while (index !== -1) {
      emit(buffer.slice(0, index));
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf('\n\n');
    }
    if (final && buffer.trim() !== '') emit(buffer);
    buffer = final ? '' : buffer + held;
  }

  return {
    push(chunk: string): void {
      buffer += chunk;
      drain(false);
    },
    flush(): void {
      drain(true);
    },
  };
}
