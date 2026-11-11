# qa/

The Electron page's checks are gone with Electron. What's left in `to-port/` are main-process checks
(Steam library, report, installer, recovery) that still need Node-test or Qt-driver counterparts; they
can't run as they are. The rest were ported (see `docs/ludus-qt-parity.md`, `launcher/test/`, and
`ludus.py --qa`).
