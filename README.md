# prettier-plugin-razor2

<br>
<table>
  <tr>
    <td><img src="https://prettier.io/icon.png" alt="Prettier icon" width="128" height="128"></td>
    <td><img src="https://upload.wikimedia.org/wikipedia/commons/d/d0/Blazor.png" alt="Blazor icon" width="128" height="128"></td>
  </tr>
</table>
<br>

An opinionated formatter plugin for [Prettier](https://prettier.io) that adds
support for Razor files (Blazor code).

Prettier is an opinionated code formatter. It enforces a consistent style by
parsing your code and re-printing it, taking various rules into account.

> **Fork notice** This project is a fork of
> [prettier-plugin-razor](https://github.com/KristinaPlusPlus/prettier-plugin-razor)
> by Kristina Corrado. It is currently maintained by Robert Macfie.

# Notice

This plugin is still under development, and has very basic formatting
functionality. Please try it out and provide feedback. Note that the `@code`
sections (pure C# code) are ignored by the formatter.

# Installation

yarn:

    yarn add --dev prettier prettier-plugin-razor2 --exact

npm:

    npm install prettier prettier-plugin-razor2 --save-dev --save-exact

# Usage

This plugin will be loaded automatically (if installed) by prettier to format
files ending with the `.razor` suffix. Using it is exactly the same as using
prettier.

Prettier [CLI usage docs](https://prettier.io/docs/en/cli.html)<br> Prettier
[API usage docs](https://prettier.io/docs/en/api.html)

# Configuration

This library follows the same configuration format as Prettier, which is
documented [here](https://prettier.io/docs/en/configuration.html). However, at
this time, there are no configuration options enabled.
