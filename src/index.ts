import type { Parser, Printer, SupportLanguage } from 'prettier';

import type { AnyNode, RootNode } from './ast.ts';
import { parse as parseRazor } from './parse.ts';
import { print } from './print.ts';

export const languages: SupportLanguage[] = [
  {
    name: 'Razor',
    parsers: ['razor'],
    extensions: ['.razor'],
    vscodeLanguageIds: ['razor'],
  },
];

export const parsers: Record<string, Parser<RootNode>> = {
  razor: {
    parse: (text) => parseRazor(text),
    astFormat: 'razor-ast',
    locStart: () => 0,
    locEnd: () => 0,
  },
};

export const printers: Record<string, Printer<AnyNode>> = {
  'razor-ast': { print },
};
