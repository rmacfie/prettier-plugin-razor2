import type {
  AstPath,
  Doc,
  Options,
  Parser,
  Plugin,
  Printer,
  SupportLanguage,
} from 'prettier';

import { formatDocument } from './format.ts';

/** Trivial AST: the whole document is formatted in one embedded pass. */
interface RazorRoot {
  type: 'razor-root';
  source: string;
}

export const languages: SupportLanguage[] = [
  {
    name: 'Razor',
    parsers: ['razor'],
    // .razor = Blazor components; .cshtml = MVC views / Razor Pages. Same
    // grammar, so both use this parser.
    extensions: ['.razor', '.cshtml'],
    vscodeLanguageIds: ['razor', 'aspnetcorerazor'],
  },
];

export const parsers: Record<string, Parser<RazorRoot>> = {
  razor: {
    parse: (text) => ({ type: 'razor-root', source: text }),
    astFormat: 'razor-ast',
    locStart: () => 0,
    locEnd: () => 0,
  },
};

export const options: Plugin['options'] = {
  csharpierEnabled: {
    type: 'boolean',
    category: 'Razor',
    default: true,
    description:
      'Format embedded C# (@code/@functions/@{ } blocks) with CSharpier. ' +
      'When false, C# is kept verbatim.',
  },
  csharpierCommand: {
    type: 'string',
    category: 'Razor',
    default: 'dotnet csharpier',
    description: 'Command used to invoke the CSharpier CLI.',
  },
};

export const printers: Record<string, Printer<RazorRoot>> = {
  'razor-ast': {
    // All work happens in `embed` (the only async printer hook); `print` is
    // required but unused.
    print: () => '',
    embed(path: AstPath<RazorRoot>) {
      const node = path.node;
      if (node.type !== 'razor-root') return null;
      return async (
        textToDoc,
        _print,
        _embedPath,
        options: Options,
      ): Promise<Doc> => {
        const formatted = await formatDocument(node.source, textToDoc, options);
        return formatted.replace(/\s+$/, '') + '\n';
      };
    },
  },
};
