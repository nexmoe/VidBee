---
name: nexmoe-best-practices-release
description: Universal release workflow. Auto-detects version files and changelogs. Supports Node.js, Python, Rust, Claude Plugin, and generic projects. Use when user says "release", "发布", "new version", "bump version", or asks to "push" / "推送" a release. Not for ordinary branch commits, pushes or PRs.
---

# Nexmoe Release Best Practices

Universal release workflow supporting any project type with multi-language changelog.

## Quick Start

Just run `/nexmoe-best-practices-release` - auto-detects your project configuration.

## Supported Projects

| Project Type | Version File | Auto-Detected |
|--------------|--------------|---------------|
| Node.js | package.json | ✓ |
| Python | pyproject.toml | ✓ |
| Rust | Cargo.toml | ✓ |
| Claude Plugin | marketplace.json | ✓ |
| Generic | VERSION / version.txt | ✓ |

## Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview changes without executing |
| `--major` | Force major version bump |
| `--minor` | Force minor version bump |
| `--patch` | Force patch version bump |

## Workflow

### Step 1: Detect Project Configuration

1. Check for `.releaserc.yml` (optional config override)
2. Auto-detect version file by scanning (priority order):
   - `package.json` (Node.js)
   - `pyproject.toml` (Python)
   - `Cargo.toml` (Rust)
   - `marketplace.json` or `.claude-plugin/marketplace.json` (Claude Plugin)
   - `VERSION` or `version.txt` (Generic)
3. Scan for changelog files using glob patterns:
   - `CHANGELOG*.md`
   - `HISTORY*.md`
   - `CHANGES*.md`
4. Identify language of each changelog by filename suffix
5. Display detected configuration

**Language Detection Rules**:

Changelog files follow the pattern `CHANGELOG_{LANG}.md` or `CHANGELOG.{lang}.md`, where `{lang}` / `{LANG}` is a language or region code.

| Pattern | Example | Language |
|---------|---------|----------|
| No suffix | `CHANGELOG.md` | en (default) |
| `_{LANG}` (uppercase) | `CHANGELOG_CN.md`, `CHANGELOG_JP.md` | Corresponding language |
| `.{lang}` (lowercase) | `CHANGELOG.zh.md`, `CHANGELOG.ja.md` | Corresponding language |
| `.{lang-region}` | `CHANGELOG.zh-CN.md` | Corresponding region variant |

Common language codes: `zh` (Chinese), `ja` (Japanese), `ko` (Korean), `de` (German), `fr` (French), `es` (Spanish).

**Output Example**:
```
Project detected:
  Version file: package.json (1.2.3)
  Changelogs:
    - CHANGELOG.md (en)
    - CHANGELOG.zh.md (zh)
    - CHANGELOG.ja.md (ja)
```

### Step 2: Analyze Changes Since Last Tag

```bash
LAST_TAG=$(git tag --sort=-v:refname | head -1)
git log ${LAST_TAG}..HEAD --oneline
git diff ${LAST_TAG}..HEAD --stat
```

Categorize by conventional commit types:

| Type | Description |
|------|-------------|
| feat | New features |
| fix | Bug fixes |
| docs | Documentation |
| refactor | Code refactoring |
| perf | Performance improvements |
| test | Test changes |
| style | Formatting, styling |
| chore | Maintenance (skip in changelog) |

> **Note**: This categorization is for internal analysis only. When writing changelog entries (Step 4), ALL descriptions must be rewritten in user-facing language. See Step 4 writing guidelines.

**Breaking Change Detection**:
- Commit message starts with `BREAKING CHANGE`
- Commit body/footer contains `BREAKING CHANGE:`
- Removed public APIs, renamed exports, changed interfaces

If breaking changes detected, warn user: "Breaking changes detected. Consider major version bump (--major flag)."

### Step 3: Determine Version Bump

Rules (in priority order):
1. User flag `--major/--minor/--patch` → Use specified
2. BREAKING CHANGE detected → Major bump (1.x.x → 2.0.0)
3. `feat:` commits present → Minor bump (1.2.x → 1.3.0)
4. Otherwise → Patch bump (1.2.3 → 1.2.4)

Display version change: `1.2.3 → 1.3.0`

### Step 4: Generate Multi-language Changelogs

For each detected changelog file:

