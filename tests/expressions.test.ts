// Inline Razor expressions and directive attributes. The scanner must leave
// implicit expressions/attributes for Prettier, but mask explicit `@(…)`
// expressions (which may contain `<`/generics that HTML parsing would mangle).

import assert from 'node:assert/strict';
import test from 'node:test';

import { expectIdempotent, format } from './support.ts';

test('leaves an implicit expression in place', async () => {
  assert.equal(
    await format('<td>@forecast.Date.ToShortDateString()</td>'),
    '<td>@forecast.Date.ToShortDateString()</td>\n',
  );
});

test('preserves text/expression spacing', async () => {
  assert.equal(
    await format('<p>Hello @Name, welcome!</p>'),
    '<p>Hello @Name, welcome!</p>\n',
  );
});

test('preserves an explicit @(...) expression with a generic', async () => {
  // Regression: `<int>` used to be parsed as an HTML tag and the content lost.
  assert.equal(
    await format('<p>@(GenericMethod<int>())</p>'),
    '<p>@(GenericMethod<int>())</p>\n',
  );
});

test('preserves an explicit @(...) expression containing < and quotes', async () => {
  assert.equal(
    await format('<p>@(a < b ? x : y)</p>'),
    '<p>@(a < b ? x : y)</p>\n',
  );
  assert.equal(
    await format('<p>@("<span>hi</span>")</p>'),
    '<p>@("<span>hi</span>")</p>\n',
  );
});

test('leaves an escaped @@ untouched', async () => {
  assert.equal(await format('<p>a@@b.com</p>'), '<p>a@@b.com</p>\n');
});

test('does not treat an email address as a transition', async () => {
  assert.equal(
    await format('<a href="mailto:S@c.com">S@c.com</a>'),
    '<a href="mailto:S@c.com">S@c.com</a>\n',
  );
});

test('preserves an implicit expression with quoted arguments in an attribute', async () => {
  // Regression: the inner quotes ended the surrounding attribute value for
  // the HTML parser and derailed the whole document. Such expressions are
  // masked inline like explicit @(...) ones.
  assert.equal(
    await format('<a href="@Url.Action("Create")">go</a>'),
    '<a href="@Url.Action("Create")">go</a>\n',
  );
  assert.equal(
    await format('<p>Total: @Fmt(x, "C") kr</p>'),
    '<p>Total: @Fmt(x, "C") kr</p>\n',
  );
});

test('leaves an @await expression in place', async () => {
  assert.equal(
    await format('<p>@await Foo("a", "b")</p>'),
    '<p>@await Foo("a", "b")</p>\n',
  );
});

test('keeps razor directive attributes on the element', async () => {
  assert.equal(
    await format('<button @onclick="Go">Go</button>'),
    '<button @onclick="Go">Go</button>\n',
  );
  assert.equal(
    await format('<input @bind="Name" @bind:event="oninput" />'),
    '<input @bind="Name" @bind:event="oninput" />\n',
  );
});

test('is idempotent', async () => {
  await expectIdempotent('<p>@(GenericMethod<int>()) and @Name here</p>');
});
