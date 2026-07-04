// The async mask -> HTML-format -> restore pipeline. See DESIGN.md.

import { doc, type Doc } from 'prettier';

import { formatCSharp, type RazorOptions } from './csharp.ts';
import { mask, type RazorBlock } from './scan.ts';

type Options = RazorOptions;

/** Formats a chunk of embedded code with a given parser. */
type TextToDoc = (text: string, options: Options) => Promise<Doc>;

// Captures the indentation immediately preceding a placeholder so the restored
// construct can be re-indented to match. Handles both own-line placeholders
// (block-level) and inline ones Prettier chose not to break. Constructed fresh
// per call — `restore` recurses, so a shared /g regex's lastIndex would clash.
const placeholderRE = (): RegExp => /([ \t]*)<div data-razor="(\d+)"><\/div>/g;

function indentUnit(options: Options): string {
  return options.useTabs ? '\t' : ' '.repeat(options.tabWidth ?? 2);
}

function indentLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '' : prefix + line))
    .join('\n');
}

// Re-base a verbatim block (C# kept as-is) to `indent`. Top-level blocks
// (indent === '') are emitted unchanged.
function reindentVerbatim(text: string, indent: string): string {
  if (indent === '') return text;
  return indentLines(text, indent);
}

async function renderBlock(
  block: RazorBlock,
  indent: string,
  textToDoc: TextToDoc,
  options: Options,
): Promise<string> {
  switch (block.kind) {
    case 'directive':
      return indent + block.text;
    case 'verbatim': {
      const formatted = await formatCSharp(block.body, block.csharp, options);
      // CSharpier unavailable/disabled or couldn't parse the C#: keep verbatim.
      if (formatted === null) return reindentVerbatim(block.raw, indent);
      if (formatted === '') return `${indent}${block.opener}\n${indent}}`;
      const body = indentLines(formatted, indent + indentUnit(options));
      return `${indent}${block.opener}\n${body}\n${indent}}`;
    }
    case 'control': {
      const inner = indent + indentUnit(options);
      const parts: string[] = [];
      for (const clause of block.clauses) {
        parts.push(indent + clause.header);
        parts.push(indent + '{');
        const body = (
          await formatDocument(clause.body, textToDoc, options)
        ).trimEnd();
        if (body !== '') parts.push(indentLines(body, inner));
        parts.push(indent + '}');
      }
      let result = parts.join('\n');
      if (block.trailer) result += '\n' + indent + block.trailer;
      return result;
    }
  }
}

async function restore(
  html: string,
  blocks: RazorBlock[],
  textToDoc: TextToDoc,
  options: Options,
): Promise<string> {
  const re = placeholderRE();
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out += html.slice(last, m.index);
    out += await renderBlock(blocks[Number(m[2])]!, m[1]!, textToDoc, options);
    last = m.index + m[0].length;
  }
  out += html.slice(last);
  return out;
}

/**
 * Format Razor source into a formatted string: mask the Razor constructs,
 * delegate the remaining markup to Prettier's HTML printer, then restore the
 * constructs (recursing into control-block bodies).
 */
export async function formatDocument(
  source: string,
  textToDoc: TextToDoc,
  options: Options,
): Promise<string> {
  if (source.trim() === '') return '';

  const { masked, blocks } = mask(source);

  const htmlDoc = await textToDoc(masked, { parser: 'html' });
  const html = doc.printer.printDocToString(htmlDoc, {
    printWidth: options.printWidth ?? 80,
    tabWidth: options.tabWidth ?? 2,
    useTabs: options.useTabs ?? false,
    // printDocToString requires these fields; they don't affect our output.
    parser: 'html',
    endOfLine: 'lf',
  } as never).formatted;

  return blocks.length === 0 ? html : restore(html, blocks, textToDoc, options);
}
