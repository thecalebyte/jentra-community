# Contributing

Thank you for improving Jentra Community. Keep changes focused on the public runtime, contracts,
clients, skill or conformance kit. Do not submit credentials, private infrastructure details or
hosted control-plane source.

Before opening a contribution:

```sh
npm ci
npm run check
```

For behaviour changes, add a focused test. For protocol changes, update contracts before clients and
describe compatibility impact in the contribution.
