/** @type {import('prettier').Config} */
export default {
  plugins: ['prettier-plugin-packagejson', 'prettier-plugin-jsdoc'],

  quoteProps: 'consistent',
  singleQuote: true,

  overrides: [
    {
      files: ['*.md'],
      options: { proseWrap: 'always' },
    },
  ],
};
