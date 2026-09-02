# Contributing to TradeGuard

Thank you for your interest in contributing! This document provides guidelines for contributing to TradeGuard.

---

## Code of Conduct

- Be respectful and constructive
- Focus on the problem, not the person
- Welcome newcomers and help them contribute
- Credit contributors properly

---

## How to Contribute

### Reporting Issues

**Before creating an issue:**
1. Check existing issues to avoid duplicates
2. Test with the latest version
3. Gather diagnostic information (logs, config, test case)

**Issue template:**
```
## Description
Clear description of the problem

## Steps to Reproduce
1. Step one
2. Step two
3. Expected vs actual behavior

## Environment
- TradeGuard version: 1.0.0
- Node.js version: 22.x
- OS: Ubuntu 22.04 / macOS 14 / Windows 11

## Configuration
```json
{
  "maxLeverage": 5,
  ...
}
```

## Logs
```
Hook script stderr output
```
```

### Suggesting Features

**Feature request template:**
```
## Problem
What problem does this solve?

## Proposed Solution
How should it work?

## Alternatives Considered
What other approaches did you consider?

## Impact
Who benefits? What's the effort estimate?
```

---

## Development Setup

### 1. Fork and Clone

```bash
git clone https://github.com/YOUR_USERNAME/tradeguard.git
cd tradeguard
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build

```bash
npm run build
```

### 4. Run Tests

```bash
npm test
```

---

## Development Workflow

### Branch Naming

- `feature/your-feature-name` — New features
- `fix/issue-number-description` — Bug fixes
- `docs/what-you-changed` — Documentation only
- `refactor/what-you-refactored` — Code improvements

### Commit Messages

Follow conventional commits:

```
type(scope): subject

body (optional)

footer (optional)
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `test`: Test changes only
- `refactor`: Code refactoring (no behavior change)
- `perf`: Performance improvement
- `chore`: Tooling, dependencies, etc.

**Examples:**
```
feat(rules): add VelocityLimitRule for trade frequency caps

Implements max trades per hour and cumulative drawdown circuit breaker.
Closes #42.

fix(hook): handle undefined leverage field gracefully

Previously crashed on SPOT trades with explicit leverage: undefined.
Now treats undefined as 1x. Fixes #38.

docs(api): clarify PriceDeviationRule failure modes

Added examples for stale price, hallucination, unit confusion.
```

### Pull Request Process

1. **Create a branch** from `main`
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow existing code style
   - Add tests for new features
   - Update documentation

3. **Verify your changes**
   ```bash
   npm run build    # Must succeed
   npm test         # All tests must pass
   npm run typecheck # No TypeScript errors
   ```

4. **Commit and push**
   ```bash
   git add .
   git commit -m "feat(scope): your change"
   git push origin feature/your-feature-name
   ```

5. **Create pull request**
   - Use PR template (below)
   - Link related issues
   - Request review

**PR template:**
```
## Description
What does this PR do?

## Motivation
Why is this needed?

## Changes
- Added X
- Changed Y
- Removed Z

## Testing
How was this tested?

## Checklist
- [ ] Tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Documentation updated
- [ ] CHANGELOG.md updated (if user-facing change)
```

---

## Coding Standards

### TypeScript Style

**Use explicit types for public APIs:**
```typescript
// GOOD
export function evaluate(trade: ProposedTrade): Promise<ValidationResult> { ... }

// BAD
export function evaluate(trade) { ... }
```

**Use `readonly` for immutable properties:**
```typescript
// GOOD
readonly name = 'max-leverage';

// BAD
name = 'max-leverage';
```

**Use parameter properties sparingly:**
```typescript
// GOOD (simple case)
constructor(private readonly maxLeverage: number) { }

// AVOID (complex case — not supported by --experimental-strip-types)
constructor(
  private readonly maxLeverage: number,
  private readonly marketData: MarketDataSource,
  private readonly config: Config,
) { }

// BETTER
constructor(maxLeverage: number, marketData: MarketDataSource, config: Config) {
  this.maxLeverage = maxLeverage;
  this.marketData = marketData;
  this.config = config;
}
```

### File Organization

```
src/
  rules/           # Rule implementations
  interfaces/      # TypeScript interfaces only
  binance/         # External integrations
  config/          # Configuration loading
  
tests/
  unit/            # Unit tests (mocked dependencies)
  integration/     # Integration tests (real connections)
  fixtures/        # Test data
```

### Naming Conventions

