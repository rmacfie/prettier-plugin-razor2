// A minimal stand-in for prettier-plugin-tailwindcss: it overrides Prettier's
// built-in `html` parser to sort the tokens in every class="" attribute. Used
// to prove that plugins which hook the html parser compose with this plugin's
// HTML delegation (see tests/plugin-composition.test.ts).
import htmlPlugin from 'prettier/plugins/html';

const base = htmlPlugin.parsers.html;

export const parsers = {
  html: {
    ...base,
    async preprocess(text, options) {
      const pre = base.preprocess ? await base.preprocess(text, options) : text;
      return pre.replace(
        /class="([^"]*)"/g,
        (_m, cls) => `class="${cls.trim().split(/\s+/).sort().join(' ')}"`,
      );
    },
  },
};
