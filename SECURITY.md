# Security

## Reporting a problem

Please report security problems privately, not in a public issue: on GitHub, open the
**Security** tab of this repository and choose **Report a vulnerability**. Include what you found,
how to see it happen, and which Tessera version (Settings › Update software shows it).

## Our standards

These apply to Tessera (this repository), [Tessera Mortar](https://github.com/Herbalchemist/tessera-mortar)
and [Tessera add-ons](https://github.com/Herbalchemist/tessera-addons). Most of them are checked by
`tools/security-check.cjs` on every push and pull request (`.github/workflows/launcher-tests.yml`);
a change that breaks one fails the check.

Some common web-app rules don't fit Tessera: it has no server, no database, no user accounts of its
own and no web API. Those are marked **Doesn't apply**, with what Tessera does instead.

| Standard | How Tessera meets it | Checked |
|---|---|---|
| **Row-level security** | Doesn't apply: there is no database. Instead, each profile's pages, controls, browser storage and theme are kept apart, and what Guest may do is decided in the main process (`profiles.guestDenies`), not by what the screen shows. | Tests (`qa/profiles.cjs`) |
| **Tight CORS** | Doesn't apply: Tessera runs no web server and offers no web API. The launcher page loads only its own files under a strict Content-Security-Policy. Widgets run in sandboxed frames with no access to the page. Web pages in the built-in browser get no Tessera API, every permission they ask for is refused, and the main process ignores any request that isn't from the launcher's own page (`main/ipcGuard.js`). | Yes |
| **Parameterized SQL** | Doesn't apply: there is no SQL. The same rule for commands: programs are started with `execFile`/`spawn` and a list of arguments, never a shell or a command string, so text from outside can't become a command. | Yes |
| **Verified e-mail addresses** | Doesn't apply: Tessera never asks for an e-mail address. Signing in is the computer's own account; profiles and PINs are local. | — |
| **Tokens out of local storage** | The launcher keeps nothing in browser storage (no localStorage, sessionStorage or IndexedDB) and has no tokens. Websites' own logins in the built-in browser stay in that profile's separate browser storage (`persist:tessera-browser-<profile>`). | Yes (code search) |
| **.env and keys out of Git** | `.gitignore` covers `.env`, `*.key`, `*.pem` and other key files in all three repositories. The history of all three was searched: no key, token or secret file was ever committed. The add-on signing key stays offline and passphrase-protected, never on GitHub or in CI. The image-signing key exists only as a GitHub secret. | Yes |
| **Validated input** | Every request from the screen is checked in the main process: types, lengths, fixed lists and patterns (a Wi-Fi password is 8 to 63 characters; a boot screen is one of four names; a file to delete must be inside the Tessera folder). Requests from anything but the launcher's own page are refused. Jobs that run as root take only fixed names, and polkit allows only those. | Yes (sender check), tests |
| **Protected admin actions** | Anything that changes the system or deletes things needs the admin PIN (`pinLock.pinOk`). System changes run only as fixed systemd jobs, and polkit lets only an administrator's account at the console start them (`49-tessera-update.rules`). Guest is locked down by default. The boot menu never skips a password: Opus from Boot options goes through the login screen. | Tests |
| **No debugging in production** | Developer tools are off in every window, including the built-in browser and its pointer, unless `TESSERA_DEV=1` (Mortar: off in released builds). No remote debugging port, no inspector, no reload shortcut. | Yes |
| **API secrets stay server-side** | Tessera, Mortar and the add-ons ship no API keys at all. The only secrets are the image-signing key (a GitHub secret, used only by the build), the add-on signing key (offline) and `CLAUDE_API_KEY` for the security review (a GitHub secret). | Yes |
| **Claude Code security review** | `anthropics/claude-code-security-review` reviews every pull request in all three repositories (`.github/workflows/security-review.yml`), pinned to a commit, with Tessera-specific instructions. It runs once the `CLAUDE_API_KEY` secret is added, and never with the key on pull requests from other people's copies. | — |
| **Rate limits** | There is no server to flood. Profile PINs make you wait after wrong tries, and the wait survives a restart. The admin PIN never makes anyone wait, by the owner's decision: a wait on the owner's own PIN could lock them out of their device. The trade-off is that someone at the controller can keep guessing the admin PIN, so a longer admin PIN (up to 8 digits) is its protection. | Tests |
| **Validated files** | Add-on packages: size limits, a cap on unpacked size, plain files only (no links or devices), safe names only, and a package that breaks any rule is refused whole. A shard is Official only if Tessera's Ed25519 signature checks out; unsigned shards still run by default, with a warning, and the admin can turn them off. Mortar checks every image against its release SHA-256, writes only a file picked in its own file dialog, and checks the USB after writing. | Tests |
| **No sensitive data in logs** | No PIN, password, Wi-Fi password or key is written to a log. Report a problem replaces names and addresses before the file is written. The settings file, which holds the PIN's hash, is readable by its own account only. Known open item: while Wi-Fi joins a network, the password is briefly visible in the process list to other accounts on the same computer (on the roadmap: hand it over without the command line, after a test on real Wi-Fi). | Yes |
| **Hashed passwords** | PINs are stored only as scrypt hashes with a random salt and compared in constant time. Account passwords belong to the computer's own login, not to Tessera. | Tests |
| **Verified signatures** | Doesn't apply as webhooks: Tessera receives none. The same rule for what it downloads: system updates must carry Tessera's signature (`/etc/containers/policy.json` requires `tessera.pub` for these images), add-ons are checked against the catalog's SHA-256 and their signature, and Mortar checks every image's SHA-256. | Build check |
| **Permissions decided in the main process** | Every allow/deny decision (admin PIN, Guest, profile PINs, root jobs) is made in the main process or by polkit. Hiding a button on screen is only a convenience, never the protection. | Tests |
| **Joy-Con service** | `tessera-joycons` runs as root to read Joy-Cons and make virtual controllers through `/dev/uinput`. Its control socket (`/run/tessera/joycons.sock`, open to every local user) takes only fixed requests (grip, single, pair, unassign, move, mode, forget), checks them against the Joy-Cons it can see, and can do nothing but regroup them; it takes no paths, commands or files. The unit sets `NoNewPrivileges`, `PrivateTmp` and `ProtectHome`. | Tests |
| **No cross-site scripting** | A strict Content-Security-Policy (`default-src 'none'; script-src 'self'`): only Tessera's own script files can run. Names, titles, web page text and anything else from outside go in as plain text; HTML is built only from Tessera's own fixed text. | Yes |
| **Up-to-date dependencies** | Dependabot keeps the GitHub Actions (all three repositories) and Mortar's npm tools current. Qt and Node come from Fedora's repositories with the rest of the system. The system underneath is rebuilt from Bazzite every day. All actions are pinned to a commit. | Yes |
