# Third-Party Notices

`bravia-remote` bundles the following runtime components into `public/app.js` and the
compiled single-file executable. Development-only dependencies are not part of the
runtime artifact.

## React, React DOM, and Scheduler

Versions: React 18.3.1, React DOM 18.3.1, Scheduler 0.23.2.

MIT License

Copyright (c) Facebook, Inc. and its affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

## Bun

The compiled executable embeds the Bun runtime. Bun is MIT-licensed and statically links
additional components, including JavaScriptCore/WebKit under LGPL-2 and several
permissively licensed libraries. The Bun 1.4.4 license text is included in this repository
at [BUN-LICENSE.md](BUN-LICENSE.md); the upstream file has the complete list and relinking
terms:

<https://github.com/oven-sh/bun/blob/main/LICENSE.md>

When redistributing a compiled binary, ship this file together with
`BUN-LICENSE.md`, and review the LGPL relinking requirements for your
distribution model.
