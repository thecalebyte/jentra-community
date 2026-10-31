# Security

Do not report a suspected vulnerability in a public issue. Send a concise report to
`security@jentra.dev`, including affected versions, reproduction steps and potential impact.

The local runtime binds to loopback by default. Set `JENTRA_COMMUNITY_TOKEN` before exposing it on a
non-loopback interface. Never commit model keys, provider credentials or repository secrets.
