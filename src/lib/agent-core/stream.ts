export type AgentStreamEvent =
  | { type: 'thought'; token: string }
  | { type: 'text'; token: string }
  | { type: 'action'; action: string }
  | { type: 'chart'; chart: any }
  | { type: 'approval'; approval: any }
  | { type: 'sources'; sources: string[] }
  | { type: 'error'; message: string }
  | { type: 'done'; fullText: string; thought?: string };

/**
 * Encodes an AgentStreamEvent into standard SSE data line.
 */
export function formatSseEvent(event: AgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Creates a TransformStream that ingests upstream OpenAI/GLM SSE lines
 * and emits structured Fluxbase AgentStreamEvent chunks.
 */
export function createAgentSseTransformStream(sources: string[] = []): TransformStream<Uint8Array, Uint8Array> {
  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();

  let buffer = '';
  let inThinkTag = false;
  let accumulatedThought = '';
  let accumulatedText = '';
  let keepAliveTimer: any = null;

  return new TransformStream({
    start(controller) {
      // Send SSE keep-alive ping every 10 seconds to prevent proxy/browser timeout disconnects
      keepAliveTimer = setInterval(() => {
        try {
          controller.enqueue(textEncoder.encode(': keepalive\n\n'));
        } catch {
          if (keepAliveTimer) clearInterval(keepAliveTimer);
        }
      }, 10000);
    },
    transform(chunk, controller) {
      buffer += textDecoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue; // Comment or keep-alive

        if (trimmed === 'data: [DONE]') {
          continue;
        }

        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta;
            if (!delta) continue;

            const content = delta.content || '';
            if (!content) continue;

            // Handle <think> / </think> tag transitions in the live stream
            let remaining = content;

            while (remaining.length > 0) {
              if (!inThinkTag) {
                const thinkOpenIdx = remaining.indexOf('<think>');
                if (thinkOpenIdx !== -1) {
                  // Emit any text preceding <think>
                  const pre = remaining.slice(0, thinkOpenIdx);
                  if (pre) {
                    accumulatedText += pre;
                    controller.enqueue(textEncoder.encode(formatSseEvent({ type: 'text', token: pre })));
                  }
                  inThinkTag = true;
                  remaining = remaining.slice(thinkOpenIdx + 7);
                } else {
                  accumulatedText += remaining;
                  controller.enqueue(textEncoder.encode(formatSseEvent({ type: 'text', token: remaining })));
                  remaining = '';
                }
              } else {
                const thinkCloseIdx = remaining.indexOf('</think>');
                if (thinkCloseIdx !== -1) {
                  const thoughtToken = remaining.slice(0, thinkCloseIdx);
                  accumulatedThought += thoughtToken;
                  if (thoughtToken) {
                    controller.enqueue(textEncoder.encode(formatSseEvent({ type: 'thought', token: thoughtToken })));
                  }
                  inThinkTag = false;
                  remaining = remaining.slice(thinkCloseIdx + 8);
                } else {
                  accumulatedThought += remaining;
                  controller.enqueue(textEncoder.encode(formatSseEvent({ type: 'thought', token: remaining })));
                  remaining = '';
                }
              }
            }
          } catch {
            // Incomplete JSON line in chunk, ignore and continue
          }
        }
      }
    },
    flush(controller) {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      if (sources.length > 0) {
        controller.enqueue(textEncoder.encode(formatSseEvent({ type: 'sources', sources })));
      }

      controller.enqueue(
        textEncoder.encode(
          formatSseEvent({
            type: 'done',
            fullText: accumulatedText.trim(),
            thought: accumulatedThought.trim() || undefined
          })
        )
      );
    }
  });
}