1. **Identify language** from filename suffix
2. **Detect third-party contributors**:
   - Check merge commits: `git log ${LAST_TAG}..HEAD --merges --pretty=format:"%H %s"`
   - For each merged PR, identify the PR author via `gh pr view <number> --json author --jq '.author.login'`
   - Compare against repo owner (`gh repo view --json owner --jq '.owner.login'`)
   - If PR author ≠ repo owner → third-party contributor
3. **Generate content in that language**:
   - Section titles in target language
   - Change descriptions written naturally in target language (not translated)
   - Date format: YYYY-MM-DD (universal)
   - **Third-party contributions**: Append contributor attribution `(by @username)` to the changelog entry
4. **Insert at file head** (preserve existing content)

**⚠️ CRITICAL: User-Facing Writing Guidelines**

Changelog is written for **end users**, NOT developers. Every entry must describe what changed **from the user's perspective** and highlight the value it brings. Follow these rules strictly:

- **DO NOT** include any technical/programming terms: no "refactor", "component", "module", "API", "SDK", "runtime", "middleware", "state management", "IPC", "store", "hook", "cache invalidation", "dependency injection", etc.
- **DO NOT** mention internal code structure: no file names, function names, class names, variable names, database tables, or architecture details.
- **DO NOT** include engineering process items: no "code cleanup", "refactoring", "migration", "dependency update", "CI/CD", "build optimization", "type safety improvement", etc.
- **DO** describe what the user can now do, see, or experience differently.
- **DO** use plain, everyday language that any non-technical person can understand.
- **DO** focus on user benefits and outcomes, not implementation details.

**How to transform technical commits into user-facing entries**:

| Technical commit | User-facing entry |
|-----------------|-------------------|
| `refactor: reorganize desktop component structure` | *(skip — no user-visible change)* |
| `feat: add OAuth2 authentication module` | 支持使用第三方账号登录（如 Google、GitHub） |
| `fix: fix memory leak in connection pool` | 修复了长时间使用后应用变卡的问题 |
| `perf: optimize image loading pipeline` | 图片加载速度更快了 |
| `feat: improve document import and library actions` | 导入文档更方便，书库管理操作更顺手 |
| `fix: update sign-in and sign-up form components` | 优化了登录和注册页面的体验 |
| `refactor: improve IPC flow and store sync` | *(skip — no user-visible change)* |

**Filtering rules**:
- **Skip entirely**: commits that are purely internal (refactor, code cleanup, test-only, CI/CD, dependency updates) with NO user-visible effect.
- **Rewrite**: commits that have user-visible effects but are described technically — rewrite them in user language.
- Only `feat` and `fix` type changes typically produce user-facing entries. `perf` entries are included only when the improvement is noticeable to users.
- If after filtering, a section would be empty, omit that section entirely.

**Section Title Translations** (built-in, user-facing only):

| Type | en | zh | ja | ko | de | fr | es |
|------|----|----|----|----|----|----|-----|
| feat | What's New | 新增功能 | 新機能 | 새로운 기능 | Neuigkeiten | Nouveautés | Novedades |
| fix | Improvements | 改进与修复 | 改善 | 개선 사항 | Verbesserungen | Améliorations | Mejoras |
| perf | Faster & Smoother | 更快更流畅 | パフォーマンス向上 | 더 빠르게 | Schneller & Besser | Plus rapide | Más rápido |
| breaking | Important Changes | 重要变更 | 重要な変更 | 중요 변경사항 | Wichtige Änderungen | Changements importants | Cambios importantes |

> **Note**: `docs`, `refactor`, `test`, `style`, `chore` types are **excluded** from the changelog. They are internal engineering concerns with no direct user value.

**Changelog Format**:

```markdown
## {VERSION} - {YYYY-MM-DD}

### What's New
- User-facing description of what they can now do (by @username)

### Improvements
- User-facing description of what got better
```

Only include sections that have changes. Omit empty sections. Remember: every line must be understandable by a non-technical user.

**Third-Party Attribution Rules**:
- Only add `(by @username)` for contributors who are NOT the repo owner
- Use GitHub username with `@` prefix
- Place at the end of the changelog entry line
- Apply to all languages consistently (always use `(by @username)` format, not translated)

**Multi-language Example**:

