# Jentra CLI fallback

Configure `JENTRA_API_URL` and `JENTRA_SESSION_TOKEN`. For local development only, use `JENTRA_TEST_PARTICIPANT` instead of a session token.

```text
jentra project <project-id> --json
jentra collaboration <project-id> --json
jentra people <project-id> [journey-id] --json
jentra journey <journey-id> --json
jentra experience <journey-id> --advanced --json
jentra change-review <journey-id> --json
```

Do not pass credentials on the command line or include secret material in command payloads.
