# Changelog

## [0.4.0](https://github.com/devbydaniel/taproot/compare/taproot-v0.3.0...taproot-v0.4.0) (2026-07-06)


### Features

* focus today's entry when opening the journal ([dfb8454](https://github.com/devbydaniel/taproot/commit/dfb84548c1bdc19cacea1ee4366bf72679148d7e))
* open-tasks section on pages listing tasks that link to them ([bfd1225](https://github.com/devbydaniel/taproot/commit/bfd12253929713ba5db94cb336e16e49f1b9f135))

## [0.3.0](https://github.com/devbydaniel/taproot/compare/taproot-v0.2.0...taproot-v0.3.0) (2026-07-06)


### Features

* cmd+j opens the journal, hotkeys via @tanstack/react-hotkeys ([502e72b](https://github.com/devbydaniel/taproot/commit/502e72b1470be9dde41cec6e382f0b23d34765d6))
* sprout favicon matching the sidebar brand icon ([63dd6b7](https://github.com/devbydaniel/taproot/commit/63dd6b77e08447e6b4d033c68d4bd389d47771b4))

## [0.2.0](https://github.com/devbydaniel/taproot/compare/taproot-v0.1.0...taproot-v0.2.0) (2026-07-06)


### Features

* auto-focus page content on navigation (cmd+k, links, daily nav) ([0d95d0d](https://github.com/devbydaniel/taproot/commit/0d95d0d3b5bcb984418368588602959dde535103))
* cmd+k command palette for page search ([c170f09](https://github.com/devbydaniel/taproot/commit/c170f09a6e1bbb80c8425ced31c2d5285afdad43))
* drizzle-kit migrations — schema.ts as single source of truth ([53e37ad](https://github.com/devbydaniel/taproot/commit/53e37add627b3c8b3265c06ec28d22ae6240e3eb))
* drop the sidebar new-page form — cmd+k covers page creation ([30e56c5](https://github.com/devbydaniel/taproot/commit/30e56c5d8324fc4735cdfdbfb06b882dbd5c3657))
* hono rpc — client fetchers typed end-to-end from the server routes ([7029baa](https://github.com/devbydaniel/taproot/commit/7029baa027a5475ea7fe87ced8824b926cbe284c))
* journal — daily-note pages with infinite-scroll view and day navigation ([bbb78f6](https://github.com/devbydaniel/taproot/commit/bbb78f6696aad820a2b2ac5c4c850fc2d4b3ae54))
* linked references on journal days; / redirects to journal ([57e7693](https://github.com/devbydaniel/taproot/commit/57e7693cf17af375be57166a7fd2d9dd496ed326))
* pin pages to the sidebar; dark-mode toggle ([d25dae3](https://github.com/devbydaniel/taproot/commit/d25dae354d42c7adc6fd0f6fd6d3631e17c835e3))
* quality gates — eslint, jscpd, knip, husky hooks, github actions ci ([5a06f02](https://github.com/devbydaniel/taproot/commit/5a06f02843a87a558e334a953b72266763a362fb))
* replace sidebar page list with a dedicated /pages view ([7da7684](https://github.com/devbydaniel/taproot/commit/7da7684ed9049ed683ffbe445640080b252f0001))
* taproot MVP — self-hosted fractal outliner ([0cbd020](https://github.com/devbydaniel/taproot/commit/0cbd02015e0b1c1292c3c61aba4f72e3c4e630e1))
* tasks — TODO/DONE blocks with checkbox UI and aggregate view ([d93fc69](https://github.com/devbydaniel/taproot/commit/d93fc694ac1648d16955a2b3f20f17f8fddf1a68))
* zod op schemas — validate writes at the HTTP boundary ([f3f8fab](https://github.com/devbydaniel/taproot/commit/f3f8fab2f3883991448115a221a821d19184c247))


### Performance Improvements

* batch backend queries; fix completedAt reset on every reindex ([bc7673e](https://github.com/devbydaniel/taproot/commit/bc7673e23fcbcbffc13ce28482e784cfe213d122))
