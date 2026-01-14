1. use pnpm instead of npm
2. use pnpm run check after tasks to check code
3. Support i18n. When writing business logic, initially only translate the English version of en.json
4. use English for comments&console
5. Follow the ✅ KISS (Keep It Simple, Stupid) & ✅ YAGNI (You Aren't Gonna Need It) principles
6. Use Conventional Commits format for commit messages: `type(scope): subject`. Common types: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert. PR titles should also follow this format.
7. If there is an error when running `pnpm run check:i18n`, please complete the missing corresponding translation files and fields. Ensure the translation is done into the corresponding language, rather than directly copying the English version.