English (CHANGELOG.md):
```markdown
## 1.3.0 - 2026-01-22

### What's New
- Sign in with your Google or GitHub account (by @contributor1)
- Link your existing account with third-party login

### Improvements
- Fixed an issue where the app would slow down after extended use
```

Chinese (CHANGELOG.zh.md):
```markdown
## 1.3.0 - 2026-01-22

### 新增功能
- 支持使用 Google 或 GitHub 账号登录 (by @contributor1)
- 可以将已有账号与第三方登录方式绑定

### 改进与修复
- 修复了长时间使用后应用变卡的问题
```

Japanese (CHANGELOG.ja.md):
```markdown
## 1.3.0 - 2026-01-22

### 新機能
- GoogleやGitHubアカウントでログインできるようになりました (by @contributor1)
- 既存アカウントとサードパーティログインの連携が可能に

### 改善
- 長時間使用時にアプリが遅くなる問題を修正
```

### Step 5: Group Changes by Skill/Module

Analyze commits since last tag and group by affected skill/module:

1. **Identify changed files** per commit
2. **Group by skill/module**:
   - `skills/<skill-name>/*` → Group under that skill
   - Root files (CLAUDE.md, etc.) → Group as "project"
   - Multiple skills in one commit → Split into multiple groups
3. **For each group**, identify related README updates needed

**Example Grouping**:
```
baoyu-cover-image:
  - feat: add new style options
  - fix: handle transparent backgrounds
  → README updates: options table

baoyu-comic:
  - refactor: improve panel layout algorithm
  → No README updates needed

project:
  - docs: update CLAUDE.md architecture section
```

### Step 6: Commit Each Skill/Module Separately

For each skill/module group (in order of changes):

1. **Check README updates needed**:
   - Scan `README*.md` for mentions of this skill/module
   - Verify options/flags documented correctly
   - Update usage examples if syntax changed
   - Update feature descriptions if behavior changed

2. **Stage and commit**:
   ```bash
   git add skills/<skill-name>/*
   git add README.md README.zh.md  # If updated for this skill
   git commit -m "<type>(<skill-name>): <meaningful description>"
   ```

3. **Commit message format**:
   - Use conventional commit format: `<type>(<scope>): <description>`
   - `<type>`: feat, fix, refactor, docs, perf, etc.
   - `<scope>`: skill name or "project"
   - `<description>`: Clear, meaningful description of changes

**Example Commits**:
```bash
git commit -m "feat(baoyu-cover-image): add watercolor and minimalist styles"
git commit -m "fix(baoyu-comic): improve panel layout for long dialogues"
git commit -m "docs(project): update architecture documentation"
```

**Common README Updates Needed**:
| Change Type | README Section to Check |
|-------------|------------------------|
| New options/flags | Options table, usage examples |
| Renamed options | Options table, usage examples |
| New features | Feature description, examples |
| Breaking changes | Migration notes, deprecation warnings |
| Restructured internals | Architecture section (if exposed to users) |

### Step 7: Generate Changelog and Update Version

1. **Generate multi-language changelogs** (as described in Step 4)
2. **Update version file**:
   - Read version file (JSON/TOML/text)
   - Update version number
   - Write back (preserve formatting)

**Version Paths by File Type**:

| File | Path |
|------|------|
| package.json | `$.version` |
| pyproject.toml | `project.version` |
| Cargo.toml | `package.version` |
| marketplace.json | `$.metadata.version` |
| VERSION / version.txt | Direct content |

### Step 8: User Confirmation

Before creating the release commit, ask user to confirm:

**Use AskUserQuestion with two questions**:

1. **Version bump** (single select):
   - Show recommended version based on Step 3 analysis
   - Options: recommended (with label), other semver options
   - Example: `1.2.3 → 1.3.0 (Recommended)`, `1.2.3 → 1.2.4`, `1.2.3 → 2.0.0`

2. **Push to remote** (single select):
   - Options: "Yes, push after commit", "No, keep local only"

**Example Output Before Confirmation**:
```
Commits created:
  1. feat(baoyu-cover-image): add watercolor and minimalist styles
  2. fix(baoyu-comic): improve panel layout for long dialogues
  3. docs(project): update architecture documentation

Changelog preview (en):
  ## 1.3.0 - 2026-01-22
  ### What's New
  - New cover styles available: watercolor and minimalist
  ### Improvements
  - Comics with longer conversations now display more cleanly

Ready to create release commit and tag.
```

