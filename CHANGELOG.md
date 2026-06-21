# Changelog

## [2.3.5](https://github.com/chrischall/infinitecampus-mcp/compare/v2.3.4...v2.3.5) (2026-06-21)


### Documentation

* audit CLAUDE.md and add auto-review follow-up convention ([#76](https://github.com/chrischall/infinitecampus-mcp/issues/76)) ([b0767f7](https://github.com/chrischall/infinitecampus-mcp/commit/b0767f79a6cf70c35fd596f9b89c571063a65c3b))
* require Conventional Commit PR titles for release-please ([#72](https://github.com/chrischall/infinitecampus-mcp/issues/72)) ([aa23e76](https://github.com/chrischall/infinitecampus-mcp/commit/aa23e76e489af4d1988810e137cf0733095cf0cc))

## [2.3.4](https://github.com/chrischall/infinitecampus-mcp/compare/v2.3.3...v2.3.4) (2026-06-13)


### Bug Fixes

* bot PRs bypass the CI gate unconditionally (upstream curtaincall[#86](https://github.com/chrischall/infinitecampus-mcp/issues/86) review) ([#68](https://github.com/chrischall/infinitecampus-mcp/issues/68)) ([f575895](https://github.com/chrischall/infinitecampus-mcp/commit/f575895f110df3eb8d59161ce21d33b677495fdd))


### Documentation

* add MIT LICENSE file and README badges ([#66](https://github.com/chrischall/infinitecampus-mcp/issues/66)) ([5d962e9](https://github.com/chrischall/infinitecampus-mcp/commit/5d962e91d3c8cdfe3c6b4bc85b5039b722cb217e))
* correct release flow to describe release-please ([#64](https://github.com/chrischall/infinitecampus-mcp/issues/64)) ([85e08bb](https://github.com/chrischall/infinitecampus-mcp/commit/85e08bb17f14854305fdf9691ccf48eaea959327))

## [2.3.3](https://github.com/chrischall/infinitecampus-mcp/compare/v2.3.2...v2.3.3) (2026-06-09)


### Bug Fixes

* re-auth expired linked-district sessions via the primary, not placeholder creds ([#61](https://github.com/chrischall/infinitecampus-mcp/issues/61)) ([9f37420](https://github.com/chrischall/infinitecampus-mcp/commit/9f37420b549241325c34ec5d8f2c29c5f3467c76))

## [2.3.2](https://github.com/chrischall/infinitecampus-mcp/compare/v2.3.1...v2.3.2) (2026-06-04)


### Bug Fixes

* adopt @fetchproxy/server 0.13.0 (bridge host failover + re-pairing) ([#55](https://github.com/chrischall/infinitecampus-mcp/issues/55)) ([8868377](https://github.com/chrischall/infinitecampus-mcp/commit/886837719637596a0a8643fc782b5e0d53d3959d))
* adopt @fetchproxy/server 1.0.0 + @chrischall/mcp-utils 0.5.0 ([#57](https://github.com/chrischall/infinitecampus-mcp/issues/57)) ([757ae30](https://github.com/chrischall/infinitecampus-mcp/commit/757ae304d3961a48cef01351c2298b21dbf67948))

## [2.3.1](https://github.com/chrischall/infinitecampus-mcp/compare/v2.3.0...v2.3.1) (2026-05-29)


### Bug Fixes

* **ci:** auto-merge arm guards ([#42](https://github.com/chrischall/infinitecampus-mcp/issues/42)) ([4bcf52e](https://github.com/chrischall/infinitecampus-mcp/commit/4bcf52e3cdc1a8380eef91605f6aba4e6213b3c4))

## [2.3.0](https://github.com/chrischall/infinitecampus-mcp/compare/v2.2.3...v2.3.0) (2026-05-27)


### Features

* **deps:** bump @fetchproxy/bootstrap to ^0.8.0 with bridge-down hints ([#40](https://github.com/chrischall/infinitecampus-mcp/issues/40)) ([604ad9e](https://github.com/chrischall/infinitecampus-mcp/commit/604ad9ee1e9ff20f9c11eb7f777f249f4d771c72))

## [2.2.3](https://github.com/chrischall/infinitecampus-mcp/compare/v2.2.2...v2.2.3) (2026-05-26)


### Bug Fixes

* **ci:** substitute repo name in publish workflow ([#37](https://github.com/chrischall/infinitecampus-mcp/issues/37)) ([75024bc](https://github.com/chrischall/infinitecampus-mcp/commit/75024bcfbeab56e637e1d92d0e85b2fbb06c7666))

## [2.2.2](https://github.com/chrischall/infinitecampus-mcp/compare/v2.2.1...v2.2.2) (2026-05-26)


### Documentation

* **claude:** warn against early PRs and call out first-party dep bumps ([#35](https://github.com/chrischall/infinitecampus-mcp/issues/35)) ([ca0e8da](https://github.com/chrischall/infinitecampus-mcp/commit/ca0e8da9582ec1d8d30eb0fcaec2887d93b5eee4))

## [2.2.1](https://github.com/chrischall/infinitecampus-mcp/compare/v2.2.0...v2.2.1) (2026-05-25)


### Bug Fixes

* **ci:** prevent labeled event from cancelling auto-review ([#32](https://github.com/chrischall/infinitecampus-mcp/issues/32)) ([1558087](https://github.com/chrischall/infinitecampus-mcp/commit/1558087ac8d2cf736c4a1f7180633bdbd746f0d0))

## [2.2.0](https://github.com/chrischall/infinitecampus-mcp/compare/v2.1.4...v2.2.0) (2026-05-24)


### Features

* add assessments + fees tools, augment messages with inbox + notices ([3d9c65c](https://github.com/chrischall/infinitecampus-mcp/commit/3d9c65cf2678ec5e5575a1508fa2ba37c1b88624))
* **auth:** add fetchproxy fallback as no-password onboarding path ([a5c21da](https://github.com/chrischall/infinitecampus-mcp/commit/a5c21da041cbaa7692e2f6e50fec01ba4d73e9c2))
* **client:** auto-discover linked districts via CUPS SSO ([814a932](https://github.com/chrischall/infinitecampus-mcp/commit/814a9321d79133860c95879d72366684d839aa6e))
* **client:** auto-discover linked districts via CUPS SSO ([ab9afa6](https://github.com/chrischall/infinitecampus-mcp/commit/ab9afa67017cdb3a204c24d3c0e2046f703b42c6))
* **client:** download() streams to disk with path safety checks ([ed6340f](https://github.com/chrischall/infinitecampus-mcp/commit/ed6340f9d683e4d507eff9dcdd0aad4300caa7c9))
* **client:** ICClient skeleton with listDistricts and error classes ([bad801a](https://github.com/chrischall/infinitecampus-mcp/commit/bad801a01ee245ce67a45b14ef33d9bcec049d35))
* **client:** lazy per-district login, cookie reuse, request method ([db4dd41](https://github.com/chrischall/infinitecampus-mcp/commit/db4dd4100000898cf69d26662a82538705417eb8))
* **config:** loadAccounts parses IC_N_* env vars with gap-stop scan ([001d29b](https://github.com/chrischall/infinitecampus-mcp/commit/001d29b75332ef90a9aa54a20f949d7f959d2dac))
* **deploy:** registry listings for MCP Registry, Claude plugins, ClawHub, PulseMCP, mcpservers.org ([9d096a2](https://github.com/chrischall/infinitecampus-mcp/commit/9d096a2b48d255ddbadd6458123edc71f59b9c81))
* displayOptions feature detection (ic_get_features + fast-path skip) ([d96c537](https://github.com/chrischall/infinitecampus-mcp/commit/d96c53734998ee5ee44b689790556b3d99c4067a))
* fix attendance/documents + add attendance_events/recent_grades/teachers ([d120275](https://github.com/chrischall/infinitecampus-mcp/commit/d120275d07003beb174b1548b17d040467b953b3))
* **tools:** ic_download_document ([35bbcf8](https://github.com/chrischall/infinitecampus-mcp/commit/35bbcf8cb75961cf5db5decd91f0a7a58a2216e1))
* **tools:** ic_get_schedule ([0992d0f](https://github.com/chrischall/infinitecampus-mcp/commit/0992d0f18a4758d3c2711c5c6c23493e4b47d0ac))
* **tools:** ic_list_assignments with missingOnly filter ([cb03f09](https://github.com/chrischall/infinitecampus-mcp/commit/cb03f0912dcc3e9fb8384fd55e4c2129779e6a80))
* **tools:** ic_list_attendance ([85d5d09](https://github.com/chrischall/infinitecampus-mcp/commit/85d5d09f8769bd285ad615ffe56ad3011e74aceb))
* **tools:** ic_list_behavior with FeatureDisabled fallback on 404 ([1821a98](https://github.com/chrischall/infinitecampus-mcp/commit/1821a98e45d9b5b5949ad6ec8e0081424b11f4df))
* **tools:** ic_list_districts ([4ef0cf2](https://github.com/chrischall/infinitecampus-mcp/commit/4ef0cf29bd31adb682acc20a5952aa97427d0ff6))
* **tools:** ic_list_documents ([1bfff17](https://github.com/chrischall/infinitecampus-mcp/commit/1bfff17fa6bf4fb991ee9f4f4d876071a466f223))
* **tools:** ic_list_food_service with FeatureDisabled fallback ([b6f2186](https://github.com/chrischall/infinitecampus-mcp/commit/b6f2186273f3e936ac89045e8f75501916c9828c))
* **tools:** ic_list_grades ([04d7e49](https://github.com/chrischall/infinitecampus-mcp/commit/04d7e49482aac4b7c5999578cb1fd4e43f81620d))
* **tools:** ic_list_message_recipients ([c5eba57](https://github.com/chrischall/infinitecampus-mcp/commit/c5eba57bd28bec303beb83779e829251f6343738))
* **tools:** ic_list_messages + ic_get_message ([a8f15f3](https://github.com/chrischall/infinitecampus-mcp/commit/a8f15f3970fb7a9624d9e3e1bed506121a1b901b))
* **tools:** ic_list_school_days (calendar with term boundaries) ([7de2f21](https://github.com/chrischall/infinitecampus-mcp/commit/7de2f2164ce0986de09d5643b6df87a20f29bdb2))
* **tools:** ic_list_students ([9c1fdae](https://github.com/chrischall/infinitecampus-mcp/commit/9c1fdaec25ae62542f0fd1ba3c68ec11f9845176))
* **tools:** ic_send_message with recipient validation ([f848b6f](https://github.com/chrischall/infinitecampus-mcp/commit/f848b6ffa4ea9551cfb419ed51807f7c8945c77c))
* wire config + ICClient + districts/students tools ([7341efa](https://github.com/chrischall/infinitecampus-mcp/commit/7341efa2671d6160cc594683e31e23af9714cd7b))


### Bug Fixes

* address final code review findings ([26d9af9](https://github.com/chrischall/infinitecampus-mcp/commit/26d9af91f17b514dd32dc8a847d766abe23d9f87))
* **assignments:** drop ignored startDate/endDate, filter dates client-side ([2967195](https://github.com/chrischall/infinitecampus-mcp/commit/29671951d8b6abe69433c7b9ab5807e4f6fb1bb2))
* **bundle:** add createRequire shim so ws works in ESM bundle ([a9c9f46](https://github.com/chrischall/infinitecampus-mcp/commit/a9c9f4639ec50db07b670be6d4e4d09d5bcd4cec))
* **bundle:** add createRequire shim so ws works in ESM bundle ([fe840bf](https://github.com/chrischall/infinitecampus-mcp/commit/fe840bf86d8a64a24ba8e9f0dd7c5c191f47f593))
* **client:** cold-start CUPS discovery + diagnostic auth errors ([e77800c](https://github.com/chrischall/infinitecampus-mcp/commit/e77800c96a337ae4de8d3526f00517b363405204))
* **client:** download() handles absolute URLs (not just relative paths) ([731730f](https://github.com/chrischall/infinitecampus-mcp/commit/731730f8ece0020961e7bb0f6c6c7af2d3fb6153))
* **client:** filter Max-Age=0 cookies + send XSRF-TOKEN header ([8a21e1e](https://github.com/chrischall/infinitecampus-mcp/commit/8a21e1e643eef692697671afc551eebe2c15ae13))
* correct endpoint paths to match real IC parent portal API ([bdd644d](https://github.com/chrischall/infinitecampus-mcp/commit/bdd644d9ebdfc60efdd432bd0dbe9dd3c9748654))
* defensive toArray on collection responses (prism XML→JSON quirk) ([dcb356d](https://github.com/chrischall/infinitecampus-mcp/commit/dcb356d170a35c04e27537df37795075d4ceffc5))
* **deploy:** shorten server.json description to ≤100 chars for MCP Registry ([46d4fb5](https://github.com/chrischall/infinitecampus-mcp/commit/46d4fb581041a0e4b4120bb1d15b1e981f45e193))
* don't crash at install when env vars are missing; trim .mcpb ([36e62a4](https://github.com/chrischall/infinitecampus-mcp/commit/36e62a4f04c7f44316c950afeea17ea1fbabaadd))
* don't crash at install when env vars are missing; trim .mcpb ([cff37df](https://github.com/chrischall/infinitecampus-mcp/commit/cff37df73a4581ce668be825fddfe715a739ee2f))
* **env:** also reject literal "undefined"/"null" in readVar ([05a2515](https://github.com/chrischall/infinitecampus-mcp/commit/05a251568d5e42d116d3ee47f648027e2023fb8a))
* **env:** treat blank/whitespace/placeholder env vars as unset ([03e08c8](https://github.com/chrischall/infinitecampus-mcp/commit/03e08c805c4470b8d3f4028fef381eeda76a2ae6))
* **env:** wire readVar helper into loadAccount (was inserted but unused) ([621ffd2](https://github.com/chrischall/infinitecampus-mcp/commit/621ffd2e608d2349ab233729c38930524d0e8ef3))
* grades needs personID, messages use prism notifications, attendance 404 fallback ([537f065](https://github.com/chrischall/infinitecampus-mcp/commit/537f065233c39643c2cf227d4ac1002790ce8978))
* ic_list_districts triggers login for CUPS discovery + cleanup stale docs/scripts ([ba8714e](https://github.com/chrischall/infinitecampus-mcp/commit/ba8714e7f14edc44f5c91c133b50210e32bbf809))
* **messages:** handle prism single-notification response (XML→JSON quirk) ([1635f3d](https://github.com/chrischall/infinitecampus-mcp/commit/1635f3d4028ac4804d8ce213786d723279ce5d57))
* suppress dotenv startup banner that corrupted JSON-RPC stdout ([ca5f7d0](https://github.com/chrischall/infinitecampus-mcp/commit/ca5f7d0221d6cade423b5c0653944c978f1d7543))
* trim attendance sectionPlacements + ic_get_message now fetches body + annotation audit ([5eaf016](https://github.com/chrischall/infinitecampus-mcp/commit/5eaf016e152b69a892f8b5cd81d9e2edb43684cc))
* **tsconfig:** add node types so tsc builds with process.env / fs imports ([82cb6d7](https://github.com/chrischall/infinitecampus-mcp/commit/82cb6d758bd30470a41021853489e38185a468ea))


### Refactor

* simplify to single-account config (CUPS handles linked districts) ([6999f42](https://github.com/chrischall/infinitecampus-mcp/commit/6999f4288948c0bb3fd2658684dc35c8dd2ec013))
* **tools:** extract _shared helpers (textContent, is404, featureDisabled, findStudent) ([baafe07](https://github.com/chrischall/infinitecampus-mcp/commit/baafe072326701847f8e2c79e9245b0a4948af5c))


### Documentation

* add Acknowledgement of Terms section to README ([#25](https://github.com/chrischall/infinitecampus-mcp/issues/25)) ([2ec40c8](https://github.com/chrischall/infinitecampus-mcp/commit/2ec40c82c848aa3fbbe0a0290bd36f8ed7a0a892))
* add ic skill description ([626f111](https://github.com/chrischall/infinitecampus-mcp/commit/626f1111d1879538a82234035582092e23662d8a))
* canonical auto-merge guidance ([#26](https://github.com/chrischall/infinitecampus-mcp/issues/26)) ([dcd33a1](https://github.com/chrischall/infinitecampus-mcp/commit/dcd33a10dda43394ccc11ab8fda5a19e2cfbace5))
* **claude-md:** call out 100-char limit on server.json description ([#21](https://github.com/chrischall/infinitecampus-mcp/issues/21)) ([a14225e](https://github.com/chrischall/infinitecampus-mcp/commit/a14225e611dd1a683b55a78f50c769ad029589f0))
* correct release-please PR handling in merge guidance ([#27](https://github.com/chrischall/infinitecampus-mcp/issues/27)) ([d9f7221](https://github.com/chrischall/infinitecampus-mcp/commit/d9f722188fe7bf13bab68333c41a4913fdacd4be))
* ensure CLAUDE.md is current and complete ([a66d1fa](https://github.com/chrischall/infinitecampus-mcp/commit/a66d1fa39c5fbafc343b8307a72e5e22f4e80355))
* ensure CLAUDE.md is current and complete ([1f006df](https://github.com/chrischall/infinitecampus-mcp/commit/1f006dfe32905302bbaabc9881007f80418d4b2c))
* implementation plan for infinitecampus-mcp ([23841d6](https://github.com/chrischall/infinitecampus-mcp/commit/23841d6670ae14fc54f1c0c4f807352915c3ab8c))
* initial design spec for infinitecampus-mcp ([82604d7](https://github.com/chrischall/infinitecampus-mcp/commit/82604d7afa1b8e9c5efa628ba60f3ac12d7211cc))
* README and CLAUDE.md ([9a38421](https://github.com/chrischall/infinitecampus-mcp/commit/9a38421132af3c7db5a52805a4ed7123843fbef0))
