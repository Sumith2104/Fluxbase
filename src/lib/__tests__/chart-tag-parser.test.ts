import { describe, it, expect } from 'vitest';
import { extractChartTag, stripChartTags } from '../chart-tag-parser';

describe('extractChartTag', () => {
  it('correctly extracts RENDER_CHART with nested array brackets in data', () => {
    const raw = `Now, I'll generate a line chart with this data. The chart will have 'Day' on the X-axis and 'Sales' on the Y-axis.

[RENDER_CHART:{"type":"line","title":"30-Day Sales Trend","data":[{"day":1,"sales":120},{"day":2,"sales":135}],"xKey":"day","yKey":"sales"}]`;

    const result = extractChartTag(raw);

    expect(result.chart).toBeDefined();
    expect(result.chart?.type).toBe('line');
    expect(result.chart?.title).toBe('30-Day Sales Trend');
    expect(result.chart?.xKey).toBe('day');
    expect(result.chart?.yKey).toBe('sales');
    expect(result.chart?.data).toEqual([
      { day: 1, sales: 120 },
      { day: 2, sales: 135 }
    ]);

    expect(result.cleanedText).toBe(
      "Now, I'll generate a line chart with this data. The chart will have 'Day' on the X-axis and 'Sales' on the Y-axis."
    );
    expect(result.cleanedText).not.toContain('xKey');
    expect(result.cleanedText).not.toContain('yKey');
    expect(result.cleanedText).not.toContain('RENDER_CHART');
  });

  it('handles spaces and newlines around tag syntax', () => {
    const raw = `Here is the bar chart:
[RENDER_CHART:   {
  "type": "bar",
  "title": "Monthly Revenue",
  "data": [
    { "month": "Jan", "rev": 1000 },
    { "month": "Feb", "rev": 1500 }
  ],
  "xKey": "month",
  "yKey": "rev"
}   ]
Hope this helps!`;

    const result = extractChartTag(raw);
    expect(result.chart).toBeDefined();
    expect(result.chart?.type).toBe('bar');
    expect(result.chart?.data.length).toBe(2);
    expect(result.cleanedText).toContain('Here is the bar chart:');
    expect(result.cleanedText).toContain('Hope this helps!');
    expect(result.cleanedText).not.toContain('RENDER_CHART');
  });

  it('strips leaking orphan JSON fragments from broken turns', () => {
    const broken = `Now, I'll generate a line chart with this data. The chart will have 'Day' on the X-axis and 'Sales' on the Y-axis.

,"xKey":"day","yKey":"sales"}]`;

    const result = extractChartTag(broken);
    expect(result.cleanedText).toBe(
      "Now, I'll generate a line chart with this data. The chart will have 'Day' on the X-axis and 'Sales' on the Y-axis."
    );
    expect(result.cleanedText).not.toContain('xKey');
    expect(result.cleanedText).not.toContain('yKey');
  });

  it('handles in-progress streaming where tag is unclosed', () => {
    const streaming = `Generating chart...\n\n[RENDER_CHART:{"type":"line","data":[{"day":1`;
    const result = extractChartTag(streaming);
    expect(result.cleanedText).toBe('Generating chart...');
    expect(result.cleanedText).not.toContain('RENDER_CHART');
  });

  it('handles multiple tags in same message', () => {
    const raw = `Chart 1:
[RENDER_CHART:{"type":"bar","title":"Chart 1","data":[{"a":1}],"xKey":"a","yKey":"a"}]
Chart 2:
[RENDER_CHART:{"type":"line","title":"Chart 2","data":[{"b":2}],"xKey":"b","yKey":"b"}]`;

    const result = extractChartTag(raw);
    expect(result.chart).toBeDefined();
    expect(result.cleanedText).toContain('Chart 1:');
    expect(result.cleanedText).toContain('Chart 2:');
    expect(result.cleanedText).not.toContain('RENDER_CHART');
  });

  it('handles strings containing escaped quotes', () => {
    const raw = `[RENDER_CHART:{"type":"pie","title":"User \\"Special\\" Status","data":[{"status":"Active \\"Pro\\"","val":40}],"xKey":"status","yKey":"val"}]`;
    const result = extractChartTag(raw);
    expect(result.chart).toBeDefined();
    expect(result.chart?.title).toBe('User "Special" Status');
  });
});