### Step 9: Create Release Commit and Tag

After user confirmation:

1. **Stage version and changelog files**:
   ```bash
   git add <version-file>
   git add CHANGELOG*.md
   ```

2. **Create release commit**:
   ```bash
   git commit -m "chore: release v{VERSION}"
   ```

3. **Create tag**:
   ```bash
   git tag v{VERSION}
   ```

4. **Push if user confirmed** (Step 8):
   ```bash
   git push origin main
   git push origin v{VERSION}
   ```

**Note**: Do NOT add Co-Authored-By line. This is a release commit, not a code contribution.

**Post-Release Output**:
```
Release v1.3.0 created.

Commits:
  1. feat(baoyu-cover-image): add watercolor and minimalist styles
  2. fix(baoyu-comic): improve panel layout for long dialogues
  3. docs(project): update architecture documentation
  4. chore: release v1.3.0

Tag: v1.3.0
Status: Pushed to origin  # or "Local only - run git push when ready"
```

## Configuration (.releaserc.yml)

Optional config file in project root to override defaults:

```yaml
# .releaserc.yml - Optional configuration

# Version file (auto-detected if not specified)
version:
  file: package.json
  path: $.version  # JSONPath for JSON, dotted path for TOML

# Changelog files (auto-detected if not specified)
changelog:
  files:
    - path: CHANGELOG.md
      lang: en
    - path: CHANGELOG.zh.md
      lang: zh
    - path: CHANGELOG.ja.md
      lang: ja

  # Section mapping (conventional commit type → changelog section)
  # Use null to skip a type in changelog
  # Sections should use user-facing names, not technical terms
  sections:
    feat: "What's New"
    fix: Improvements
    perf: "Faster & Smoother"
    docs: null       # Skip — internal only
    refactor: null   # Skip — internal only
    test: null       # Skip — internal only
    chore: null      # Skip — internal only

# Commit message format
commit:
  message: "chore: release v{version}"

# Tag format
tag:
  prefix: v  # Results in v1.0.0
  sign: false

# Additional files to include in release commit
include:
  - README.md
  - package.json
```

## Dry-Run Mode

When `--dry-run` is specified:

```
=== DRY RUN MODE ===

Project detected:
  Version file: package.json (1.2.3)
  Changelogs: CHANGELOG.md (en), CHANGELOG.zh.md (zh)

Last tag: v1.2.3
Proposed version: v1.3.0

Changes grouped by skill/module:
  baoyu-cover-image:
    - feat: add watercolor style
    - feat: add minimalist style
    → Commit: feat(baoyu-cover-image): add watercolor and minimalist styles
    → README updates: options table

  baoyu-comic:
    - fix: panel layout for long dialogues
    → Commit: fix(baoyu-comic): improve panel layout for long dialogues
    → No README updates

Changelog preview (en):
  ## 1.3.0 - 2026-01-22
  ### What's New
  - New cover styles available: watercolor and minimalist
  ### Improvements
  - Comics with longer conversations now display more cleanly

Changelog preview (zh):
  ## 1.3.0 - 2026-01-22
  ### 新增功能
  - 新增封面风格：水彩和极简
  ### 改进与修复
  - 长对话的漫画排版更加美观

Commits to create:
  1. feat(baoyu-cover-image): add watercolor and minimalist styles
  2. fix(baoyu-comic): improve panel layout for long dialogues
  3. chore: release v1.3.0

No changes made. Run without --dry-run to execute.
```

## Example Usage

```
/nexmoe-best-practices-release              # Auto-detect version bump
/nexmoe-best-practices-release --dry-run    # Preview only
/nexmoe-best-practices-release --minor      # Force minor bump
/nexmoe-best-practices-release --patch      # Force patch bump
/nexmoe-best-practices-release --major      # Force major bump (with confirmation)
```

## When to Use

Trigger this skill when user requests:
- "release", "发布", "create release", "new version", "新版本"
- "bump version", "update version", "更新版本"
- "prepare release"
- "push to remote" (with uncommitted changes)

**Important**: If user says "just push" or "直接 push" with uncommitted changes, STILL follow all steps above first.
