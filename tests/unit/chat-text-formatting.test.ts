import { describe, expect, it } from 'vitest';
import { formatReadableText, parseTaskProgressText } from '@/pages/Chat/text-formatting';

describe('formatReadableText', () => {
  it('splits long plain Chinese paragraphs into readable sections', () => {
    const text =
      '我会先查看当前页面的组件结构，确认处理任务消息是从哪个数据源渲染出来的。然后我会检查流式输出和历史消息是否走了同一个渲染组件，避免只修改最终回复但任务过程仍然是一大段。接着我会在展示层增加分段规则，只对没有结构的长自然语言段落生效，不改变实际发送给模型的内容。最后我会补充测试，确认代码块、列表和已有 Markdown 不会被误处理。';

    const formatted = formatReadableText(text);

    expect(formatted).toContain('\n\n');
    expect(formatted.split('\n\n').length).toBeGreaterThan(1);
    expect(formatted.replace(/\n/g, '')).toBe(text);
  });

  it('splits compact task progress messages into separate steps', () => {
    const text =
      '好的！我来为另外7个没有竞品数据的女性大衣产品补充竞品信息。让我先查看当前的竞品数据，然后为剩余的产品添加模拟的竞品数据。现在我为剩余的7个产品添加竞品数据';

    expect(formatReadableText(text)).toBe(
      '好的！我来为另外7个没有竞品数据的女性大衣产品补充竞品信息。\n\n让我先查看当前的竞品数据，然后为剩余的产品添加模拟的竞品数据。\n\n现在我为剩余的7个产品添加竞品数据'
    );
  });

  it('extracts compact task progress messages for step rendering', () => {
    const text =
      '好的！我来为另外7个没有竞品数据的女性大衣产品补充竞品信息。让我先查看当前的竞品数据，然后为剩余的产品添加模拟的竞品数据。现在我为剩余的7个产品添加竞品数据';

    expect(parseTaskProgressText(text)).toEqual({
      intro: '好的！我来为另外7个没有竞品数据的女性大衣产品补充竞品信息。',
      steps: [
        '查看当前的竞品数据，然后为剩余的产品添加模拟的竞品数据。',
        '为剩余的7个产品添加竞品数据',
      ],
    });
  });

  it('keeps fenced code blocks unchanged', () => {
    const code = '```ts\nconst value = "这是一段很长但是不应该被拆开的代码内容。";\n```';
    const text = `${code}\n\n我会先查看当前页面的组件结构，确认处理任务消息是从哪个数据源渲染出来的。然后我会检查流式输出和历史消息是否走了同一个渲染组件，避免只修改最终回复但任务过程仍然是一大段。接着我会在展示层增加分段规则。`;

    const formatted = formatReadableText(text);

    expect(formatted).toContain(code);
    expect(formatted).toContain('\n\n我会先查看');
  });

  it('does not split existing markdown list items', () => {
    const text =
      '- 我会先查看当前页面的组件结构，确认处理任务消息是从哪个数据源渲染出来的。然后我会检查流式输出和历史消息是否走了同一个渲染组件，避免只修改最终回复但任务过程仍然是一大段。\n- 接着我会在展示层增加分段规则，只对没有结构的长自然语言段落生效。';

    expect(formatReadableText(text)).toBe(text);
  });
});