- **Classes**: PascalCase (`MaxLeverageRule`)
- **Interfaces**: PascalCase (`TradeRule`, `MarketDataSource`)
- **Functions**: camelCase (`evaluate`, `getLivePrice`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_CONFIG_PATH`)
- **Files**: kebab-case (`max-leverage-rule.ts`)

### Import Order

1. Node.js built-ins
2. External dependencies
3. Internal modules (interfaces first, then implementations)
4. Type-only imports

```typescript
import { readFile } from 'node:fs/promises';  // Node.js
import { z } from 'zod';                       // External
import type { TradeRule } from '../interfaces/TradeRule.js';  // Type import
import { RuleEngine } from './RuleEngine.js';  // Implementation
```

---

## Adding a New Rule

See DEVELOPMENT.md for full checklist. Quick summary:

1. **Create rule class** (`src/rules/YourNewRule.ts`)
   ```typescript
   export class YourNewRule implements TradeRule {
     readonly name = 'your-new-rule';
     constructor(private readonly threshold: number) { }
     async evaluate(trade, context): Promise<ValidationResult> { ... }
   }
   ```

2. **Write tests** (`tests/unit/YourNewRule.test.ts`)
   ```typescript
   import { describeRuleContract } from './rule-contract.js';
   describeRuleContract('YourNewRule', () => new YourNewRule(10), validTrade, invalidTrade);
   ```

3. **Update config schema** (`src/config/risk-rules-loader.ts`)
   ```typescript
   yourNewThreshold: z.number().min(1)
   ```

4. **Wire into hook** (`bin/validate-trade.js`)
   ```javascript
   new YourNewRule(config.yourNewThreshold)
   ```

5. **Document** (API.md, DEVELOPMENT.md)

6. **Test**
   ```bash
   npm run build && npm test
   ```

---

## Testing Guidelines

### Unit Test Requirements

Every rule must:
- Pass contract test suite (`describeRuleContract`)
- Have 100% branch coverage
- Test edge cases (exact threshold, missing fields, malformed input)
- Mock external dependencies (MarketDataSource, AccountReader)

**Example:**
```typescript
describe('MaxLeverageRule', () => {
  // Contract tests (required)
  describeRuleContract('MaxLeverageRule', ...);
  
  // Edge case tests (required)
  it('passes when leverage equals max', async () => { ... });
  it('fails when leverage exceeds max by 0.01', async () => { ... });
  it('treats missing leverage as 1x', async () => { ... });
  it('passes SPOT trades regardless of leverage field', async () => { ... });
  
  // Constructor validation (required)
  it('throws on invalid maxLeverage', () => {
    expect(() => new MaxLeverageRule(0)).toThrow();
    expect(() => new MaxLeverageRule(-1)).toThrow();
    expect(() => new MaxLeverageRule(NaN)).toThrow();
  });
});
```

### Integration Test Guidelines

Integration tests require:
- Real Binance MCP connection
- Funded Agentic sub-account
- Manual execution (not in CI)

Document test cases in PR:
```
## Integration Testing

Tested against live Binance testnet:
- [x] Valid trade (0.001 BTC) → allowed → reached confirm prompt
- [x] Excessive leverage (10x) → denied with clear reason
- [x] Symbol not in whitelist → denied
- [x] Price 5% off market → denied
```

---

## Documentation Requirements

### Code Comments

**Write comments for:**
- Non-obvious decisions (why, not what)
- Complex algorithms (explain the approach)
- Gotchas and edge cases
- API contracts (interfaces)

**Don't write comments for:**
- Self-documenting code
- Obvious operations

### API Documentation

Public APIs must have:
- Purpose/description
- Parameter types and descriptions
- Return type and description
- Example usage
- Error conditions

**Example:**
```typescript
/**
 * Evaluate a proposed trade against this rule.
 * 
 * @param trade - The trade to validate
 * @param context - Validation context (timestamp, session info)
 * @returns ValidationResult indicating pass/fail
 * 
 * @example
 * ```typescript
 * const result = await rule.evaluate(trade, context);
 * if (!result.passed) {
 *   console.log(result.reason);
 * }
 * ```
 */
async evaluate(trade: ProposedTrade, context: RuleContext): Promise<ValidationResult>
```

### README Updates

Update README.md when:
- Adding new rules
- Changing installation steps
- Modifying configuration schema
- Altering demo scenarios

---

## Review Process

### What Reviewers Look For

1. **Correctness**: Does it work as intended?
2. **Tests**: Are there tests? Do they pass?
3. **Code quality**: Is it readable, maintainable?
4. **Documentation**: Are changes documented?
5. **Breaking changes**: Are they necessary? Documented?

### Review Checklist

- [ ] Code compiles (`npm run build`)
- [ ] Tests pass (`npm test`)
- [ ] No new TypeScript errors (`npm run typecheck`)
- [ ] Code follows style guide
- [ ] Public APIs have documentation
- [ ] Edge cases tested
- [ ] Error handling present
- [ ] No hardcoded values (use config instead)
- [ ] Commit messages follow convention
- [ ] CHANGELOG.md updated (if user-facing)

### Addressing Feedback

- Respond to all comments (even if just "Fixed")
- Push changes as new commits (don't force-push during review)
- Mark conversations as resolved after fixing
- Re-request review after addressing feedback

---

## Release Process

(For maintainers only)

1. **Update version** in `package.json`
   ```json
   {
     "version": "1.1.0"
   }
   ```

2. **Update CHANGELOG.md**
   ```markdown
   ## [1.1.0] - 2026-09-15
   
   ### Added
   - VelocityLimitRule for trade frequency caps (#42)
   
   ### Fixed
   - Hook crash on undefined leverage field (#38)
   
   ### Changed
   - Increased default maxPriceDeviationPct to 2.5% (#45)
   ```

3. **Create git tag**
   ```bash
   git tag -a v1.1.0 -m "Release v1.1.0"
   git push origin v1.1.0
   ```

4. **Create GitHub release**
   - Tag: v1.1.0
   - Title: TradeGuard v1.1.0
   - Description: Copy from CHANGELOG.md
   - Upload: None (users install from npm/git)

5. **Announce** (optional)
   - Twitter/X
   - Binance Developer Community
   - Hackathon Discord

---

## Questions?

- **General questions**: Open a GitHub Discussion
- **Bug reports**: Create an issue
- **Security issues**: Email maintainers directly (don't create public issue)

---

Thank you for contributing to TradeGuard!
